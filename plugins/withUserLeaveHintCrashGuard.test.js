// Run: node plugins/withUserLeaveHintCrashGuard.test.js
//
// No jest in this repo, so this is a plain script. Run it after every Expo SDK bump — its whole job
// is to notice when the prebuild template's shape drifts out from under the plugin's anchor.
//
// 🔴 THE POSITIVE CONTROLS ARE THE POINT, not the happy path. This plugin's dangerous failure mode
// is silence: a `.replace()` that matches nothing returns the string unchanged, so the plugin
// "succeeds", prebuild "succeeds", and the onUserLeaveHint NPE ships un-guarded with no signal
// anywhere. Two of the checks below therefore assert the plugin THROWS. They are not padding — the
// "anon body is no longer empty" control caught a real bug on first run: the original anchor used a
// lazy `[\s\S]*?` for the constructor arguments, which ran past the constructor's closing paren and
// matched a later `)` + `{}`, injecting the override INSIDE an unrelated method body instead of
// failing. The anchor now forbids parens and braces in the argument list.
//
// TEMPLATE is a verbatim snapshot of the `createReactActivityDelegate` block that
// `expo prebuild --platform android` generated for expo 57.0.8 / RN 0.86.0. It is embedded rather
// than read from android/ on purpose: /android is gitignored (.gitignore:44), so on a fresh clone
// there is nothing to read and a test that reads it would vacuously pass.

const plugin = require('./withUserLeaveHintCrashGuard');

const TEMPLATE = `package com.philoi.app

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }
}
`;

// withMainActivity stashes the mod on the config; pull it back out and drive it directly.
const action = plugin({ name: 'philoi', slug: 'philoi' }).mods.android.mainActivity;
const run = (contents, language = 'kt') =>
  action({ modResults: { contents, language, path: 'MainActivity.kt' }, modRequest: {} });

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (error) {
    console.log(`  FAIL  ${name}\n          ${error.message}`);
    fail++;
  }
}

async function expectThrows(fn, pattern) {
  try {
    await fn();
  } catch (error) {
    if (pattern.test(error.message)) return;
    throw new Error(`threw the wrong error: ${error.message}`);
  }
  throw new Error('did NOT throw — a shape change would ship silently');
}

(async () => {
  await check('injects the guard into the pristine template', async () => {
    const out = (await run(TEMPLATE)).modResults.contents;
    if (!out.includes('override fun onUserLeaveHint')) throw new Error('no override emitted');
    if (!out.includes('if (reactDelegate != null)')) throw new Error('no null guard emitted');
    if (!out.includes('io.sentry.Sentry.captureException')) throw new Error('no Sentry report emitted');
  });

  await check('injects into the delegate body, not the activity body', async () => {
    const out = (await run(TEMPLATE)).modResults.contents;
    const delegate = out.indexOf('object : DefaultReactActivityDelegate');
    const override = out.indexOf('override fun onUserLeaveHint');
    // A MainActivity-level override could not catch the throw: Expo's wrapper dispatches
    // onUserLeaveHint into a coroutine, so super() returns before the NPE fires. See the plugin.
    if (!(override > delegate)) throw new Error('override landed outside the anonymous delegate');
  });

  await check('is idempotent across repeated prebuilds', async () => {
    const once = (await run(TEMPLATE)).modResults.contents;
    const twice = (await run(once)).modResults.contents;
    if (once !== twice) throw new Error('second run changed the file');
    const count = (twice.match(/override fun onUserLeaveHint/g) || []).length;
    if (count !== 1) throw new Error(`override emitted ${count} times`);
  });

  // ── positive controls ──
  await check('THROWS when the anchored class is renamed', () =>
    expectThrows(
      () => run(TEMPLATE.replace('object : DefaultReactActivityDelegate', 'object : SomeNewDelegate')),
      /could not find the anonymous/
    )
  );

  await check('THROWS when the delegate body is no longer empty', () =>
    expectThrows(
      () => run(TEMPLATE.replace('){})', '){ override fun onPause() {} })')),
      /could not find the anonymous/
    )
  );

  await check('THROWS on a Java MainActivity', () =>
    expectThrows(() => run(TEMPLATE, 'java'), /expected a Kotlin MainActivity/)
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
