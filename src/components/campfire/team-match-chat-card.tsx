import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useTeamMatch } from '@/hooks/use-team-match';
import { joinTeamMatch } from '@/lib/api/team-match';
import { getErrorMessage } from '@/lib/errors';
import type { TeamMatch, TeamSide } from '@/types/database';

import { ChallengeChatCard } from './challenge-chat-card';

// THE LIVE MATCH CARD IN THE CHAT — mock 177 §B (migration 0173).
//
// WHY THIS WRAPS ChallengeChatCard RATHER THAN SITTING BESIDE IT. A campfire message row carries
// `attach_kind = 'challenge'` and the challenge's id, and nothing else — the timeline has no idea
// which SHAPE that challenge is, and teaching it would mean a join on every message read. So this
// component asks get_team_match once: null means "not a team match" and the ordinary campfire
// challenge card renders exactly as it did, and a row means this is a match and it draws the
// scoreboard instead. One question, asked by the only component that needs the answer.
//
// 🔴 THIS ONE DOES READ ITS OWN SUBJECT, WHICH ChallengeChatCard DELIBERATELY DOES NOT. Its header
// explains why it doesn't: a member who has not joined yet is not on the roster, so a read scoped
// to the roster would render blank for exactly the people the join CTA is for. That reasoning does
// not transfer, because get_team_match is gated on CAMPFIRE MEMBERSHIP rather than on the roster —
// everyone who can see the message can read the match. And the card has no choice: a live score
// that never changes is not a live score.
//
// THE SCORE IS PUSHED, NOT POLLED. useTeamMatch subscribes to this one row, so the ref's +1 lands
// on every member's card without anyone refreshing — which is the whole of mock 177 §B.

export function TeamMatchChatCard({
  challengeId,
  headline,
  isOwn,
}: {
  challengeId: string;
  headline: string | null;
  isOwn: boolean;
}) {
  const router = useRouter();
  const { match, loading } = useTeamMatch(challengeId);

  // Until the read comes back we render the ordinary card. It is the right answer for every
  // non-match challenge (the common case) and a reasonable placeholder for a match for one frame,
  // which is a great deal better than a spinner in the middle of a chat timeline.
  if (!match) {
    return <ChallengeChatCard challengeId={challengeId} headline={headline} isOwn={isOwn} />;
  }

  return <MatchCard match={match} loading={loading} onOpen={() => router.push(`/challenge/match/${match.id}`)} />;
}

function MatchCard({ match, loading, onOpen }: { match: TeamMatch; loading: boolean; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const live = match.match_state === 'live' && match.status !== 'completed';
  const final = match.match_state === 'final';
  const running = Boolean(match.clock_started_at) && !final;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const clock = useMemo(() => {
    if (!match.clock_started_at || final) return match.clock_elapsed_s;
    return match.clock_elapsed_s + Math.max(0, (now - new Date(match.clock_started_at).getTime()) / 1000);
  }, [match.clock_started_at, match.clock_elapsed_s, final, now]);

  const join = async (team: TeamSide) => {
    setBusy(true);
    setError(null);
    try {
      await joinTeamMatch(match.id, team);
    } catch (e) {
      // Inline, like ChallengeChatCard's: the refusals here are ordinary and legible ("That match
      // is over"), and a modal for a game that finished while you scrolled is heavier than the
      // news deserves.
      setError(getErrorMessage(e, "That didn't go through."));
    } finally {
      setBusy(false);
    }
  };

  const colorA = match.team_a_color ?? Colors.coral;
  const colorB = match.team_b_color ?? Colors.sky;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${match.team_a_name} versus ${match.team_b_name}`}
        style={styles.top}>
        <Text style={styles.sport}>
          {match.sport_emoji} {match.sport_label}
        </Text>
        {final ? (
          <Text style={styles.ft}>FULL TIME</Text>
        ) : live ? (
          <View style={styles.liveWrap}>
            <View style={styles.liveDot} />
            <Text style={styles.live}>LIVE</Text>
          </View>
        ) : (
          <Text style={styles.pending}>NOT STARTED</Text>
        )}
      </Pressable>

      <Pressable onPress={onOpen} style={styles.scoreRow} accessibilityRole="button">
        <View style={styles.scoreSide}>
          <Text style={[styles.teamName, { color: colorA }]} numberOfLines={1}>
            {match.team_a_name}
          </Text>
          <Text style={[styles.score, { color: colorA }]}>{match.score_a}</Text>
        </View>
        <Text style={styles.dash}>–</Text>
        <View style={styles.scoreSide}>
          <Text style={[styles.teamName, { color: colorB }]} numberOfLines={1}>
            {match.team_b_name}
          </Text>
          <Text style={[styles.score, { color: colorB }]}>{match.score_b}</Text>
        </View>
      </Pressable>

      <View style={styles.foot}>
        <Text style={styles.footText} numberOfLines={1}>
          {match.score_mode === 'live' && !final
            ? `⏱ ${Math.floor(clock / 60)}' · ${match.ref_name ?? 'someone'} keeps score`
            : final
              ? `Winners take ${match.winner_reward_tier} · everyone earned something`
              : 'Final score, both sides confirm'}
        </Text>
        <Text style={styles.footCta}>{match.am_i_ref && !final ? 'Open scorekeeper' : 'Open'}</Text>
      </View>

      {/* Pick a side — the match's own version of the Join CTA, and the only thing on this card
          that writes anything. Hidden once the match is over: a roster that could still change
          after the payout would be a way to be paid for a game you did not play. */}
      {!final && match.my_team === null && (
        <View style={styles.joinRow}>
          {(['a', 'b'] as const).map((side) => (
            <Pressable
              key={side}
              disabled={busy || loading}
              onPress={() => join(side)}
              accessibilityRole="button"
              style={[styles.joinBtn, { borderColor: side === 'a' ? colorA : colorB }]}>
              <Text style={[styles.joinText, { color: side === 'a' ? colorA : colorB }]} numberOfLines={1}>
                Join {side === 'a' ? match.team_a_name : match.team_b_name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {!final && match.my_team !== null && (
        <View style={styles.state}>
          <Ionicons name="checkmark-circle" size={15} color={Colors.green} />
          <Text style={styles.joined}>
            You&apos;re on {match.my_team === 'a' ? match.team_a_name : match.team_b_name}
          </Text>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.4)',
    borderRadius: Radius.card,
    padding: Spacing.twelve,
    marginBottom: Spacing.two,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sport: { fontFamily: Fonts.bodyBold, fontSize: 12.5, color: Colors.ink },
  liveWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.danger },
  live: { fontFamily: Fonts.bodyBold, fontSize: 9, letterSpacing: 1, color: Colors.danger },
  ft: { fontFamily: Fonts.bodyBold, fontSize: 9, letterSpacing: 1, color: Colors.green },
  pending: { fontFamily: Fonts.bodyBold, fontSize: 9, letterSpacing: 1, color: Colors.textTertiary },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  scoreSide: { flex: 1, alignItems: 'center', gap: 3 },
  teamName: { fontFamily: Fonts.bodyBold, fontSize: 11.5 },
  score: { fontFamily: Fonts.displayHeavy, fontSize: 34, lineHeight: 38 },
  dash: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.textTertiary },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    paddingTop: Spacing.two,
  },
  footText: { flex: 1, fontFamily: Fonts.body, fontSize: 10.5, color: Colors.muted },
  footCta: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.achieverText },
  joinRow: { flexDirection: 'row', gap: Spacing.two },
  joinBtn: {
    flex: 1,
    height: 36,
    borderRadius: Radius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  joinText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  state: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  joined: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.green },
  error: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.danger },
});
