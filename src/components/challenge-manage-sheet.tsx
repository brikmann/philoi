import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { isPlacement, metricLabel } from '@/lib/challenge-metric';
import {
  cancelSocialChallenge,
  deleteSocialChallenge,
  fetchOpenChallengeChangeRequest,
  forfeitSocialChallenge,
  requestChallengeChange,
  updateGroupChallengeTerms,
} from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import { formatTimeLeft } from '@/lib/format';
import type { ChallengeChangeRequestDetail, SocialChallenge } from '@/types/database';

type ChallengeManageSheetProps = {
  challenge: SocialChallenge;
  myUserId: string;
  onClose: () => void;
  /** Refetch the list — terms may have moved, or the challenge may be over. */
  onChanged: () => void;
  /**
   * Whether the viewer is a campfire admin here (A's useCampfireRole). Only widens who is offered
   * Delete; the RPC decides what is actually allowed, so a wrong `false` hides an action rather
   * than granting one. Defaults false because the global Challenges tab has no campfire context.
   */
  isAdmin?: boolean;
};

// Window presets rather than a free-form number: the stepper in mock 70 walks the same ladder
// the create screen offers, so a challenge can never end up on a window the rest of the app
// can't describe ("1d 4h left" reads fine; "37h" doesn't).
const WINDOW_LADDER = [24, 48, 72, 120, 168];

