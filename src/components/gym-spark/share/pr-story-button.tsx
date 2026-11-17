import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { LiftStorySheet } from '@/components/story-sticker/lift-story-sheet';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { GYM_SPARK } from '@/constants/feature-flags';
import type { GymFeedItem } from '@/lib/api/gym-spark';
import { useAuth } from '@/lib/auth/auth-context';
import { liftStatFromPost } from '@/lib/story-sticker/from-post';
import type { AgoraItem } from '@/types/database';

// THE GYM SPARK · "I hit a PR" -> "it's on my story" in two taps (CODE_PROMPT §6).
//
// Tap 1 is this pill; tap 2 is "Add to Instagram Story" in the existing lift sticker sheet
// (story-sticker/lift-story-sheet.tsx — not rebuilt, only fed). The sticker is pre-filled from the
// post's frozen attachments; see lib/story-sticker/from-post.ts for what counts and why a
// caption-only PR never gets a number printed on it.
//
// Only on YOUR OWN post: a story sticker carries the sharer's handle, and sharing someone else's
// lift as your own story is not a thing this button should make easy.

type Props = {
  item: GymFeedItem | (AgoraItem & { is_pr?: boolean });
  /**
   * Treat the post as PR-flagged even though the row does not say so — post detail, whose
   * get_agora_item row has no is_pr and which learns it from the `pr=1` route param instead.
   */
  forcePr?: boolean;
};

export function PrStoryButton({ item, forcePr = false }: Props) {
  const { session } = useAuth();
  // Mounted on the first tap, then kept: a Modal per feed row would cost every row, and keeping it
  // after the first open lets the close slide finish instead of being cut by an unmount.
  const [opened, setOpened] = useState(false);
  const [visible, setVisible] = useState(false);

  if (!GYM_SPARK) return null;
  if (!session?.user.id || item.user_id !== session.user.id) return null;
  const stat = liftStatFromPost({ ...item, is_pr: forcePr || item.is_pr === true });
  if (!stat) return null;

  return (
    <>
      <Pressable
        onPress={() => {
          setOpened(true);
          setVisible(true);
        }}
        hitSlop={8}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Add to Instagram Story">
        <Ionicons name="add-circle" size={13} color={Colors.navEmber2} />
        <Text style={styles.text}>Story</Text>
      </Pressable>
      {opened ? <LiftStorySheet visible={visible} stat={stat} onClose={() => setVisible(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: Colors.navEmber2,
  },
  pressed: { opacity: 0.6 },
  text: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.2,
    color: Colors.navEmber2,
  },
});
