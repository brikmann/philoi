import { forwardRef, useId, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors, Fonts } from '@/constants/theme';
import { FlameLogo } from '@/components/ui/flame-logo';
import { FLAME_CREST_INNER, FLAME_CREST_OUTER } from '@/components/hexagon-badge';
import { DIVISION_NUMERAL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// THE SHARE-CARD FRAME (design-mocks/96 + 97, reworked to 171) — the shell every one of the story
// cards is built on, so the set reads as one family instead of several drawings that happen to be
// 9:16.
//
// It exists mostly for the FOOTER. Mock 96's whole retention argument is that every share carries
// the sharer's rank in a hex + philoi.app: "each share is an install prompt with a status stamp."
// That only holds if it is genuinely on every card — which means one component, not five copies
// that drift the first time one of them is touched.
//
// The loop it serves: earn a moment -> Share -> post to story -> friends see the flex + rank +
// philoi.app -> they install -> they lock in -> they hit their own moment.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// MOCK 171: THE SET HAD SPLIT IN TWO, AND NOTHING TIED IT TO THE REVEALS.
//
//   · SPLIT GROUND. challenge/streak/season passed `ground="season"` (the molten floor) while
//     rank-up/unlock/milestone took the default purple. Half the family lit from below, half from
//     above — so a story feed with two Philoi cards in it looked like two apps. Purple is the
//     default for everything now; `season` survives on the season-standing card alone, where the
//     lava floor is the point rather than an accident of who was written first.
//
//   · NO RAYS. The reveal screens all bloom a converging fan behind their hero (reward-reveal's
//     RewardRays, mock 170). The cards those reveals produce had nothing — so the screenshot people
//     actually post looked unrelated to the moment they just watched. The fan is in the frame now,
//     which means every card inherits it and no card can be built without it.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** 9:16, captured at 2× the mock's 208×370 so the exported PNG holds up at story size. */
export const SHARE_CARD_WIDTH = 360;
export const SHARE_CARD_HEIGHT = 640;

/** The two card grounds from the mocks: the standard purple, and the season card's molten floor. */
export type ShareCardGround = 'purple' | 'season';

const GROUND_STOPS: Record<ShareCardGround, { cy: string; stops: [string, string, string] }> = {
  // radial-gradient(120% 55% at 50% 2%, #3a2350, #1a1526 58%, #141019)
  purple: { cy: '2%', stops: ['#3A2350', '#1A1526', '#141019'] },
  // radial-gradient(120% 60% at 50% 100%, #3a1c12, #1a1526 55%, #141019) — lit from the lava below.
  season: { cy: '100%', stops: ['#3A1C12', '#1A1526', '#141019'] },
};

// ─────────────────────────── the ray field ───────────────────────────

/**
 * The converging fan behind the hero — mock 171's `.rays`, and the signature that ties a share
 * card to the reveal screen it came off.
 *
 * 🔴 STATIC, AND THAT IS THE WHOLE POINT. The obvious move is to reuse `RewardRays` from
 * reward-reveal.tsx, which draws the identical wedge geometry. It cannot be used here: it is
 * animated. Its opacity is driven by a Reanimated `bloom` shared value that starts at 0 and eases
 * in over BLOOM_MS, plus a `breathe` loop and a slow `spin`.
 *
 * A share card is not watched, it is CAPTURED — `captureRef` rasterises whatever is on screen at
 * one instant, and these cards are rendered off-screen and captured almost immediately. Reuse the
 * animated fan and the exported PNG gets whatever opacity the bloom happened to be at, which for a
 * fast capture is somewhere near zero. "Rays on screen, no rays in the export" is the exact bug
 * the mock's verify step calls out, and it would have been invisible in the simulator and obvious
 * in someone's story.
 *
 * So: same wedges, same radial fade (bright at the centre, gone before the tip), fixed opacity, no
 * shared values, nothing to wait for. What the card renders is what the PNG contains.
 */
function ShareCardRays({
  tint,
  rampOuter,
  rampCore,
  size,
  centerY,
  opacity,
}: {
  tint: string;
  /**
   * The equipped flame's colourway, on a card whose hero IS that flame.
   *
   * 🔴 THE FAN IS THE FLAME'S OWN LIGHT — the same rule the reveal screens now follow (see
   * FLAME_HERO_KINDS in reward-reveal.tsx). A streak card draws the user's PersonalFlame, which has
   * always recoloured with the equipped skin, over a fan that was fixed orange; an Emberfall or
   * violet flame therefore exported a PNG with light that did not come from it.
   *
   * Optional, and null on every card WITHOUT a flame — the duel king is bronze, the rank-up hex is
   * struck in the tier's metal, the unlock card belongs to the item's rarity, and the season card's
   * fan sits over its molten floor. Forcing a flame ramp onto any of those would be worse than the
   * bug it fixes.
   */
  rampOuter?: string | null;
  rampCore?: string | null;
  size: number;
  /** Fan centre, as a fraction of card height — it sits on the hero, not on the card's middle. */
  centerY: number;
  opacity: number;
}) {
  const id = `shareRays-${useId()}`;
  // outer -> core, the flame's own body-to-heart direction: brightest where the fan meets the
  // flame, cooling as it travels. Falls back to the single kicker tint on a card with no flame.
  const inner = rampCore ?? tint;
  const outer = rampOuter ?? tint;
  // Mock 171 runs a 3.4°-in-15° repeating gradient — 24 spokes around the circle. Matching the
  // count matters more than matching the technique: the fan's character is its density.
  const RAYS = 24;
  const r = size / 2;
  // Half-angle of one wedge. The mock's duty cycle is 3.4/15 ≈ 0.227 of each slice; the same ratio
  // here keeps the gaps as wide as the spokes rather than producing a solid disc.
  const half = (Math.PI / RAYS) * 0.227;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.rays,
        { width: size, height: size, left: SHARE_CARD_WIDTH / 2 - r, top: SHARE_CARD_HEIGHT * centerY - r, opacity },
      ]}>
      <Svg width={size} height={size}>
        <Defs>
          {/* Radial and in USER SPACE, for the reason RewardRays' own note gives: a linear gradient
              defaults to each wedge's own bounding box, so half the spokes would fade the wrong
              way. One gradient over the whole fan makes every wedge bright at the centre and gone
              before its tip, so no spoke has a visible hard end. */}
          <RadialGradient id={id} gradientUnits="userSpaceOnUse" cx={r} cy={r} r={r}>
            <Stop offset="0" stopColor={inner} stopOpacity={0} />
            {/* Hollow at the very centre — the mock masks the inner 20px out, so the fan reads as
                light coming from BEHIND the hero rather than as a star sitting on top of it. */}
            <Stop offset="0.08" stopColor={inner} stopOpacity={0.9} />
            <Stop offset="0.55" stopColor={outer} stopOpacity={0.55} />
            <Stop offset="1" stopColor={outer} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {Array.from({ length: RAYS }, (_, i) => {
          const a = (i / RAYS) * Math.PI * 2;
          const x1 = r + Math.cos(a - half) * r;
          const y1 = r + Math.sin(a - half) * r;
          const x2 = r + Math.cos(a + half) * r;
          const y2 = r + Math.sin(a + half) * r;
          return (
            <Path
              key={i}
              d={`M ${r} ${r} L ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} Z`}
              fill={`url(#${id})`}
            />
          );
        })}
      </Svg>
    </View>
  );
}

