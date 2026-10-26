#!/usr/bin/env node
// Builds assets/lottie/hoplite-spear-plant.json — the done screen's spear-plant (mock 311).
//
//   node scripts/gen-hoplite-lottie.js
//
// The art is mock 311's hoplite redrawn as Lottie shape layers, so the asset is real vector
// animation rather than the mock's SVG. It is a STAND-IN for the #242 art program: a hand-drawn
// Lottie (or a Rive port) can replace the JSON outright as long as it keeps the contract
// spear-plant-reveal.tsx depends on —
//
//   • 60fps, frames 0–96 (1.6s), spear lands on frame 48, impact on frame 49 (0.82s);
//   • every impact element (rings, sparks, flash) lives in ONE layer named "Burst", which the
//     screen tints with the equipped flare through `colorFilters` — so nothing else may be in it;
//   • the last frame is the settled pose (planted spear, burst gone) — skip and reduce-motion
//     park on it.
//
// Timing is mock 311's CSS, beat for beat: enter .5s ease-out, plant .32s from .55s with
// -46° → 3° (80%) → 0°, flash ring + sparks .5–.55s from .82s.

const fs = require('fs');
const path = require('path');

const FR = 60;
const OP = 96;
// Mock 311 draws in a 260×300 box with most of it empty sky; the comp is cropped to the figure +
// burst so the screen can size the stage by the art instead of by the mock's phone.
const OX = -40;
const OY = -110;
const W = 180;
const H = 180;

const COLOR = {
  ember: '#ff7a2f',
  ember2: '#ffb05a',
  gold: '#ffd166',
  ground: '#3a2d55',
  shield: '#241a3a',
  body: '#2a1f45',
  shaft: '#c9a86a',
  flash: '#fff3d6',
};

const f = (sec) => Math.round(sec * FR);
const rgba = (hex) => [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).concat(1);

// ── animated-property helpers ────────────────────────────────────────────────────────────────
const still = (k) => ({ a: 0, k });
// keys: [frame, value, easeOut?] — easeOut is [x1, y1, x2, y2] for the segment LEAVING the key.
// 1-D props (opacity, rotation) carry one-element easing arrays, scale one per axis, position scalars —
// the bodymovin shapes every Lottie runtime parses.
function anim(keys, dims) {
  return {
    a: 1,
    k: keys.map(([t, s, e], idx) => {
      const kf = { t, s: Array.isArray(s) ? s : [s] };
      if (idx < keys.length - 1) {
        const [x1, y1, x2, y2] = e ?? [0.33, 0, 0.67, 1];
        const v = (n) => (dims === 'scalar' ? n : Array(dims).fill(n));
        kf.o = { x: v(x1), y: v(y1) };
        kf.i = { x: v(x2), y: v(y2) };
      }
      return kf;
    }),
  };
}
const EASE_OUT = [0, 0, 0.58, 1];
const POP_OUT = [0.1, 0.6, 0.3, 1];
// Mock 311's plant curve, cubic-bezier(.6,0,.2,1.3), front-loads the swing: rendered, the tip is
// down by ~0.7s and the 0.82s strike lands on a spear already at rest. A drive accelerates INTO
// the ground, so the down-stroke eases in (fastest on the strike frame) and the 3° → 0° recoil
// eases out.
const PLANT = [0.6, 0, 0.9, 0.55];
const RECOIL = [0.2, 0.8, 0.4, 1];

// ── shapes ───────────────────────────────────────────────────────────────────────────────────
// Just enough SVG path to read mock 311's markup: M L H V Q Z, absolute and relative.
function parsePath(d) {
  const tokens = d.match(/[MLHVQZmlhvqz]|-?\d*\.?\d+/g);
  const subpaths = [];
  let cur = null;
  let cmd = null;
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const push = (px, py, inT = [0, 0]) => {
    cur.v.push([px, py]);
    cur.i.push(inT);
    cur.o.push([0, 0]);
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      cur.c = true;
      continue;
    }
    if (C === 'M') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      cur = { v: [], i: [], o: [], c: false };
      subpaths.push(cur);
      push(x, y);
      cmd = rel ? 'l' : 'L'; // implicit lineto after a moveto's first pair
    } else if (C === 'L') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      push(x, y);
    } else if (C === 'H') {
      x = (rel ? x : 0) + num();
      push(x, y);
    } else if (C === 'V') {
      y = (rel ? y : 0) + num();
      push(x, y);
    } else if (C === 'Q') {
      const cx = (rel ? x : 0) + num();
      const cy = (rel ? y : 0) + num();
      const ex = (rel ? x : 0) + num();
      const ey = (rel ? y : 0) + num();
      // Quadratic → cubic: both handles sit 2/3 of the way to the quad's control point.
      cur.o[cur.o.length - 1] = [((cx - x) * 2) / 3, ((cy - y) * 2) / 3];
      push(ex, ey, [((cx - ex) * 2) / 3, ((cy - ey) * 2) / 3]);
      x = ex;
      y = ey;
    } else {
      throw new Error(`unsupported path command ${cmd}`);
    }
  }
  return subpaths.map((sp) => ({ ty: 'sh', d: 1, ks: still(sp) }));
}
const ellipse = (cx, cy, r) => ({ ty: 'el', d: 1, p: still([cx, cy]), s: still([r * 2, r * 2]) });
const fill = (hex) => ({ ty: 'fl', c: still(rgba(hex)), o: still(100), r: 1 });
const stroke = (hex, w) => ({ ty: 'st', c: still(rgba(hex)), o: still(100), w: still(w), lc: 2, lj: 2, ml: 4 });
const tr = (over = {}) => ({
  ty: 'tr',
  p: still([0, 0]),
  a: still([0, 0]),
  s: still([100, 100]),
  r: still(0),
  o: still(100),
  sk: still(0),
  sa: still(0),
  ...over,
});
// Lottie paints a group's items bottom-up, so the stroke goes BEFORE the fill to sit on top of it.
function group(nm, shapes, { fill: fl, stroke: st, transform } = {}) {
  const it = [...shapes];
  if (st) it.push(stroke(...st));
  if (fl) it.push(fill(fl));
  it.push(tr(transform));
  return { ty: 'gr', nm, it };
}

