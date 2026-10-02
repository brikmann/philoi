import { useId, type ReactNode } from 'react';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { mix, shade, tint } from '@/lib/economy/colour';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ONE SILHOUETTE PER RELIC — CODE_PROMPT_relic_reveal_fix.md §3, elevated by design-mocks/255.
//
// 🔴 WHAT THIS REPLACES. `ItemArt` draws one vector family per item TYPE and recolours it from the
// item's own two stops, which is exactly right for ~60 flames and titles: within a type the
// silhouette is the constant and the palette is the item. Relics are the one type where that
// premise is false. Each is a NAMED OBJECT out of the myth — a scroll, a sandal, an anvil, a bolt —
// so the KEY is the art, not the type. `ItemArt` delegates here for any key listed below and keeps
// its fallback tablet for anything it does not know, which means the reveal, the share card, the
// Trophy Hall shelf, the Collection and the inventory tile all pick this up together.
//
// WHAT MOCK 255 CHANGED. The relics were flat two-tone glyphs. Same silhouettes, now given depth —
// every relic is drawn through the same five layers (see `RelicDrawing`):
//
//   1. a DROP — the silhouette again, dark and nudged down, so the object has an underside;
//   2. an UNDER layer — the emissive relics' own light (a forge glow, a flame's bloom);
//   3. the PAINT — material gradients (stone, gold, iron, leather, parchment, sky);
//   4. a SPECULAR bloom, upper-left, CLIPPED to the silhouette so it is on the object, not the air;
//   5. a RIM LIGHT — the silhouette stroked with a gradient that is bright at the top-left edge
//      and gone by the bottom-right, which is the single cheapest "this is lit" cue there is.
//
// What this file deliberately does NOT draw: the rarity glow, the cast shadow on the shelf and the
// float. `ItemPedestal` (item-art.tsx) already owns all three, and its shadow is the one that
// tightens as the piece rises — a second, static shadow drawn in here would ride UP with the float
// and sit inside the object. Same for the float: one driver, the pedestal's.
//
// MATERIALS ARE THE MOCK'S, PALETTE IS STILL THE CATALOG'S. Where a relic is intrinsically one
// material — Hestia's stone, Atlas' sky, the Emberfall boulder, a parchment scroll — the material
// is fixed, because a hearthstone recoloured purple stops being a stone. Everything that carries
// identity (gold, fire, bronze, the wing, the gems, the constellation) still comes off the item's
// own `from`/`to`, so the catalog keeps its say.
//
// TWO SIZES, ONE DRAWING. These must read at 27pt on a shelf tile AND at 124pt as a reveal hero.
// Below DETAIL_MIN the hairline detail (feather barbs, globe grid, craters, the blueprint's grid)
// is dropped — at 27pt a 0.3-unit line is a third of a pixel and reads as dirt, not detail.
//
// STATIC. Nothing here animates and nothing here holds state; the only hook is useId, so every
// mount gets its own gradient ids (react-native-svg on Android leaks a duplicate <Defs> id across
// mounts, so a shared "relicBody" would paint every relic with whichever registered first).
//
// 24×24 rather than ItemArt's 0-100 — these are icon-grid drawings. The rendered aspect ratio is
// kept identical to ItemArt's, so nothing that already lays a relic out has to change.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Every relic key with a drawing of its own. Anything absent falls back to ItemArt's tablet. */
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

/** Below this rendered width the hairline detail is dropped (a shelf tile is 27pt). */
const DETAIL_MIN = 40;

/** A standalone relic: its own <Svg>, 24-grid, in ItemArt's 1:1.07 box. */
export function RelicArt({ relicKey, from, to, size = 44 }: Props) {
  return (
    <Svg width={size} height={Math.round(size * 1.07)} viewBox="0 0 24 24">
      <RelicDrawing relicKey={relicKey} from={from} to={to} size={size} />
    </Svg>
  );
}

/**
 * The same drawing as SVG nodes in ItemPedestal's 0-100 box, for its `inline` (single-<Svg>,
 * still) path — so a grid of relics costs one native view per tile instead of four. Both boxes
 * are drawn `meet` into the same w × h frame, so 100/24 maps one exactly onto the other.
 */
export function RelicArtInline({ relicKey, from, to, size = 44 }: Props) {
  return (
    <G transform={`scale(${100 / 24})`}>
      <RelicDrawing relicKey={relicKey} from={from} to={to} size={size} />
    </G>
  );
}

// ─────────────────────────── the shared five layers ───────────────────────────

type Ctx = {
  /** A per-mount gradient id. */
  id: (name: string) => string;
  /** `url(#…)` of a per-mount gradient id. */
  url: (name: string) => string;
  from: string;
  to: string;
  /** False below DETAIL_MIN — draw the silhouette and its big planes only. */
  detail: boolean;
};

type Spec = { cx: number; cy: number; rx: number; ry: number; opacity?: number };

type Drawing = {
  /** The whole silhouette as one path (several subpaths is fine) — the drop, the clip, the rim. */
  body: string;
  defs?: ReactNode;
  /** Light the object throws behind itself. Drawn under the drop. */
  under?: ReactNode;
  paint: ReactNode;
  /** Drawn over the specular and the rim — emissive marks that should not be dulled by either. */
  over?: ReactNode;
  /** Null for the self-lit relics (a flame has no specular, it IS the light). */
  spec: Spec | null;
  /** The drop's strength; 0 for the relics that are their own light. */
  drop?: number;
};