function windowLabel(hours: number): string {
  if (hours % 168 === 0) return `${hours / 168}w`;
  if (hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}

function stepWindow(current: number, direction: -1 | 1): number {
  const i = WINDOW_LADDER.indexOf(current);
  // An existing challenge can sit on a value the ladder doesn't contain (created before this
  // ladder, or by an older client) — snap to the nearest rung rather than refusing to move.
  if (i === -1) {
    const nearest = WINDOW_LADDER.reduce((a, b) => (Math.abs(b - current) < Math.abs(a - current) ? b : a));
    return nearest;
  }
  return WINDOW_LADDER[Math.min(WINDOW_LADDER.length - 1, Math.max(0, i + direction))];
}

// Manage / edit a challenge (design-mocks/70), opened by the ⋯ kebab on the card. A challenge is
// a two-party agreement, so for h2h both editing and ending go out as a request the other side has
// to agree to (mock 71); nothing here takes effect unilaterally except the forfeit at the bottom,
// which exists so a silent opponent can't trap someone forever.
//
// TWO BODIES, ONE SHEET. Everything above was written for a LIVE race — terms to renegotiate, a
// counterparty to ask. The kebab now opens on drafts, unanswered invites and finished rows too,
// because CAMPFIRE_REDESIGN_SPEC's missing "Delete challenge" has to be reachable exactly where
// there is nothing to renegotiate. So a non-live challenge gets the short body: what it was, and
// the one action that applies.
export function ChallengeManageSheet({ challenge: c, myUserId, onClose, onChanged, isAdmin = false }: ChallengeManageSheetProps) {
  const insets = useSafeAreaInsets();
  const isGroup = c.mode === 'group';
  // A placement race is mode = 'group' but has NO per-member target — target_count is null by
  // constraint (0126), and writing one back would now be rejected by the database rather than
  // quietly stored. So the target stepper and its term row are gated on this, while everything
  // else `isGroup` decides (the creator sets the terms directly, there is no counterparty to ask,
  // ending it ends it) stays true for a placement race and is deliberately left alone.
  const hasTarget = isGroup && !isPlacement(c);
  const isCreator = c.created_by === myUserId;
  const otherName = isCreator ? (c.opponent_name ?? 'them') : c.created_by_name;
  const isLive = c.status === 'active';
  // The server allows the creator OR a campfire admin (0112). Mirrored here so a member is not
  // shown a button that will be refused.
  const canDelete = !isLive && (isCreator || isAdmin);

  const [windowHours, setWindowHours] = useState(c.window_hours);
  const [targetCount, setTargetCount] = useState(c.target_count ?? 1);
  const [openRequest, setOpenRequest] = useState<ChallengeChangeRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // The caller mounts this only while open (see social-challenge-card), so the useState
  // initializers above ARE the re-seed — reopening after a cancelled edit starts from the live
  // terms without an effect syncing props into state on every render.
  useEffect(() => {
    let live = true;
    fetchOpenChallengeChangeRequest(c.id)
      .then((r) => live && setOpenRequest(r))
      .catch(() => live && setOpenRequest(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [c.id]);

  const windowEdited = windowHours !== c.window_hours;
  const targetEdited = hasTarget && targetCount !== (c.target_count ?? 1);
  const edited = windowEdited || targetEdited;
  // Group terms are the creator's to set directly; a member has nothing to edit here.
  const canEdit = isGroup ? isCreator : true;

  async function handleRequestChanges() {
    setBusy(true);
    try {
      if (isGroup) {
        await updateGroupChallengeTerms({
          challengeId: c.id,
          targetCount: targetEdited ? targetCount : null,
          windowHours: windowEdited ? windowHours : null,
        });
      } else {
        await requestChallengeChange({
          challengeId: c.id,
          kind: 'edit',
          proposed: windowEdited ? { window_hours: windowHours } : {},
        });
      }
      onChanged();
      onClose();
    } catch (e) {
      Alert.alert('Could not send that', getErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestCancel() {
    Alert.alert(
      isGroup ? 'End this challenge?' : 'Request to cancel?',
      isGroup
        ? 'This ends the group challenge for everyone. Nobody gets the payout.'
        : `${otherName} has to agree before it ends. Neither side gets the payout if they do.`,
      [
        { text: 'Never mind', style: 'cancel' },
        {
          text: isGroup ? 'End it' : 'Send request',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              if (isGroup) {
                // No counterparty to ask — the creator ending their own group race is the
                // existing unilateral cancel (0053), not a consent request.
                await cancelSocialChallenge(c.id);
              } else {
                await requestChallengeChange({ challengeId: c.id, kind: 'cancel' });
              }
              onChanged();
              onClose();
            } catch (e) {
              Alert.alert('Could not send that', getErrorMessage(e, 'Try again in a moment.'));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  function handleForfeit() {
    Alert.alert(
      'Forfeit this challenge?',
      `You bow out now and ${otherName} is left standing. Nobody is paid out. Use this if they've stopped responding.`,
      [
        { text: 'Never mind', style: 'cancel' },
        {
          text: 'Forfeit',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await forfeitSocialChallenge(c.id);
              onChanged();
              onClose();
            } catch (e) {
              Alert.alert('Could not forfeit', getErrorMessage(e, 'Try again in a moment.'));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  function handleDelete() {
    Alert.alert(
      'Delete this challenge?',
      isLive
        ? 'A running race has to be ended with the other side first.'
        : 'It disappears for everyone who could see it. XP already paid out is not clawed back.',
      [
        { text: 'Never mind', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteSocialChallenge(c.id);
              onChanged();
              onClose();
            } catch (e) {
              Alert.alert('Could not delete that', getErrorMessage(e, 'Try again in a moment.'));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  // Was `race_metric === 'lockin_time' ? 'Most lock-in time' : 'Most XP'` — the same two-branch
  // ternary that made a volume duel call itself an XP duel on three other screens.
  const raceLabel = isPlacement(c)
    ? `Placement · ${metricLabel(c.race_metric).toLowerCase()}`
    : isGroup
      ? 'Group · all or nothing'
      : metricLabel(c.race_metric);
  const statusLabel: Record<string, string> = {
    draft: 'not started',
    pending: 'waiting on answers',
    completed: 'finished',
    expired: 'ended',
    declined: 'declined',
  };
  const summary = [
    c.public_name?.trim() || null,
    raceLabel,
    isGroup ? null : `vs ${otherName}`,
    isLive ? formatTimeLeft(c.ends_at) : statusLabel[c.status],
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: Math.max(Spacing.four, insets.bottom + Spacing.two) }]}>
          <View style={styles.grab} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Manage challenge</Text>
            <Text style={styles.summary}>{summary}</Text>

            {!isLive ? (
              // NOT RUNNING — no terms to renegotiate and no counterparty to ask, so the whole
              // consent apparatus below would be offering actions the server refuses. What is
              // left is the spec's missing Delete.
              <>
                <View style={styles.waiting}>
                  <Ionicons name="information-circle-outline" size={16} color={Colors.amber} />
                  <Text style={styles.waitingText}>
                    {c.status === 'draft'
                      ? 'This race has not started, so there is nothing to renegotiate yet.'
                      : c.status === 'pending'
                        ? "It is still waiting on an answer. Once it is running you can ask to change the terms."
                        : 'This one is over. Its result and any XP paid out stay on record.'}
                  </Text>
                </View>

                <TermRow label="Metric" value={<Text style={styles.termFixed}>{raceLabel}</Text>} />
                <TermRow label="Window" value={<Text style={styles.termFixed}>{windowLabel(c.window_hours)}</Text>} />
                {hasTarget && (
                  <TermRow label="Lock-ins each" value={<Text style={styles.termFixed}>{c.target_count}</Text>} />
                )}

                {canDelete ? (
                  <View style={styles.buttons}>
                    <Pressable
                      onPress={handleDelete}
                      disabled={busy}
                      style={[styles.btn, styles.btnDanger]}
                      accessibilityRole="button">
                      <Text style={styles.btnDangerLabel}>Delete challenge</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.hint}>
                    Only the person who started it, or a campfire admin, can delete it.
                  </Text>
                )}
              </>
            ) : loading ? (
              <ActivityIndicator color={Colors.amber} style={styles.loading} />
            ) : openRequest ? (
              // One open request at a time (server-enforced) — offering a second here would just
              // produce an error, so this explains the wait instead.
              <View style={styles.waiting}>
                <Ionicons name="hourglass-outline" size={16} color={Colors.amber} />
                <Text style={styles.waitingText}>
                  {openRequest.is_mine
                    ? `Waiting on ${otherName} to answer your ${openRequest.kind === 'cancel' ? 'request to cancel' : 'change request'}. Nothing changes until they do.`
                    : `${openRequest.requested_by_name} has asked to ${openRequest.kind === 'cancel' ? 'end this early' : 'change the terms'} — check your notifications to answer.`}
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>Terms</Text>

                <TermRow
                  label="Window"
                  edited={windowEdited}
                  value={
                    <>
                      {windowEdited && <Text style={styles.was}>{windowLabel(c.window_hours)}</Text>}
                      {windowEdited && <Text style={styles.arrow}>→</Text>}
                      <Text style={[styles.termValue, windowEdited && styles.termValueNow]}>
                        {windowLabel(windowHours)}
                      </Text>
                      {canEdit && (
                        <Stepper
                          onMinus={() => setWindowHours((h) => stepWindow(h, -1))}
                          onPlus={() => setWindowHours((h) => stepWindow(h, 1))}
                          label="window"
                        />
                      )}
                    </>
                  }
                />

                {hasTarget && (
                  <TermRow
                    label="Lock-ins each"
                    edited={targetEdited}
                    value={
                      <>
                        {targetEdited && <Text style={styles.was}>{c.target_count}</Text>}
                        {targetEdited && <Text style={styles.arrow}>→</Text>}
                        <Text style={[styles.termValue, targetEdited && styles.termValueNow]}>{targetCount}</Text>
                        {canEdit && (
                          <Stepper
                            onMinus={() => setTargetCount((t) => Math.max(1, t - 1))}
                            onPlus={() => setTargetCount((t) => Math.min(50, t + 1))}
                            label="target"
                          />
                        )}
                      </>
                    }
                  />
                )}

                {/* Fixed for the life of the challenge — these are what each side agreed to race
                    on, and letting them move mid-race would make "agree to an extension" a blank
                    cheque. Shown, not hidden, so the terms read as a complete contract. */}
                <TermRow label="Metric" value={<Text style={styles.termFixed}>{raceLabel}</Text>} />
                <TermRow
                  label="Stakes"
                  value={<Text style={styles.termFixed}>🏆 {isGroup ? 'up to ' : 'winner '}+{c.payout_xp} XP</Text>}
                />

                {!isGroup && (
                  <View style={styles.consent}>
                    <Text style={styles.consentEmoji}>🤝</Text>
                    <Text style={styles.consentText}>
                      Any change or cancel needs <Text style={styles.consentName}>{otherName}</Text>&apos;s consent.
                      They&apos;ll get a request to approve — nothing changes until they agree. Progress keeps
                      counting in the meantime.
                    </Text>
                  </View>
                )}

                <View style={styles.buttons}>
                  {canEdit && (
                    <Pressable
                      onPress={handleRequestChanges}
                      disabled={!edited || busy}
                      style={[styles.btn, styles.btnPrimary, (!edited || busy) && styles.btnDisabled]}
                      accessibilityRole="button">
                      <Text style={styles.btnPrimaryLabel}>
                        {isGroup ? 'Save changes' : 'Request changes →'}
                      </Text>
                    </Pressable>
                  )}

                  {(isCreator || !isGroup) && (
                    <Pressable
                      onPress={handleRequestCancel}
                      disabled={busy}
                      style={[styles.btn, styles.btnDanger]}
                      accessibilityRole="button">
                      <Text style={styles.btnDangerLabel}>
                        {isGroup ? 'End challenge' : 'Request to cancel challenge'}
                      </Text>
                    </Pressable>
                  )}
                </View>

                <Text style={styles.hint}>
                  {isGroup
                    ? 'Ending it early stops the race for everyone — no payout.'
                    : 'Cancelling (if agreed) ends it early — neither side gets the payout.'}
                </Text>

                {/* Last resort, deliberately quiet and below the fold of the main actions: the
                    consent route is the clean one, but it can't be the only one or an opponent
                    who simply never answers would trap you here indefinitely. */}
                {!isGroup && (
                  <Pressable onPress={handleForfeit} disabled={busy} style={styles.forfeit} accessibilityRole="button">
                    <Text style={styles.forfeitLabel}>They&apos;ve gone quiet — forfeit &amp; leave</Text>
                  </Pressable>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TermRow({ label, value, edited }: { label: string; value: React.ReactNode; edited?: boolean }) {
  return (
    <View style={[styles.termRow, edited && styles.termRowEdited]}>
      <Text style={styles.termKey}>{label}</Text>
      <View style={styles.termValueWrap}>{value}</View>
    </View>
  );
}

function Stepper({ onMinus, onPlus, label }: { onMinus: () => void; onPlus: () => void; label: string }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onMinus} style={styles.step} hitSlop={6} accessibilityLabel={`Decrease ${label}`}>
        <Text style={styles.stepLabel}>–</Text>
      </Pressable>
      <Pressable onPress={onPlus} style={styles.step} hitSlop={6} accessibilityLabel={`Increase ${label}`}>
        <Text style={styles.stepLabel}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(8,6,12,0.55)',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    maxHeight: '86%',
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.lineStrong,
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  title: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 18,
    color: Colors.ink,
  },
  summary: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 4,
  },
  loading: {
    marginVertical: Spacing.six,
  },
  waiting: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.3)',
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  waitingText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.achieverText,
  },
  sectionLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  termRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 7,
  },
  termRowEdited: {
    borderColor: 'rgba(242,163,60,0.5)',
  },
  termKey: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  termValueWrap: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  termValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  termValueNow: {
    color: Colors.amber,
  },
  was: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  arrow: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  termFixed: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  stepper: {
    flexDirection: 'row',
    gap: 2,
  },
  step: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: Colors.trackAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    lineHeight: 17,
    color: Colors.muted,
  },
  consent: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.3)',
    borderRadius: 12,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  consentEmoji: {
    fontSize: 13,
  },
  consentText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16.5,
    color: Colors.muted,
  },
  consentName: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
  buttons: {
    marginTop: Spacing.three,
    gap: 9,
  },
  btn: {
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: Colors.coral,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnPrimaryLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  // Red is reserved for this one control (mock 72's note) — the trash that opens this sheet is
  // deliberately neutral grey, because opening Manage isn't itself a destructive act.
  btnDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(232,90,90,0.6)',
  },
  btnDangerLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.danger,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  forfeit: {
    alignSelf: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  forfeitLabel: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    textDecorationLine: 'underline',
  },
});
