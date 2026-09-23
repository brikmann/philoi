import { StyleSheet, Text, View } from 'react-native';

import { EquippedHexGlow } from '@/components/economy/loadout-bits';
import { PublicIdentity, useResolvedLoadout } from '@/components/economy/public-identity';
import { RankBadge } from '@/components/rank-badge';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { PublicLoadout } from '@/hooks/use-public-loadouts';
import { formatRankTier } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// The compact leaderboard row shared by the Leaderboard tab (design-mocks/11) and the
// intra-campfire board (PHILOI_UI_SPEC.md §15 — "same row style"). Position · avatar · name +
// tier label · mini rank-hexagon (tier color, badge only — never the sort key, that's always
// raw XP) · value. Your row is always highlighted with the coral border/tint.
//
// This row carries the person's EQUIPPED GEAR — halo ring, flare aura, title — because between the
// Leaderboard tab, the campfire panel and the group board it is the single most-seen view of
// another player in the app, and a cosmetic nobody else sees is not a flex. It used to render a
// bare circle, which is why "titles do not show" was reported against three different screens.
//
// `loadout` is REQUIRED-ish in spirit: every caller should pass it down from one
// usePublicLoadouts(ids) call over the whole page. Omitting it falls back to a per-row fetch,
// which on a 30-row board is 30 requests on first paint.

/** Gold/silver/bronze for the top three positions (design-mocks/94's `.rk.g/.s/.b`) — the medal
 * colours of the PLACE, deliberately not the person's rank tier, which the hexagon already says. */
const MEDAL_COLOR: Record<number, string> = { 1: '#F5C542', 2: '#CFD3DC', 3: '#D08A4F' };

export function LeaderboardPersonRow({
  rank,
  userId,
  displayName,
  avatarUrl,
  tier,
  division,
  value,
  secondaryValue,
  isMe,
  loadout,
}: {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  tier: RankTierName;
  division: number;
  value: string;
  /** A smaller line under the value — the campfire roster's weekly-lock-in count (mock 94). */
  secondaryValue?: string;
  isMe: boolean;
  /** Batched at the list — see the note above. */
  loadout?: PublicLoadout;
}) {
  // Resolved once and shared: EquippedHexGlow draws YOUR halo when handed `undefined`, so it must
  // never see the raw prop.
  const resolved = useResolvedLoadout(userId, loadout);

  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <Text style={[styles.pos, MEDAL_COLOR[rank] ? { color: MEDAL_COLOR[rank] } : null]}>{rank}</Text>
      {/* Flares run STATIC here. A board is a long list, and an animated aura per row is the one
          thing in this file that could cost frames while scrolling. */}
      <PublicIdentity
        userId={userId}
        name={displayName}
        avatarUrl={avatarUrl}
        size={30}
        loadout={resolved}
        motion="reduced"
        suffix={isMe ? ' · you' : undefined}
        sub={<Text style={styles.sub}>{formatRankTier(tier, division)}</Text>}
      />
      <View>
        <EquippedHexGlow size={24} loadout={resolved} />
        <RankBadge tier={tier} division={division} size={24} />
      </View>
      <View style={styles.valueColumn}>
        <Text style={styles.val}>{value}</Text>
        {secondaryValue ? <Text style={styles.valSub}>{secondaryValue}</Text> : null}
      </View>
    </View>
  );
}

// The "···" gap the My-university scope drops between the top 10 and your pinned row
// (PHILOI_UI_SPEC.md §417) — you stay findable even at #142.
export function LeaderboardGap() {
  return <Text style={styles.gap}>···</Text>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.card,
  },
  rowMe: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
  },
  pos: {
    width: 18,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  valueColumn: {
    alignItems: 'flex-end',
  },
  val: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  valSub: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  gap: {
    textAlign: 'center',
    color: Colors.textTertiary,
    fontSize: 14,
    letterSpacing: 2,
    paddingVertical: 2,
  },
});
