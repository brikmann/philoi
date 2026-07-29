import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

type PhotoViewerProps = {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
};

// A tappable lock-in photo opens here full-screen (PHILOI_UI_SPEC.md §12) — "if people share
// gym photos, they need to be able to save them." The remote (signed Supabase) URL has to be
// downloaded to a local file first; expo-media-library can only save a local URI.
export function PhotoViewer({ visible, uri, onClose }: PhotoViewerProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!uri) return;
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
      const downloaded = await File.downloadFileAsync(uri, new Directory(Paths.cache), { idempotent: true });
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

        {uri && <Image source={{ uri }} style={styles.image} contentFit="contain" />}

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
