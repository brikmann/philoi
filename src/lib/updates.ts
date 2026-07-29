import * as Updates from 'expo-updates';

// OTA JS updates (EAS Update, app.config.ts's `updates.url` + eas.json's per-profile `channel`).
// Checked once per cold start. Updates.isEnabled is false in Expo Go and any dev-client build,
// so this is always safe to call regardless of how the app was launched.
//
// Reloads immediately once a fetch succeeds — this runs at launch, before the user has done
// anything with the app yet, so a brief restart here reads as "the app took an extra beat to
// open," not a mid-session interruption. The alternative (apply on the NEXT cold start) sounds
// less disruptive but is actually worse in practice: it silently downloads while the user is
// still looking at the stale JS, so "I reopened it and nothing changed" becomes the norm rather
// than the update actually landing on the launch that fetched it.
export async function checkForAppUpdate(): Promise<void> {
  if (!Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Offline, no channel configured for this build, etc. — never worth surfacing to the user;
    // the app just keeps running on whatever it already launched with.
  }
}