function RelicDrawing({ relicKey, from, to, size }: Required<Props>) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ctx: Ctx = {
    id: (name) => `relic-${name}-${uid}`,
    url: (name) => `url(#relic-${name}-${uid})`,
    from,
    to,
    detail: size >= DETAIL_MIN,
  };
  const d = drawingFor(relicKey, ctx);
  const drop = d.drop ?? 0.38;

  return (
    <G>
      <Defs>
        {d.defs}
        <ClipPath id={ctx.id('clip')}>
          <Path d={d.body} />
        </ClipPath>
        <RadialGradient id={ctx.id('spec')} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="1" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={ctx.id('rim')} x1="0" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
          <Stop offset="0.45" stopColor="#ffffff" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {d.under}
      {drop > 0 ? (
        <G transform="translate(0 0.9)">
          <Path d={d.body} fill="#000000" opacity={drop} />
        </G>
      ) : null}
      {d.paint}
      {d.spec ? (
        <G clipPath={ctx.url('clip')}>
          <Ellipse
            cx={d.spec.cx}
            cy={d.spec.cy}
            rx={d.spec.rx}
            ry={d.spec.ry}
            fill={ctx.url('spec')}
            opacity={d.spec.opacity ?? 0.45}
          />
        </G>
      ) : null}
      <Path d={d.body} fill="none" stroke={ctx.url('rim')} strokeWidth={ctx.detail ? 0.5 : 0.65} strokeLinejoin="round" />
      {d.over}
    </G>
  );
}

/** A rounded rect as a path, so it can join a multi-part silhouette. */
function rr(x: number, y: number, w: number, h: number, r: number): string {
  const n = (v: number) => +v.toFixed(3);
  return (
    `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${n(h - 2 * r)}` +
    `a${r} ${r} 0 0 1 -${r} ${r}h-${n(w - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}v-${n(h - 2 * r)}a${r} ${r} 0 0 1 ${r} -${r}z`
  );
}

/** A soft light pool — a radial gradient that fades to nothing at its edge. */
function glowDef(id: string, colour: string, peak: number) {
  return (
    <RadialGradient id={id} cx="50%" cy="50%" r="50%">
      <Stop offset="0" stopColor={colour} stopOpacity={peak} />
      <Stop offset="0.55" stopColor={colour} stopOpacity={peak * 0.35} />
      <Stop offset="1" stopColor={colour} stopOpacity="0" />
    </RadialGradient>
  );
}

// ─────────────────────────── the relics ───────────────────────────

