import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BoardStoryCard } from '@/components/gym-spark/share/board-story-card';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from '@/components/share-card-frame';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { GYM_SPARK } from '@/constants/feature-flags';
import { track } from '@/lib/analytics';
import type { GymBoardRow, GymBoardWindow } from '@/lib/api/gym-spark';
import { canShareToInstagramStories, shareSticker } from '@/lib/story-sticker/share';

// THE GYM SPARK · share your Board standing (CODE_PROMPT §6, mock 402). A share glyph for the Board
// header; tap it, then "Add to Instagram Story". The card is BoardStoryCard (ShareCardFrame with the
// Board's numbers) and the hand-off is the story-sticker path (lib/story-sticker/share.ts) — the same
// settle-then-capture, Instagram-then-system-sheet pipeline the lift and lock-in stickers use.
//
// Hidden when there is nothing worth posting: no row yet, or 0 XP ("#31 · 0 XP" is not a flex, it
// is an ad for not going).

type Props = { row: GymBoardRow | null; window: GymBoardWindow };

export function BoardStoryButton({ row, window }: Props) {
  // Mounted on the first tap, then kept, so the Board pays nothing until someone shares.
  const [opened, setOpened] = useState(false);
  const [visible, setVisible] = useState(false);

  if (!GYM_SPARK || !row || row.xp <= 0) return null;

  return (
    <>
      <Pressable
        onPress={() => {
          setOpened(true);
          setVisible(true);
        }}
        hitSlop={10}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Share your Board standing to your story">
        <Ionicons name="share-outline" size={20} color={Colors.ink} />
      </Pressable>
      {opened ? <BoardStorySheet visible={visible} row={row} window={window} onClose={() => setVisible(false)} /> : null}
    </>
  );
}

function BoardStorySheet({
  visible,
  row,
  window,
  onClose,
}: {
  visible: boolean;
  row: GymBoardRow;
  window: GymBoardWindow;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const exportRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const igReady = canShareToInstagramStories();

  // The preview is scaled to fit; the PNG comes off the hidden full-size instance below, so it is the
  // same 360×640 layout on every phone.
  const scale = Math.min(1, (screenW - Spacing.four * 2) / SHARE_CARD_WIDTH, (screenH * 0.62) / SHARE_CARD_HEIGHT);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const target = await shareSticker(exportRef, { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT });
      if (!target) return;
      void track('story_sticker_shared', { target, backdrop: 'board', window, rank: row.rank });
    } catch (e) {
      console.warn('[board-story] share failed:', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.title}>Share your standing</Text>
            <Text style={styles.sub}>Put the Board on your story.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={Colors.muted} />
          </Pressable>
        </View>

        <View style={styles.stage}>
          <View style={[styles.previewBox, { width: SHARE_CARD_WIDTH * scale, height: SHARE_CARD_HEIGHT * scale }]}>
            <View
              style={{
                position: 'absolute',
                left: (SHARE_CARD_WIDTH * scale - SHARE_CARD_WIDTH) / 2,
                top: (SHARE_CARD_HEIGHT * scale - SHARE_CARD_HEIGHT) / 2,
                transform: [{ scale }],
              }}>
              <BoardStoryCard row={row} window={window} />
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label={igReady ? 'Add to Instagram Story' : 'Share'}
            onPress={() => void share()}
            loading={busy}
          />
          <Text style={styles.hint}>{igReady ? 'Opens your Instagram story composer.' : 'Opens the share sheet.'}</Text>
        </View>

        {/* The export instance — full size, never visible. ShareCardFrame already holds its loops
            still (MotionStill), and shareSticker waits for a painted frame before capturing. */}
        <View style={styles.offscreen} pointerEvents="none">
          <BoardStoryCard ref={exportRef} row={row} window={window} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#0E0A1C' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  title: { fontFamily: Fonts.displayHeavy, fontSize: 19, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, marginTop: 4 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  previewBox: { borderRadius: 20, overflow: 'hidden' },
  actions: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  hint: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary, textAlign: 'center' },
  offscreen: { position: 'absolute', top: -10000, left: 0 },
});
