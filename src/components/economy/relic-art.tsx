import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ONE SILHOUETTE PER RELIC — CODE_PROMPT_relic_reveal_fix.md §3.
//
// 🔴 WHAT THIS REPLACES. `ItemArt` draws one vector family per item TYPE and recolours it from the
// item's own two stops, which is exactly right for ~60 flames and titles: within a type the
// silhouette is the constant and the palette is the item. Relics are the one type where that
// premise is false. There are fourteen of them, each is a NAMED OBJECT out of the myth — a scroll,
// a sandal, an anvil, a bolt — and collapsing all fourteen onto `kind: 'relic'` meant every one of
// them rendered as the same faceted gem in a different colour. On a 27pt shelf tile that passes as
// a set; blown up to 124pt as the hero of a Legendary reveal it reads as a placeholder, which is
// the report this file exists to answer.
//
// SO THE KEY IS THE ART, not the type. `ItemArt` delegates here for any relic key listed below and
// keeps its gem for anything it does not know, which means the reveal, the share card, the Trophy
// Hall shelf, the Collection and the inventory tile all pick this up together. A relic that looked
// like a scroll on the reveal and a gem on the shelf would be a new drift on the day it shipped.
//
// STILL RECOLOURED BY THE CATALOG. `from`/`to` are the item's own stops, so Hercules stays bronze
// and the Oracle stays deep blue — the palette carries rarity and family exactly as it did before.
// The drawings are silhouettes on purpose: they have to survive being drawn at 27pt on a shelf tile
// AND at 124pt behind a ray fan, and detail that only reads at one of those sizes reads as noise at
// the other.
//
// 24×24 rather than ItemArt's 90×96 — these are icon-grid drawings and the box is the mock's
// (design-mocks/107, the discipline shelf). The rendered aspect ratio is kept identical to
// ItemArt's, so nothing that already lays a relic out has to change.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Every relic key with a drawing of its own. Anything absent falls back to ItemArt's gem. */
export const RELIC_ART_KEYS = [
  'relic-hestias-hearthstone',
  'relic-athenas-aegis',
  'relic-icarus-feather',
  'relic-anvil-of-hephaestus',
  'relic-prometheus-shard',
  'relic-zeus-bolt',
  'relic-atlas-burden',
  'relic-hercules-might',
  'relic-pheidippides-sandals',
  'relic-socrates-scroll',
  'relic-daedalus-blueprint',
  'relic-oracles-stillness',
  'relic-crown-of-olympus',
  'relic-emberfall',
] as const;

const KEYS: ReadonlySet<string> = new Set<string>(RELIC_ART_KEYS);

/** True when this relic has its own drawing. The gate `ItemArt` delegates on. */
export function hasRelicArt(relicKey: string): boolean {
  return KEYS.has(relicKey);
}

type Props = {
  relicKey: string;
  /** The item's own two stops — body and highlight. Straight off `CatalogItem.art`. */
  from: string;
  to: string;
  size?: number;
};

export function RelicArt({ relicKey, from, to, size = 44 }: Props) {
  return (
    <Svg width={size} height={Math.round(size * 1.07)} viewBox="0 0 24 24">
      {shapeFor(relicKey, from, to)}
    </Svg>
  );
}

