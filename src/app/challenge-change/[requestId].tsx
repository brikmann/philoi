import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { useChallengeWatch } from '@/hooks/use-challenge-watch';
import { fetchChallengeChangeRequest, respondToChallengeChange } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import { formatSessionDuration } from '@/lib/format';
import type { ChallengeChangeRequestDetail } from '@/types/database';

function windowLabel(hours: number): string {
  if (hours % 168 === 0) return `${hours / 168}w`;
  if (hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}

/** Which single term moved, as a before → after pair. The request is validated server-side to
 * carry only `window_hours` or `target_count`, so this can't come back empty for a live edit. */
function changedTerm(request: ChallengeChangeRequestDetail): { key: string; was: string; now: string } | null {
  const p = request.proposed;
  if (!p) return null;
  if (p.window_hours !== undefined) {
    return { key: 'Window', was: windowLabel(request.current.window_hours), now: windowLabel(p.window_hours) };
  }
  if (p.target_count !== undefined) {
    return { key: 'Lock-ins each', was: String(request.current.target_count ?? '—'), now: String(p.target_count) };
  }
  return null;
}

// Change / cancel consent (design-mocks/71). Reached from the push the other side gets when
// someone asks to change or end a shared challenge — the whole point of migration 0058 is that
// neither of these happens until the person on this screen taps Agree.
export default function ChallengeChangeConsentScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const router = useRouter();
  const { session } = useAuth();

  const [request, setRequest] = useState<ChallengeChangeRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);

  const load = useCallback(async () => {
    if (!requestId) return;
    try {
      setError(null);
      setRequest(await fetchChallengeChangeRequest(requestId));
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't load this request."));
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    load();
  }, [load]);

  // Live standings, so agreeing to an extension is an informed decision rather than a blind one
  // — "you're 25m ahead" is exactly the context that decides the answer. Reuses the Watch
  // screen's own read; passing '' keeps the hook inert until the request resolves.
  const { watch } = useChallengeWatch(request?.challenge_id ?? '');

  async function handleRespond(agree: boolean) {
    if (!request) return;
    setResponding(true);
    try {
      await respondToChallengeChange(request.id, agree);
      router.back();
    } catch (e) {
      Alert.alert('Could not send that', getErrorMessage(e, 'Try again in a moment.'));
      setResponding(false);
    }
  }

  if (loading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Colors.amber} />
      </Screen>
    );
  }

  if (error || !request) {
    return (
      <Screen style={styles.centered}>
        <Text style={styles.muted}>{error ?? "This request isn't around any more."}</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backLabel}>Go back</Text>
        </Pressable>
      </Screen>
    );
  }

  // Already answered, or the viewer is the one who asked — either way there's nothing to decide
  // here, so say so rather than showing live Agree/Decline buttons the server would reject.
  const settled = request.status !== 'pending' || request.challenge_status !== 'active';
  const term = changedTerm(request);
  const isCancel = request.kind === 'cancel';

  const isTimeMetric = request.race_metric === 'lockin_time';
  const fmtScore = (n: number) => (isTimeMetric ? formatSessionDuration(Math.round(n)) : `${Math.round(n)} XP`);
  const iAmCreator = watch ? watch.created_by === session?.user.id : false;
  const myScore = watch ? (iAmCreator ? watch.created_by_score : (watch.opponent_score ?? 0)) : null;
  const theirScore = watch ? (iAmCreator ? (watch.opponent_score ?? 0) : watch.created_by_score) : null;

  return (
    <Screen style={styles.container}>
      <View style={styles.hero}>
        <Avatar label={request.requested_by_name} size={56} lit />
        <Text style={styles.kicker}>{isCancel ? 'Cancel request' : 'Change request'}</Text>
        <Text style={styles.ask}>
          {isCancel ? (
            <>
              <Text style={styles.askName}>{request.requested_by_name}</Text> wants to end it early
            </>
          ) : (
            <>
              <Text style={styles.askName}>{request.requested_by_name}</Text> wants to change your{' '}
              {request.mode === 'group' ? 'group challenge' : 'head-to-head'}
            </>
          )}
        </Text>
      </View>

      {isCancel ? (
        <View style={styles.changeCard}>
          <Text style={styles.changeLabel}>What happens</Text>
          <Text style={styles.cancelBody}>
            The challenge ends now and neither side gets the +{request.payout_xp} XP. Whatever you&apos;ve both
            logged stays on your records.
          </Text>
        </View>
      ) : term ? (
        <View style={styles.changeCard}>
          <Text style={styles.changeLabel}>{term.key}</Text>
          <View style={styles.changeRow}>
            <View style={styles.changeSide}>
              <Text style={styles.changeKey}>Now</Text>
              <Text style={[styles.changeValue, styles.changeWas]}>{term.was}</Text>
            </View>
            <Text style={styles.changeArrow}>→</Text>
            <View style={styles.changeSide}>
              <Text style={styles.changeKey}>Proposed</Text>
              <Text style={[styles.changeValue, styles.changeNow]}>{term.now}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {myScore !== null && theirScore !== null && (
        <View style={styles.recap}>
          <Ionicons name="flash" size={12} color={Colors.achieverText} />
          <Text style={styles.recapText}>
            Right now: <Text style={styles.recapStrong}>You {fmtScore(myScore)}</Text> ·{' '}
            <Text style={styles.recapStrong}>
              {request.requested_by_name} {fmtScore(theirScore)}
            </Text>
          </Text>
        </View>
      )}

      <Text style={styles.note}>
        {settled
          ? 'Nothing to decide here any more.'
          : isCancel
            ? 'Agree and it ends for both of you. Decline and the challenge runs to the finish exactly as it is.'
            : 'Agree and the new terms apply to both of you. Decline and the challenge continues exactly as it is.'}
      </Text>

      <View style={styles.actions}>
        {settled || request.is_mine ? (
          <Pressable onPress={() => router.back()} style={[styles.actionBtn, styles.decline]}>
            <Text style={styles.declineLabel}>
              {request.is_mine && !settled ? 'Waiting on their answer' : 'Close'}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={() => handleRespond(true)}
              disabled={responding}
              style={[styles.actionBtn, styles.agree, responding && styles.busy]}
              accessibilityRole="button">
              <Text style={styles.agreeLabel}>{isCancel ? 'Agree — end it' : 'Agree to the change'}</Text>
            </Pressable>
            <Pressable
              onPress={() => handleRespond(false)}
              disabled={responding}
              style={[styles.actionBtn, styles.decline, responding && styles.busy]}
              accessibilityRole="button">
              <Text style={styles.declineLabel}>Decline — keep it as is</Text>
            </Pressable>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Spacing.six,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  muted: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textAlign: 'center',
  },
  backBtn: {
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  backLabel: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
  hero: {
    alignItems: 'center',
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Colors.amber,
    marginTop: Spacing.two,
  },
  ask: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 19,
    lineHeight: 24,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  askName: {
    color: Colors.achieverText,
  },
  changeCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: Spacing.three,
    marginTop: Spacing.four,
  },
  changeLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginBottom: 9,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  changeSide: {
    flex: 1,
    alignItems: 'center',
  },
  changeKey: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  changeValue: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 20,
    marginTop: 3,
    color: Colors.ink,
  },
  changeWas: {
    fontSize: 16,
    color: Colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  changeNow: {
    color: Colors.amber,
  },
  changeArrow: {
    fontFamily: Fonts.body,
    fontSize: 18,
    color: Colors.coral,
  },
  cancelBody: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.muted,
  },
  recap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.three,
  },
  recapText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  recapStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  actions: {
    marginTop: 'auto',
    gap: 9,
    paddingBottom: Spacing.two,
  },
  actionBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  busy: {
    opacity: 0.6,
  },
  agree: {
    backgroundColor: Colors.coral,
  },
  agreeLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  decline: {
    backgroundColor: Colors.card,
  },
  declineLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.muted,
  },
});
