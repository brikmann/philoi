import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconText } from '@/components/ui/icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  createReelChallenge,
  formatLiftWeight,
  getLiftClipUrls,
  type ReelChallengeWindow,
  type VerifiedLift,
} from '@/lib/api/reel-challenge';
import { setChallengeScope } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraItem } from '@/types/database';

// ⚔ → A PRE-FILLED HEAD-TO-HEAD (mock 319 frame 2). Everything on this sheet comes from the clip's
// badge — the exercise, the exact set, the owner — so there is nothing to dig for: pick a window,
// send. The server re-reads all of it from the post (create_reel_challenge); the window is the only
// thing this sheet tells it.
//
// It rides the existing duel path, so the owner gets the normal invite and can decline it, and the
// race settles through the normal sweep. To win, the challenger posts a verified clip of their own
// that beats the set — the same verification that made this badge.

const WINDOWS: { key: ReelChallengeWindow; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '14d', label: '14 days' },
  { key: 'season', label: 'Season' },
];

/** Same proposal the Versus screen sends (versus/index.tsx DUEL_TIER); the server derives the rest. */
const DUEL_TIER = 'uncommon' as const;

type Props = {
  /** The post and its verified lift. Null = closed. */
  target: { item: AgoraItem; lift: VerifiedLift } | null;
  onClose: () => void;
  /** After a send — the feed re-reads the lift so ⚔ reads "sent". */
  onSent: (postId: string) => void;
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "Deadlift · 1RM" for a single, "Deadlift · 5 reps" otherwise. */
function metricLine(lift: VerifiedLift): string {
  return `${lift.exercise} · ${lift.reps === 1 ? '1RM' : `${lift.reps} reps`}`;
}

export function ReelChallengeSheet({ target, onClose, onSent }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [span, setSpan] = useState<ReelChallengeWindow>('7d');
  const [sending, setSending] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);

  const lift = target?.lift ?? null;
  const setId = lift?.workout_set_id ?? null;

  // Each open starts on the default window.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if ((target?.item.id ?? null) !== openFor) {
    setOpenFor(target?.item.id ?? null);
    setSpan('7d');
    setThumb(null);
  }

  useEffect(() => {
    if (!setId) return;
    let alive = true;
    getLiftClipUrls(setId).then((u) => {
      if (alive) setThumb(u?.posterUrl ?? null);
    });
    return () => {
      alive = false;
    };
  }, [setId]);

  function openExisting(challengeId: string) {
    onClose();
    router.push({ pathname: '/challenge-info/[challengeId]', params: { challengeId } });
  }

  async function send() {
    if (!target || sending) return;
    setSending(true);
    try {
      const duel = await createReelChallenge(target.item.id, span);
      // Swallowed, as on Versus: an unscoped duel pays less, never wrong.
      await setChallengeScope(duel.id, DUEL_TIER).catch(() => {});
      onSent(target.item.id);
      onClose();
      router.push({ pathname: '/challenge-info/[challengeId]', params: { challengeId: duel.id, fresh: '1' } });
    } catch (e) {
      Alert.alert('Challenge not sent', getErrorMessage(e, 'Try again.'));
    } finally {
      setSending(false);
    }
  }

  const who = target ? firstName(target.item.display_name) : '';

  return (
    <Modal visible={target !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      {target && lift ? (
        <View style={[styles.sheet, { paddingBottom: Math.max(Spacing.four, insets.bottom + Spacing.two) }]}>
          <View style={styles.grab} />

          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Icon name="versus" size={18} color={Colors.onEmber} />
            </View>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Challenge {who}
            </Text>
          </View>

          <View style={styles.targetCard}>
            <View style={styles.thumb}>
              {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              <Icon name="play" size={14} color="#FFFFFF" />
            </View>
            <View style={styles.targetText}>
              <Text style={styles.targetName} numberOfLines={1}>
                {metricLine(lift)}
              </Text>
              <IconText icon="check" style={styles.targetVerified} gap={3}>
                verified · {formatLiftWeight(lift.weight)}
                {lift.reps > 1 ? ` × ${lift.reps}` : ''}
              </IconText>
            </View>
          </View>

          <View style={styles.goal}>
            <Text style={styles.goalKicker}>YOUR TARGET</Text>
            <Text style={styles.goalValue}>
              Beat <Text style={styles.goalNumber}>{formatLiftWeight(lift.weight)}</Text>
              {lift.reps > 1 ? ` × ${lift.reps}` : ''}
            </Text>
          </View>

          {lift.my_challenge_id ? (
            <>
              <Text style={styles.note}>You&apos;ve already challenged this clip.</Text>
              <PrimaryButton label="See the challenge" onPress={() => openExisting(lift.my_challenge_id!)} />
            </>
          ) : (
            <>
              <View style={styles.windows} accessibilityRole="radiogroup">
                {WINDOWS.map((w) => {
                  const on = w.key === span;
                  return (
                    <Pressable
                      key={w.key}
                      onPress={() => setSpan(w.key)}
                      style={[styles.window, on && styles.windowOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}>
                      <Text style={[styles.windowText, on && styles.windowTextOn]}>{w.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.note}>
                Logs a real <Text style={styles.noteStrong}>head-to-head</Text> on the board — post your own verified clip to
                win. Winner climbs; both of you get better.
              </Text>

              <PrimaryButton label="Send challenge" onPress={() => void send()} loading={sending} disabled={sending} />
            </>
          )}
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5,3,14,0.62)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#140E26',
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: Spacing.twelve,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#3A2F55',
    alignSelf: 'center',
    marginBottom: Spacing.twelve,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: Spacing.twelve,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  targetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    padding: 11,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetText: {
    flex: 1,
    gap: 2,
  },
  targetName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  targetVerified: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.green,
  },
  goal: {
    alignItems: 'center',
    marginVertical: Spacing.three,
  },
  goalKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    color: Colors.spaceFaint,
  },
  goalValue: {
    marginTop: 3,
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: '#FFFFFF',
  },
  goalNumber: {
    color: Colors.navEmber2,
  },
  windows: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.twelve,
  },
  window: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 11,
    paddingVertical: 9,
  },
  windowOn: {
    borderColor: '#4A3718',
    backgroundColor: 'rgba(255,122,47,0.1)',
  },
  windowText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  windowTextOn: {
    color: '#FFD9B0',
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginBottom: Spacing.twelve,
  },
  noteStrong: {
    fontFamily: Fonts.bodyBold,
    color: '#FFFFFF',
  },
});

