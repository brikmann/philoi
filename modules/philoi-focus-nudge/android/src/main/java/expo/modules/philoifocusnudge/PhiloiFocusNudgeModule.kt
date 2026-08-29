package expo.modules.philoifocusnudge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.text.TextUtils
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// The app-side half of Focus Nudge on Android — the counterpart of PhiloiFocusNudgeModule.swift,
// and deliberately the same shape so src/lib/focus-nudge.ts can talk to either one.
//
// Its jobs, in the same order as iOS:
//   1. report whether the two permissions are granted, and open the right Settings screen,
//   2. let the user pick from the curated list of guardable apps,
//   3. hand Cindy's pre-fetched line to SharedPreferences so the overlay can draw it offline,
//   4. arm on lock-in start and disarm on lock-in end.
//
// WHERE THE TWO PLATFORMS GENUINELY DIVERGE, and it is worth naming because it is the whole design:
//
//   · PERMISSIONS. iOS has one prompt this module can raise itself. Android has two, and NEITHER
//     can be granted from inside an app — an AccessibilityService cannot be enabled
//     programmatically by any means (that restriction is the point of the permission), and
//     SYSTEM_ALERT_WINDOW is a Settings trip too. So there is no requestAuthorization() here. There
//     are two "open the right Settings page" intents and a screen that explains why, which is all
//     the platform allows.
//
//   · ARMING. iOS applies a ManagedSettingsStore and registers a DeviceActivity schedule, and needs
//     a monitor extension to sweep up after a force-quit. Android arms by writing a timestamp: the
//     accessibility service reads it on every window change, so "armed" is a fact on disk rather
//     than a state applied to the system. Nothing to leak, nothing to sweep — a force-quit leaves a
//     stale `armedAtMs`, and the very next launch's cold-start disarm in FocusNudgeSync clears it.
//     That is why there is no Android equivalent of the 12-hour failsafe window.
//
//   · WHAT WE KNOW. Apple hands back opaque tokens; Android hands back package names. Both sides
//     report only the COUNT upward, so the analytics surface is identical (see FocusNudgeKey.GUARDED).

/** Mirrors FocusNudgeArmOptions in modules/philoi-focus-nudge/index.ts and its Swift twin. */
class FocusNudgeArmOptions : Record {
  /**
   * The iOS failsafe ceiling. Accepted and ignored here — see "ARMING" above; Android has no
   * applied system state that could outlive the process. Kept in the record rather than dropped so
   * one JS call site serves both platforms.
   */
  @Field var maxMinutes: Double = 720.0

  /** What a "continue anyway" buys. This is the one the Android guard actually enforces. */
  @Field var deferMinutes: Double = 10.0
}

class PhiloiFocusNudgeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No react context")

  override fun definition() = ModuleDefinition {
    Name("PhiloiFocusNudge")

    // ─────────────────────────── permissions ───────────────────────────

    /**
     * The shared three-state contract, collapsed onto Android's two switches.
     *
     * "denied" is never returned. On iOS it is a real, distinguishable answer — the user was asked
     * and said no. Android never asks: both permissions are toggles in Settings that have simply
     * not been turned on yet, and there is no way to tell "hasn't got round to it" from "went and
     * turned it off". Reporting "denied" would make the setup screen say "turned off in Settings"
     * to someone who has never seen a prompt.
     */
    Function("authorizationStatus") {
      if (hasAccessibility(context) && Settings.canDrawOverlays(context)) "approved"
      else "notDetermined"
    }

    /** The two switches, separately — the setup screen walks the user through them one at a time. */
    Function("permissions") {
      mapOf(
        "accessibility" to hasAccessibility(context),
        "overlay" to Settings.canDrawOverlays(context),
      )
    }

    /**
     * The system's accessibility list. There is no way to deep-link reliably to Philoi's own row:
     * the `:settings:fragment_args_key` extra that does it is undocumented and OEM skins move or
     * ignore it, so a wrong guess lands on a blank screen. The list plus the on-screen instruction
     * beats a deep link that works on Pixel and nowhere else.
     */
    Function("openAccessibilitySettings") {
      launchSettings(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    Function("openOverlaySettings") {
      launchSettings(
        Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:" + context.packageName),
        )
      )
    }

    // ─────────────────────────── the picker ───────────────────────────

    /**
     * Which of the candidate packages are actually on this phone.
     *
     * The candidates come from JS, out of modules/philoi-focus-nudge/android-guarded-apps.json —
     * the same file the config plugin turns into the manifest's <queries> allow-list. That is the
     * whole reason this app needs no QUERY_ALL_PACKAGES: it never enumerates anything, it asks
     * about a fixed list of ~14 names it declared up front. Anything outside that list is invisible
     * to this call, which is exactly the property the allow-list is meant to have.
     */
    Function("installedPackages") { candidates: List<String> ->
      val packageManager = context.packageManager
      candidates.filter { candidate ->
        try {
          packageManager.getPackageInfo(candidate, 0)
          true
        } catch (e: Exception) {
          // Not installed, or not in <queries>. Indistinguishable from here and the same outcome:
          // the app is not offered.
          false
        }
      }
    }

    /**
     * Shaped like the iOS selection counts so focusNudgeSelectionSize() works unchanged on both.
     * Android has no notion of guarding a category or a web domain, so those are structurally zero.
     */
    Function("selectionCounts") {
      mapOf(
        "applications" to FocusNudgeState.guardedPackages(context).size,
        "categories" to 0,
        "webDomains" to 0,
      )
    }

    /**
     * The current selection, by package name.
     *
     * Yes, this hands package names up to JS — unavoidable, because JS draws the picker and a
     * picker has to know what is ticked. The discipline the iOS side gets for free from Apple's
     * opaque tokens is kept by hand here instead: src/app/focus-nudge.tsx tracks these locally and
     * reports only `count` to analytics, exactly as the iOS screen does. Nothing named ever leaves
     * the phone.
     */
    Function("guardedPackages") { FocusNudgeState.guardedPackages(context).toList() }

    Function("setGuardedPackages") { packages: List<String> ->
      FocusNudgeState.setGuardedPackages(context, packages)
      // Changing the list mid-session takes effect on the next window change, with no re-arm: the
      // service reads the set fresh on every event. An app removed from the list while its nudge is
      // on screen is the one case that needs a hand, so drop the overlay too.
      if (packages.isEmpty()) FocusNudgeOverlay.hide(context)
    }

    Function("clearSelection") {
      FocusNudgeState.setGuardedPackages(context, emptyList())
      FocusNudgeOverlay.hide(context)
    }

    // ─────────────────────────── the handoff ───────────────────────────

    /**
     * Cache the nudge copy for the overlay to read.
     *
     * A JSON string rather than a Record, for the same reason as iOS: the payload is authored
     * end-to-end in JS (src/lib/focus-nudge.ts) so the wording ships over OTA, and both native
     * sides treat it as opaque text. Nothing validates it here — FocusNudgePayload.load() falls
     * back to its built-in card on anything it cannot parse, which is the behaviour we want for a
     * half-written or future-shaped payload anyway.
     */
    Function("writePayload") { json: String ->
      focusNudgePrefs(context).edit().putString(FocusNudgeKey.PAYLOAD, json).apply()
    }

    /** Presentations inside the window — written by the overlay, read here for the next coach call. */
    Function("retreatCount") { windowMs: Double ->
      FocusNudgeState.retreats(context, windowMs).size
    }

    // ─────────────────────────── arm / disarm ───────────────────────────

    Function("isArmed") { FocusNudgeState.isArmed(context) }

    /**
     * Arm for the current lock-in.
     *
     * False is the ordinary answer, not an error: no accessibility grant, no overlay grant, or
     * nothing picked. All three mean "the feature is off", and none of them may ever stop someone
     * locking in.
     */
    AsyncFunction("arm") { options: FocusNudgeArmOptions ->
      if (!hasAccessibility(context)) return@AsyncFunction false
      if (!Settings.canDrawOverlays(context)) return@AsyncFunction false
      if (FocusNudgeState.guardedPackages(context).isEmpty()) return@AsyncFunction false
      // A new session starts clean: a previous session's deferral must not silently swallow the
      // first nudge of this one, and its retreat history must not escalate this one early.
      FocusNudgeState.arm(context, (options.deferMinutes * 60_000).toLong())
      true
    }

    /** End of session. Unconditional and idempotent. */
    AsyncFunction("disarm") {
      FocusNudgeState.disarm(context)
      // A nudge left on screen after its session ended is the only genuinely harmful failure this
      // feature has. Cheap to prevent, so it is prevented unconditionally rather than only on the
      // paths we think can reach here with the overlay up.
      FocusNudgeOverlay.hide(context)
    }

    /**
     * Called on every foreground. On iOS this re-applies a shield a cooldown took down; here there
     * is no applied state to restore — the deferral expires on its own clock — so the only work is
     * noticing that a permission was revoked mid-session and standing down honestly rather than
     * leaving the lock-in screen claiming a guard that is no longer there.
     */
    AsyncFunction("reconcile") {
      if (!FocusNudgeState.isArmed(context)) return@AsyncFunction false
      if (!hasAccessibility(context) || !Settings.canDrawOverlays(context)) {
        FocusNudgeState.disarm(context)
        FocusNudgeOverlay.hide(context)
        return@AsyncFunction false
      }
      !FocusNudgeState.isDeferred(context)
    }
  }

  // ─────────────────────────── plumbing ───────────────────────────

  /**
   * Whether OUR service is in the system's enabled list.
   *
   * Settings.Secure rather than AccessibilityManager.getEnabledAccessibilityServiceList(), because
   * the latter answers "is any service with this feedback type running" and we need "is this exact
   * component enabled" — the difference matters on a phone that has TalkBack on and Philoi off.
   *
   * Also the reason the feature degrades cleanly when the FOCUS_NUDGE_ANDROID build flag is off:
   * the config plugin then never registers the <service>, so this component can never appear in
   * that list, arm() returns false, and every layer above reads it as "not available on this
   * device" rather than as a failure.
   */
  private fun hasAccessibility(context: Context): Boolean {
    val expected = ComponentName(context, PhiloiFocusNudgeAccessibilityService::class.java)
    val enabled = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabled)
    while (splitter.hasNext()) {
      if (ComponentName.unflattenFromString(splitter.next()) == expected) return true
    }
    return false
  }

  private fun launchSettings(intent: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
      return
    }
    // No activity attached (the JS side raced a backgrounding). NEW_TASK is required to start an
    // activity from an application context and would leak the Settings screen into our own task if
    // used while one exists, hence the branch.
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
}
