import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { ProofClip } from '@/components/economy/proof-clip';
import { getVouchRequest, submitVouch } from '@/lib/api/vouch';
import type { VouchRequest } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// "DID THEY?" — the friend's half of the honour path (CODE_PROMPT §B, migration 0164).
//
// Route target of the `vouch_requested` notification, so it must survive being opened cold: from a
// push, days later, by someone who has forgotten they were asked, and possibly after the window
// has already closed. Every one of those is a rendered state below rather than an error.
//
// TWO BUTTONS, AND "NAH" IS REAL. It would be easy to ship only the affirmative and call the other
// path "close the screen" — but a vouch you can only agree to is not a signal, it is a formality,
// and the whole gradient rests on the vouch meaning something. So "Nah" is recorded. It is also
// explicitly NOT a penalty: the spec's rule is that a reward can only fail to rise, never fall, and
// the copy says so, because a friend who thinks tapping it will cost someone their crate will not
// tap it honestly.
//
// THE COLLUSION CAP IS EXPLAINED, NOT SWALLOWED. submit_vouch can accept a vouch and decline to
// COUNT it (same pair twice in 30 days, five a week from one giver). Silently showing "thanks"
// would be a small lie; the screen says the vouch was recorded but did not count, without lecturing
// about why the rule exists.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export default function VouchScreen() {
  const router = useRouter();
  const { goalId } = useLocalSearchParams<{ goalId: string }>();

  const [req, setReq] = useState<VouchRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ counted: boolean; resolved: boolean; verdict: boolean } | null>(null);

  const load = useCallback(() => {
    getVouchRequest(goalId)
      .then(setReq)
      .catch((e) => setError(getErrorMessage(e, 'That request could not be loaded.')));
  }, [goalId]);

  useEffect(() => {
    load();
  }, [load]);

  const answer = async (verdict: boolean) => {
    setBusy(true);
    try {
      const res = await submitVouch(goalId, verdict);
      setOutcome({ counted: res.counted, resolved: res.resolved, verdict });
    } catch (e) {
      setError(getErrorMessage(e, 'That did not go through.'));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Vouch', headerShown: true }} />
        <Text style={styles.error}>{error}</Text>
        <PrimaryButton label="Close" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!req) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Vouch', headerShown: true }} />
        <ActivityIndicator style={styles.loading} color={Colors.amber} />
      </Screen>
    );
  }

  const claim = req.label?.trim() || 'that goal';

  // ── the states that are not a question ──
  const closed =
    outcome != null
      ? outcome.verdict
        ? outcome.resolved
          ? { icon: 'checkmark-circle' as const, tint: Colors.green, text: `That's two — ${req.claimant}'s reward just went up.` }
          : outcome.counted
            ? { icon: 'checkmark-circle' as const, tint: Colors.green, text: `Vouched. One more friend and ${req.claimant} gets the full crate.` }
            : { icon: 'time-outline' as const, tint: Colors.muted, text: "Recorded — but it didn't count this time. You've vouched for them recently." }
        : { icon: 'close-circle' as const, tint: Colors.muted, text: "Noted. Nothing was taken away — their reward just doesn't go up." }
      : req.is_mine
        ? { icon: 'person-outline' as const, tint: Colors.muted, text: 'This is your own claim — you cannot vouch for it.' }
        : req.settled
          ? { icon: 'lock-closed-outline' as const, tint: Colors.muted, text: 'This one has already settled.' }
          : req.expired
            ? { icon: 'time-outline' as const, tint: Colors.muted, text: 'The 48-hour window closed. They kept their reward.' }
            : req.my_verdict != null
              ? { icon: 'checkmark-circle' as const, tint: Colors.green, text: 'You already answered this one.' }
              : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Vouch', headerShown: true }} />
      <View style={styles.body}>
        <View style={styles.avatarWrap}>
          {req.claimant_avatar ? (
            <Image source={{ uri: req.claimant_avatar }} style={styles.avatar} contentFit="cover" />
          ) : (
            <Text style={styles.avatarInitial}>{req.claimant.charAt(0).toUpperCase()}</Text>
          )}
        </View>

        <Text style={styles.question}>
          {req.claimant} says they {claim === 'that goal' ? 'did it' : `landed ${claim}`}.
        </Text>
        {/* 0165 / mock 176 frame D — "you decide if it counts". A voucher asked to judge a claim
            they cannot see is being asked to rubber-stamp it, so the clip sits above the buttons.
            ProofClip plays it and draws the goal+date stamp over it FROM THE SERVER's label and
            claimed_at, so what the footage is being passed off as comes from the database rather
            than from pixels the claimant chose. Still not proof — see that component's header. */}
        {req.proof_path ? (
          <ProofClip path={req.proof_path} label={req.label} claimedAt={req.claimed_at} />
        ) : null}

        <Text style={styles.sub}>Did they?</Text>

        {/* Progress toward the two the threshold needs — so a friend can see their tap matters. */}
        {!closed && (
          <Text style={styles.count}>
            {req.vouches} of 2 vouches so far
          </Text>
        )}

        {closed ? (
          <View style={styles.closed}>
            <Ionicons name={closed.icon} size={20} color={closed.tint} />
            <Text style={[styles.closedText, { color: closed.tint }]}>{closed.text}</Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <PrimaryButton label="Vouch for them" onPress={() => answer(true)} loading={busy} disabled={busy} />
            <PrimaryButton label="Nah" variant="ghost" onPress={() => answer(false)} disabled={busy} />
            <Text style={styles.fineprint}>
              Only say yes if you actually believe them. Saying no takes nothing away — it just means their reward
              stays where it is.
            </Text>
          </View>
        )}

        {closed && <PrimaryButton label="Done" variant="ghost" onPress={() => router.back()} />}

        {/* Mock 176 frame D's footer. The per-giver cap is stated UP FRONT rather than discovered
            as a "didn't count" after the fact, and "visible" is the honest part of the deal: a
            vouch is attributable, which is most of what stops it being handed out freely. */}
        <View style={styles.spacer} />
        <Text style={styles.footNote}>Vouching is visible · you can vouch about 5 times a week</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: Spacing.six },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.coral,
    textAlign: 'center',
    marginVertical: Spacing.four,
  },
  body: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.four },
  avatarWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardDark,
    borderWidth: 2,
    borderColor: Colors.amber,
    marginBottom: Spacing.two,
  },
  avatar: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: Fonts.bodyBold, fontSize: 28, color: Colors.ink },
  question: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
    textAlign: 'center',
    lineHeight: 26,
  },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.muted },
  count: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.textTertiary, marginTop: Spacing.two },
  actions: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.four },
  fineprint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  closed: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  closedText: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 13, lineHeight: 19 },
  spacer: { flex: 1, minHeight: Spacing.three },
  footNote: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
});
