import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

export type SessionPhoto = { id: string; uri: string };

const COLUMNS = 3;
const GRID_GAP = Spacing.two;

// The photos taken during a running lock-in (PHILOI_UI_SPEC.md §12/§13 — the in-session camera is
// the only camera in the app). The redesigned session screen shows only a count badge, so this is
// where you actually look at them.
//
// Delete is hold-then-confirm rather than an always-visible X on every tile: these are one-shot
// photos you can't retake once the moment's passed, so a stray thumb on a 3-up grid must not be
// able to destroy one. Long-press arms exactly one tile, and only the small X commits.
export function SessionPhotoGallery({
  visible,
  photos,
  onRemove,
  onClose,
}: {
  visible: boolean;
  photos: SessionPhoto[];
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [armedId, setArmedId] = useState<string | null>(null);

  // Grid math off the real width so tiles stay square on any device.
  const tileSize = (width - Spacing.four * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

  function close() {
    setArmedId(null);
    onClose();
  }

  function handleRemove(id: string) {
    setArmedId(null);
    onRemove(id);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {/* Tapping the backdrop closes; tapping the sheet itself only disarms, so a mis-tap while a
          photo is armed doesn't also dismiss the whole gallery. */}
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => setArmedId(null)}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>
              {photos.length} photo{photos.length === 1 ? '' : 's'} this session
            </Text>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close photos" accessibilityRole="button">
              <Ionicons name="close" size={20} color={Colors.muted} />
            </Pressable>
          </View>

          <Text style={styles.hint}>{armedId ? 'Tap the ✕ to delete it.' : 'Hold a photo to delete it.'}</Text>

          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {photos.map((p) => {
              const armed = armedId === p.id;
              return (
                <View key={p.id} style={{ width: tileSize, height: tileSize }}>
                  <Pressable
                    onLongPress={() => setArmedId(p.id)}
                    // Any plain tap cancels — including on a DIFFERENT tile, which the sheet's
                    // own onPress can't cover since RN Pressables don't bubble to their parent.
                    onPress={() => setArmedId(null)}
                    delayLongPress={350}
                    style={styles.tilePressable}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={armed ? 'Photo ready to delete' : 'Photo — hold to delete'}>
                    <Image source={{ uri: p.uri }} style={[styles.tile, armed && styles.tileArmed]} contentFit="cover" />
                    {armed && <Animated.View entering={FadeIn.duration(120)} style={styles.armedScrim} pointerEvents="none" />}
                  </Pressable>

                  {armed && (
                    <Animated.View entering={ZoomIn.springify().damping(13)} style={styles.removeWrap}>
                      <Pressable
                        onPress={() => handleRemove(p.id)}
                        hitSlop={10}
                        style={styles.removeBtn}
                        accessibilityLabel="Delete this photo"
                        accessibilityRole="button">
                        <Ionicons name="close" size={13} color={Colors.ink} />
                      </Pressable>
                    </Animated.View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    paddingTop: Spacing.two,
    maxHeight: '75%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.disabled,
    marginBottom: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: 3,
    marginBottom: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingBottom: Spacing.two,
  },
  tilePressable: {
    flex: 1,
  },
  tile: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.card,
    backgroundColor: Colors.disabled,
  },
  tileArmed: {
    opacity: 0.75,
  },
  armedScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: Colors.danger,
  },
  // Overhangs the tile corner so it never covers the photo it's about to remove.
  removeWrap: {
    position: 'absolute',
    top: -6,
    right: -6,
  },
  removeBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
