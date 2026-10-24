import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { setWorkoutSetRanking } from '@/lib/api/stats';

type PrConsentSheetProps = {
  /** The PR set the clip was just attached to. Null = closed. */
  workoutSetId: string | null;
  exerciseName: string;
  onClose: () => void;
};

// "Post this PR?" (mock 295) — the consent gate between attaching a clip to a PR and that PR
// ranking on its exercise board.
//
// REPORT-ONLY, AND THE COPY SAYS SO. There is no age check anywhere in Philoi, so a clip is never
// publicly browsable: it sits in a private bucket and only a moderator reaches it, and only when
// someone disputes the PR. That is the whole reason this sheet exists — the owner agrees to that one
// review, in plain words, before the number goes up.
//
// Fails soft. Before 0265 the RPC doesn't exist; the clip is already attached either way, so a
// failure just closes the sheet — the set stays logged, and nothing about it is wrong. Backing out
// without choosing changes nothing either: the set keeps the server default (ranked, unverified).
export function PrConsentSheet({ workoutSetId, exerciseName, onClose }: PrConsentSheetProps) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<'post' | 'private' | null>(null);

  async function choose(post: boolean) {
    if (!workoutSetId || busy) return;
    setBusy(post ? 'post' : 'private');
    try {
      await setWorkoutSetRanking(workoutSetId, { private: !post, consent: post });
    } catch {
      // Pre-0265 server, or offline: nothing to tell the lifter that would help them mid-set.
    } finally {
      setBusy(null);
      onClose();
    }
  }

  return (
    <Modal visible={workoutSetId !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grab} />
          <Text style={styles.title}>Post this PR?</Text>
          <Text style={styles.body}>
            Uploading this adds your PR to the <Text style={styles.strong}>{exerciseName}</Text> board. Your clip is kept for
            verification only — <Text style={styles.strong}>not shown publicly</Text>. If someone disputes your PR, a moderator
            reviews the clip. By posting, you consent to that review.
          </Text>

          <View style={styles.shield}>
            <Text style={styles.shieldText}>
              🛡 We never broadcast anyone&apos;s workout video. Clips are review-only — a moderator sees one only if a PR is
              disputed.
            </Text>
          </View>

          <View style={styles.actions}>
            <PrimaryButton label="Post PR & rank" onPress={() => void choose(true)} loading={busy === 'post'} disabled={busy !== null} />
            <Pressable
              onPress={() => void choose(false)}
              disabled={busy !== null}
              style={styles.private}
              accessibilityRole="button">
              <Text style={styles.privateText}>{busy === 'private' ? 'Keeping it private…' : "Keep private — logs it, but won't rank"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 18,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
  },
  strong: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
  shield: {
    marginTop: Spacing.twelve,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(61,168,92,0.3)',
    borderRadius: Radius.card,
    padding: Spacing.twelve,
  },
  shieldText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
  },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  private: {
    alignItems: 'center',
    paddingVertical: Spacing.twelve,
  },
  privateText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
});
