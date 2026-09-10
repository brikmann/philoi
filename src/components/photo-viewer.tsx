import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

type PhotoViewerProps = {
  visible: boolean;
  /** A single photo. Kept for the lock-in card, the activity screen and the lock-in detail, which
   *  each only ever have one — `uris` is the general form and this is the one-element case. */
  uri?: string | null;
  /** D3 · a whole post's photos, paged in place. A campfire message can now carry up to ten
   *  (migration 0180), and opening one of them has to be able to reach the other nine without
   *  closing and re-opening the viewer. */
  uris?: string[];
  /** Which of `uris` the viewer opens on — the one that was actually tapped in the grid. */
  initialIndex?: number;
  onClose: () => void;
};

// A tappable lock-in photo opens here full-screen (PHILOI_UI_SPEC.md §12) — "if people share
// gym photos, they need to be able to save them." The remote (signed Supabase) URL has to be
// downloaded to a local file first; expo-media-library can only save a local URI.
export function PhotoViewer({ visible, uri, uris, initialIndex = 0, onClose }: PhotoViewerProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Where in the set we are. The viewer is remounted per open by its `key` at the call site, so
  // this starts at the tapped photo every time rather than at wherever the last open left off.
  const [index, setIndex] = useState(initialIndex);

  // One list, whichever prop was used. `uris` wins when it is non-empty; otherwise the single
  // `uri` is a one-element set, so everything below has exactly one shape to think about.
  const photos = uris && uris.length > 0 ? uris : uri ? [uri] : [];
  // Clamped rather than trusted: `initialIndex` comes from a grid whose message could have been
  // edited or refetched between the tap and this render.
  const safeIndex = Math.min(Math.max(index, 0), Math.max(photos.length - 1, 0));
  const current = photos[safeIndex] ?? null;
  const hasMany = photos.length > 1;

  async function handleSave() {
    if (!current) return;
    setSaving(true);
    setSaved(false);
    try {
      // expo-media-library resolves its native binding at import time, same as expo-audio
      // (see sound.ts's preloadRewardSounds comment) — deferred into this try/catch rather
      // than a static top-level import so a dev-client build that predates this dependency
      // fails gracefully here instead of crashing the whole route this component lives on
      // at bundle-load time (expo-router eagerly requires every route file to build its
      // navigation tree, whether or not that screen is ever visited).
      const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert('Can’t save photo', 'Philoi needs photo library access to save this.');
        return;
      }
      const downloaded = await File.downloadFileAsync(current, new Directory(Paths.cache), { idempotent: true });
      await MediaLibrary.Asset.create(downloaded.uri);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      Alert.alert('Could not save photo', 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={Colors.ink} />
        </Pressable>

        {current && <Image source={{ uri: current }} style={styles.image} contentFit="contain" />}

        {/* D3 · paging. Arrows and a counter rather than a swipeable pager: the image sits inside a
            Modal over a FlatList, and a horizontal gesture there competes with the list underneath
            it — a tap target cannot be stolen by a parent responder the way a pan can. */}
        {hasMany && (
          <>
            <Pressable
              style={[styles.pageBtn, styles.pagePrev]}
              onPress={() => setIndex(safeIndex === 0 ? photos.length - 1 : safeIndex - 1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Previous photo">
              <Ionicons name="chevron-back" size={26} color={Colors.ink} />
            </Pressable>
            <Pressable
              style={[styles.pageBtn, styles.pageNext]}
              onPress={() => setIndex(safeIndex === photos.length - 1 ? 0 : safeIndex + 1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Next photo">
              <Ionicons name="chevron-forward" size={26} color={Colors.ink} />
            </Pressable>
            <View style={styles.counter} pointerEvents="none">
              <Text style={styles.counterText}>
                {safeIndex + 1} / {photos.length}
              </Text>
            </View>
          </>
        )}

        <Pressable style={styles.saveBtn} onPress={handleSave} disabled={saving} accessibilityLabel="Save to photos">
          {saving ? (
            <ActivityIndicator color={Colors.ink} />
          ) : (
            <>
              <Ionicons name={saved ? 'checkmark' : 'download-outline'} size={18} color={Colors.ink} />
              <Text style={styles.saveLabel}>{saved ? 'Saved' : 'Save to photos'}</Text>
            </>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,6,12,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 1,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '75%',
  },
  pageBtn: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  pagePrev: {
    left: 12,
  },
  pageNext: {
    right: 12,
  },
  counter: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  counterText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  saveBtn: {
    position: 'absolute',
    bottom: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.coral,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  saveLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
});
