import { Image } from 'expo-image';
import { useEffect, useId, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { EquippedAvatarHalo, type AuraTier } from '@/components/economy/applied-art';
import { PublicTitle } from '@/components/economy/loadout-bits';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useMotionActive } from '@/hooks/use-motion-active';
import { usePublicLoadout, type PublicLoadout } from '@/hooks/use-public-loadouts';
import type { FlareEffect } from '@/lib/economy/catalog';

// ── HOW SOMEONE ELSE APPEARS, EVERYWHERE ──
//
// Cosmetics are a flex economy, and a flex nobody else can see is not one. Before this, equipped
// gear rendered on almost nothing: the friends list drew a bare <Avatar>, every leaderboard tab
// and the campfire/group boards shared a "dumb" row with no loadout at all, and chat showed a
// display name. Only university-leaderboard.tsx had the full treatment. So the fix is ONE pair of
// components used on every surface a person appears on, rather than nine partial
// re-implementations that drift apart.
//
// The rule from loadout-bits.tsx carries over unchanged: everything here is additive decoration.
// None of it can change a rank, a numeral, a score or a verified badge. When a slot is empty the
// plain base look renders, so the app is fully usable having never opened the shop.

// ── DATA: batch at the LIST, not the row ──
//
// `usePublicLoadout(id)` called inside a row IS an N+1 on first paint — the module cache in
// use-public-loadouts dedups across scroll recycles, but N freshly-mounted rows each fire their own
// RPC before any of them resolves. So every list passes `loadout` down from ONE
// `usePublicLoadouts(allIds)` call at the top, and the per-row fetch stays as the fallback for
// single-avatar surfaces (a profile header, a challenge fighter) where one call already IS the
// batch.
//
// This is deliberately NOT done by widening the list RPCs to return equipped keys inline. That
// would have meant a migration against each of get_my_friends, the leaderboard reads, the roster
// and the chat page — a lot of prod ledger surface (MIGRATIONS.md) to buy one round trip that the
// existing batched hook already avoids.

export type IdentityMotion = 'full' | 'reduced' | 'none';

/**
 * The loadout to render for `userId`: the one the list already fetched, or a self-fetch for
 * single-avatar surfaces. Exported because a row that also draws a hex glow or a card backdrop
 * needs the SAME resolved object — those helpers fall back to the signed-in user's own gear when
 * handed `undefined`, which would put your halo on someone else's row.
 */
export function useResolvedLoadout(userId: string | null | undefined, provided?: PublicLoadout): PublicLoadout {
  // Hooks cannot be conditional, but the ARGUMENT can: handing the hook `null` when the caller
  // already has the loadout is what keeps a list row from queueing a fetch of its own.
  const fetched = usePublicLoadout(provided ? null : userId);
  return provided ?? fetched;
}

// ─────────────────────────── the flare aura ───────────────────────────
//
// The equipped flare, shrunk from a screen to an avatar. It deliberately does NOT reuse
// FlarePerimeter's internals: that file's marks are all screen geometry — full-width edge bands
// composited the way an inset box-shadow is — and none of that has a meaning at 38px. What it does
// reuse is the flare's IDENTITY, `{ colour, effect }`, which is the part that says which item you
// own.
//
// Cheap on purpose. A leaderboard can hold thirty of these, so an aura is ONE Reanimated value
// driving ONE view's opacity and scale over a static SVG radial. Nothing re-renders React per
// frame, and `reduced` drops the loop entirely rather than merely slowing it.
type AuraMotion = {
  /** Seconds for one breath. */
  period: number;
  /** Opacity at the top of the breath; the trough is this minus `swing`. */
  peak: number;
  swing: number;
  /** How far past the avatar's edge the glow reaches, as a multiple of its diameter. */
  reach: number;
};

