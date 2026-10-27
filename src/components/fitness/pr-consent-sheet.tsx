import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { pinPrClip } from '@/lib/api/gym-clips';
import { setWorkoutSetClipShown } from '@/lib/api/reel-challenge';
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
// THE COPY SAYS WHO CAN WATCH, BECAUSE THAT IS THE CONSENT. A clip is never publicly browsable — it
// sits in a private bucket behind signed URLs — but gym-clip-playback-url hands one to the owner,
// any circle-mate, and any accepted friend, and a moderator reviews it if the PR is disputed. The
// owner agrees to exactly that audience, in plain words, before the number goes up. Keep this copy
// in step with gym-clip-playback-url's access rule.
//
// Consenting also pins the clip (gym-clip-pin) out of the 90-day retention rule, so the board's
// "✓ clip on file" never outlives the clip. Fire-and-forget: a miss is caught by the service sweep.
//
// Fails soft. Before 0265 the RPC doesn't exist; the clip is already attached either way, so a
// failure just closes the sheet — the set stays logged, and nothing about it is wrong. Backing out
// without choosing changes nothing either: the set keeps the server default (ranked, unverified).
//
// SHOWING IT ON YOUR POSTS IS A SECOND, SEPARATE YES (0282, mock 319). Off by default. On, the clip
// plays on any post that carries this set, to anyone who can open that post, wearing the green
// "✓ this clip verifies it" badge — and friends can ⚔ challenge it. The copy below switches with
// the toggle, because "never shown publicly" stops being true the moment it's on.
export function PrConsentSheet({ workoutSetId, exerciseName, onClose }: PrConsentSheetProps) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<'post' | 'private' | null>(null);
  const [showOnPosts, setShowOnPosts] = useState(false);

  async function choose(post: boolean) {
    if (!workoutSetId || busy) return;
    setBusy(post ? 'post' : 'private');
    try {
      await setWorkoutSetRanking(workoutSetId, { private: !post, consent: post });
      if (post) void pinPrClip(workoutSetId).catch(() => {});
      // Pre-0282 server: the clip just stays where 0266 put it.
      if (post && showOnPosts) await setWorkoutSetClipShown(workoutSetId, true).catch(() => {});
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
            Uploading this adds your PR to the <Text style={styles.strong}>{exerciseName}</Text> board.{' '}
            <Text style={styles.strong}>Your friends and circle-mates can watch this clip to verify it.</Text> It&apos;s never
            shown publicly or to strangers. If your PR is disputed, a moderator reviews it too. By posting, you consent to that.
          </Text>

          <View style={styles.who} accessibilityRole="text" accessibilityLabel="Who can watch: your friends and circle-mates">
            <Text style={styles.whoIcon}>👥</Text>
            <Text style={styles.whoLabel}>Who can watch</Text>
            <Text style={styles.whoValue}>Friends + circle-mates</Text>
          </View>

          <View style={styles.showRow}>
            <View style={styles.showText}>
              <Text style={styles.showLabel}>Show the clip on my posts</Text>
              <Text style={styles.showHint}>Friends can challenge it ⚔ — the clip is the proof.</Text>
            </View>
            <Switch
              value={showOnPosts}
              onValueChange={setShowOnPosts}
              disabled={busy !== null}
              trackColor={{ false: Colors.trackAlt, true: Colors.green }}
              accessibilityLabel="Show the clip on my posts"
            />
          </View>

          <View style={styles.shield}>
            <Text style={styles.shieldText}>
              {showOnPosts
                ? '🎬 When you share this PR, anyone who can see that post can watch the clip. Turn this off and it stays with your connections, and a moderator if a PR is disputed.'
                : '🛡 Clips are never public and never shown to strangers — only your connections, and a moderator if a PR is disputed.'}
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
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.twelve,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.trackAlt,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
  },
  whoIcon: {
    fontSize: 13,
  },
  whoLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  whoValue: {
    marginLeft: 'auto',
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.trackAlt,
    borderRadius: Radius.card,
    paddingVertical: 8,
    paddingHorizontal: Spacing.twelve,
  },
  showText: {
    flex: 1,
    gap: 2,
  },
  showLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  showHint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  shield: {
    marginTop: Spacing.two,
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
