// Guards the `onUserLeaveHint` NPE that Sentry reports when the user presses Home / switches apps.
//
// Must be a config plugin, not a hand-edit to android/app/src/main/java/com/philoi/app/MainActivity.kt:
// /android is gitignored (.gitignore:44) and regenerated on every prebuild and every EAS build.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE CRASH ACTUALLY IS  (verified against the installed sources, RN 0.86.0 / expo 57.0.8)
// ─────────────────────────────────────────────────────────────────────────────
//
// node_modules/react-native/.../ReactActivityDelegate.java:189
//
//     public void onUserLeaveHint() {
//       Objects.requireNonNull(mReactDelegate).onUserLeaveHint();
//     }
//
// THAT `requireNonNull` is the NPE. The null field is `mReactDelegate` — NOT `reactInstanceManager`,
// and not the React context. Three consequences, each of which kills an "obvious" fix:
//
//   1. `reactInstanceManager` IS THE WRONG FIELD, AND CHECKING IT RE-THROWS.
//      The tempting guard is `reactNativeHost.reactInstanceManager?.currentReactContext != null`.
//      But ReactActivityDelegate.java:123 is:
//          public ReactInstanceManager getReactInstanceManager() {
//            return Objects.requireNonNull(mReactDelegate).getReactInstanceManager();
//          }
//      — so the guard dereferences the very field that is null and throws the identical NPE one
//      frame earlier. It also cannot apply here anyway: RN 0.86 is bridgeless, and that accessor is
//      deprecated ("going away in the New Architecture").
//
//   2. THE INNER CALL IS ALREADY NULL-SAFE, so there is nothing else left to guard.
//      ReactDelegate.kt:140 handles both architectures with safe calls
//      (`reactHost?.onHostLeaveHint(activity)`, and `hasInstance()` + `?.` on the old path).
//      The ONLY unguarded dereference on this path is `mReactDelegate` itself.
//
//   3. THE THROW IS ASYNCHRONOUS, SO A `MainActivity.onUserLeaveHint` TRY/CATCH CANNOT CATCH IT.
//      This is the load-bearing reason this override is injected into the DELEGATE and not into
//      MainActivity. Expo wraps our delegate, and expo/.../ReactActivityDelegateWrapper.kt:206 is:
//
//          override fun onUserLeaveHint() {
//            launchLifecycleScopeWithLock {          // <-- coroutine on activity.lifecycleScope
//              loadAppReady.await()
//              reactActivityLifecycleListeners.forEach { it.onUserLeaveHint(activity) }
//              delegate.onUserLeaveHint()            // <-- our override; throws HERE
//            }
//          }
//
//      `super.onUserLeaveHint()` in MainActivity returns the instant that coroutine is *launched*,
//      long before the body runs — so a try/catch around it is already off the stack when the NPE
//      fires. Worse, launchLifecycleScopeWithLock (:446) wraps the block in no try/catch at all, so
//      an uncaught throw there goes straight to the default uncaught-exception handler and takes the
//      process down. Overriding the delegate's method puts our try/catch INSIDE that coroutine,
//      which is the only frame that can actually contain it.
//
// The override lands in the empty `{}` body of the anonymous DefaultReactActivityDelegate that the
// prebuild template already creates, so `super.onUserLeaveHint()` resolves to the throwing
// ReactActivityDelegate method above, and `reactDelegate` resolves to the protected
// `getReactDelegate()` accessor (ReactActivityDelegate.java:112) — the one nullable reader of
// `mReactDelegate` that does NOT call requireNonNull. ReactActivityDelegateWrapper.kt:94 forwards
// that accessor by reflection to the wrapped delegate, so it reads the real field rather than the
// wrapper's own permanently-null one.
//
// `io.sentry.Sentry` is on the app's compile classpath transitively:
// @sentry/react-native/android/build.gradle:58 declares `api 'io.sentry:sentry-android:8.31.0'`
// (`api`, not `implementation`, so it is exposed to consumers).
//
// NOT AFFECTED — the lock-in "still locked in" interstitial. Philoi's leave-detection never used
// this lifecycle hook: it is JS-side AppState in src/components/focus-nudge-sync.tsx, plus the
// native AccessibilityService in modules/philoi-focus-nudge. `onUserLeaveHint` appears nowhere in
// src/ or modules/, so skipping the super call when React is not up cannot suppress the nudge.

