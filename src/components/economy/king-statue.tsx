import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors, Fonts } from '@/constants/theme';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE CROWNED KING (design-mocks/172) — the duel-win hero.
//
// What it replaces: the brand flame, which is what EVERY other card was already using. A duel is
// the one result in the app with a defeated human on the other side of it, and a flame says
// nothing about that. This does: crown, both hands on the pommel, greatsword driven point-down
// into the stone — the "the throne is mine" stance — with the winner's own face under the crown.
//
// WHY IT IS CHEAP. The figure is SYMMETRIC and static: no pose to derive from the result, no
// per-tier variant, no animation. It is roughly thirty paths that never change, so it costs one
// draw and is safe to rasterise with captureRef.
//
// 🔴 THE HEAD IS A SIZED IMAGE, NOT A SYMBOL REFERENCE. Mock 172's own comment records the bug it
// hit: `<use href="#pfpWinner"/>` with no width/height inherits the referencing canvas and the
// avatar balloons to fill the whole card. The fix there was to inline the head at an explicit size,
// and the fix here is stronger — the avatar is a real React Native <Image> in its own absolutely
// positioned box, laid over the statue between the body layer and the crown layer.
//
// Three layers rather than one SVG, and the ordering is the reason:
//
//     BODY  (svg)    stone, robe, collar, arms, sword, hands, neck — everything the head sits on
//     HEAD  (image)  the winner's real avatar, clipped round, gold-ringed
//     CROWN (svg)    the crown, which has to overlap the top of the head to rest ON it
//
// One SVG could not do it: react-native-svg's remote <Image> support is the flakiest corner of the
// library and this artefact gets rasterised to a PNG that someone posts publicly. A plain RN
// <Image> is the one thing guaranteed to composite correctly under captureRef.
//
// ⚠️ THE AVATAR MUST BE PREFETCHED BEFORE CAPTURE. captureRef rasterises the current frame; a
// remote image that has not loaded yet captures as an empty circle. See `prefetchAvatars` below and
// its caller in the settlement watcher.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The mock's own canvas. Every coordinate below is in this space. */
const VB_W = 200;
const VB_H = 300;
/** Head centre and radius, in viewBox units — mock 172's `translate(100,90)` + `r=19`. */
const HEAD_CX = 100;
const HEAD_CY = 90;
const HEAD_R = 19;

/**
 * Warm the image cache so `captureRef` has pixels rather than a placeholder.
 *
 * Resolves on failure as well as success: a card with a fallback initial where a face should be is
 * a worse card, but a share that never fires because someone's avatar 404'd is a broken feature.
 */
export async function prefetchAvatars(...urls: (string | null | undefined)[]): Promise<void> {
  await Promise.all(
    urls.filter((u): u is string => Boolean(u)).map((u) => Image.prefetch(u).catch(() => false))
  );
}

/**
 * A round avatar with an initial fallback.
 *
 * The app's own `ui/avatar.tsx` is initials-only — it has never rendered a photo — so this is the
 * first place a real profile picture appears at card size. Kept local rather than pushed into that
 * component: this one is a fixed circle with a ring, sized in card units, and generalising the
 * shared Avatar to cover it would be a wider change than the duel card justifies.
 */
function RoundAvatar({
  url,
  name,
  size,
  ring,
  ringWidth,
  greyed = false,
}: {
  url?: string | null;
  name: string;
  size: number;
  ring: string;
  ringWidth: number;
  greyed?: boolean;
}) {
  const radius = size / 2;
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: ring,
          borderWidth: ringWidth,
          // The defeated avatar reads as drained rather than as a second contender. React Native
          // has no grayscale filter, so this is opacity over a dark ground — the same read at a
          // fraction of the cost of an image pipeline.
          opacity: greyed ? 0.55 : 1,
        },
      ]}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: radius }} />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>
          {(name?.trim()?.charAt(0) || '?').toUpperCase()}
        </Text>
      )}
    </View>
  );
}

/**
 * The defeated-opponent strip that sits above the statue — greyed avatar, DEFEATED label, and the
 * loser's name struck through.
 *
 * The strike-through is `textDecorationLine`, which React Native supports on both platforms; the
 * mock's red `text-decoration-color` has no RN equivalent, so the line inherits the text colour and
 * the red moves to a thin underline bar behind it instead of being lost.
 */
