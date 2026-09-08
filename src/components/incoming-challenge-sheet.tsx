import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RewardRays } from '@/components/economy/reward-reveal';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useOpponentAvatar } from '@/hooks/use-duel-avatars';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { challengeTitle, metricLabel } from '@/lib/challenge-metric';
import { formatTimeLeft } from '@/lib/format';
import type { SocialChallenge } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BEING CHALLENGED IS A MOMENT, NOT A ROW.
//
// Spec: CODE_PROMPT_loop_signoff_meta.md §4, mock 175 (the arena / start card).
//
// WHAT WAS WRONG. Sending a challenge got a full-screen confirmation (ChallengeSentSheet, mock 98)
// — a hero, a summary, a way out. RECEIVING one got `ChallengeAcceptRow`: two buttons at the bottom
// of a card in a list. The asymmetry is the bug. The sender, who chose the moment, got the
// ceremony; the person whose week it actually changes got a row they could scroll past. Mock 175
// draws the arena from the SENDER's angle, and §4's instruction is that the receiver sees the same
// card from theirs — hence one component, `youAre`, rather than a second screen that drifts.
//
// 🔴 THIS DOES NOT REPLACE THE ROW. ChallengeAcceptRow is still correct where it is: a campfire
// feed embed and the challenges tab both need an inline answer, and R5's three faults are encoded
// in it (see that file). This is the surface a PUSH opens onto — the moment — and the row stays the
// shortcut for someone already looking at the list.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// §1 · THE COUNTDOWN IS NOT ALWAYS A COUNTDOWN, and pretending otherwise would be a lie on screen.
//
// §4 asks for "a live countdown". A duel invite mostly cannot have one: create_h2h_challenge (0153)
// inserts `status = 'pending'` and leaves `starts_at` null — "no baseline here: 'pending' has not
// started, and starts_at is null until the opponent accepts" — and respond_to_h2h_challenge takes
// both baselines at the gun. So on the majority of invites there is no end instant to count to,
// and a clock rendered against `ends_at` would sit at "Ended" (formatTimeLeft's word for a null)
// under the words "time left". That is worse than no clock: it tells the receiver they already
// missed it.
//
// So the clock is honest about which of the two facts it has:
//
//   · ends_at set   — a fixed-span race (0124's starts_on/ends_on customs). A real live countdown,
//                     re-rendered every second, because the window is already running.
//   · ends_at null  — the ordinary invite. There is no clock; what the receiver needs to know is
//                     what they are COMMITTING to, so the same slot shows the race window
//                     ("24-hour race") as a stake, not a timer.
//
// Both are drawn in the same place with the same type, so the card has one shape either way.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The window, in the words a person would use. Mirrors ChallengeSentSheet's own formatter. */
function formatWindow(hours: number): string {
  if (hours >= 168) return `${Math.round(hours / 168)}-week`;
  if (hours >= 72) return `${Math.round(hours / 24)}-day`;
  return `${hours}-hour`;
}

/**
 * One fighter in the arena — a photo when there is one, the initial when there is not.
 *
 * The fallback is the idiom body-double-row.tsx already uses rather than `Avatar`, because that
 * component is initials-only and §4 wants the challenger's actual face at size. A 404'd avatar
 * degrades to a letter; it never blanks the card.
 */
function Fighter({
  name,
  avatarUrl,
  you,
  size = 84,
}: {
  name: string;
  avatarUrl: string | null;
  you?: boolean;
  size?: number;
}) {
  return (
    <View style={styles.fighter}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={[styles.face, { width: size, height: size, borderRadius: size / 2 }, you && styles.faceYou]}
        />
      ) : (
        <View
          style={[
            styles.face,
            styles.faceFallback,
            { width: size, height: size, borderRadius: size / 2 },
            you && styles.faceYou,
          ]}
        >
          <Text style={[styles.faceInitial, { fontSize: size * 0.38 }]}>
            {(name.trim().charAt(0) || '?').toUpperCase()}
          </Text>
        </View>
      )}
      <Text style={styles.fighterName} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