function drawingFor(relicKey: string, c: Ctx): Drawing {
  switch (relicKey) {
    // ─────────────────────────── §4a · the seven ancient relics ───────────────────────────

    // Hestia's Hearthstone — a coal from the first hearth. A cut stone, lit top-left so its right
    // face falls into shadow, and the undying flame sits INSIDE it (the lore). The flame is the
    // mock's, flipped so it leans into the light.
    case 'relic-hestias-hearthstone': {
      const body = 'M12 3l7 4v7.5c0 1.9-3.1 4.4-7 6.5-3.9-2.1-7-4.6-7-6.5V7z';
      return {
        body,
        defs: (
          <>
            <LinearGradient id={c.id('stone')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#4a4660" />
              <Stop offset="1" stopColor="#201a30" />
            </LinearGradient>
            <RadialGradient id={c.id('flame')} cx="50%" cy="62%" r="60%">
              <Stop offset="0" stopColor={tint(c.to, 0.6)} />
              <Stop offset="0.5" stopColor={mix(c.from, c.to, 0.3)} />
              <Stop offset="1" stopColor={c.from} />
            </RadialGradient>
            {glowDef(c.id('ember'), c.from, 0.7)}
          </>
        ),
        paint: (
          <>
            <Path d={body} fill={c.url('stone')} stroke="#9a90b4" strokeWidth={0.4} />
            {/* the top plane catches the light; the right face turns away from it */}
            <Path d="M12 3l7 4-7 3.2L5 7z" fill="#6a6488" opacity={0.7} />
            <Path d="M12 10.2L19 7v7.5c0 1.9-3.1 4.4-7 6.5z" fill="#000000" opacity={0.18} />
            {c.detail ? (
              // fissures the fire shows through
              <Path
                d="M8.6 15.4l-1.8 1.1M15.4 15.3l1.7 1.3M12 17.2v1.6"
                stroke={c.from}
                strokeWidth={0.45}
                strokeLinecap="round"
                opacity={0.6}
              />
            ) : null}
            <Ellipse cx="12" cy="13.6" rx="4.4" ry="4.6" fill={c.url('ember')} />
          </>
        ),
        over: (
          <>
            <Path
              d="M12 8.5c-.9 2-2.6 2.7-2.6 4.5a2.6 2.6 0 0 0 5.2 0c0-1-.6-1.6-1.2-2.2 0 1-.5 1.5-1 1.5-.3-1 .5-2-.4-3.8z"
              fill={c.url('flame')}
              stroke={tint(c.to, 0.5)}
              strokeWidth={0.2}
            />
            <Ellipse cx="12" cy="14.2" rx="1" ry="1.3" fill={tint(c.to, 0.75)} opacity={0.85} />
          </>
        ),
        spec: { cx: 9.4, cy: 6.6, rx: 3.2, ry: 1.8, opacity: 0.35 },
      };
    }

    // Athena's Aegis — the shield that has never been broken. A proper HEATER shield: flat chief,
    // straight flanks, one curve to the point. Bevelled down the spine (the right half is in shade)
    // and a boss at the centre. A gorgon's face at 27pt is a smudge, so the boss stands in for it.
    case 'relic-athenas-aegis': {
      const body = 'M4 3.4H20V10C20 15.6 16.4 19.4 12 21.4 7.6 19.4 4 15.6 4 10Z';
      return {
        body,
        defs: (
          <LinearGradient id={c.id('gold')} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={tint(c.to, 0.55)} />
            <Stop offset="0.5" stopColor={shade(c.to, 0.16)} />
            <Stop offset="1" stopColor={shade(c.to, 0.6)} />
          </LinearGradient>
        ),
        paint: (
          <>
            <Path d={body} fill={c.url('gold')} stroke={tint(c.to, 0.7)} strokeWidth={0.5} />
            <Path d="M12 3.4H20V10C20 15.6 16.4 19.4 12 21.4Z" fill="#000000" opacity={0.14} />
            <Path d="M4 3.4H20V5.2H4Z" fill={tint(c.to, 0.8)} opacity={0.5} />
            {c.detail ? (
              <>
                <Path
                  d="M5.5 5.6H18.5V10C18.5 14.7 15.5 17.9 12 19.7 8.5 17.9 5.5 14.7 5.5 10Z"
                  fill="none"
                  stroke={shade(c.to, 0.45)}
                  strokeWidth={0.4}
                  opacity={0.55}
                />
                <Path d="M12 5.6V19.6M5.6 11H18.4" stroke={shade(c.to, 0.55)} strokeWidth={0.55} opacity={0.45} />
              </>
            ) : null}
            <Circle cx="12" cy="10.8" r="2.7" fill={shade(c.from, 0.72)} />
            <Circle cx="12" cy="10.8" r="2.7" fill="none" stroke={tint(c.to, 0.7)} strokeWidth={0.6} />
            <Circle cx="12" cy="10.8" r="1" fill={tint(c.to, 0.75)} opacity={0.85} />
            {c.detail ? <Circle cx="11.1" cy="9.9" r="0.45" fill="#ffffff" opacity={0.7} /> : null}
          </>
        ),
        spec: { cx: 8, cy: 6.8, rx: 3.6, ry: 2.6 },
      };
    }

    // Icarus' Feather — scorched at the tip. A pale quill that warms toward the burn; the scorch is
    // its own glowing edge, so "someone flew high enough to burn" is in the drawing.
    case 'relic-icarus-feather': {
      const body =
        'M18.6 3.4c1.2 4.2-.4 9-3.6 12.2-2.2 2.2-5 3.2-7.6 3.4l-1.2 1.6-1.4-1 1.3-1.7c-.6-2.6.1-5.6 2.2-7.9C11.6 6.6 15 4.4 18.6 3.4z';
      const scorch = 'M14 15.6c-1.9 2-4.3 3-6.6 3.4';
      return {
        body,
        defs: (
          <LinearGradient id={c.id('vane')} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c.to} />
            <Stop offset="0.6" stopColor={c.from} />
            <Stop offset="1" stopColor="#E0612C" />
          </LinearGradient>
        ),
        paint: (
          <>
            <Path d={body} fill={c.url('vane')} stroke={tint(c.to, 0.6)} strokeWidth={0.35} />
            {c.detail ? (
              // barbs, both sides of the shaft
              <Path
                d="M16.4 5.6l1.6.9M14.6 7.4l2.2 1.2M12.8 9.4l2.6 1.4M11.2 11.6l2.6 1.6M15.8 5.4l-1.3-.9M13.8 7.2l-1.6-.8M12 9.4l-1.8-.6M10.4 11.8l-1.7-.3"
                stroke={shade(c.from, 0.3)}
                strokeWidth={0.28}
                strokeLinecap="round"
                opacity={0.5}
              />
            ) : null}
            <Path
              d="M18.6 3.4c-2.4 2.2-5.2 4.8-7.4 7.4-1.6 1.9-3 4.2-3.8 6.6"
              stroke={shade(c.from, 0.35)}
              strokeWidth={0.9}
              strokeLinecap="round"
              fill="none"
            />
          </>
        ),
        over: (
          <>
            <Path d={scorch} stroke="#FF7A1E" strokeWidth={2.6} strokeLinecap="round" fill="none" opacity={0.28} />
            <Path d={scorch} stroke="#E0612C" strokeWidth={1.4} strokeLinecap="round" fill="none" />
          </>
        ),
        spec: { cx: 15.2, cy: 6.4, rx: 2.8, ry: 1.6 },
      };
    }

    // Anvil of Hephaestus — horn, waist, base. Drawn heavy: a wide face over a narrow stem. Dark
    // iron with a lit top face, on a gilded foot, and the forge's glow pooled under it.
    case 'relic-anvil-of-hephaestus': {
      const top = 'M3 8h11.5c2 0 3.3-.8 4.5-2l1.6 1.4c-.9 2.2-2.4 3.6-4.6 4.1v1.3H8.6v-1.3H3z';
      const waist = 'M9.6 12.8h5.4v3.4l3 3.4H6.6l3-3.4z';
      const foot = rr(4.4, 19.4, 15.2, 2.2, 1.1);
      return {
        body: `${top}${waist}${foot}`,
        defs: (
          <>
            <LinearGradient id={c.id('iron')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tint(c.from, 0.15)} />
              <Stop offset="1" stopColor={shade(c.from, 0.45)} />
            </LinearGradient>
            <LinearGradient id={c.id('foot')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tint(c.to, 0.35)} />
              <Stop offset="1" stopColor={shade(c.to, 0.4)} />
            </LinearGradient>
            {glowDef(c.id('forge'), '#FF8A2C', 0.9)}
          </>
        ),
        under: <Ellipse cx="12" cy="20" rx="9" ry="2.8" fill={c.url('forge')} />,
        paint: (
          <>
            <Path d={top} fill={c.url('iron')} stroke={tint(c.from, 0.35)} strokeWidth={0.4} />
            <Path d="M3 8h11.5c2 0 3.3-.8 4.5-2l1.6 1.4-1 .6H3z" fill={tint(c.from, 0.3)} opacity={0.75} />
            <Path d={waist} fill={c.url('iron')} />
            <Path d="M12.3 12.8h2.7v3.4l3 3.4h-5.7z" fill="#000000" opacity={0.2} />
            <Path d={foot} fill={c.url('foot')} />
            {c.detail ? (
              <>
                {/* the hardy hole, and the warm mark where the bolt was struck */}
                <Path d="M15.6 8.5h1v.8h-1z" fill="#000000" opacity={0.45} />
                <Ellipse cx="9.4" cy="8.6" rx="2.2" ry="0.5" fill="#FF8A2C" opacity={0.55} />
                <Path d="M5.6 19.9h12.8" stroke={tint(c.to, 0.7)} strokeWidth={0.35} strokeLinecap="round" opacity={0.7} />
              </>
            ) : null}
          </>
        ),
        spec: { cx: 7, cy: 9, rx: 3.4, ry: 1.4, opacity: 0.4 },
      };
    }

    // Prometheus' Shard — a splinter of the stolen fire, and it is FIRE: a real flame with a
    // white-hot core, not a bolt and not a gem. The mock's flame, flipped, blooming into the dark.
    case 'relic-prometheus-shard': {
      const body =
        'M12 1.4c-1.7 5-6.6 6-6.6 11.5a6.6 6.6 0 0 0 13.2 0c0-2.8-1.1-4.4-2.6-5.7 0 2.6-1.3 4-2.6 4-.9-2.9 1.5-5.5-1.4-9.8z';
      return {
        body,
        defs: (
          <>
            <RadialGradient id={c.id('fire')} cx="50%" cy="74%" r="64%">
              <Stop offset="0" stopColor="#ffffff" />
              <Stop offset="0.26" stopColor={tint(c.to, 0.15)} />
              <Stop offset="0.58" stopColor={mix(c.from, '#FF8A2C', 0.35)} />
              <Stop offset="1" stopColor={shade(c.from, 0.45)} />
            </RadialGradient>
            {glowDef(c.id('bloom'), c.from, 0.6)}
            <RadialGradient id={c.id('core')} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="1" />
              <Stop offset="0.6" stopColor="#ffffff" stopOpacity="0.85" />
              <Stop offset="1" stopColor={c.to} stopOpacity="0" />
            </RadialGradient>
          </>
        ),
        under: <Ellipse cx="12" cy="12.6" rx="11" ry="11.4" fill={c.url('bloom')} />,
        paint: (
          <>
            <Path d={body} fill={c.url('fire')} stroke={tint(c.to, 0.5)} strokeWidth={0.3} />
            {c.detail ? (
              // the inner tongue — a second, hotter flame inside the first
              <Path
                d="M12 7.6c-.9 2.8-3.4 3.8-3.4 7a3.4 3.4 0 0 0 6.8 0c0-1.8-.8-2.8-1.6-3.6-.1 1.4-.7 2.2-1.4 2.2-.3-1.8.6-3.2-.4-5.6z"
                fill={tint(c.to, 0.35)}
                opacity={0.75}
              />
            ) : null}
          </>
        ),
        over: <Ellipse cx="12" cy="15.6" rx="2.5" ry="3.4" fill={c.url('core')} />,
        spec: null,
        drop: 0,
      };
    }

    // Zeus' Bolt — caught the instant after it struck. Deliberately NOT the shard's shape: the two
    // mythics sit side by side on the Trophy Hall shelf. White-hot at the top, a lit upper facet,
    // the lower blade in its own shade, and the sparks still coming off it.
    case 'relic-zeus-bolt': {
      const body = 'M14.8 2L5.6 13.2h4.6L8.8 22l9.6-11.8h-5z';
      return {
        body,
        defs: (
          <>
            <LinearGradient id={c.id('bolt')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" />
              <Stop offset="0.45" stopColor={tint(c.from, 0.45)} />
              <Stop offset="1" stopColor={shade(c.from, 0.12)} />
            </LinearGradient>
            {glowDef(c.id('charge'), tint(c.from, 0.3), 0.55)}
          </>
        ),
        under: <Ellipse cx="12" cy="12" rx="10" ry="11.4" fill={c.url('charge')} />,
        paint: (
          <>
            <Path d={body} fill={c.url('bolt')} stroke="#ffffff" strokeWidth={0.4} />
            <Path d="M10.2 13.2L8.8 22l4.8-5.9z" fill="#000000" opacity={0.14} />
            <Path d="M14.8 2l-4.2 8.2h3.2z" fill="#ffffff" opacity={0.75} />
          </>
        ),
        over: (
          <Path
            d={c.detail ? 'M20 4.6l1.8-1.4M3.6 20.2l-1.6 1.4M21 9.4h1.6M2.6 15.2l1.4-.6' : 'M20 4.6l1.8-1.4M3.6 20.2l-1.6 1.4'}
            stroke={tint(c.to, 0.4)}
            strokeWidth={1}
            strokeLinecap="round"
            opacity={0.85}
          />
        ),
        spec: null,
        drop: 0.3,
      };
    }

    // Atlas' Burden — the weight of the whole sky, so the sky is the whole drawing: a celestial
    // globe, no arms, no figure. Night-blue sphere lit upper-left, meridian and equator, the
    // ecliptic band in gold, and stars.
    case 'relic-atlas-burden': {
      const body = 'M2.7 12a9.3 9.3 0 1 0 18.6 0a9.3 9.3 0 1 0-18.6 0z';
      return {
        body,
        defs: (
          <>
            <RadialGradient id={c.id('sky')} cx="37%" cy="30%" r="70%">
              <Stop offset="0" stopColor="#7a8ee0" />
              <Stop offset="0.55" stopColor="#2a3a7a" />
              <Stop offset="1" stopColor="#0c1230" />
            </RadialGradient>
            {glowDef(c.id('aura'), '#4a6ad0', 0.55)}
          </>
        ),
        under: <Ellipse cx="12" cy="12" rx="11.8" ry="11.8" fill={c.url('aura')} />,
        paint: (
          <>
            <Path d={body} fill={c.url('sky')} stroke="#9fb0ff" strokeWidth={0.55} />
            <G stroke="#9fb0ff" strokeWidth={c.detail ? 0.45 : 0.6} opacity={0.5} fill="none">
              <Ellipse cx="12" cy="12" rx="9.3" ry="3.6" />
              <Ellipse cx="12" cy="12" rx="4.7" ry="9.3" />
              {c.detail ? <Path d="M2.7 12H21.3M12 2.7V21.3" /> : null}
            </G>
            {c.detail ? (
              <G transform="rotate(-23 12 12)">
                <Ellipse cx="12" cy="12" rx="9.2" ry="2.4" fill="none" stroke="#F5C542" strokeWidth={0.7} opacity={0.55} />
              </G>
            ) : null}
            <G fill="#dfeaff">
              <Circle cx="8.6" cy="7.8" r="0.6" />
              <Circle cx="15" cy="9.6" r="0.55" />
              <Circle cx="10.6" cy="15" r="0.5" />
              <Circle cx="14.6" cy="15.2" r="0.45" />
              {c.detail ? (
                <>
                  <Circle cx="6.4" cy="12.8" r="0.35" />
                  <Circle cx="17.6" cy="13.4" r="0.35" />
                  <Circle cx="12.8" cy="5.6" r="0.3" />
                </>
              ) : null}
            </G>
            {c.detail ? (
              <Path d="M8.6 7.8L12.8 5.6M15 9.6L17.6 13.4" stroke="#dfeaff" strokeWidth={0.25} opacity={0.5} />
            ) : null}
          </>
        ),
        spec: { cx: 9, cy: 8.2, rx: 3.6, ry: 2.6, opacity: 0.4 },
      };
    }

    // ─────────────────── §4a-2 · the five discipline ladders, and the capstone ───────────────────
    // These follow design-mocks/107's shelf glyphs, so the tile someone has been watching fill is
    // the same object that lands on the reveal when it finally does.

    // Hercules' Might — a loaded bar. Steel plates (the mock), and the bar itself in the item's own
    // bronze so Hercules still reads as the bronze ladder.
    case 'relic-hercules-might': {
      const plates = [rr(1.5, 9, 3, 6, 1), rr(19.5, 9, 3, 6, 1), rr(4.5, 7.4, 2.6, 9.2, 1), rr(16.9, 7.4, 2.6, 9.2, 1)];
      const bar = rr(7.1, 10.7, 9.8, 2.6, 1.3);
      return {
        body: plates.join('') + bar,
        defs: (
          <>
            <LinearGradient id={c.id('steel')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#e4e8ee" />
              <Stop offset="0.5" stopColor="#a4abb4" />
              <Stop offset="1" stopColor="#5a6068" />
            </LinearGradient>
            <LinearGradient id={c.id('bar')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tint(c.to, 0.35)} />
              <Stop offset="0.5" stopColor={c.to} />
              <Stop offset="1" stopColor={shade(c.from, 0.1)} />
            </LinearGradient>
          </>
        ),
        paint: (
          <>
            <Path d={bar} fill={c.url('bar')} />
            <Path d={rr(7.4, 10.9, 9.2, 0.9, 0.45)} fill={tint(c.to, 0.7)} opacity={0.6} />
            {plates.map((p) => (
              <Path key={p} d={p} fill={c.url('steel')} stroke="#3e434a" strokeWidth={0.3} />
            ))}
            {c.detail ? (
              <Path
                d="M2.4 9.6h1.2M20.4 9.6h1.2M5.3 8h1M17.7 8h1"
                stroke="#ffffff"
                strokeWidth={0.4}
                strokeLinecap="round"
                opacity={0.75}
              />
            ) : null}
          </>
        ),
        spec: { cx: 5.6, cy: 9.4, rx: 2.4, ry: 1.8, opacity: 0.4 },
      };
    }

    // Pheidippides' Sandals — a winged sandal (talaria). Leather sole and straps, and a refined wing
    // rising from the heel and sweeping back: three primaries, a lighter covert layer, its own
    // glow. The wing is what separates it from a shoe — and the half that carries the 414 km.
    case 'relic-pheidippides-sandals': {
      const sole = 'M20 17.6c0-1.8-1.4-2.9-3.3-2.9h-6.5l-4.7 3.3c-.7.5-.3 1.5.6 1.5h10.6c1.9 0 3.3-.9 3.3-1.9z';
      const wing =
        'M16.4 12.2C15.8 8.4 17.8 4.6 21.4 2.8C21 4 21.2 4.8 22.6 5.4C21.6 6 21.6 7 22.4 8C21.2 8.2 20.8 9.2 20.8 10.4C19.6 10.2 18.4 11 17.8 12.4Z';
      return {
        body: sole + wing,
        defs: (
          <>
            <LinearGradient id={c.id('leather')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#9a6634" />
              <Stop offset="1" stopColor="#4e3216" />
            </LinearGradient>
            <LinearGradient id={c.id('wing')} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={c.from} />
              <Stop offset="0.55" stopColor={tint(c.from, 0.72)} />
              <Stop offset="1" stopColor="#ffffff" />
            </LinearGradient>
            {glowDef(c.id('lift'), c.from, 0.55)}
          </>
        ),
        under: <Ellipse cx="19.4" cy="7.4" rx="5.2" ry="6" fill={c.url('lift')} />,
        paint: (
          <>
            <Path d={sole} fill={c.url('leather')} stroke="#c89a5a" strokeWidth={0.4} />
            <Path d="M5.6 18.6c.2.6.6.9 1.1.9h10c1.4 0 2.6-.5 3.1-1.3-.6.3-1.6.5-2.6.5z" fill="#000000" opacity={0.3} />
            <Path
              d="M17.4 14.7l-.5-2.6M13.8 14.7l-.4-3.2M10.2 14.7l-.5-2.6M17.6 12.1c-1.6-.7-3.6-.9-5.2-.6"
              stroke="#c89a5a"
              strokeWidth={c.detail ? 0.85 : 1}
              strokeLinecap="round"
              fill="none"
            />
            <Path d={wing} fill={c.url('wing')} stroke={tint(c.from, 0.85)} strokeWidth={0.3} />
            <Path
              d="M16.6 12C16.4 9.4 17.6 7 19.8 5.6C19.6 7 20 7.8 20.8 8.4C19.6 8.8 19 9.8 18.8 11Z"
              fill={tint(c.from, 0.88)}
              opacity={0.8}
            />
            {c.detail ? (
              <Path
                d="M17.2 11.6L21 3.8M17.4 11.8L22 6M17.8 12L21.6 8.4"
                stroke="#ffffff"
                strokeWidth={0.28}
                strokeLinecap="round"
                opacity={0.55}
              />
            ) : null}
          </>
        ),
        spec: { cx: 18.2, cy: 6, rx: 2.2, ry: 2.4, opacity: 0.5 },
      };
    }

    // Socrates' Scroll — a sheet with writing on it, curled at the head. Parchment is parchment, so
    // the material is fixed; the wax seal is the item's own colour.
    case 'relic-socrates-scroll': {
      const sheet = 'M7 3.4h9.4a2 2 0 0 1 2 2v15.2H9a2 2 0 0 1-2-2z';
      const curl = 'M7 3.4a2 2 0 0 0-2 2v1.4h3z';
      return {
        body: sheet + curl,
        defs: (
          <LinearGradient id={c.id('vellum')} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F6ECCC" />
            <Stop offset="1" stopColor="#BFA978" />
          </LinearGradient>
        ),
        paint: (
          <>
            <Path d={sheet} fill={c.url('vellum')} stroke="#a89668" strokeWidth={0.4} />
            {/* the sheet bows away from the light down its right edge */}
            <Path d="M16.2 3.4h.2a2 2 0 0 1 2 2v15.2h-2.2z" fill="#000000" opacity={0.12} />
            <Path d={curl} fill="#d8c8a0" />
            <Path d="M5 5.4v1.4h3V5.6c-1 .4-2 .3-3-.2z" fill="#000000" opacity={0.18} />
            <G stroke="#5a4a2e" strokeLinecap="round" fill="none" opacity={0.8}>
              {c.detail ? (
                <Path d="M10.2 8.4h5.6M10.2 10.4h5.6M10.2 12.4h5.6M10.2 14.4h4" strokeWidth={0.6} />
              ) : (
                <Path d="M10.4 9.4h5.2M10.4 12.6h5.2" strokeWidth={1.1} />
              )}
            </G>
            <Circle cx="15.4" cy="17.6" r={c.detail ? 1.3 : 1.5} fill={c.from} stroke={shade(c.from, 0.35)} strokeWidth={0.3} />
            {c.detail ? <Circle cx="15" cy="17.2" r="0.4" fill={tint(c.from, 0.6)} opacity={0.8} /> : null}
          </>
        ),
        spec: { cx: 10, cy: 6, rx: 3.4, ry: 1.8, opacity: 0.4 },
      };
    }

    // Daedalus' Blueprint — the labyrinth, drawn from above by the one who built it. Blueprint
    // paper is blueprint paper; the drawn lines glow in the item's own light colour.
    case 'relic-daedalus-blueprint': {
      const sheet = rr(3.4, 3.4, 17.2, 17.2, 2.2);
      const maze = 'M7.4 17.4V9.6h6.2v4.8h-2.6v-2.2';
      const ink = tint(c.to, 0.25);
      return {
        body: sheet,
        defs: (
          <LinearGradient id={c.id('paper')} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#245688" />
            <Stop offset="1" stopColor="#0c2442" />
          </LinearGradient>
        ),
        paint: (
          <>
            <Path d={sheet} fill={c.url('paper')} stroke="#4FB0E5" strokeWidth={0.5} />
            {c.detail ? (
              <>
                <Path
                  d="M3.6 7.4h16.8M3.6 11.4h16.8M3.6 15.4h16.8M7.4 3.6v16.8M11.4 3.6v16.8M15.4 3.6v16.8"
                  stroke="#7fd0ff"
                  strokeWidth={0.2}
                  opacity={0.18}
                />
                <Path d="M5.6 7.4V5.6h12.8v12.8H9.6" stroke={ink} strokeWidth={0.5} strokeLinecap="round" fill="none" opacity={0.45} />
              </>
            ) : null}
            <Path d={maze} stroke={c.to} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.22} />
            <Path d={maze} stroke={ink} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <Path d="M16.6 7.4v9.2" stroke={ink} strokeWidth={1} opacity={0.6} strokeLinecap="round" fill="none" />
            {c.detail ? <Path d="M20.6 17.2v1.2a2.2 2.2 0 0 1-2.2 2.2h-1.2z" fill="#9fe0ff" opacity={0.35} /> : null}
          </>
        ),
        spec: { cx: 8, cy: 6.6, rx: 4.4, ry: 2.6, opacity: 0.25 },
      };
    }

    // Crown of Olympus — the capstone. Five peaks for the five maxed ladders, gold from the item's
    // own stop, and the only relic set with stones; the centre stone is the item's own colour.
    case 'relic-crown-of-olympus': {
      const crown = 'M3 18.6L4.6 7l4.2 3.4L12 3.6l3.2 6.8L19.4 7 21 18.6z';
      const band = rr(3, 18.6, 18, 2.6, 1.3);
      return {
        body: crown + band,
        defs: (
          <>
            <LinearGradient id={c.id('gold')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tint(c.from, 0.65)} />
              <Stop offset="0.5" stopColor={c.from} />
              <Stop offset="1" stopColor={shade(c.from, 0.38)} />
            </LinearGradient>
            {glowDef(c.id('regal'), c.from, 0.45)}
          </>
        ),
        under: <Ellipse cx="12" cy="12" rx="11.4" ry="10.4" fill={c.url('regal')} />,
        paint: (
          <>
            <Path d={crown} fill={c.url('gold')} stroke={tint(c.from, 0.8)} strokeWidth={0.5} strokeLinejoin="round" />
            <Path d="M12 3.6l3.2 6.8L19.4 7 21 18.6H12z" fill="#000000" opacity={0.12} />
            <Path d={band} fill={shade(c.from, 0.38)} />
            <Path d={rr(3.6, 18.9, 16.8, 0.7, 0.35)} fill={tint(c.from, 0.6)} opacity={0.6} />
            {c.detail ? (
              <G fill={tint(c.from, 0.75)}>
                <Circle cx="4.6" cy="7" r="0.75" />
                <Circle cx="12" cy="3.6" r="0.85" />
                <Circle cx="19.4" cy="7" r="0.75" />
              </G>
            ) : null}
            <Circle cx="12" cy="13.4" r="1.6" fill={c.to} stroke={shade(c.to, 0.4)} strokeWidth={0.25} />
            <Circle cx="6.6" cy="14.4" r="1.1" fill="#7fd0ff" stroke="#2f6f96" strokeWidth={0.2} />
            <Circle cx="17.4" cy="14.4" r="1.1" fill="#7BE06A" stroke="#2f7a3c" strokeWidth={0.2} />
            <G fill="#ffffff" opacity={0.85}>
              <Circle cx="11.5" cy="12.9" r="0.5" />
              {c.detail ? (
                <>
                  <Circle cx="6.3" cy="14.1" r="0.32" />
                  <Circle cx="17.1" cy="14.1" r="0.32" />
                </>
              ) : null}
            </G>
          </>
        ),
        spec: { cx: 8.4, cy: 11, rx: 3.4, ry: 2.4 },
      };
    }

    // Emberfall Relic — the Forge Pass capstone. "A fragment of the first forge": an ancient
    // boulder, lit upper-left and falling into shadow underneath, with Hades' BIDENT imprinted on
    // its face as an asterism — two prongs on a shaft, cut into the stone and glowing from inside —
    // and embers still lifting off it. Not a bowl, not a wheel: a rock you could hold, if it let you.
    case 'relic-emberfall': {
      const body =
        'M6 7.2C7.1 4.6 11 3.6 14.1 4.4C18.1 5.2 20.7 8.1 20 12.1C19.5 16.1 15.9 19.7 11.9 20.1C7.5 20.5 4.5 17 4.2 13C4 10.6 4.8 8.6 6 7.2Z';
      const bident = 'M9.3 7.7L10 11.8L14 11.9L14.7 7.9M12 11.85V17.2';
      const hot = tint(c.to, 0.35);
      return {
        body,
        defs: (
          <>
            <RadialGradient id={c.id('rock')} cx="36%" cy="28%" r="82%">
              <Stop offset="0" stopColor="#a39a8b" />
              <Stop offset="0.5" stopColor="#5e564b" />
              <Stop offset="1" stopColor={mix('#241f18', c.from, 0.35)} />
            </RadialGradient>
            {glowDef(c.id('heat'), c.to, 0.6)}
          </>
        ),
        under: <Ellipse cx="12" cy="12.4" rx="10.6" ry="10.4" fill={c.url('heat')} opacity={0.6} />,
        paint: (
          <>
            <Path d={body} fill={c.url('rock')} stroke="#1f1a14" strokeWidth={0.45} />
            {/* the lit top plane, and the underside turned away from the light */}
            <Path d="M6 7.2C7.1 4.6 11 3.6 14.1 4.4C15.6 4.8 16.8 5.4 17.8 6.4C14.6 7.6 9.8 8.2 6 7.2Z" fill="#ffffff" opacity={0.08} />
            <Path
              d="M4.2 13C5.6 15.6 9 17.4 13.4 17C16.4 16.7 18.8 15.2 19.9 12.9C19.5 16.1 15.9 19.7 11.9 20.1C7.5 20.5 4.5 17 4.2 13Z"
              fill="#000000"
              opacity={0.3}
            />
            {c.detail ? (
              <>
                {/* weathering — pits with a lit lower lip, and old cracks */}
                <G fill="#000000" opacity={0.24}>
                  <Ellipse cx="16.8" cy="9" rx="0.9" ry="0.6" />
                  <Ellipse cx="7.4" cy="14.4" rx="1.1" ry="0.7" />
                  <Ellipse cx="16.2" cy="15.2" rx="0.8" ry="0.55" />
                </G>
                <G fill="#cfc5b4" opacity={0.25}>
                  <Ellipse cx="16.9" cy="9.5" rx="0.8" ry="0.22" />
                  <Ellipse cx="7.5" cy="15" rx="1" ry="0.25" />
                </G>
                <Path
                  d="M18.6 11.2l-1.4.9-.6 1.6M6.2 10.4l1.2.6M13.8 18.6l.8-1.2"
                  stroke="#15110b"
                  strokeWidth={0.3}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.6}
                />
              </>
            ) : null}
            <Path d="M6.6 7.2C8.2 5.1 11.2 4.3 14 4.7" stroke="#cfc5b4" strokeWidth={0.6} opacity={0.55} fill="none" />
          </>
        ),
        over: (
          <>
            {/* cut into the stone: a dark groove first, then the light inside it */}
            <Path d={bident} stroke="#120c06" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.55} />
            <Path d={bident} stroke={c.to} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.22} />
            <Path d={bident} stroke={hot} strokeWidth={0.55} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
            {c.detail ? (
              <G fill={c.to} opacity={0.35}>
                <Circle cx="9.3" cy="7.7" r="1.6" />
                <Circle cx="14.7" cy="7.9" r="1.6" />
                <Circle cx="12" cy="17.2" r="1.7" />
              </G>
            ) : null}
            <G fill="#FFF3D0">
              <Circle cx="9.3" cy="7.7" r="0.8" />
              <Circle cx="14.7" cy="7.9" r="0.8" />
              <Circle cx="10" cy="11.8" r="0.6" />
              <Circle cx="14" cy="11.9" r="0.6" />
              <Circle cx="12" cy="14.6" r="0.45" />
              <Circle cx="12" cy="17.2" r="0.9" />
            </G>
            {/* embers lifting off it */}
            <G fill={tint(c.to, 0.2)}>
              <Circle cx="7.4" cy="3.2" r="0.85" />
              <Circle cx="12" cy="2.2" r="0.7" />
              <Circle cx="16.4" cy="3.4" r="0.6" />
            </G>
          </>
        ),
        spec: { cx: 9.2, cy: 8.6, rx: 3.6, ry: 2.4, opacity: 0.22 },
      };
    }

    // Unreachable while `hasRelicArt` gates this — ItemArt keeps its fallback for anything not in
    // RELIC_ART_KEYS, so a key only lands here if the two come apart. A gem rather than a blank, so
    // that failure is invisible (punchlist 8 §1).
    default: {
      const body = 'M12 3.2L18.1 9 12 20.8 5.9 9z';
      return {
        body,
        paint: (
          <>
            <Path d={body} fill={c.from} />
            <Path d="M12 3.2L18.1 9 12 11.7 5.9 9z" fill={c.to} opacity={0.85} />
          </>
        ),
        spec: { cx: 10, cy: 8, rx: 2.4, ry: 1.6 },
      };
    }
  }
}
