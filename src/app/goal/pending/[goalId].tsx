import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { ProofClip } from '@/components/economy/proof-clip';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { previewScopedReward } from '@/lib/api/challenges';
import { getClaimStatus } from '@/lib/api/vouch';
import { BOXES, BOX_KEYS, type BoxKey } from '@/lib/economy/boxes';
import type { ClaimStatus } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FRAME C — "0 of 2 vouched · 47h left" (mock 176, CODE_PROMPT_honor_vouch.md §3)
//
// The claimant's side of a live window, and the one screen in the flow whose job is to be
// REASSURING rather than persuasive. The reward is already banked at the unverified tier — the
// spec's rule is that it can only fail to rise, never fall — so nothing here is at risk and the
// copy must not imply otherwise. "You keep The Furnace either way" is the load-bearing sentence.
//
// WHY IT NAMES NAMES. Mock frame C shows "Maya & Dee were asked", which needs a roster the schema
// did not have: only ANSWERS were recorded, so this screen could have shown a count and nothing
// else. Migration 0166 made verdict nullable and writes a row at ask time so the people are here.
// It matters because the honest question at this moment is "is anyone actually going to look at
// this", and a bare "0 of 2" reads as failure where "Maya · asked" reads as waiting.
//
// A "Nah" IS SHOWN, and shown neutrally. Hiding it would make the count stall for reasons the
// claimant cannot see, which is worse than the answer itself — and it costs nothing, because a no
// genuinely takes nothing away.
// ══════════════════════════════════════════════════════════════════════════════════════════════

function asBoxKey(key: string | null | undefined): BoxKey | null {
  return key != null && (BOX_KEYS as readonly string[]).includes(key) ? (key as BoxKey) : null;
}

/** "47h left" / "40m left" / "closed". The window is 48h, so hours are the useful unit until the
 *  last hour, when minutes start mattering to someone deciding whether to nudge a friend. */
function timeLeft(deadline: string | null): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'closed';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

export default function ClaimPendingScreen() {
  const router = useRouter();
  const { goalId } = useLocalSearchParams<{ goalId: string }>();

  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crates, setCrates] = useState<{ full: string | null; honor: string | null; fullKey: BoxKey | null }>({
    full: null,
    honor: null,
    fullKey: null,
  });

  const load = useCallback(() => {
    getClaimStatus(goalId)
      .then(setStatus)
      .catch((e) => setError(getErrorMessage(e, 'That claim could not be loaded.')));
  }, [goalId]);

  // Refetch on focus rather than polling: a vouch landing while this screen sits open is the whole
  // reason to come back to it, and returning from the notification is when it needs to be current.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const tier = status?.tier ?? null;
  useEffect(() => {
    if (!tier) return;
    let alive = true;
    Promise.all([previewScopedReward(tier, 'vouched'), previewScopedReward(tier, 'honor')])
      .then(([vouched, honor]) => {
        if (!alive) return;
        const fullKey = asBoxKey(vouched?.box);
        const honorKey = asBoxKey(honor?.box);
        setCrates({
          full: fullKey ? BOXES[fullKey].name : null,
          honor: honorKey ? BOXES[honorKey].name : null,
          fullKey,
        });
      })
      .catch(() => {
        // Names degrade to generic copy; the counts below are the part that must be right.
      });
    return () => {
      alive = false;
    };
  }, [tier]);

  if (error) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Pending vouch', headerShown: true }} />
        <Text style={styles.error}>{error}</Text>
        <PrimaryButton label="Close" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!status) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Pending vouch', headerShown: true }} />
        <ActivityIndicator style={styles.loading} color={Colors.amber} />
      </Screen>
    );
  }

  const needed = status.needed || 2;
  const left = timeLeft(status.deadline);
  const upgraded = status.settled && status.level === 'vouched';
  const pct = Math.min(100, Math.round((status.vouches / needed) * 100));

  return (
    <Screen>
      <Stack.Screen options={{ title: upgraded ? 'Confirmed' : 'Pending vouch', headerShown: true }} />

      <View style={styles.hero}>
        {crates.fullKey ? <BoxArt boxKey={crates.fullKey} size={58} /> : <Ionicons name="cube" size={44} color={Colors.amber} />}
      </View>

      <Text style={styles.count}>
        <Text style={styles.countNum}>{status.vouches}</Text> of {needed} vouched
      </Text>

      <Text style={styles.mid}>
        {upgraded
          ? `Confirmed — ${crates.full ?? 'the full crate'} is yours.`
          : status.settled
            ? `Window closed. You kept ${crates.honor ?? 'your reward'}.`
            : `Full ${crates.full ?? 'crate'} unlocks at ${needed} — you keep ${crates.honor ?? 'the unverified tier'} either way.`}
      </Text>

      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.max(4, pct)}%` }]} />
      </View>

      {/* The roster. Empty only if the ask somehow reached nobody, which the picker prevents. */}
      <View style={styles.roster}>
        {status.asked.map((v) => (
          <View key={v.id} style={styles.chip}>
            {v.avatar ? (
              <Image source={{ uri: v.avatar }} style={styles.chipAvatar} contentFit="cover" />
            ) : (
              <Avatar label={v.name} size={18} />
            )}
            <Text style={styles.chipName} numberOfLines={1}>
              {v.name}
            </Text>
            <Text style={[styles.chipState, v.answered === true && v.counted && styles.chipStateYes]}>
              {v.answered == null
                ? '· asked'
                : v.answered === false
                  ? '· passed'
                  : v.counted
                    ? '· vouched'
                    : /* Recorded but capped by an anti-collusion rule. Shown rather than counted
                         silently, so a stuck total has a visible reason. */
                      "· didn't count"}
            </Text>
          </View>
        ))}
      </View>

      {status.proof_path ? (
        <ProofClip
          path={status.proof_path}
          label={status.label}
          claimedAt={status.claimed_at}
          showCaption={false}
        />
      ) : null}

      <View style={styles.spacer} />

      <Text style={styles.foot}>
        {upgraded
          ? 'Your reward was upgraded automatically.'
          : status.settled
            ? 'Nothing was taken away — an unconfirmed claim just does not go up.'
            : `${left ?? 'The window'} · closes to ${crates.honor ?? 'the unverified tier'} if unconfirmed`}
      </Text>

      <PrimaryButton label="Done" variant="ghost" onPress={() => router.back()} />
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
  hero: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.scrim,
    borderWidth: 2,
    borderColor: 'rgba(160,108,213,0.55)',
    marginTop: Spacing.three,
  },
  count: {
    fontFamily: Fonts.bodyBold,
    fontSize: 24,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  countNum: { color: '#A06CD5' },
  mid: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: Spacing.two,
  },
  bar: {
    height: 8,
    borderRadius: 5,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
    marginTop: Spacing.three,
    marginHorizontal: Spacing.two,
  },
  barFill: { height: '100%', backgroundColor: '#A06CD5' },
  roster: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.three,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
    maxWidth: 190,
  },
  chipAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.disabled },
  chipName: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink, flexShrink: 1 },
  chipState: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary },
  chipStateYes: { color: Colors.green, fontFamily: Fonts.bodySemiBold },
  spacer: { flex: 1, minHeight: Spacing.three },
  foot: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
});