export function IncomingChallengeSheet({
  challenge,
  visible,
  busy = false,
  error,
  myName,
  myAvatarUrl,
  onAccept,
  onDecline,
  onClose,
}: {
  challenge: SocialChallenge;
  visible: boolean;
  busy?: boolean;
  /** Surfaced in place of the CTAs' silence — a failed accept must say why. */
  error?: string | null;
  myName: string;
  myAvatarUrl: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const reduceMotion = useReduceMotion();

  // The challenger is whoever is NOT the viewer. On an invite that is always `created_by` — the
  // roster gives the creator 'accepted' and the opponent 'invited' (0153) — but reading it off the
  // creator fields rather than assuming keeps this correct if it is ever shown to a third party.
  const challengerName = challenge.created_by_name || 'Someone';
  const challengerAvatarUrl = useOpponentAvatar(challenge.created_by);

  // §1 — which of the two facts do we have?
  const live = Boolean(challenge.ends_at);
  // A BARE TICK, not the formatted string in state. Storing the text meant writing it once
  // synchronously in the effect body so the first frame was not a second stale — which is the
  // cascading-render pattern react-hooks/set-state-in-effect rejects, and rightly.
  //
  // formatTimeLeft reads the wall clock itself, so the seconds counter is not an INPUT to it; it
  // is only the reason to recompute. Deriving during render off a counter makes the first frame
  // correct for free and keeps the effect purely a subscription, which is what an interval is.
  // Same shape as body-double-row.tsx's live elapsed timer.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Cleared with the sheet: an invisible modal must not hold a 1Hz timer.
    if (!live || !visible) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [live, visible]);
  const clock = useMemo(
    () => (live ? formatTimeLeft(challenge.ends_at) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the recompute trigger
    [live, challenge.ends_at, tick]
  );

  // ── THE CLASH ────────────────────────────────────────────────────────────────────────────────
  //
  // The two fighters slide in from their own edges and meet. It plays ONCE on present, and again —
  // harder — on accept, which is the "duel clash" §4 asks for: accepting should feel like the gun
  // going off, not like a row changing state.
  //
  // One shared value drives both sides (mirrored by sign) so they can never desynchronise, which is
  // the failure two independent springs would eventually produce on a slow frame.
  const clash = useSharedValue(0);
  useEffect(() => {
    if (!visible) return;
    clash.value = 0;
    clash.value = withDelay(
      90,
      withTiming(1, { duration: reduceMotion ? 0 : 420, easing: Easing.out(Easing.cubic) })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one entrance per presentation
  }, [visible]);

  const strike = useSharedValue(0);
  function handleAccept() {
    // The animation is a flourish on top of the call, never a gate in front of it: onAccept fires
    // immediately and the strike plays over the round trip. A clash that had to finish before the
    // RPC started would add ~300ms to every accept for decoration.
    onAccept();
    if (reduceMotion) return;
    strike.value = withSequence(
      withTiming(1, { duration: 160, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 420, easing: Easing.out(Easing.back(2)) })
    );
  }

  const leftStyle = useAnimatedStyle(() => ({
    opacity: clash.value,
    transform: [{ translateX: (clash.value - 1) * 46 + strike.value * 16 }],
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: clash.value,
    transform: [{ translateX: (1 - clash.value) * 46 - strike.value * 16 }],
  }));
  const vsStyle = useAnimatedStyle(() => ({
    opacity: clash.value,
    transform: [{ scale: 0.7 + clash.value * 0.3 + strike.value * 0.5 }],
  }));

  const raceLabel = challenge.race_metric ? metricLabel(challenge.race_metric) : null;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <ScreenBackground>
        {/* The app's own fan, not a second ray language. `challenge_solo` is the amber row, and the
            intensity is mock 175's .34 — the arena is the subject, the light is behind it. */}
        <View style={styles.rays} pointerEvents="none">
          <RewardRays kind="challenge_solo" size={560} intensity={0.32} />
        </View>

        <SafeAreaView style={styles.safe}>
          <View style={styles.topbar}>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* BIDIRECTIONAL COPY, and the reason this component takes `myName` at all. The sender
                sees "You challenged Sam"; this is the same sentence from the other end. Naming the
                challenger in the headline — not in a subtitle under a generic "New challenge" — is
                the whole difference between a notification and a moment. */}
            <Text style={styles.eyebrow}>{"YOU'VE BEEN CHALLENGED"}</Text>
            <Text style={styles.headline} numberOfLines={3}>
              {challengerName} has challenged you
            </Text>

            <View style={styles.arena}>
              <Animated.View style={leftStyle}>
                <Fighter name={challengerName} avatarUrl={challengerAvatarUrl} />
              </Animated.View>

              <Animated.View style={[styles.vsWrap, vsStyle]}>
                <Text style={styles.vs}>VS</Text>
              </Animated.View>

              <Animated.View style={rightStyle}>
                <Fighter name={myName} avatarUrl={myAvatarUrl} you />
              </Animated.View>
            </View>

            {/* THE GOAL, in the challenge's own words. challengeTitle prefers the creator's public
                name over a derived metric label, so a named duel reads as what its owner called it
                rather than as "Most volume". */}
            <View style={styles.card}>
              <Text style={styles.goal} numberOfLines={3}>
                {challengeTitle(challenge)}
              </Text>
              {raceLabel ? <Text style={styles.goalSub}>{raceLabel}</Text> : null}
            </View>

            {/* THE STAKES ROW — what it pays and how long it runs. §1 decides which clock. */}
            <View style={styles.stakes}>
              {challenge.payout_xp > 0 ? (
                <View style={styles.stake}>
                  <Ionicons name="trophy" size={15} color={Colors.amber} />
                  <Text style={styles.stakeText}>
                    +{challenge.payout_xp.toLocaleString('en-US')} XP to the winner
                  </Text>
                </View>
              ) : null}
              <View style={styles.stake}>
                <Ionicons name={live ? 'time' : 'hourglass-outline'} size={15} color={Colors.amber} />
                <Text style={styles.stakeText}>
                  {live ? `${clock} left` : `${formatWindow(challenge.window_hours)} race`}
                </Text>
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.foot}>
            <PrimaryButton
              label="Accept the challenge"
              onPress={handleAccept}
              disabled={busy}
              loading={busy}
            />
            {/* DECLINE IS GRACEFUL (§4): a ghost, not a red destructive button, and it never asks
                "are you sure". Turning down a duel is an ordinary answer, and dressing it as a
                dangerous one pressures the receiver into a race they did not want. */}
            <PrimaryButton label="Not this time" variant="ghost" onPress={onDecline} disabled={busy} />
          </View>
        </SafeAreaView>
      </ScreenBackground>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  rays: {
    position: 'absolute',
    top: '26%',
    left: '50%',
    marginLeft: -280,
    marginTop: -280,
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingTop: 0,
    zIndex: 2,
  },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  eyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    color: Colors.amber,
  },
  headline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 23,
    lineHeight: 29,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  arena: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  fighter: {
    alignItems: 'center',
    width: 104,
  },
  face: {
    borderWidth: 2,
    borderColor: Colors.twilight900,
    backgroundColor: Colors.disabled,
  },
  faceYou: {
    borderColor: Colors.coral,
  },
  faceFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceInitial: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  fighterName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
    marginTop: Spacing.one,
    textAlign: 'center',
  },
  vsWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  vs: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    letterSpacing: 1.2,
    color: Colors.amber,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: Colors.twilight900,
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.four,
    alignItems: 'center',
  },
  goal: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    textAlign: 'center',
  },
  goalSub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  stakes: {
    alignSelf: 'stretch',
    marginTop: Spacing.three,
    gap: Spacing.one,
  },
  stake: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  stakeText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  foot: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
});