function shapeFor(relicKey: string, from: string, to: string) {
  switch (relicKey) {
    // ─────────────────────────── §4a · the seven ancient relics ───────────────────────────

    // Hestia's Hearthstone — a coal from the first hearth. The stone is the body and the undying
    // flame sits INSIDE it rather than on top of it, which is the whole conceit of the lore.
    case 'relic-hestias-hearthstone':
      return (
        <>
          <Path d="M12 3l7 4v7.5c0 1.9-3.1 4.4-7 6.5-3.9-2.1-7-4.6-7-6.5V7z" fill={from} />
          <Path
            d="M12 8.5c.9 2 2.6 2.7 2.6 4.5a2.6 2.6 0 0 1-5.2 0c0-1 .6-1.6 1.2-2.2 0 1 .5 1.5 1 1.5.3-1-.5-2 .4-3.8z"
            fill={to}
          />
        </>
      );

    // Athena's Aegis — the shield that has never been broken. A boss and a spine, nothing more: an
    // aegis is read by its outline, and a gorgon's face at 27pt is a smudge.
    case 'relic-athenas-aegis':
      return (
        <>
          <Path d="M12 2.4l8 3.4v6.4c0 4.9-3.6 8.2-8 9.8-4.4-1.6-8-4.9-8-9.8V5.8z" fill={from} />
          <Circle cx="12" cy="11" r="3.1" fill={to} />
          <Path d="M12 5.4v2.2M12 14.4v3.4" stroke={to} strokeWidth={1.3} strokeLinecap="round" fill="none" />
        </>
      );

    // Icarus' Feather — scorched at the tip. The quill runs corner to corner and the burn is the
    // `to` stop bitten out of the high end, so "someone flew high enough to burn" is in the drawing
    // rather than only in the lore under it.
    case 'relic-icarus-feather':
      return (
        <>
          <Path
            d="M18.6 3.4c1.2 4.2-.4 9-3.6 12.2-2.2 2.2-5 3.2-7.6 3.4l-1.2 1.6-1.4-1 1.3-1.7c-.6-2.6.1-5.6 2.2-7.9C11.6 6.6 15 4.4 18.6 3.4z"
            fill={from}
          />
          <Path
            d="M18.6 3.4c-2.4 2.2-5.2 4.8-7.4 7.4-1.6 1.9-3 4.2-3.8 6.6"
            stroke={to}
            strokeWidth={1.1}
            strokeLinecap="round"
            fill="none"
          />
          <Path d="M18.6 3.4c-1.5.4-3 1-4.4 1.8.9 1.1 2.3 1.6 3.7 1.4z" fill={to} />
        </>
      );

    // Anvil of Hephaestus — horn, waist, base. Zeus' bolt was forged on it, so it is drawn heavy:
    // a wide face over a narrow stem, which is the one shape an anvil is.
    case 'relic-anvil-of-hephaestus':
      return (
        <>
          <Path d="M3 8h11.5c2 0 3.3-.8 4.5-2l1.6 1.4c-.9 2.2-2.4 3.6-4.6 4.1v1.3H8.6v-1.3H3z" fill={from} />
          <Path d="M9.6 12.8h5.4v3.4l3 3.4H6.6l3-3.4z" fill={from} opacity={0.9} />
          <Rect x="4.4" y="19.6" width="15.2" height="2" rx="1" fill={to} />
        </>
      );

    // Prometheus' Shard — a splinter of the stolen fire, still alight. Jagged on purpose: it is the
    // only relic in the set that is a BROKEN piece of something.
    case 'relic-prometheus-shard':
      return (
        <>
          <Path d="M13.4 1.8L7.2 12.6h3.6L8.4 22.2l8.4-12.4h-4z" fill={from} />
          <Path
            d="M13.4 1.8L10.6 9.8h2.2l-1.4 5.4"
            stroke={to}
            strokeWidth={1.2}
            strokeLinejoin="round"
            fill="none"
          />
        </>
      );

    // Zeus' Bolt — a struck line with a flare where it lands. Deliberately NOT the shard's shape:
    // the two mythics sit next to each other on the Trophy Hall shelf and must never read as one
    // item, which is the whole reason the old single-gem art had to go.
    case 'relic-zeus-bolt':
      return (
        <>
          <Path d="M14.8 2L5.6 13.2h4.6L8.8 22l9.6-11.8h-5z" fill={from} />
          <Path d="M14.8 2l-4.2 8.2h3.2z" fill={to} opacity={0.9} />
          <G stroke={to} strokeWidth={1.1} strokeLinecap="round" fill="none">
            <Path d="M20 4.6l1.8-1.4M3.6 20.2l-1.6 1.4M21 9.4h1.6" />
          </G>
        </>
      );

    // Atlas' Burden — the sky on a pair of shoulders. The figure is deliberately small under the
    // sphere; the drawing is about the load, not the man carrying it.
    case 'relic-atlas-burden':
      return (
        <>
          <Circle cx="12" cy="8" r="6" fill={from} />
          <Path
            d="M6.3 6.2h11.4M6.6 10.4h10.8M12 2v12"
            stroke={to}
            strokeWidth={0.9}
            opacity={0.75}
            fill="none"
          />
          <Path d="M8.4 14.6l1.8 1.6v5.6H8v-4.2l-2.6 2.6-1.3-1.3z" fill={to} />
          <Path d="M15.6 14.6l-1.8 1.6v5.6H16v-4.2l2.6 2.6 1.3-1.3z" fill={to} />
        </>
      );

    // ─────────────────── §4a-2 · the five discipline ladders, and the capstone ───────────────────
    // These follow design-mocks/107's shelf glyphs, so the tile someone has been watching fill is
    // the same object that lands on the reveal when it finally does.

    // Hercules' Might — a loaded barbell, sleeves and all.
    case 'relic-hercules-might':
      return (
        <>
          <Rect x="1.5" y="9" width="3" height="6" rx="1" fill={from} />
          <Rect x="19.5" y="9" width="3" height="6" rx="1" fill={from} />
          <Rect x="4.5" y="7.4" width="2.6" height="9.2" rx="1" fill={from} />
          <Rect x="16.9" y="7.4" width="2.6" height="9.2" rx="1" fill={from} />
          <Rect x="7.1" y="10.7" width="9.8" height="2.6" rx="1.3" fill={to} />
        </>
      );

    // Pheidippides' Sandals — a winged sandal. The wing is what separates it from a shoe, and it is
    // the half that carries the 414 km.
    case 'relic-pheidippides-sandals':
      return (
        <>
          <Path d="M4 17.6c0-1.8 1.4-2.9 3.3-2.9h6.5l4.7 3.3c.7.5.3 1.5-.6 1.5H7.3C5.4 19.5 4 18.6 4 17.6z" fill={from} />
          <Path
            d="M6.6 14.7l.5-2.6M10.2 14.7l.4-3.2M13.8 14.7l.5-2.6"
            stroke={to}
            strokeWidth={1.1}
            strokeLinecap="round"
            fill="none"
          />
          <Path d="M15.6 5.2c2.6.4 4.6 2 5.6 4.2-2.4.5-4.6-.2-6.2-1.8z" fill={to} />
          <Path d="M13.4 9.2c2 .3 3.6 1.3 4.6 2.8-1.9.5-3.7 0-5-1.2z" fill={to} opacity={0.75} />
        </>
      );

    // Socrates' Scroll — a rolled sheet with writing on it. Outlined rather than solid, because
    // "there is something written here" is the half of the object that means anything.
    case 'relic-socrates-scroll':
      return (
        <>
          <Path d="M7 3.4h9.4a2 2 0 0 1 2 2v15.2H9a2 2 0 0 1-2-2z" fill={from} />
          <Path d="M7 3.4a2 2 0 0 0-2 2v1.4h3z" fill={from} opacity={0.8} />
          <G stroke={to} strokeWidth={1.2} strokeLinecap="round" fill="none">
            <Path d="M10.4 9.4h5.2M10.4 12.6h5.2M10.4 15.8h3.2" />
          </G>
        </>
      );

    // Daedalus' Blueprint — the labyrinth as a plan view. A blueprint is a drawing OF something, so
    // there has to be something drawn on it.
    case 'relic-daedalus-blueprint':
      return (
        <>
          <Rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.2" fill={from} />
          <Path
            d="M7.4 17.4V9.6h6.2v4.8h-2.6v-2.2"
            stroke={to}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <Path d="M16.6 7.4v9.2" stroke={to} strokeWidth={1.1} opacity={0.6} strokeLinecap="round" fill="none" />
        </>
      );

    // Oracle's Stillness — rings widening out of nothing. The one relic whose subject is an
    // absence, drawn as one: the centre is empty and stays empty.
    case 'relic-oracles-stillness':
      return (
        <>
          <Circle cx="12" cy="12" r="9.4" fill="none" stroke={from} strokeWidth={1.3} opacity={0.45} />
          <Circle cx="12" cy="12" r="6.2" fill="none" stroke={from} strokeWidth={1.5} opacity={0.75} />
          <Circle cx="12" cy="12" r="3.2" fill="none" stroke={to} strokeWidth={1.6} />
          <Circle cx="12" cy="12" r="1" fill={to} />
        </>
      );

    // Crown of Olympus — the capstone. Five peaks for the five maxed ladders, which is literally
    // what earns it, and the only relic in the set drawn with stones set into it.
    case 'relic-crown-of-olympus':
      return (
        <>
          <Path d="M3 18.6L4.6 7l4.2 3.4L12 3.6l3.2 6.8L19.4 7 21 18.6z" fill={from} />
          <Rect x="3" y="18.6" width="18" height="2.6" rx="1.3" fill={to} />
          <G fill={to}>
            <Circle cx="12" cy="13.4" r="1.5" />
            <Circle cx="6.6" cy="14.4" r="1.1" />
            <Circle cx="17.4" cy="14.4" r="1.1" />
          </G>
        </>
      );

    // Emberfall Relic — the Forge Pass capstone, and the one relic named after a motion rather than
    // an object. Embers raining into a basin, which is the flare effect it is the trophy for.
    case 'relic-emberfall':
      return (
        <>
          <Path d="M4.4 13.6h15.2c0 4.3-3.4 7.4-7.6 7.4s-7.6-3.1-7.6-7.4z" fill={from} />
          <Ellipse cx="12" cy="13.6" rx="7.6" ry="1.7" fill={to} opacity={0.85} />
          <G fill={to}>
            <Circle cx="8.4" cy="4.2" r="1.3" />
            <Circle cx="12.6" cy="6.4" r="1.6" />
            <Circle cx="16.2" cy="3.4" r="1.1" />
            <Circle cx="10.2" cy="9.6" r="1" />
            <Circle cx="15.4" cy="9" r="1.3" />
          </G>
        </>
      );

    // Unreachable while `hasRelicArt` gates this — ItemArt keeps its gem for anything not in
    // RELIC_ART_KEYS, so a key only lands here if the two come apart. A gem is what would have been
    // drawn anyway, so that failure is invisible rather than blank (punchlist 8 §1).
    default:
      return (
        <>
          <Path d="M12 3.2L18.1 9 12 20.8 5.9 9z" fill={from} />
          <Path d="M12 3.2L18.1 9 12 11.7 5.9 9z" fill={to} opacity={0.85} />
        </>
      );
  }
}