// ─────────────────────────── the frame ───────────────────────────

type ShareCardFrameProps = {
  /** The all-caps kicker at the top: STILL ON FIRE · LOCKED IN · RANKED UP · MYTHIC UNLOCKED. */
  kick: string;
  kickColor?: string;
  ground?: ShareCardGround;
  /**
   * The ray field behind the hero. On by default — a card opts OUT, it does not opt in, so a new
   * card cannot be added without the signature by simply forgetting a prop.
   */
  rays?: boolean;
  /** Defaults to the kicker's colour, so the fan is lit in whatever the moment's accent is. */
  rayTint?: string;
  /**
   * The equipped flame's ramp, for a card whose hero is that flame — see ShareCardRays.
   *
   * Passed in rather than read here with `useFlameRamp()`, deliberately. The frame is worn by cards
   * with no flame at all, and a hook in here would tint the duel king's fan with the user's flame
   * skin. The card that draws the flame is the card that knows.
   */
  rayRamp?: { outer: string; core: string } | null;
  /** Where the fan's centre sits, as a fraction of card height. Default lands it on the hero. */
  rayCenterY?: number;
  /** Full-bleed animated layer behind the content — the season card's Emberfall aura. */
  aura?: ReactNode;
  handle: string | null;
  /** The sharer's rank, stamped into the footer hex. Omitted only if they somehow have no rank. */
  tier?: RankTierName;
  division?: number;
  children: ReactNode;
};