let nextInd = 1;
function layer(nm, shapes, { ip = 0, op = OP, parent, ks = {} } = {}) {
  return {
    ddd: 0,
    ind: nextInd++,
    ty: 4,
    nm,
    sr: 1,
    ao: 0,
    ip,
    op,
    st: 0,
    bm: 0,
    ...(parent ? { parent } : {}),
    ks: {
      o: still(100),
      r: still(0),
      p: still([parent ? 0 : OX, parent ? 0 : OY, 0]),
      a: still([0, 0, 0]),
      s: still([100, 100]),
      ...ks,
    },
    shapes,
  };
}

// ── the figure ───────────────────────────────────────────────────────────────────────────────
const ENTER_END = f(0.5);
const PLANT_START = f(0.55); // 33
const PLANT_HIT = 48; // the 80% key — the tip touches the ground
const PLANT_END = 52;
const IMPACT = f(0.82); // 49

// The hero rises 20px while fading in, then takes a 2.5px recoil from its own strike.
const heroOpacity = anim([[0, 0, EASE_OUT], [ENTER_END, 100]], 1);
const hero = layer(
  'Hoplite',
  [
    // Spear arm sits on top of the cuirass, under the spear (its own layer, above this one).
    group('Arm', parsePath('M127 182 L152 186'), { stroke: [COLOR.ember2, 6] }),
    group('Plume line', parsePath('M118 142 Q126 134 136 136'), { stroke: [COLOR.ember2, 2] }),
    group('Crest plume', parsePath('M116 141 Q124 128 140 132 Q130 136 128 146'), {
      stroke: [COLOR.gold, 1.5],
      fill: COLOR.ember,
    }),
    group('Corinthian helmet', parsePath('M106 158 Q106 143 116 143 Q126 143 126 158 L126 162 L122 162 L122 170 L120 170 L120 160'), {
      stroke: [COLOR.gold, 2.5],
      fill: COLOR.shield,
    }),
    group('Head', [ellipse(116, 158, 10)], { stroke: [COLOR.ember2, 3], fill: COLOR.body }),
    group('Cuirass', parsePath('M103 174 Q117 168 129 174 L127 214 Q115 220 105 214 Z'), {
      stroke: [COLOR.ember2, 3],
      fill: COLOR.body,
    }),
    group('Legs', parsePath('M112 250 L108 212 M126 250 L122 210'), { stroke: [COLOR.ember2, 7] }),
    group('Shield boss', [ellipse(92, 196, 8)], { stroke: [COLOR.gold, 2.5] }),
    group('Hoplon', [ellipse(92, 196, 26)], { stroke: [COLOR.ember2, 3.5], fill: COLOR.shield }),
  ],
  {
    ks: {
      o: heroOpacity,
      p: anim(
        [
          [0, [OX, OY + 20, 0], EASE_OUT],
          [ENTER_END, [OX, OY, 0]],
          [IMPACT, [OX, OY, 0], POP_OUT],
          [IMPACT + 3, [OX, OY + 2.5, 0]],
          [IMPACT + 10, [OX, OY, 0]],
        ],
        'scalar'
      ),
    },
  }
);

