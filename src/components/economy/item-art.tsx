import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { ArtKind, CatalogItem } from '@/lib/economy/catalog';

// One vector family per item TYPE, recoloured by the item's own two-stop palette (21f, art from
// mocks 61/63/64/65). ~60 items don't need ~60 hand-drawn files: within a type the silhouette is
// the constant and the PALETTE is the item, which is also exactly the §4 flame constraint —
// a flame cosmetic changes the colour ramp and nothing else.

type Props = { item: CatalogItem; size?: number };

export function ItemArt({ item, size = 44 }: Props) {
  const { from, to } = tilePalette(item);
  const h = Math.round(size * 1.07);
  return (
    <Svg width={size} height={h} viewBox="0 0 90 96">
      {shapeFor(item.art.kind, from, to)}
    </Svg>
  );
}

/**
 * The two stops this tile draws with — `item.art` for everything except a FLARE.
 *
 * A flare tile is a preview of the perimeter aura, so it leads with `flare.colour`, which IS the
 * colour the aura paints. Zeus' Wrath is why: its stops run blue -> gold and its aura is golden
 * thunderbolts, but the tile is built dominant-stop-first, so the mythic rendered as a BLUE
 * starburst — the wrong item entirely (COSMETIC_UI_FIXES §4). Leading with the aura's own colour
 * fixes it by construction rather than by special-casing one id, and it can never drift again:
 * change the aura and the tile follows.
 *
 * The trailing stop is whichever of the two the lead is NOT, so Zeus keeps its blue as the faint
 * storm undertone the spec asks for, and Asgardian Valor — blue stops, blue aura — stays blue.
 */
function tilePalette(item: CatalogItem): { from: string; to: string } {
  const lead = item.flare?.colour;
  if (item.art.kind !== 'flare' || !lead) return item.art;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return { from: lead, to: same(lead, item.art.to) ? item.art.from : item.art.to };
}