export const ShareCardFrame = forwardRef<View, ShareCardFrameProps>(function ShareCardFrame(
  {
    kick,
    kickColor = Colors.amber,
    // 🔴 PURPLE FOR EVERYTHING. Was the default already, but three cards overrode it to 'season'
    // and the set stopped reading as a set. The override survives on exactly one card now.
    ground = 'purple',
    rays = true,
    rayTint,
    rayRamp,
    rayCenterY = 0.42,
    aura,
    handle,
    tier,
    division,
    children,
  },
  ref
) {
  const uid = useId();
  const bg = `shareBg-${uid}`;
  const g = GROUND_STOPS[ground];

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Svg width={SHARE_CARD_WIDTH} height={SHARE_CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={bg} cx="50%" cy={g.cy} rx="120%" ry="58%">
            <Stop offset="0" stopColor={g.stops[0]} />
            <Stop offset="0.58" stopColor={g.stops[1]} />
            <Stop offset="1" stopColor={g.stops[2]} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={SHARE_CARD_WIDTH} height={SHARE_CARD_HEIGHT} fill={`url(#${bg})`} />
      </Svg>

      {/* Behind the hero and above the ground, but under everything that carries information.
          0.30 per the mock — the flex has to keep supremacy, and a fan bright enough to notice on
          its own is a fan competing with the number it is behind. */}
      {rays ? (
        <ShareCardRays
          tint={rayTint ?? kickColor}
          rampOuter={rayRamp?.outer}
          rampCore={rayRamp?.core}
          size={SHARE_CARD_WIDTH * 1.9}
          centerY={rayCenterY}
          opacity={0.3}
        />
      ) : null}

      {aura}

      <Text style={[styles.kick, { color: kickColor }]} numberOfLines={1}>
        {kick}
      </Text>
      <View style={styles.hero}>{children}</View>
      <ShareCardFooter handle={handle} tier={tier} division={division} />
    </View>
  );
});

/**
 * The install prompt with a status stamp. Wordmark + flame on top, then the identity row:
 * rank hexagon · @handle · philoi.app.
 */