// Parented to the hero so it rides the entrance and the recoil; opacity is NOT inherited through
// a Lottie parent, so it repeats the hero's fade. Pivots on the hand (158,185), as in the mock —
// and, unlike the mock, the shaft also slides 18px down through the grip on the same curve: the
// mock's rotation alone reads as a sweep, the slide is what makes it a drive into the ground.
const spear = layer(
  'Spear',
  [
    group('Butt cap', [ellipse(166, 150, 3)], { fill: COLOR.shaft }),
    group('Spearhead', parsePath('M150 252 l-5 -12 l10 0 Z'), { fill: COLOR.gold }),
    group('Shaft', parsePath('M166 150 L150 252'), { stroke: [COLOR.shaft, 4] }),
  ],
  {
    parent: hero.ind,
    ks: {
      o: heroOpacity,
      a: still([158, 185, 0]),
      p: anim([[PLANT_START, [158, 167, 0], PLANT], [PLANT_HIT, [158, 186, 0], RECOIL], [PLANT_END, [158, 185, 0]]], 'scalar'),
      r: anim([[PLANT_START, -46, PLANT], [PLANT_HIT, 3, RECOIL], [PLANT_END, 0]], 1),
    },
  }
);

// A soft contact shadow, so the figure stands ON the ground rather than in front of it.
const shadow = layer('Shadow', [group('Shadow', [{ ty: 'el', d: 1, p: still([122, 252]), s: still([92, 10]) }], { fill: '#07040f' })], {
  ks: { o: anim([[0, 0, EASE_OUT], [ENTER_END, 55]], 1) },
});

const ground = layer('Ground', [group('Ground line', parsePath('M20 252 H240'), { stroke: [COLOR.ground, 3] })]);

// ── the burst (tinted to the equipped flare by the screen) ───────────────────────────────────
const BX = 150;
const BY = 250;
const ring = (nm, r, w, start, len, fromScale, fromOpacity) =>
  group(nm, [ellipse(BX, BY, r)], {
    stroke: [COLOR.gold, w],
    transform: {
      a: still([BX, BY]),
      p: still([BX, BY]),
      s: anim([[start, [fromScale, fromScale], POP_OUT], [start + len, [100, 100]]], 2),
      o: anim([[start, fromOpacity, EASE_OUT], [start + len, 0]], 1),
    },
  });
// Mock 311's five sparks plus four more so the burst reads as a burst at phone size; every one
// is a deterministic offset, never random, so the asset is byte-stable across rebuilds.
const SPARKS = [
  [-28, -30, 3.5, COLOR.ember2],
  [26, -32, 3, COLOR.gold],
  [-40, -10, 3, COLOR.ember],
  [40, -14, 3.5, COLOR.ember2],
  [-12, -40, 2.5, COLOR.gold],
  [14, -44, 2.5, COLOR.ember2],
  [-34, -22, 2, COLOR.gold],
  [32, -6, 2.5, COLOR.ember],
  [4, -30, 2, COLOR.gold],
];
const SPARK_LEN = f(0.55);
const sparks = SPARKS.map(([dx, dy, r, c], n) =>
  group(`Spark ${n + 1}`, [ellipse(BX, BY, r)], {
    fill: c,
    transform: {
      a: still([BX, BY]),
      p: anim([[IMPACT, [BX, BY], POP_OUT], [IMPACT + SPARK_LEN, [BX + dx, BY + dy]]], 'scalar'),
      s: anim([[IMPACT, [100, 100], EASE_OUT], [IMPACT + SPARK_LEN, [45, 45]]], 2),
      o: anim([[IMPACT, 100, [0.5, 0, 0.8, 1]], [IMPACT + SPARK_LEN, 0]], 1),
    },
  })
);
const flash = group('Flash', [ellipse(BX, BY - 4, 11)], {
  fill: COLOR.flash,
  transform: {
    a: still([BX, BY - 4]),
    p: still([BX, BY - 4]),
    s: anim([[IMPACT, [50, 50], POP_OUT], [IMPACT + 6, [130, 130]]], 2),
    o: anim([[IMPACT, 85, EASE_OUT], [IMPACT + 6, 0]], 1),
  },
});
const burst = layer(
  'Burst',
  [flash, ...sparks, ring('Flash ring', 26, 3, IMPACT, f(0.5), 30, 90), ring('Outer ring', 40, 2, IMPACT + 3, f(0.55), 25, 55)],
  { ip: IMPACT }
);

const comp = {
  v: '5.7.4',
  fr: FR,
  ip: 0,
  op: OP,
  w: W,
  h: H,
  nm: 'hoplite-spear-plant',
  ddd: 0,
  assets: [],
  // Top of the stack first.
  layers: [burst, spear, hero, shadow, ground],
  markers: [{ tm: IMPACT, cm: 'impact', dr: 0 }],
};

const out = path.join(__dirname, '..', 'assets', 'lottie', 'hoplite-spear-plant.json');
fs.writeFileSync(out, JSON.stringify(comp));
console.log(`wrote ${path.relative(process.cwd(), out)} (${fs.statSync(out).size} bytes)`);
