import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChallengeManageSheet } from '@/components/challenge-manage-sheet';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { PublicTitle } from '@/components/economy/loadout-bits';
import { Avatar } from '@/components/ui/avatar';
import { usePublicLoadout } from '@/hooks/use-public-loadouts';
import { cancelSocialChallenge, respondToH2HChallenge } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import { challengeTitle, formatMetricValue, isPlacement, metricLabel } from '@/lib/challenge-metric';
import { formatTimeLeft } from '@/lib/format';
import type { SocialChallenge } from '@/types/database';

type SocialChallengeCardProps = {
  challenge: SocialChallenge;
  myUserId: string;
  onChanged: () => void;
  /** Campfire-admin, when the card is rendered inside a campfire. Widens who is offered Delete
   *  in the manage sheet; the RPC is what actually decides. */
  isAdmin?: boolean;
};

export function SocialChallengeCard({ challenge: c, myUserId, onChanged, isAdmin = false }: SocialChallengeCardProps) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  const isInvite = c.mode === 'h2h' && c.status === 'pending' && c.opponent_id === myUserId;
  const isOutgoingPending = c.mode === 'h2h' && c.status === 'pending' && c.created_by === myUserId;
  const isMine = c.created_by === myUserId;
  const otherId = isMine ? c.opponent_id : c.created_by;
  const oppLoadout = usePublicLoadout(otherId);
  const otherName = isMine ? (c.opponent_name ?? 'them') : c.created_by_name;

  function handleRematch() {
    if (!otherId) return;
    router.push({
      pathname: '/challenge/create',
      params: { opponentId: otherId, opponentName: otherName ?? 'them', mode: 'h2h' },
    });
  }

  async function handleRespond(accept: boolean) {
    try {
      await respondToH2HChallenge(c.id, accept);
      onChanged();
    } catch (e) {
      Alert.alert('Something went wrong', getErrorMessage(e, 'Could not respond to this challenge.'));
    }
  }

  function handleCancel(confirmLabel: string, confirmMessage: string) {
    Alert.alert(confirmLabel, confirmMessage, [
      { text: 'Never mind', style: 'cancel' },
      {
        text: confirmLabel,
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelSocialChallenge(c.id);
            onChanged();
          } catch (e) {
            Alert.alert('Something went wrong', getErrorMessage(e, 'Could not cancel this challenge.'));
          }
        },
      },
    ]);
  }

  // Was a two-branch ternary written when the metric set was {lockin_time, xp}: since 0096 it can
  // also be volume, distance or ai, and all three fell through to "Most XP" / "12000 XP". One
  // shared spec now (challenge-metric.ts) rather than a copy of this on every screen.
  const fmtScore = (n: number) => formatMetricValue(c.race_metric, n);
  const raceLabel = metricLabel(c.race_metric);
  // public_name is what the spec titles the card with; it was written at creation and read by
  // nothing until 0112 started selecting it.
  const title = challengeTitle(c);

  // ── Outgoing invite you sent, still unanswered ──────────────────────────────
  if (isOutgoingPending) {
    return (
      <View style={[styles.card, styles.cardPending]}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="flash" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Head-to-head</Text>
          </View>
          <Text style={styles.clock}>waiting for a response</Text>
        </View>
        <Text style={styles.title}>Challenged {otherName ?? 'them'} · {title}</Text>
        <Pressable style={styles.cancelLink} onPress={() => handleCancel('Cancel challenge', `Cancel your challenge to ${otherName ?? 'them'}?`)}>
          <Text style={styles.cancelLinkText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // ── Incoming invite (accept / decline) ─────────────────────────────────────
  if (isInvite) {
    return (
      <View style={[styles.card, styles.cardInvite]}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="flash" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Head-to-head</Text>
          </View>
          <Text style={styles.clock}>{c.created_by_name} challenged you</Text>
        </View>
        <Text style={styles.title}>{title} · who wins in {c.window_hours}h</Text>
        <View style={styles.footRow}>
          <Ionicons name="trophy" size={12} color={Colors.achieverText} />
          <Text style={styles.footText}>winner +{c.payout_xp} XP</Text>
        </View>
        <View style={styles.actsRow}>
          <Pressable style={styles.acceptBtn} onPress={() => handleRespond(true)}>
            <Text style={styles.acceptLabel}>Accept</Text>
          </Pressable>
          <Pressable style={styles.declineBtn} onPress={() => handleRespond(false)}>
            <Text style={styles.declineLabel}>Decline</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── H2H tug-of-war scoreboard (active / completed) — mock 44 ────────────────
  if (c.mode === 'h2h') {
    const myScore = c.my_score ?? 0;
    const oppScore = c.opponent_score ?? 0;
    const total = myScore + oppScore;
    const myPct = total > 0 ? Math.max(6, Math.min(94, (myScore / total) * 100)) : 50;
    const ahead = c.status === 'completed' ? c.winner_id === myUserId : myScore > oppScore;
    const tied = myScore === oppScore;
    const leadAmt = Math.abs(myScore - oppScore);
    const leadText =
      total === 0
        ? 'No lock-ins logged yet'
        : tied
          ? 'Neck and neck'
          : `${ahead ? 'You lead' : `${otherName} leads`} by ${fmtScore(leadAmt)}`;

    return (
      <View style={styles.card}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="flash" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>{raceLabel}</Text>
          </View>
          <View style={styles.labelLeft}>
            {c.status === 'active' && <View style={styles.livePulse} />}
            <Text style={styles.clock}>{c.status === 'completed' ? 'finished' : formatTimeLeft(c.ends_at)}</Text>
            <ManageKebab visible onPress={() => setManageOpen(true)} />
          </View>
        </View>

        {/* The public name, when there is one, is the headline — the metric has already said what
            the race is in the label row above. */}
        {c.public_name ? (
          <Text style={styles.title} numberOfLines={1}>
            {c.public_name}
          </Text>
        ) : null}

        <View style={styles.matchRow}>
          <View style={styles.matchSide}>
            <View style={[styles.ring, styles.ringYou]}>
              <Avatar label="You" size={40} lit />
            </View>
            <Text style={styles.matchName} numberOfLines={1}>You</Text>
            <Text style={[styles.matchScore, { color: Colors.coral }]}>{fmtScore(myScore)}</Text>
          </View>
          <Text style={styles.vsText}>VS</Text>
          <View style={styles.matchSide}>
            <View style={[styles.ring, styles.ringOpp]}>
              <Avatar label={otherName ?? '?'} size={40} textColor={Colors.sky} />
            </View>
            <Text style={styles.matchName} numberOfLines={1}>{otherName}</Text>
            {/* Your opponent's equipped title — a 1v1 header is exactly where a "Final Boss" or a
                season placement title is supposed to land (21j / mock 64). */}
            <PublicTitle loadout={oppLoadout} compact />
            <Text style={[styles.matchScore, { color: Colors.sky }]}>{fmtScore(oppScore)}</Text>
          </View>
        </View>

        <View style={styles.tugTrack}>
          <View style={[styles.tugYou, { width: `${myPct}%` }]} />
          <View style={styles.tugOpp} />
        </View>
        <Text style={[styles.leadLabel, { color: tied || total === 0 ? Colors.muted : ahead ? Colors.amber : Colors.sky }]}>
          {total > 0 && !tied ? '🔥 ' : ''}{leadText}
        </Text>

        {/* No "Winner +N XP" row here any more (mock 102 v2): the browse surface stays avatars +
            bar + lead + clock, and every reward/rule moved to the Challenge info screen. The
            RESULT line below stays — once it is over, what you won is the news, not clutter. */}

        {c.status === 'completed' && (
          <View style={styles.resultRow}>
            <Text style={[styles.resultText, tied ? styles.resultTied : ahead ? styles.resultWon : styles.resultLost]}>
              {tied ? "It's a tie" : ahead ? `You won +${c.payout_xp} XP` : `${otherName} won`}
            </Text>
            <Pressable style={styles.rematchBtn} onPress={handleRematch}>
              <Ionicons name="refresh" size={12} color={Colors.achieverText} />
              <Text style={styles.rematchText}>Rematch</Text>
            </Pressable>
          </View>
        )}
        {/* The old unilateral "Leave challenge" link is gone — ending a race the other person is
            still running is now a request they answer (mock 70/71), reached through the trash
            above. The no-consent route survives as "forfeit & leave" inside that sheet. */}
        {/* Mounted only while open, so it re-seeds its editable terms from the live challenge
            every time rather than syncing props into state in an effect. */}
        {manageOpen && (
          <ChallengeManageSheet
            challenge={c}
            myUserId={myUserId}
            isAdmin={isAdmin}
            onClose={() => setManageOpen(false)}
            onChanged={onChanged}
          />
        )}
      </View>
    );
  }

  // ── Placement: a ranked board, not a completion bar (mock 114) ──────────────
  //
  // This branch has to come FIRST, because a placement race is mode = 'group' and would otherwise
  // fall into the block below and claim three things that are not true of it: that it is "all or
  // nothing" (it has no shared target), that everyone must lock in `target_count`× (null by
  // constraint, so the title would read "Everyone locks in null×"), and that 0 of 48 are "done"
  // (nothing is there to be done). The segment strip would draw 48 empty pips that can never fill.
  if (isPlacement(c)) {
    const field = c.member_count ?? c.accepted_count ?? 0;
    return (
      <View style={styles.card}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="trophy" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Placement · ranked</Text>
          </View>
          <View style={styles.labelLeft}>
            {c.status === 'active' && <View style={styles.livePulse} />}
            <Text style={styles.clock}>{c.status === 'completed' ? 'finished' : formatTimeLeft(c.ends_at)}</Text>
            <ManageKebab visible onPress={() => setManageOpen(true)} />
          </View>
        </View>

        <Text style={styles.title}>{challengeTitle(c)}</Text>

        <View style={styles.groupCountRow}>
          <Text style={styles.groupCount}>
            <Text style={styles.groupCountBig}>{field}</Text>
            <Text style={styles.groupCountMuted}> racing · {metricLabel(c.race_metric).toLowerCase()}</Text>
          </Text>
        </View>

        <View style={styles.footRow}>
          <Ionicons name="trophy" size={12} color={Colors.achieverText} />
          <Text style={styles.footText}>Everyone places · rewards scale with your band</Text>
        </View>

        {manageOpen && (
          <ChallengeManageSheet
            challenge={c}
            myUserId={myUserId}
            isAdmin={isAdmin}
            onClose={() => setManageOpen(false)}
            onChanged={onChanged}
          />
        )}
      </View>
    );
  }

  // ── Group "all or nothing" completion — mock 45 language ────────────────────
  const memberCount = c.member_count ?? 0;
  const completedCount = c.completed_count ?? 0;
  const segments = Array.from({ length: Math.max(memberCount, 1) }, (_, i) => i < completedCount);
  const everyoneDone = memberCount > 0 && completedCount >= memberCount;

  return (
    <View style={styles.card}>
      <View style={styles.labelRow}>
        <View style={styles.labelLeft}>
          <Ionicons name="people" size={12} color={Colors.achieverText} />
          <Text style={styles.labelText}>Group · all or nothing</Text>
        </View>
        <View style={styles.labelLeft}>
          {c.status === 'active' && <View style={styles.livePulse} />}
          <Text style={styles.clock}>{c.status === 'completed' ? 'finished' : formatTimeLeft(c.ends_at)}</Text>
          <ManageKebab visible onPress={() => setManageOpen(true)} />
        </View>
      </View>

      <Text style={styles.title}>
        {c.public_name?.trim()
          ? c.public_name
          : `Everyone locks in ${c.target_count}× this ${c.window_hours >= 168 ? 'week' : 'window'}`}
      </Text>

      <View style={styles.groupCountRow}>
        <Text style={styles.groupCount}>
          <Text style={[styles.groupCountBig, everyoneDone && { color: Colors.green }]}>{completedCount}</Text>
          <Text style={styles.groupCountMuted}> / {memberCount} done</Text>
        </Text>
        {everyoneDone && <Text style={styles.groupDoneTag}>Everyone finished 🎉</Text>}
      </View>

      <View style={styles.segRow}>
        {segments.map((on, i) => (
          <View key={i} style={[styles.seg, on && styles.segOn]} />
        ))}
      </View>

      <View style={styles.footRow}>
        <Ionicons name="trophy" size={12} color={Colors.achieverText} />
        <Text style={styles.footText}>Everyone who finishes scores</Text>
      </View>

      {manageOpen && (
        <ChallengeManageSheet
          challenge={c}
          myUserId={myUserId}
          isAdmin={isAdmin}
          onClose={() => setManageOpen(false)}
          onChanged={onChanged}
        />
      )}
    </View>
  );
}

// THE ⋯ KEBAB — top-right of the card, after the time-left.
//
// This was a trash can (mock 72), and CAMPFIRE_REDESIGN_SPEC's 🔴 is precisely that: "Manage = a
// kebab / hamburger, not a trash can. The trash-can-as-manage is confusing." It was already the
// wrong glyph for what it did — the old comment here argued at length that the trash was "neutral
// on purpose" because it opens Manage rather than deleting anything, which is the tell: an icon
// that needs a paragraph explaining it does not mean what it depicts is the wrong icon. Now that
// Delete genuinely lives inside the sheet, a trash can would be actively misleading about which
// of the four actions you were about to get.
//
// Visible on every card that has a sheet to open, not only active ones: Delete has to be reachable
// on a draft that never started and on a finished row, which is where it is most wanted.
function ManageKebab({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  if (!visible) return null;
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.manageKebab} accessibilityRole="button" accessibilityLabel="Manage challenge">
      <Ionicons name="ellipsis-horizontal" size={15} color={Colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  cardInvite: {
    borderWidth: 1,
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  cardPending: {
    opacity: 0.85,
  },
  manageKebab: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginLeft: 3,
  },
  cancelLink: {
    marginTop: Spacing.two,
    alignSelf: 'flex-start',
  },
  cancelLinkText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.danger,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  labelText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  clock: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  livePulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  // ── H2H tug-of-war ──
  matchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
    marginBottom: Spacing.two,
  },
  matchSide: {
    width: 96,
    alignItems: 'center',
    gap: 4,
  },
  ring: {
    borderRadius: 999,
    borderWidth: 2.5,
    padding: 1,
  },
  ringYou: {
    borderColor: Colors.coral,
  },
  ringOpp: {
    borderColor: Colors.sky,
  },
  matchName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
    maxWidth: 92,
  },
  matchScore: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  vsText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 22,
  },
  tugTrack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sky,
    overflow: 'hidden',
    marginTop: Spacing.one,
  },
  tugYou: {
    backgroundColor: Colors.coral,
    height: '100%',
  },
  tugOpp: {
    flex: 1,
  },
  leadLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 7,
  },
  // ── Group ──
  groupCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  groupCount: {
    fontFamily: Fonts.body,
  },
  groupCountBig: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  groupCountMuted: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  groupDoneTag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.green,
  },
  segRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 8,
  },
  seg: {
    flex: 1,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
  },
  segOn: {
    backgroundColor: Colors.green,
  },
  // ── shared footer / result ──
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: Spacing.two,
  },
  footText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.achieverText,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  resultText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
  },
  resultWon: {
    color: Colors.green,
  },
  resultLost: {
    color: Colors.muted,
  },
  resultTied: {
    color: Colors.amber,
  },
  rematchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  rematchText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  actsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: Colors.coral,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  acceptLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  declineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  declineLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
});
