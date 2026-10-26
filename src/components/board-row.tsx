import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useId, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { EquippedCardBackdrop } from '@/components/economy/applied-art';
import { HouseSeal } from '@/components/house/house-seal';
import { IdentityLine } from '@/components/house/identity-line';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts } from '@/constants/theme';
import type { PublicLoadout } from '@/hooks/use-public-loadouts';
import { titleLabel } from '@/lib/economy/catalog';
import type { PresenceRow } from '@/types/database';
import type { MetricLeaderboardRow } from '@/types/house';

/** A row whose owner wears nothing — the plain panel. */
export const NO_LOADOUT: PublicLoadout = {};

/** '#RRGGBB' (or '#RGB') at an alpha. Anything else comes back as-is, opaque. */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * A board row, styled to ITS OWNER'S equipped loadout (mock 307) — the public flex that sells
 * cosmetics. Same reads the profile and share card use (get_public_loadouts):
 *
 *  · FLARE → `f`: the row's outline and glow, the rank number and the avatar border.
 *  · HALO  → a radial glow ring behind the avatar, in the halo's colour.
 *  · CARD  → the card's own art behind the row (EquippedCardBackdrop, as the profile and the Agora
 *    draw it). Mock 307 asked for a faint tint of its colour, and at 8–22% on the space panel that
 *    read as no card at all — "the leaderboard is plain". Only a worn card is drawn: the backdrop
 *    falls back to the starter Hearth skin, which would paint every row the same.
 *  · FLARE only → a faint gradient of the flare into the panel.
 *  · TITLE → under the name. EARNED titles are ★ + gold; anything acquired another way is italic in
 *    the flare colour. A purchase must never be able to look like an achievement.
 *
 * Nothing equipped draws the plain panel. Your own row keeps the ember edge when you wear no flare.
 * The heir seal and the identity line are untouched.
 *
 * ONE ROW FOR EVERY BOARD. The XP board and the Fitness board both draw this, so a loadout reads
 * the same wherever you rank; the fitness board fills the optional slots (its "Kin · Laurier" line,
 * the PR-clip status, the value's window caption and the ⚔ Versus button).
 */
export function BoardRow({
  row,
  value,
  presence,
  loadout,
  onPressRow,
  onPressAvatar,
  identity,
  extra,
  valueCaption,
  trailing,
}: {
  row: MetricLeaderboardRow;
  value: string;
  presence?: PresenceRow;
  loadout: PublicLoadout;
  onPressRow: (row: MetricLeaderboardRow) => void;
  onPressAvatar: (row: MetricLeaderboardRow) => void;
  /** Replaces the Heir identity line. */
  identity?: ReactNode;
  /** Under the identity line. */
  extra?: ReactNode;
  /** A small line under the value — "last 30 days", "est 1RM". */
  valueCaption?: string;
  /** After the value. */
  trailing?: ReactNode;
}) {
  const haloId = useId();
  const initials = (row.display_name || row.handle || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const flare = loadout.flare ? (loadout.flare.flare?.colour ?? loadout.flare.art.to) : null;
  const f = flare ?? (row.is_me ? Colors.navEmber : null);
  const rankColor = f ?? (row.rank === 1 ? Colors.gold : Colors.spaceDim);
  const card = loadout.card;
  const halo = loadout.halo?.art.from ?? null;
  const title = loadout.title ? { ...titleLabel(loadout.title), earned: loadout.title.acquisition === 'earned' } : null;

  const content = (
    <>
      {!card && f ? (
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(f, 0.14), withAlpha(f, 0)]}
          locations={[0, 0.7]}
          start={{ x: 0, y: 0.3 }}
          end={{ x: 1, y: 0.7 }}
          style={styles.tint}
        />
      ) : null}

      <Text style={[styles.rank, { color: rankColor }]}>{row.rank ?? '—'}</Text>
      <Pressable onPress={() => onPressAvatar(row)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Open profile">
        {halo ? (
          <Svg pointerEvents="none" width={HALO} height={HALO} style={styles.halo}>
            <Defs>
              <RadialGradient id={haloId} cx="50%" cy="50%" r="50%">
                <Stop offset="0.6" stopColor={halo} stopOpacity={0.6} />
                <Stop offset="1" stopColor={halo} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={HALO / 2} cy={HALO / 2} r={HALO / 2} fill={`url(#${haloId})`} />
          </Svg>
        ) : null}
        <View style={[styles.avatarRing, f ? { borderColor: f } : null]}>
          {row.avatar_url ? (
            <Image source={{ uri: row.avatar_url }} style={styles.avatar} contentFit="cover" />
          ) : (
            <Avatar label={initials} size={36} />
          )}
        </View>
        {/* Presence: bright = locked in now, soft = online. Nothing when neither. */}
        {presence?.locked_in || presence?.online ? (
          <View style={[styles.presenceDot, !presence.locked_in && styles.presenceDotOnline]} />
        ) : null}
      </Pressable>
      <View style={styles.who}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {row.is_me ? 'You' : row.display_name}
          </Text>
          {row.patron_key ? <HouseSeal patronKey={row.patron_key} size={13} /> : null}
        </View>
        {title ? (
          <Text
            style={[styles.rowTitle, title.earned ? styles.rowTitleEarned : { color: f ?? Colors.legend }]}
            numberOfLines={1}>
            {title.earned ? '★ ' : ''}
            {title.name}
            {title.stamp ? ` · ${title.stamp}` : ''}
          </Text>
        ) : null}
        {identity !== undefined ? (
          identity
        ) : row.rank == null ? (
          <Text style={styles.identity}>Not ranked yet</Text>
        ) : (
          <IdentityLine userId={row.user_id} university={row.university} style={styles.identity} />
        )}
        {extra}
      </View>
      <View style={styles.valueColumn}>
        <Text style={styles.value}>{value}</Text>
        {valueCaption ? <Text style={styles.valueCaption}>{valueCaption}</Text> : null}
      </View>
      {trailing}
    </>
  );

  return (
    <Pressable
      style={[
        card ? styles.rowShell : styles.row,
        f ? [styles.rowWorn, { borderColor: f, shadowColor: f }] : null,
        row.is_me && styles.rowMe,
      ]}
      onPress={() => onPressRow(row)}
      accessibilityRole="button"
      accessibilityLabel={`${row.rank == null ? 'Not ranked yet' : row.rank}. ${row.is_me ? 'You' : row.display_name}${title ? `, ${title.earned ? 'earned title' : 'title'} ${title.name}` : ''}${presence?.locked_in ? ', locked in now' : ''}, ${value}${row.is_me ? '' : '. Head-to-head'}`}>
      {card ? (
        // Animated, as the Agora feed draws it. Only worn cards get a backdrop, so the ticking scenes
        // are the handful of rows that flex one — the same budget the feed already carries.
        <EquippedCardBackdrop cardId={card.id} radius={15}>
          <View style={styles.rowInner}>{content}</View>
        </EquippedCardBackdrop>
      ) : (
        content
      )}
    </Pressable>
  );
}

/** The halo's glow box — the 36px avatar plus its 2px ring, with ~7px of glow on every side. */
const HALO = 54;

const styles = StyleSheet.create({
  presenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#39D98A',
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
  presenceDotOnline: {
    backgroundColor: '#2A8A5C',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  // Wearing a flare: the outline thickens and glows in it (borderColor/shadowColor set per row).
  rowWorn: {
    borderWidth: 1.5,
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  // A worn card: the backdrop draws the surface, so the shell keeps only the edge, and the row's
  // layout moves inside the backdrop, which clips its own art to the radius. No overflow:hidden
  // here — on iOS it would clip the flare's glow too.
  rowShell: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  // You, on top of whatever you wear: a heavier edge, so your row is findable at a scroll.
  rowMe: {
    borderWidth: 2,
  },
  // The equipped card's tint, behind everything in the row.
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 15,
  },
  halo: {
    position: 'absolute',
    left: (40 - HALO) / 2,
    top: (40 - HALO) / 2,
  },
  avatarRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    fontStyle: 'italic',
  },
  rowTitleEarned: {
    color: Colors.gold,
    fontStyle: 'normal',
  },
  rank: {
    width: 24,
    textAlign: 'center',
    fontFamily: Fonts.black,
    fontSize: 15,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  who: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  identity: {
    color: Colors.spaceDim,
  },
  value: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 14,
    color: Colors.ink,
  },
  valueColumn: {
    alignItems: 'flex-end',
  },
  valueCaption: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.spaceFaint,
    marginTop: 1,
  },
});