// Per-effect tuning. The split follows the catalog's own reading of each flare: the two lightning
// flares snap, the smoke and glow families breathe slowly, and emberfall — the Forge Pass capstone,
// one item — is the only one allowed to sit at the top of the range.
const AURA: Record<FlareEffect, AuraMotion> = {
  glow: { period: 3.2, peak: 0.52, swing: 0.16, reach: 1.5 },
  smoke: { period: 4.6, peak: 0.42, swing: 0.14, reach: 1.62 },
  plasma: { period: 2.1, peak: 0.6, swing: 0.24, reach: 1.56 },
  zaps: { period: 1.15, peak: 0.62, swing: 0.34, reach: 1.48 },
  hammer: { period: 1.5, peak: 0.6, swing: 0.3, reach: 1.52 },
  falling: { period: 2.6, peak: 0.5, swing: 0.2, reach: 1.55 },
  flames: { period: 1.9, peak: 0.58, swing: 0.22, reach: 1.58 },
  emberfall: { period: 2.4, peak: 0.68, swing: 0.24, reach: 1.7 },
};

/**
 * The flare on its own, for surfaces that already have a ring they can't give up — the podium's
 * avatars are circled in the PLACE's metal (gold/silver/bronze), and stacking a cosmetic halo on
 * top of that would put two rings on one avatar and blur which of them was earned.
 */
export function FlareAura({ loadout, size, motion }: { loadout: PublicLoadout; size: number; motion: IdentityMotion }) {
  const gradientId = useId();
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  const flare = loadout.flare?.flare;
  // Destructured to primitives so the effect below depends on the NUMBERS, not on the identity of
  // a table row — and so the worklet closes over values rather than an object.
  const { period, peak, swing, reach } = flare ? AURA[flare.effect] : AURA.glow;

  // Static whenever the OS asks for it, the caller asks for it, or the screen is not being looked
  // at — use-motion-active exists precisely so cosmetic loops do not burn frames behind a blurred
  // tab, and a list of these is the case it was written for.
  const animate = motion === 'full' && !reduceMotion && active;

  const phase = useSharedValue(0);

  // The loop is started from an EFFECT, never from the render body. Assigning to `phase.value`
  // during render is the mistake flare-perimeter.tsx already avoids: Reanimated warns on it, and
  // it restarts the animation on every unrelated re-render — which on a list row (a new reaction,
  // a refreshed score) means the aura visibly snaps back to the start of its breath.
  useEffect(() => {
    if (animate) {
      phase.value = withRepeat(withTiming(1, { duration: period * 1000, easing: Easing.inOut(Easing.sin) }), -1, true);
    } else {
      // Park it at the MIDDLE of the breath, not at the trough — a held-still flare should read as
      // the same object stopped, not as a dimmer one.
      cancelAnimation(phase);
      phase.value = 0.5;
    }
  }, [animate, period, phase]);

  const style = useAnimatedStyle(() => ({
    opacity: peak - swing * (1 - phase.value),
    transform: [{ scale: 0.97 + 0.03 * phase.value }],
  }));

  if (!flare) return null;
  const box = size * reach;
  // Where the avatar's own edge falls inside the box, in the gradient's 0-100% space. The ramp is
  // pinned to THAT rather than to a constant, so the glow hugs the avatar at 24px and at 96px.
  const edge = 100 / reach;

  return (
    <Animated.View pointerEvents="none" style={[styles.aura, { width: box, height: box }, style]}>
      <Svg width={box} height={box} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            {/* Hollow in the middle — the avatar covers it, and a filled centre would only wash
                the face out. The ramp fades to zero at its own boundary so the aura has no edge. */}
            <Stop offset="0%" stopColor={flare.colour} stopOpacity={0} />
            <Stop offset={`${edge * 0.92}%`} stopColor={flare.colour} stopOpacity={0.55} />
            <Stop offset={`${edge}%`} stopColor={flare.colour} stopOpacity={0.95} />
            <Stop offset="100%" stopColor={flare.colour} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
}

// ─────────────────────────── the avatar ───────────────────────────

/**
 * An avatar wearing its owner's equipped gear: the Halo as a ring (via EquippedAvatarHalo, which
 * already draws each halo's own style at any size) with the Flare glowing behind it.
 *
 * Pass `loadout` on list rows — see the batching note above.
 */
export function CosmeticAvatar({
  userId,
  name,
  size,
  avatarUrl,
  loadout,
  motion = 'full',
  lit = false,
  auraTier = 0,
}: {
  userId: string | null | undefined;
  /** Used for the initial when there is no photo. */
  name: string;
  size: number;
  avatarUrl?: string | null;
  loadout?: PublicLoadout;
  motion?: IdentityMotion;
  /** The people-tab "locked in now" state — a live signal, deliberately not a cosmetic. */
  lit?: boolean;
  auraTier?: AuraTier;
}) {
  const resolved = useResolvedLoadout(userId, loadout);

  return (
    <View style={styles.avatarStack}>
      <FlareAura loadout={resolved} size={size} motion={motion} />
      <EquippedAvatarHalo haloId={resolved.halo?.id} size={size} auraTier={auraTier}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[styles.fallback, lit && styles.fallbackLit]}>
            <Text style={[styles.initial, { fontSize: size * 0.375 }, lit && styles.initialLit]}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </EquippedAvatarHalo>
    </View>
  );
}

