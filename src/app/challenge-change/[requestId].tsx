import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { CompeteGlyph } from '@/components/ui/glyphs-compete';
import { Screen } from '@/components/ui/screen';
import { SPACE_GUTTER, SpaceButton, SpaceCard, SpaceEmpty, SpaceHeader } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
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
      <Screen padded={false}>
        <SpaceHeader title="Request" />
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.navEmber} />
        </View>
      </Screen>
    );
  }

  if (error || !request) {
    return (
      <Screen padded={false}>
        <SpaceHeader title="Request" />
        <View style={styles.centered}>
          <SpaceEmpty
            title={error ?? "This request isn't around any more."}
            action={<SpaceButton label="Go back" variant="secondary" onPress={() => router.back()} />}
          />
        </View>
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
    // A modal (no bottom bar): SpaceHeader's chevron is the way out besides the answer buttons.
    <Screen padded={false}>
      <SpaceHeader title={isCancel ? 'Cancel request' : 'Change request'} />
      <View style={styles.container}>
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
        <SpaceCard style={styles.changeCard}>
          <Text style={styles.changeLabel}>What happens</Text>
          <Text style={styles.cancelBody}>
            The challenge ends now and neither side gets the +{request.payout_xp} XP. Whatever you&apos;ve both
            logged stays on your records.
          </Text>
        </SpaceCard>
      ) : term ? (
        <SpaceCard tone="ember" style={styles.changeCard}>
          <Text style={styles.changeLabel}>{term.key}</Text>
          <View style={styles.changeRow}>
            <View style={styles.changeSide}>
              <Text style={styles.changeKey}>Now</Text>
              <Text style={[styles.changeValue, styles.changeWas]}>{term.was}</Text>
            </View>
            <UiGlyph name="forward" size={18} color={Colors.navEmber} />
            <View style={styles.changeSide}>
              <Text style={styles.changeKey}>Proposed</Text>
              <Text style={[styles.changeValue, styles.changeNow]}>{term.now}</Text>
            </View>
          </View>
        </SpaceCard>
      ) : null}

      {myScore !== null && theirScore !== null && (
        <View style={styles.recap}>
          <CompeteGlyph name="bolt" size={13} color={Colors.gold} />
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
          <SpaceButton
            label={request.is_mine && !settled ? 'Waiting on their answer' : 'Close'}
            variant="secondary"
            onPress={() => router.back()}
          />
        ) : (
          <>
            <SpaceButton
              label={isCancel ? 'Agree — end it' : 'Agree to the change'}
              onPress={() => handleRespond(true)}
              disabled={responding}
            />
            <SpaceButton
              label="Decline — keep it as is"
              variant="secondary"
              onPress={() => handleRespond(false)}
              disabled={responding}
            />
          </>
        )}
      </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.four,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE_GUTTER,
  },
  hero: {
    alignItems: 'center',
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.navEmber2,
    marginTop: Spacing.two,
  },
  ask: {
    fontFamily: Fonts.black,
    fontSize: 19,
    lineHeight: 24,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  askName: {
    color: Colors.navEmber2,
  },
  changeCard: {
    marginTop: Spacing.four,
  },
  changeLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
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
    color: Colors.spaceDim,
  },
  changeValue: {
    fontFamily: Fonts.black,
    fontSize: 20,
    marginTop: 3,
    color: Colors.ink,
  },
  changeWas: {
    fontSize: 16,
    color: Colors.spaceFaint,
    textDecorationLine: 'line-through',
  },
  changeNow: {
    color: Colors.navEmber2,
  },
  cancelBody: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.spaceDim,
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
    color: Colors.spaceDim,
  },
  recapStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  actions: {
    marginTop: 'auto',
    gap: 9,
    paddingBottom: Spacing.three,
  },
});