const { withMainActivity } = require('@expo/config-plugins');

// Idempotence marker. Also what to grep for in a prebuilt tree to confirm the plugin actually ran.
const MARKER = 'PHILOI_USER_LEAVE_HINT_GUARD';

// The empty body of the anonymous `object : DefaultReactActivityDelegate(...){}` in the template.
//
// The argument list is `[^(){}]*` — NOT `[\s\S]*?` — and that is deliberate. A lazy any-character
// match happily runs PAST the constructor's closing paren to find some later `)` that happens to be
// followed by `{}`, so the moment Expo's template gains a method in that body
// (`){ override fun onPause() {} }`), the plugin would silently inject the guard INSIDE that
// method's braces instead of failing. Forbidding parens and braces pins the match to the real
// argument list (`this, mainComponentName, fabricEnabled` — no parens, no braces) and turns that
// case back into the loud throw below. Covered by the positive controls in the plugin's test.
const ANON_DELEGATE_BODY = /(object\s*:\s*DefaultReactActivityDelegate\s*\([^(){}]*\)\s*)\{\s*\}/;

const OVERRIDE = `{
    // ${MARKER} — injected by plugins/withUserLeaveHintCrashGuard.js. Edit the plugin, not this
    // file: /android is regenerated on every prebuild and every EAS build.
    //
    // Runs INSIDE ReactActivityDelegateWrapper's lifecycle coroutine, which is the only frame that
    // can catch this. super.onUserLeaveHint() is ReactActivityDelegate's
    // \`Objects.requireNonNull(mReactDelegate)\` — null when the user leaves before onCreate has
    // installed the ReactDelegate (cold start), which is the reported Sentry NPE.
    override fun onUserLeaveHint() {
      try {
        if (reactDelegate != null) {
          super.onUserLeaveHint()
        }
      } catch (t: Throwable) {
        // A lifecycle NPE must never take down the app. Report it handled so the signal survives.
        io.sentry.Sentry.captureException(t)
      }
    }
  }`;

module.exports = function withUserLeaveHintCrashGuard(config) {
  return withMainActivity(config, (cfg) => {
    const { language } = cfg.modResults;

    // Java would need a different override syntax entirely. Fail loudly rather than emit Kotlin
    // into a .java file and hand the developer a Gradle error with no explanation.
    if (language !== 'kt') {
      throw new Error(
        `withUserLeaveHintCrashGuard: expected a Kotlin MainActivity, got "${language}". ` +
          'The prebuild template changed shape — update this plugin before shipping.'
      );
    }

    if (cfg.modResults.contents.includes(MARKER)) return cfg;

    // 🔴 The failure mode this guards against is a SILENT one: if the template's shape changes and
    // the anchor stops matching, a `.replace()` that finds nothing returns the string untouched, the
    // plugin reports success, and the crash quietly ships un-guarded. Throw instead.
    if (!ANON_DELEGATE_BODY.test(cfg.modResults.contents)) {
      throw new Error(
        'withUserLeaveHintCrashGuard: could not find the anonymous DefaultReactActivityDelegate ' +
          'body in MainActivity.kt. The prebuild template changed — re-anchor this plugin against ' +
          'the generated file before shipping, or the onUserLeaveHint NPE returns unnoticed.'
      );
    }

    cfg.modResults.contents = cfg.modResults.contents.replace(ANON_DELEGATE_BODY, `$1${OVERRIDE}`);

    return cfg;
  });
};
