import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { formatLiftSet, getLiftChallenge, type LiftChallenge } from '@/lib/api/reel-challenge';

// A verified_lift race (0282, mock 319) as its two racers see it: the exact set to beat, and the
// challenger's best verified beat so far. Drawn in place of the generic live score, which reads
// social_challenge_score and can't see the frozen target (it would say "0 vs 0").
//
// The rule, said plainly because it is the whole race: post your own verified clip that beats it.
// A beating clip settles the race early (0282's trigger pulls the clock in; the 10-minute sweep
// pays it and tells both of you). No clip by the end, and the owner holds.

type Props = {
  challengeId: string;
  myUserId: string | undefined;
  ownerName: string;
};

export function LiftChallengeCard({ challengeId, myUserId, ownerName }: Props) {
  const router = useRouter();
  const [lift, setLift] = useState<LiftChallenge | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getLiftChallenge(challengeId)
      .then((l) => {
        if (alive) setLift(l);
      })
      .catch(() => {
        if (alive) setLift(null);
      });
    return () => {
      alive = false;
    };
  }, [challengeId]);

  if (!lift) return null;

  const iAmOwner = myUserId === lift.owner_id;
  const target = formatLiftSet({ weight: lift.target_weight, reps: lift.target_reps });
  const best = lift.best_weight != null && lift.best_reps != null ? formatLiftSet({ weight: lift.best_weight, reps: lift.best_reps }) : null;
  const live = lift.status === 'active';

  const status = lift.beaten
    ? iAmOwner
      ? `Beaten — ${best} on a verified clip.`
      : `You beat it — ${best}, verified. ${live ? 'Settling now.' : ''}`.trim()
    : lift.status === 'pending'
      ? iAmOwner
        ? 'Accept to start the clock.'
        : `Waiting on ${ownerName} to accept.`
      : live
        ? iAmOwner
          ? 'No verified clip has beaten it yet — you hold.'
          : 'Post your own verified clip that beats it to win.'
        : `${ownerName} held.`;

  function watchSource() {
    // The post the race came from — its clip plays there through the same signed path as the reel.
    if (lift?.source_post_id) router.push({ pathname: '/agora/[id]', params: { id: lift.source_post_id, type: 'post' } });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>THE CLIP TO BEAT</Text>
      <Text style={styles.target}>
        {lift.exercise} · <Text style={styles.targetNumber}>{target}</Text>
      </Text>
      <Text style={styles.verified}>✓ verified on {iAmOwner ? 'your' : `${ownerName}'s`} clip</Text>

      <View style={[styles.status, lift.beaten && styles.statusBeaten]}>
        <Text style={styles.statusText}>{status}</Text>
      </View>

      {lift.source_post_id && lift.source_set_id ? (
        <Pressable onPress={watchSource} accessibilityRole="button" style={styles.link} hitSlop={6}>
          <Text style={styles.linkText}>▶ Watch the clip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    padding: Spacing.three,
    marginBottom: Spacing.three,
    gap: 4,
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    color: Colors.spaceFaint,
  },
  target: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: '#FFFFFF',
  },
  targetNumber: {
    color: Colors.navEmber2,
  },
  verified: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.green,
  },
  status: {
    marginTop: Spacing.two,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  statusBeaten: {
    borderWidth: 1,
    borderColor: Colors.green,
  },
  statusText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.ink,
  },
  link: {
    marginTop: Spacing.two,
    alignSelf: 'flex-start',
  },
  linkText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
});