export function ShareCardFooter({
  handle,
  tier,
  division,
}: {
  handle: string | null;
  tier?: RankTierName;
  division?: number;
}) {
  const metal = tier ? RANK_TIER_METAL[tier] : null;
  // 🐛 THE DIVISION NUMERAL DISAGREED WITH THE BADGE (mock 171 bug 6, the #166 family).
  //
  // This read `DIVISION_NUMERAL[division ?? 1] ?? division`, which is wrong in two distinct ways
  // that HexagonBadge — the thing this hex is supposed to be a miniature of — gets right:
  //
  //   1. PRIMORDIAL HAS NO DIVISIONS. `formatRankTier` returns a bare "Primordial" and the badge
  //      draws the flame crest instead of a numeral, precisely so the top rank is not "diluted into
  //      III/II/I" (PHILOI_UI_SPEC §11). The footer stamped a roman numeral on it anyway. A
  //      Primordial player's share card contradicted their own badge.
  //   2. `division ?? 1` INVENTS A DIVISION. Where the badge renders nothing for an unknown
  //      division, the footer defaulted to 1 — and division I is the TOP of a tier, so a card with
  //      no division data claimed the best one. That is the off-by-one: not an index slip, a
  //      fabricated default.
  //
  // Both now match the badge exactly: crest for Primordial, numeral only when there is a division
  // to name, nothing at all otherwise.
  const isPrimordial = tier === 'primordial';
  const numeral = division != null ? DIVISION_NUMERAL[division] ?? String(division) : null;

  return (
    <View style={styles.foot}>
      <View style={styles.mark}>
        {/* The brand mark itself, never a redrawn copy of it (DESIGN_LANGUAGE_EMBER §1). */}
        <FlameLogo size={20} />
        <Text style={styles.wordmark}>philoi</Text>
      </View>
      <View style={styles.idRow}>
        {metal && (
          <View style={styles.hexWrap}>
            <Svg width={17} height={19} viewBox="0 0 100 100">
              <Polygon points="50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27" fill={metal.inner} />
            </Svg>
            {isPrimordial ? (
              // The badge's own crest paths, imported rather than copied, so the two hexes cannot
              // drift. Flipped for the same reason every flame in the app is (CINDY_SPEC rule 1).
              <View style={styles.hexCrest} pointerEvents="none">
                <Svg width={9} height={11} viewBox="0 0 120 150">
                  <G transform="translate(120,0) scale(-1,1)">
                    <Path d={FLAME_CREST_OUTER} fill={metal.outer} />
                    <Path d={FLAME_CREST_INNER} fill={Colors.coral} />
                  </G>
                </Svg>
              </View>
            ) : numeral ? (
              <Text style={[styles.hexNumeral, { color: metal.numeral }]}>{numeral}</Text>
            ) : null}
          </View>
        )}
        <Text style={styles.idText} numberOfLines={1}>
          {handle ? `@${handle} · ` : ''}
          <Text style={styles.idUrl}>philoi.app</Text>
        </Text>
      </View>
    </View>
  );
}

/**
 * A deterministic font size for a line that has to fit.
 *
 * 🐛 THE TRUNCATION FIX (mock 171 bug 4). Long goal names ("Land a standing backflip"), long
 * campfire names and long reward names ("Vessel of Hestia") hit a `numberOfLines` and got clipped
 * mid-word — on the one artefact of the app that gets posted publicly.
 *
 * NOT `adjustsFontSizeToFit`. That is the built-in answer and it is the wrong one here for two
 * reasons: it is unreliable on Android (which is the platform these cards are actually tested on),
 * and it resolves during layout — so a `captureRef` firing on an early frame can rasterise the
 * pre-shrink size. This is a pure function of the string, so the size is settled before the first
 * render and the PNG matches the screen by construction.
 *
 * Paired with a 2-line allowance at the call sites: shrink first, then wrap, then — only for
 * genuinely absurd input — clip.
 */
export function fitFontSize(text: string, max: number, min: number, fitsAt: number): number {
  const len = text?.trim().length ?? 0;
  if (len <= fitsAt) return max;
  // Linear in the overflow ratio: a string twice as long as it should be lands at roughly half
  // size, floored so it never becomes unreadable.
  return Math.max(min, Math.round((max * fitsAt) / len));
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    alignItems: 'center',
    paddingTop: 34,
    paddingHorizontal: 28,
    paddingBottom: 30,
    overflow: 'hidden',
  },
  rays: {
    position: 'absolute',
  },
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 3,
    textAlign: 'center',
  },
  hero: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: {
    alignItems: 'center',
    gap: 6,
  },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wordmark: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    letterSpacing: -0.5,
    color: Colors.ink,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  hexWrap: {
    width: 17,
    height: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexNumeral: {
    position: 'absolute',
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
  },
  hexCrest: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  idText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  idUrl: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
});
