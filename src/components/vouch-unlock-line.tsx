import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { previewScopedReward } from '@/lib/api/challenges';
import { asBoxKey } from '@/lib/challenge-tier';
import { BOXES } from '@/lib/economy/boxes';
import type { DifficultyTier, ScopedRewardPreview } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// "EARNS THE FURNACE NOW · VOUCH TO UNLOCK HEPHAESTUS" — the honour cap, said with its way out.
//
// A LEGENDARY grade goal and an EPIC one both paying The Furnace is correct: a self-reported claim
// is capped at 'notable' (goal_paid_band), and that cap is the anti-cheese firewall. What made it
// read as broken was that the card named the tier and the capped crate side by side and said
// nothing else, so "LEGENDARY · The Furnace" looked like a pricing bug.
//
// The EFFORT (what Cindy judged) and the PAYOUT (what you get) are two different things, and this
// line is where the second one names the route to the first: two friends vouch, and the goal pays
// its full band. Since 0209 that route reaches grade goals too.
//
// 🔒 BOTH PRICES ARE THE SERVER'S. The vouched figure is preview_challenge_reward at 'vouched' —
// the same function grant_reward reads at settlement — never a local tier→crate table.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The full-band price, fetched only when the capped one is actually discounted. */
export function useVouchedReward(
  tier: DifficultyTier | null,
  capped: ScopedRewardPreview | null
): ScopedRewardPreview | null {
  // Keyed by the tier it was fetched for, so a card whose goal was re-tiered never shows the old
  // tier's crate for the length of a round trip.
  const [fetched, setFetched] = useState<{ tier: DifficultyTier; preview: ScopedRewardPreview | null } | null>(null);
  const discounted = capped?.discounted === true;

  useEffect(() => {
    if (!tier || !discounted) return;
    let alive = true;
    previewScopedReward(tier, 'vouched').then((preview) => {
      if (alive) setFetched({ tier, preview });
    });
    return () => {
      alive = false;
    };
  }, [tier, discounted]);

  return discounted && fetched?.tier === tier ? fetched.preview : null;
}

/** True when vouching buys something — a better crate or more embers. A discount that changes
 *  neither (a low tier where both levels land on the same band) has nothing to offer. */
export function isRealUpgrade(capped: ScopedRewardPreview | null, vouched: ScopedRewardPreview | null) {
  if (!capped?.discounted || !vouched) return false;
  return vouched.box !== capped.box || vouched.embers > capped.embers;
}

/** "Vessel of Hestia · 90 embers" — what the vouched claim pays IN FULL, instead of the capped price.
 *  Not a delta: "+45 embers" under "earns The Furnace · 45 embers" read as a bonus stacked on the
 *  Furnace, when vouching replaces it. Totals on both lines make it a swap you can compare. */
export function upgradeLabel(_capped: ScopedRewardPreview, vouched: ScopedRewardPreview) {
  const box = asBoxKey(vouched.box);
  const name = box ? BOXES[box].name : 'the full reward';
  return `${name} · ${vouched.embers.toLocaleString('en-US')} embers`;
}

export function VouchUnlockLine({
  capped,
  vouched,
  lead = 'Vouch to unlock',
  style,
}: {
  capped: ScopedRewardPreview | null;
  vouched: ScopedRewardPreview | null;
  /** The verb, which depends on where the line sits — "2 friends vouch → upgrades to" on a live card, "Vouch to
   *  unlock" before a goal exists. */
  lead?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (!capped || !vouched || !isRealUpgrade(capped, vouched)) return null;
  return (
    <View style={[styles.row, style]}>
      <Ionicons name="people-outline" size={12} color={Colors.amber} />
      <Text style={styles.text} numberOfLines={2}>
        {lead} <Text style={styles.strong}>{upgradeLabel(capped, vouched)}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { flex: 1, fontFamily: Fonts.body, fontSize: 11, lineHeight: 15.5, color: Colors.muted },
  strong: { fontFamily: Fonts.bodyBold, color: Colors.amber },
});