export function DefeatedStrip({
  name,
  avatarUrl,
  maxWidth,
}: {
  name: string;
  avatarUrl?: string | null;
  maxWidth: number;
}) {
  return (
    <View style={[styles.fallen, { maxWidth }]}>
      <RoundAvatar url={avatarUrl} name={name} size={30} ring="#6B6472" ringWidth={2} greyed />
      <View style={styles.fallenCol}>
        <Text style={styles.fallenLabel}>DEFEATED</Text>
        {/* Two lines allowed before it clips — a long display name is exactly the input that broke
            the old cards, and a name is the one string on this card that must stay readable. */}
        <Text style={styles.fallenName} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </View>
  );
}

/**
 * The statue itself.
 *
 * `width` drives everything: the SVG scales by `width / 200`, and the avatar box is positioned in
 * the same units so the head lands in the collar at any size.
 */
export function KingStatue({
  width,
  avatarUrl,
  name,
}: {
  width: number;
  avatarUrl?: string | null;
  name: string;
}) {
  const scale = width / VB_W;
  const height = VB_H * scale;
  const headPx = HEAD_R * 2 * scale;

  return (
    <View style={{ width, height }}>
      {/* ── LAYER 1 · the body ──────────────────────────────────────────────────────────────── */}
      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          {/* Bronze, not marble. A taste call the mock leaves open, decided for the ember palette:
              a white marble figure on the purple ground reads cold and belongs to a different app.
              Swapping is these four stops and nothing else. */}
          <LinearGradient id="ksBronze" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F4C27A" />
            <Stop offset="0.4" stopColor="#B07A38" />
            <Stop offset="0.78" stopColor="#6E4A22" />
            <Stop offset="1" stopColor="#3A2510" />
          </LinearGradient>
          <LinearGradient id="ksBronzeDark" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7A552A" />
            <Stop offset="1" stopColor="#241505" />
          </LinearGradient>
          <LinearGradient id="ksStone" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#4A3F52" />
            <Stop offset="1" stopColor="#251D30" />
          </LinearGradient>
          <LinearGradient id="ksBlade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF6E0" />
            <Stop offset="0.5" stopColor="#D9C9A6" />
            <Stop offset="1" stopColor="#8A7A58" />
          </LinearGradient>
          <LinearGradient id="ksCrown" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFE9A8" />
            <Stop offset="1" stopColor="#E8A32E" />
          </LinearGradient>
          <RadialGradient id="ksRim" cx="30%" cy="25%" r="80%">
            <Stop offset="0" stopColor="#FFCF87" stopOpacity={0.9} />
            <Stop offset="1" stopColor="#FFCF87" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* the stone the sword is planted in */}
        <Rect x={60} y={250} width={80} height={30} rx={3} fill="url(#ksStone)" />
        <Rect x={54} y={244} width={92} height={10} rx={3} fill="#5A4D66" />
        {/* the crack where the blade enters */}
        <Path d="M96 250 L104 250 L102 266 L98 266 Z" fill="#171020" />

        {/* robe — symmetric, fur hem + ermine centre panel */}
        <Path d="M76 108 L124 108 L136 250 L64 250 Z" fill="url(#ksBronze)" />
        <Path d="M100 116 L100 250" stroke="#3A2510" strokeWidth={1.5} opacity={0.5} />
        <Path d="M64 250 L136 250 L134 244 L66 244 Z" fill="#E9DCC2" opacity={0.85} />
        <Path d="M92 110 L108 110 L112 250 L88 250 Z" fill="#D9CBB0" opacity={0.35} />
        <G fill="#3A2510" opacity={0.5}>
          <Circle cx={96} cy={150} r={1} />
          <Circle cx={104} cy={168} r={1} />
          <Circle cx={97} cy={190} r={1} />
          <Circle cx={103} cy={210} r={1} />
        </G>

        {/* shoulders / fur collar — what the head sits on */}
        <Path d="M74 112 C82 98 118 98 126 112 C118 120 82 120 74 112 Z" fill="#E9DCC2" />
        <Ellipse cx={78} cy={110} rx={12} ry={8} fill="url(#ksBronze)" stroke="#3A2510" strokeWidth={1} />
        <Ellipse cx={122} cy={110} rx={12} ry={8} fill="url(#ksBronze)" stroke="#3A2510" strokeWidth={1} />

        {/* both arms in to the pommel */}
        <Path d="M80 116 C76 132 88 146 100 150 L100 140 C92 136 86 126 88 114 Z" fill="url(#ksBronze)" />
        <Path d="M120 116 C124 132 112 146 100 150 L100 140 C108 136 114 126 112 114 Z" fill="url(#ksBronze)" />

        {/* the sword: pommel, grip, crossguard, blade into the stone */}
        <Circle cx={100} cy={138} r={4.5} fill="url(#ksCrown)" stroke="#3A2510" strokeWidth={1} />
        <Rect x={97} y={140} width={6} height={12} rx={2} fill="#6E4A22" />
        <Rect x={80} y={150} width={40} height={5.5} rx={2.7} fill="#C79A54" stroke="#3A2510" strokeWidth={1} />
        <Path d="M95 156 L105 156 L102 252 L100 258 L98 252 Z" fill="url(#ksBlade)" stroke="#8A7A58" strokeWidth={0.6} />
        {/* hands over the grip */}
        <Ellipse cx={97} cy={146} rx={4} ry={5} fill="url(#ksBronze)" stroke="#3A2510" strokeWidth={0.8} />
        <Ellipse cx={103} cy={146} rx={4} ry={5} fill="url(#ksBronze)" stroke="#3A2510" strokeWidth={0.8} />

        {/* neck — short and wide, drawn BEFORE the head so the head plainly sits on the shoulders */}
        <Rect x={91} y={98} width={18} height={14} rx={5} fill="url(#ksBronzeDark)" />

        {/* amber rim light down the robe edge only — no halo behind the head. The mock softens this
            with feGaussianBlur; react-native-svg's filter support is unreliable on Android and this
            card gets rasterised, so the softness comes from the gradient's own falloff instead. */}
        <Path d="M76 110 L64 250" fill="none" stroke="url(#ksRim)" strokeWidth={6} opacity={0.7} />
      </Svg>

      {/* ── LAYER 2 · the head — the winner's real profile picture ───────────────────────────── */}
      <View
        style={[
          styles.head,
          {
            width: headPx,
            height: headPx,
            left: HEAD_CX * scale - headPx / 2,
            top: HEAD_CY * scale - headPx / 2,
          },
        ]}>
        <RoundAvatar url={avatarUrl} name={name} size={headPx} ring="#FFD27A" ringWidth={Math.max(2, 2.6 * scale)} />
      </View>

      {/* ── LAYER 3 · the crown, resting on the crown of the head ────────────────────────────── */}
      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="ksCrown2" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFE9A8" />
            <Stop offset="1" stopColor="#E8A32E" />
          </LinearGradient>
        </Defs>
        <Path
          d="M82 74 L86 56 L92 69 L100 51 L108 69 L114 56 L118 74 Z"
          fill="url(#ksCrown2)"
          stroke="#3A2510"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <Rect x={82} y={73} width={36} height={7} rx={2} fill="url(#ksCrown2)" stroke="#3A2510" strokeWidth={1} />
        <Circle cx={100} cy={76} r={1.6} fill="#E05A5A" />
        <Circle cx={90} cy={76} r={1.3} fill="#5AA0E0" />
        <Circle cx={110} cy={76} r={1.3} fill="#5AA0E0" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#2A1F3E',
  },
  initial: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  head: {
    position: 'absolute',
  },
  fallen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(20,14,26,0.6)',
    borderWidth: 1,
    borderColor: '#33283F',
    borderRadius: 22,
    paddingLeft: 5,
    paddingRight: 14,
    paddingVertical: 5,
  },
  fallenCol: {
    flexShrink: 1,
  },
  fallenLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 1.5,
    color: '#8A7D9C',
  },
  fallenName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#9A8FB0',
    textDecorationLine: 'line-through',
  },
});
