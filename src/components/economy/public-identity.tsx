import { Image } from 'expo-image';
import { useId, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { BurningName } from '@/components/burning-name';
import { EquippedAvatarHalo, type AuraTier } from '@/components/economy/applied-art';
import { useCosmeticClock } from '@/components/economy/cosmetic-clock';
import {
  SIGNATURE_CYCLE_MS,
  SignatureLayers,
  SignatureStill,
  flareSignature,
  type SignatureMark,
} from '@/components/economy/flare-signature';
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
// Cheap on purpose. A leaderboard can hold thirty of these, so an aura reads ONE shared clock per
// effect (cosmetic-clock) for its breath and its few signature marks. Nothing re-renders React per
// frame, and `reduced` drops the loop entirely rather than merely slowing it.
type AuraMotion = {
  /** Opacity at the top of the breath; the trough is this minus `swing`. */
  peak: number;
  swing: number;
  /** How far past the avatar's edge the glow reaches, as a multiple of its diameter. */
  reach: number;
};

// Per-effect tuning. The split follows the catalog's own reading of each flare, and emberfall — the
// Forge Pass capstone, one item — is the only one allowed to sit at the top of the range. Tempo
// lives in flare-signature's SIGNATURE_CYCLE_MS (two breaths per cycle), shared with the shop tile.
const AURA: Record<FlareEffect, AuraMotion> = {
  glow: { peak: 0.52, swing: 0.16, reach: 1.5 },
  smoke: { peak: 0.42, swing: 0.14, reach: 1.62 },
  plasma: { peak: 0.6, swing: 0.24, reach: 1.56 },
  zaps: { peak: 0.62, swing: 0.34, reach: 1.48 },
  hammer: { peak: 0.6, swing: 0.3, reach: 1.52 },
  falling: { peak: 0.5, swing: 0.2, reach: 1.55 },
  flames: { peak: 0.58, swing: 0.22, reach: 1.58 },
  emberfall: { peak: 0.68, swing: 0.24, reach: 1.7 },
};

/** Below this avatar diameter the signature keeps only its first three marks (flareSignature's
 *  `compact`) — a 24px row has room for one bolt, not three, and the rest would only be mush. */
const AURA_COMPACT_BELOW = 34;

/**
 * The flare on its own, for surfaces that already have a ring they can't give up — the podium's
 * avatars are circled in the PLACE's metal (gold/silver/bronze), and stacking a cosmetic halo on
 * top of that would put two rings on one avatar and blur which of them was earned.
 *
 * TWO LAYERS. The soft radial bed (the old aura, unchanged) and on top of it the flare's SIGNATURE
 * marks — the bolts, tongues, drips or wisps from flare-signature.tsx. Before the marks, every flare
 * was the same coloured pulse and only its tempo differed, so a profile could not show WHICH flare
 * someone owned. `glow` flares have no marks: their bloom is the signature, as at full screen.
 */
export function FlareAura({ loadout, size, motion }: { loadout: PublicLoadout; size: number; motion: IdentityMotion }) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  const flare = loadout.flare?.flare;
  if (!flare) return null;

  // Static whenever the OS asks for it, the caller asks for it, or the screen is not being looked
  // at — use-motion-active exists precisely so cosmetic loops do not burn frames behind a blurred
  // tab, and a list of these is the case it was written for.
  const animate = motion === 'full' && !reduceMotion && active;
  const tuning = AURA[flare.effect];
  const box = size * tuning.reach;
  // The ring sits just outside the avatar (EquippedAvatarHalo draws it at 1.06x the radius), so the
  // marks start clear of it rather than under its stroke.
  const marks = flareSignature(
    flare.effect,
    flare.colour,
    { cx: 50, cy: 50, rIn: (50 / tuning.reach) * 1.1, rOut: 50, px: box / 100 },
    size < AURA_COMPACT_BELOW
  );

  return animate ? (
    <LiveAura colour={flare.colour} tuning={tuning} cycleMs={SIGNATURE_CYCLE_MS[flare.effect]} box={box} marks={marks} />
  ) : (
    // Parked mid-breath, not at the trough — a held-still flare should read as the same object
    // stopped, not as a dimmer one — and with its marks frozen on a representative frame.
    <View pointerEvents="none" style={[styles.aura, { width: box, height: box }]}>
      <View style={[StyleSheet.absoluteFill, { opacity: tuning.peak - tuning.swing * 0.5 }]}>
        <AuraBed colour={flare.colour} box={box} reach={tuning.reach} />
      </View>
      {marks.length > 0 && (
        <Svg width={box} height={box} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
          <SignatureStill marks={marks} />
        </Svg>
      )}
    </View>
  );
}

/**
 * The animated aura, split out so a parked one never subscribes to a clock at all.
 *
 * The breath and every mark read ONE shared clock (cosmetic-clock) per effect — a leaderboard of
 * thirty Infernos is one driver, not thirty, let alone thirty times seven. The cycle is four breaths
 * long, so the breath (2 per cycle, ping-pong) and the marks (whole-number loops per cycle) all
 * land back on their start together when the clock snaps to 0.
 */
function LiveAura({
  colour,
  tuning,
  cycleMs,
  box,
  marks,
}: {
  colour: string;
  tuning: AuraMotion;
  cycleMs: number;
  box: number;
  marks: SignatureMark[];
}) {
  const { peak, swing, reach } = tuning;
  const clock = useCosmeticClock(cycleMs, true);

  const style = useAnimatedStyle(() => {
    // 0 -> 1 -> 0 twice per cycle, sine-eased: the old ping-pong withRepeat on a per-row driver.
    const b = 0.5 - 0.5 * Math.cos(clock.value * Math.PI * 4);
    return { opacity: peak - swing * (1 - b), transform: [{ scale: 0.97 + 0.03 * b }] };
  });

  return (
    <View pointerEvents="none" style={[styles.aura, { width: box, height: box }]}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <AuraBed colour={colour} box={box} reach={reach} />
      </Animated.View>
      <SignatureLayers marks={marks} box={box} clock={clock} />
    </View>
  );
}

function AuraBed({ colour, box, reach }: { colour: string; box: number; reach: number }) {
  const gradientId = useId();
  // Where the avatar's own edge falls inside the box, in the gradient's 0-100% space. The ramp is
  // pinned to THAT rather than to a constant, so the glow hugs the avatar at 24px and at 96px.
  const edge = 100 / reach;
  return (
    <Svg width={box} height={box} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          {/* Hollow in the middle — the avatar covers it, and a filled centre would only wash
              the face out. The ramp fades to zero at its own boundary so the aura has no edge. */}
          <Stop offset="0%" stopColor={colour} stopOpacity={0} />
          <Stop offset={`${edge * 0.92}%`} stopColor={colour} stopOpacity={0.55} />
          <Stop offset={`${edge}%`} stopColor={colour} stopOpacity={0.95} />
          <Stop offset="100%" stopColor={colour} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${gradientId})`} />
    </Svg>
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
      <EquippedAvatarHalo
        haloId={resolved.halo?.id}
        size={size}
        auraTier={auraTier}
        motion={motion === 'full' ? 'full' : 'still'}>
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
        {/* A Flame Pass holder's name burns (0220). Every leaderboard row, the campfire board and
            the group board come through here, so this one line is most of the campus's view of it. */}
        <BurningName userId={userId} style={[styles.name, nameStyle]} numberOfLines={1} suffix={suffix}>
          {name}
        </BurningName>
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