function shapeFor(kind: ArtKind, from: string, to: string) {
  switch (kind) {
    // The flame silhouette from mock 67's grid — outer body in `from`, inner core in `to`.
    case 'flame':
      return (
        <>
          <Path
            d="M45 12 C56 34 70 42 70 62 a25 25 0 0 1 -50 0 C20 44 34 40 39 28 c2 9 6 12 6 12 C52 30 40 22 45 12Z"
            fill={from}
          />
          <Path d="M45 36 C52 50 60 55 60 68 a15 15 0 0 1 -30 0 c0 -8 5 -10 6 -16z" fill={to} />
        </>
      );

    // Particles: a dim flame with a scatter of orbiting motes thrown off it.
    case 'particle':
      return (
        <>
          <Path
            d="M45 26 C54 44 64 50 64 64 a19 19 0 0 1 -38 0 C26 52 38 48 41 38 c2 7 4 9 4 9 C50 40 41 33 45 26Z"
            fill={from}
            opacity={0.75}
          />
          <G fill={to}>
            <Circle cx="24" cy="30" r="3.4" />
            <Circle cx="66" cy="36" r="3" />
            <Circle cx="18" cy="54" r="2.6" />
            <Circle cx="72" cy="58" r="2.4" />
            <Circle cx="31" cy="16" r="2.2" />
            <Circle cx="58" cy="14" r="2.6" />
          </G>
        </>
      );

    // God-Mode flare: a radiating burst — the screen-edge aura, read as rays off a core.
    case 'flare':
      return (
        <>
          <G stroke={from} strokeWidth={4} strokeLinecap="round">
            <Path d="M45 6 L45 26" />
            <Path d="M45 66 L45 88" />
            <Path d="M6 46 L26 46" />
            <Path d="M64 46 L86 46" />
            <Path d="M18 19 L32 33" />
            <Path d="M72 19 L58 33" />
            <Path d="M18 73 L32 59" />
            <Path d="M72 73 L58 59" />
          </G>
          <Circle cx="45" cy="46" r="17" fill={from} />
          <Circle cx="45" cy="46" r="8" fill={to} />
        </>
      );

    // Card texture: the profile-card backdrop, shown as a rounded plate with a banded finish.
    case 'card':
      return (
        <>
          <Rect x="10" y="18" width="70" height="60" rx="8" fill={from} />
          <Rect x="10" y="18" width="70" height="60" rx="8" fill="none" stroke={to} strokeWidth={2} />
          <Rect x="18" y="30" width="54" height="5" rx="2.5" fill={to} opacity={0.85} />
          <Rect x="18" y="43" width="38" height="5" rx="2.5" fill={to} opacity={0.55} />
          <Rect x="18" y="56" width="46" height="5" rx="2.5" fill={to} opacity={0.35} />
        </>
      );

    // Avatar halo: the ring around the avatar, with the avatar itself neutral underneath.
    case 'halo':
      return (
        <>
          <Circle cx="45" cy="48" r="30" fill="none" stroke={from} strokeWidth={5} />
          <Circle cx="45" cy="48" r="30" fill="none" stroke={to} strokeWidth={2} strokeDasharray="6 9" />
          <Circle cx="45" cy="44" r="9" fill="#4a4460" />
          <Path d="M28 70 a17 14 0 0 1 34 0Z" fill="#4a4460" />
        </>
      );

    // Title: a nameplate — it's text in the product, so the art is the plate it sits on.
    case 'title':
      return (
        <>
          <Rect x="8" y="34" width="74" height="28" rx="14" fill={from} />
          <Rect x="8" y="34" width="74" height="28" rx="14" fill="none" stroke={to} strokeWidth={2} />
          <Rect x="20" y="45" width="34" height="6" rx="3" fill={to} />
          <Circle cx="64" cy="48" r="4" fill={to} />
        </>
      );

    // Campfire banner: header art — a wide pennant with a ridgeline.
    case 'banner':
      return (
        <>
          <Path d="M10 20 h70 v44 l-35 -12 l-35 12 Z" fill={from} />
          <Path d="M10 46 l18 -10 l14 8 l16 -12 l22 12 v8 l-35 -6 l-35 6 Z" fill={to} opacity={0.9} />
          <Rect x="10" y="20" width="70" height="6" rx="3" fill={to} />
        </>
      );

    // Focus audio: concentric arcs off a speaker core.
    case 'audio':
      return (
        <>
          <Path d="M26 36 h10 l14 -12 v48 l-14 -12 h-10 Z" fill={from} />
          <G stroke={to} strokeWidth={4} fill="none" strokeLinecap="round">
            <Path d="M58 34 a18 18 0 0 1 0 28" />
            <Path d="M66 26 a30 30 0 0 1 0 44" />
          </G>
        </>
      );

    // Rank-up SFX: a one-shot sting — a struck plate throwing a burst.
    case 'sfx':
      return (
        <>
          <Path d="M45 14 L54 40 L80 40 L59 55 L67 82 L45 66 L23 82 L31 55 L10 40 L36 40 Z" fill={from} />
          <Circle cx="45" cy="48" r="11" fill={to} />
        </>
      );

    // Relic: a mythic artifact — a faceted gem on a plinth.
    case 'relic':
      return (
        <>
          <Path d="M45 12 L68 34 L45 78 L22 34 Z" fill={from} />
          <Path d="M45 12 L68 34 L45 44 L22 34 Z" fill={to} opacity={0.85} />
          <Path d="M22 34 L68 34" stroke={to} strokeWidth={2} />
          <Ellipse cx="45" cy="84" rx="22" ry="5" fill={from} opacity={0.4} />
        </>
      );

    // Medal: season-stamped, never re-issued — a disc on a ribbon.
    case 'medal':
      return (
        <>
          <Path d="M32 10 L40 44 L28 44 Z" fill={to} opacity={0.8} />
          <Path d="M58 10 L62 44 L50 44 Z" fill={to} opacity={0.8} />
          <Circle cx="45" cy="60" r="24" fill={from} />
          <Circle cx="45" cy="60" r="24" fill="none" stroke={to} strokeWidth={3} />
          <Path d="M45 46 L50 57 L62 57 L52 64 L56 76 L45 69 L34 76 L38 64 L28 57 L40 57 Z" fill={to} />
        </>
      );

    // Unreachable while ArtKind and this switch agree — but the switch is exhaustive by convention,
    // not by construction, and returning `undefined` into <Svg> from a kind added to the union
    // without a case here would take out whatever grid the item is in. A neutral plate is a far
    // better failure than a blank screen (punchlist 8 §1).
    default:
      return (
        <>
          <Rect x="16" y="20" width="58" height="56" rx="10" fill={from} opacity={0.6} />
          <Circle cx="45" cy="48" r="12" fill={to} opacity={0.8} />
        </>
      );
  }
}