/**
 * The full identity block: avatar + gear, the name, and the equipped Title UNDER the name.
 *
 * The title goes beneath rather than beside deliberately — it is a tagline, and inline it competes
 * with the name for the same line and truncates first on a narrow row.
 */
export function PublicIdentity({
  userId,
  name,
  size,
  avatarUrl,
  loadout,
  motion = 'full',
  lit = false,
  align = 'row',
  suffix,
  sub,
  nameStyle,
  compactTitle = true,
}: {
  userId: string | null | undefined;
  name: string;
  size: number;
  avatarUrl?: string | null;
  loadout?: PublicLoadout;
  motion?: IdentityMotion;
  lit?: boolean;
  /** `row` for list rows, `column` for a centred hero (profile, podium). */
  align?: 'row' | 'column';
  /** Rendered inside the name line — " · you", a Friend tag, a handle. */
  suffix?: ReactNode;
  /** The line under the title — a status, a rank label, a handle. */
  sub?: ReactNode;
  nameStyle?: TextStyle;
  compactTitle?: boolean;
}) {
  const resolved = useResolvedLoadout(userId, loadout);
  const column = align === 'column';

  return (
    <View style={column ? styles.identityColumn : styles.identityRow}>
      <CosmeticAvatar
        userId={userId}
        name={name}
        size={size}
        avatarUrl={avatarUrl}
        loadout={resolved}
        motion={motion}
        lit={lit}
      />
      <View style={column ? styles.whoColumn : styles.whoRow}>
        <Text style={[styles.name, nameStyle]} numberOfLines={1}>
          {name}
          {suffix}
        </Text>
        <PublicTitle loadout={resolved} compact={compactTitle} />
        {sub}
      </View>
    </View>
  );
}

/**
 * Someone else's equipped Banner, as the backdrop behind a profile hero. Returns `undefined` when
 * the slot is empty so callers can write `style={[styles.hero, publicBannerStyle(loadout)]}` and
 * get the stock surface unchanged.
 */
export function publicBannerStyle(loadout: PublicLoadout): ViewStyle | undefined {
  const banner = loadout.banner;
  if (!banner) return undefined;
  return { backgroundColor: banner.art.from, borderWidth: 1, borderColor: banner.art.to };
}

const styles = StyleSheet.create({
  avatarStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  aura: {
    position: 'absolute',
  },
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLit: {
    borderWidth: 2,
    borderColor: Colors.coral,
  },
  initial: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.achieverText,
  },
  initialLit: {
    color: Colors.coral,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
    minWidth: 0,
  },
  identityColumn: {
    alignItems: 'center',
  },
  whoRow: {
    flex: 1,
    minWidth: 0,
  },
  whoColumn: {
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
});
