// Registers react-native-health-connect's permission launcher in MainActivity.onCreate.
//
// react-native-health-connect's requestPermission() uses an ActivityResultLauncher that must be
// registered while the Activity is being created. The library's own bundled Expo plugin only wires
// the rationale intent-filter — it does NOT add this registration — so without it requestPermission()
// crashes with "lateinit property requestPermission has not been initialized"
// (matinzd/react-native-health-connect issue #214).
//
// This MUST be a config plugin, not a hand-edit to android/app/.../MainActivity.kt, because android/
// is gitignored (.gitignore) and regenerated on every `expo prebuild` and every EAS build — a raw
// edit would survive exactly one local run and then vanish. This runs during prebuild so the fix is
// permanent.
//
// Method name confirmed against the library docs: HealthConnectPermissionDelegate.setPermissionDelegate(this)
// (NOT `configure`).

const { withMainActivity } = require('@expo/config-plugins');

const IMPORT_LINE = 'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const DELEGATE_CALL = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';

module.exports = function withHealthConnectPermissionDelegate(config) {
  return withMainActivity(config, (cfg) => {
    const { language } = cfg.modResults;
    if (language !== 'kt') {
      throw new Error(
        `withHealthConnectPermissionDelegate: expected a Kotlin MainActivity, got "${language}". ` +
          'Update this plugin if the project switched to Java.'
      );
    }

    let src = cfg.modResults.contents;

    // 1) Add the import, right after the package declaration (idempotent).
    if (!src.includes(IMPORT_LINE)) {
      src = src.replace(/^(package .+)$/m, `$1\n\n${IMPORT_LINE}`);
    }

    // 2) Register the delegate right after super.onCreate(...) inside onCreate (idempotent).
    if (!src.includes(DELEGATE_CALL)) {
      src = src.replace(/(super\.onCreate\([^)]*\))/, `$1\n    ${DELEGATE_CALL}`);
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};
