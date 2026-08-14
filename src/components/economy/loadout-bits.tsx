import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { PublicLoadout } from '@/hooks/use-public-loadouts';
import { useEquipped } from '@/lib/economy/loadout';
import { RARITY_COLOR } from '@/lib/economy/rarity';

// The equipped cosmetics as they appear on OTHER people's screens — profile, feed rows,
// leaderboard rows, 1v1 headers (mock 64).
//
// Everything here is additive decoration. None of it can change a rank, a numeral, a score, or a
// verified badge: those are earned signals, and a cosmetic that could alter them would be selling
// standing. When a slot is empty these render the plain base look, so the app is fully usable
// having never opened the shop.

// `enabled` exists because the loadout store holds exactly ONE loadout — the signed-in user's.
// profile.tsx doubles as someone else's profile, and rendering my halo on their card would be
// worse than rendering nothing. Callers viewing another user pass false until a public loadout
// read exists for them.

/** Ring around an avatar, drawn from the equipped Halo. Renders nothing when the slot is empty. */
export function EquippedHalo({ size, children, enabled = true }: { size: number; children: ReactNode; enabled?: boolean }) {
  const equipped = useEquipped('halo');
  const halo = enabled ? equipped : undefined;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {halo ? (
        <>
          <View
            style={[
              styles.haloRing,
              { width: size, height: size, borderRadius: size / 2, borderColor: halo.art.from },
            ]}
          />
          <View
            style={[
              styles.haloRingInner,
              { width: size - 5, height: size - 5, borderRadius: (size - 5) / 2, borderColor: halo.art.to },
            ]}
          />
        </>
      ) : null}
      {children}
    </View>
  );
}

/** Tagline under a name on leaderboards / profile. Nothing renders without an equipped Title. */
export function EquippedTitle({ style, enabled = true }: { style?: ViewStyle; enabled?: boolean }) {
  const equipped = useEquipped('title');
  const title = enabled ? equipped : undefined;
  if (!title) return null;
  return (
    <View style={style}>
      <Text style={[styles.title, { color: RARITY_COLOR[title.rarity] }]} numberOfLines={1}>
        ✦ {title.name.replace(/^"|"$/g, '')}
      </Text>
    </View>
  );
}

/**
 * Backdrop for the profile-card block. Returns the equipped Card texture's colours, or the stock
 * surface when nothing is equipped — callers spread this onto their existing container so the
 * layout is identical either way.
 */
export function useEquippedCardStyle(enabled = true): ViewStyle {
  const equipped = useEquipped('card');
  const card = enabled ? equipped : undefined;
  if (!card) return { backgroundColor: Colors.card };
  return {
    backgroundColor: card.art.from,
    borderWidth: 1,
    borderColor: card.art.to,
  };
}

/**
 * The rank hex's cosmetic glow. Deliberately a separate ring BEHIND the badge rather than a change
 * to the badge itself — the hexagon's metal and numeral carry the earned rank, so a purchasable
 * item must never be able to repaint them into looking like a higher tier.
 */
export function EquippedHexGlow({ size, loadout }: { size: number; loadout?: PublicLoadout }) {
  // Pass `loadout` for someone else's row; omit it for your own surfaces and it reads the store.
  const mine = useEquipped('halo');
  const halo = loadout ? loadout.halo : mine;
  if (!halo) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.hexGlow,
        {
          width: size * 1.5,
          height: size * 1.5,
          borderRadius: size * 0.75,
          backgroundColor: halo.art.from,
          left: -size * 0.25,
          top: -size * 0.25,
        },
      ]}
    />
  );
}

// ── Other users ──
// Same three decorations, but driven by an explicitly-passed loadout instead of the signed-in
// user's store. Feed rows, leaderboard rows and 1v1 headers use these; the hook versions above
// are only ever correct for yourself.

/** Halo ring for someone else, from usePublicLoadout(). */
export function PublicHalo({ loadout, size, children }: { loadout: PublicLoadout; size: number; children: ReactNode }) {
  const halo = loadout.halo;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {halo ? (
        <View
          style={[styles.haloRing, { width: size, height: size, borderRadius: size / 2, borderColor: halo.art.from }]}
        />
      ) : null}
      {children}
    </View>
  );
}

/** Title line for someone else, including the 21j scope stamp ("🌍 GLOBAL #1 · S1"). */
export function PublicTitle({ loadout, compact = false }: { loadout: PublicLoadout; compact?: boolean }) {
  const title = loadout.title;
  if (!title) return null;
  return (
    <Text style={[styles.title, compact && styles.titleCompact, { color: RARITY_COLOR[title.rarity] }]} numberOfLines={1}>
      ✦ {title.name.replace(/^"|"$/g, '')}
      {title.seasonStamp ? <Text style={styles.stamp}> {title.seasonStamp}</Text> : null}
    </Text>
  );
}

/** Their equipped flame's colour, for the small flame tint on a row. Base coral when unequipped. */
export function publicFlameTint(loadout: PublicLoadout): string {
  return loadout.flame?.art.from ?? Colors.coral;
}

/** Card texture for someone else's row/header background. */
export function publicCardStyle(loadout: PublicLoadout): ViewStyle {
  const card = loadout.card;
  if (!card) return {};
  return { backgroundColor: card.art.from, borderWidth: 1, borderColor: card.art.to };
}

const styles = StyleSheet.create({
  haloRing: {
    position: 'absolute',
    borderWidth: 2.5,
  },
  haloRingInner: {
    position: 'absolute',
    borderWidth: 1,
    opacity: 0.8,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
  },
  titleCompact: {
    fontSize: 9.5,
  },
  // The scope stamp rides at lower contrast than the title itself — it qualifies the name, it
  // isn't part of it.
  stamp: {
    fontFamily: Fonts.body,
    color: Colors.textTertiary,
  },
  hexGlow: {
    position: 'absolute',
    opacity: 0.18,
  },
  // Exported spacing token so callers that stack a title under a name keep one rhythm.
  titleSpacing: {
    marginTop: Spacing.half,
    borderRadius: Radius.pill,
  },
});
