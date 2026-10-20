import Constants from 'expo-constants';
import type { RefObject } from 'react';
import { Alert, type View } from 'react-native';

import StoryShare from '../../../modules/philoi-story-share';

// Capture + hand-off for the story sticker. Same lazy-require rule as share-card.ts: view-shot,
// expo-sharing and expo-media-library resolve their native bindings at import time, so a build that
// predates any of them must fail inside these try/catches, never at bundle load.

const FACEBOOK_APP_ID: string | null = Constants.expoConfig?.extra?.facebookAppId ?? null;

/** What the Stories composer shows before a photo is picked — the brand's deep purple. */
const STORY_TOP = '#1A1028';
const STORY_BOTTOM = '#07050C';

/** The exported sticker's pixel width — crisp on a 1080-wide Story at any size it gets pinched to. */
export const STICKER_EXPORT_WIDTH = 1080;

/**
 * Photograph the sticker to a PNG on disk. PNG keeps the alpha, so the canvas around the card stays
 * transparent and Instagram composites only the card over the person's photo.
 */
export async function captureSticker(ref: RefObject<View | null>, size: { width: number; height: number }): Promise<string | null> {
  if (!ref.current || size.width <= 0) return null;
  const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
  return captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    width: STICKER_EXPORT_WIDTH,
    height: Math.round((STICKER_EXPORT_WIDTH * size.height) / size.width),
  });
}

/** True when the one-tap Stories hand-off can run — native module present, App ID set, Instagram installed. */
export function canShareToInstagramStories(): boolean {
  if (!StoryShare || !FACEBOOK_APP_ID) return false;
  try {
    return StoryShare.isInstagramAvailable();
  } catch {
    return false;
  }
}

/** Resolves false when Instagram could not take it, so the caller can fall back to the share sheet. */
export async function shareStickerToInstagram(uri: string): Promise<boolean> {
  if (!StoryShare || !FACEBOOK_APP_ID) return false;
  try {
    return await StoryShare.shareStickerToInstagram(uri, FACEBOOK_APP_ID, STORY_TOP, STORY_BOTTOM);
  } catch (e) {
    console.warn('[story-sticker] Instagram hand-off failed:', e);
    return false;
  }
}

/** The fallback for TikTok, Snap and everything else — the system share sheet. */
export async function shareStickerSystem(uri: string): Promise<void> {
  try {
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your lock-in' });
    }
  } catch (e) {
    console.warn('[story-sticker] could not open the share sheet:', e);
  }
}

/** Writes the PNG to the camera roll. Resolves true once it is saved. */
export async function saveStickerToLibrary(uri: string): Promise<boolean> {
  try {
    const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      Alert.alert('Can’t save image', 'Philoi needs photo library access to save your sticker.');
      return false;
    }
    await MediaLibrary.Asset.create(uri);
    return true;
  } catch (e) {
    console.warn('[story-sticker] could not save the sticker:', e);
    Alert.alert('Could not save image', 'Try again.');
    return false;
  }
}
