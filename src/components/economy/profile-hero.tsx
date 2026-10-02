import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BurningName } from '@/components/burning-name';
import { EquippedAvatarHalo, EquippedCardBackdrop, type AuraTier } from '@/components/economy/applied-art';
import { FlareBorder, type FlareBorderMotion } from '@/components/economy/flare-border';
import { publicBannerStyle } from '@/components/economy/public-identity';
import { SeasonChip } from '@/components/economy/season-chip';
import { RankBadge } from '@/components/rank-badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { PublicLoadout } from '@/hooks/use-public-loadouts';
import { seasonPhase } from '@/lib/economy/forge-pass';
import { formatRankTier, formatXpProgress, xpProgressRatio } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE PROFILE COMPOSITE (mock 248) — every equipped family landing on one card.
//
// Back → front:
//   1. FLARE border    — the equipped flare as an animated perimeter around the whole card
//   2. Banner mat      — a thin frame in the banner's colours between the flare and the card
//   3. CARD backdrop   — the equipped card's scene behind everything
//   4. Avatar          — the PERSON (photo, else initial), ringed by the equipped HALO
//   5. Burning name    — a Flame Pass holder's name, on fire
//   6. Title           — the equipped title in its own gradient (loadout-bits)
//   7. Rank strip      — the earned rank hex + the Emberfall season chip (footer)
//
// ONE component, used by the own profile, someone else's profile, the inventory header and the
// loadout picker's live preview. Each of those drew its own copy of this stack before, and they had
// already drifted (the friend profile never drew the card; the inventory never drew the flare the
// way the profile did). A cosmetic that lands here lands identically on all four, and "equipping in
// the loadout updates the preview and the profile together" stops being two things to keep in step:
// both read the same loadout store through the same component.
//
// THE AVATAR IS THE PERSON. The flame is the home-screen and lock-in hero, never the avatar (mock
// 248's fix) — it does not appear on this card at all. A surface that needs to show the equipped
// flame (the loadout preview) passes it as `trailing`.
//
// The rank hex keeps its EARNED metal: RankBadge takes a tier and a division and nothing else, so no
// cosmetic can reach it. That is the anti-pay-to-win line, kept structural rather than by
// convention.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const CARD_RADIUS = 20;

export function ProfileHero({
  userId,
  name,
  handle,
  avatarUrl,
  loadout,
  avatarSize = 64,
  auraTier = 0,
  motion = 'full',
  title,
  nameSuffix,
  trailing,
  footer,
  children,
}: {
  userId: string | null | undefined;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  /** The resolved loadout — the signed-in user's store for your own card, the public read for anyone
   *  else's. `Loadout` from lib/economy/loadout is structurally this same type. */
  loadout: PublicLoadout;
  /** The avatar's own diameter — what EquippedAvatarHalo's `size` means (it adds the ring itself). */
  avatarSize?: number;
  auraTier?: AuraTier;
  motion?: FlareBorderMotion;
  /** The title line. A node rather than a flag because own vs. someone else's title come from two
   *  different reads (EquippedTitle / PublicTitle) and this component must not guess which. */
  title?: ReactNode;
  /** Plain text after the name — never on fire (BurningName's `suffix`). */
  nameSuffix?: ReactNode;
  /** Right of the identity block — the loadout preview's flame. */
  trailing?: ReactNode;
  /** Under the identity row, inside the card — the rank strip. */
  footer?: ReactNode;
  /** Extra lines under the title — university, bio. */
  children?: ReactNode;
}) {
  return (
    <FlareBorder flare={loadout.flare?.flare} radius={CARD_RADIUS + MAT} motion={motion}>
      {/* The Banner is a MAT around the card rather than a layer under it: the card paints its own
          texture edge to edge, so a banner behind it would be equipped and invisible. Bare padding
          when the slot is empty, so the card sits exactly where it always has. */}
      <View style={[styles.mat, publicBannerStyle(loadout)]}>
        <EquippedCardBackdrop
          cardId={loadout.card?.id}
          auraTier={auraTier}
          radius={CARD_RADIUS}
          motion={motion === 'full' ? 'full' : 'still'}>
          <View style={styles.inner}>
            <View style={styles.idRow}>
              <EquippedAvatarHalo
                haloId={loadout.halo?.id}
                size={avatarSize}
                auraTier={auraTier}
                motion={motion === 'full' ? 'full' : 'still'}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={styles.disc}>
                    <Text style={[styles.initial, { fontSize: avatarSize * 0.42 }]}>{name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </EquippedAvatarHalo>
              <View style={styles.info}>
                <BurningName userId={userId} style={styles.name} suffix={nameSuffix} licks>
                  {name}
                </BurningName>
                {handle ? (
                  <Text style={styles.handle} numberOfLines={1}>
                    @{handle}
                  </Text>
                ) : null}
                {title ? <View style={styles.title}>{title}</View> : null}
                {children}
              </View>
              {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
            </View>
            {footer}
          </View>
        </EquippedCardBackdrop>
      </View>
    </FlareBorder>
  );
}

/** The banner mat's width — mock 248 has none, so it stays thin enough to read as a frame. */
const MAT = 3;

type StripRank = {
  tier: RankTierName;
  division: number;
  xp_into_tier: number;
  xp_for_next_tier: number;
};

/**
 * Mock 248's rank strip, for the hero's `footer`: the earned hex, the tier, how far into it, and the
 * Emberfall chip at the right while a season is being played. `sub` replaces the XP line where the
 * caller has something better to say (a board position).
 */
export function HeroRankStrip({ rank, sub }: { rank: StripRank; sub?: string | null }) {
  // While the season runs AND through its claim week — the rank you hold then is still the S1 rank
  // the placement rewards are being settled on. Before S1 opens and after it closes, no chip.
  const phase = seasonPhase();
  const inSeason = phase === 'live' || phase === 'claim-window';

  return (
    <View style={styles.strip}>
      <RankBadge tier={rank.tier} division={rank.division} size={34} />
      <View style={styles.rank}>
        <Text style={styles.rankTier} numberOfLines={1}>
          {formatRankTier(rank.tier, rank.division)}
        </Text>
        <Text style={styles.rankSub} numberOfLines={1}>
          {sub ?? formatXpProgress(rank.xp_into_tier, rank.xp_for_next_tier)}
        </Text>
        <View style={styles.rankBar}>
          <ProgressBar ratio={xpProgressRatio(rank.xp_into_tier, rank.xp_for_next_tier)} height={4} />
        </View>
      </View>
      {inSeason ? <SeasonChip size="sm" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mat: {
    padding: MAT,
    borderRadius: CARD_RADIUS + MAT,
  },
  // Padded INSIDE the card — the card clips to its own bounds, so a margin would only push the row
  // off-centre.
  inner: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three + 2,
    paddingBottom: Spacing.three,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
  },
  disc: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: Fonts.display,
    color: Colors.ember,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  title: {
    marginTop: 4,
  },
  trailing: {
    alignSelf: 'flex-start',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: Spacing.three,
    paddingTop: Spacing.twelve,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  rank: {
    flex: 1,
    minWidth: 0,
  },
  rankTier: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rankSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  rankBar: {
    marginTop: 5,
  },
});
