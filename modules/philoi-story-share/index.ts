import { requireOptionalNativeModule } from 'expo-modules-core';

// Typed access to the Instagram Stories sticker hand-off (iOS pasteboard + instagram-stories://,
// Android ADD_TO_STORY). `requireOptionalNativeModule`, never `requireNativeModule` — same reason as
// philoi-live-activity: a build cut before this module existed must get null here, not a crash at
// import. Every consumer goes through src/lib/story-sticker/share.ts, which falls back to the system
// share sheet when this is null.
type PhiloiStoryShareModule = {
  /** True when Instagram is installed and accepts the Stories hand-off. */
  isInstagramAvailable: () => boolean;
  /** Resolves false when Instagram could not be opened (not installed, file missing). */
  shareStickerToInstagram: (fileUri: string, appId: string, topColor: string, bottomColor: string) => Promise<boolean>;
};

export default requireOptionalNativeModule<PhiloiStoryShareModule>('PhiloiStoryShare');
