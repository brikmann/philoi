# Punchlist 10 — the ember graphic (never landed)

PUNCHLIST_7 #3 didn't ship. There's **no ember component in the source** (no `EmberIcon`/`EmberGraphic`
anywhere) and **45 literal `🔥` emojis remain** — including inside `EmberPill` and `EmberAmount`, which
are the currency primitives everything else routes through. So the coal/ember token from
`design-mocks/86-ember-graphic.html` was designed but never built. Below is the component ready to drop
in, plus exactly which `🔥` to replace and which to leave.

---

## 1 · Build the component (react-native-svg, from mock 86)
Create `src/components/economy/ember-icon.tsx`. This is a direct translation of the mock-86 symbol.

```tsx
import { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

/** The ember/coal currency token (mock 86). Charred rim, glowing hollow core. Scales cleanly. */
export function EmberIcon({ size = 16 }: { size?: number }) {
  // Gradient ids MUST be unique per mount — react-native-svg leaks duplicate <Defs> ids across
  // instances on Android, which makes every ember after the first render blank/black. useId fixes it.
  const uid = useId();
  const core = `emberCore-${uid}`;
  const coal = `emberCoal-${uid}`;
  const h = Math.round(size * (60 / 48));
  return (
    <Svg width={size} height={h} viewBox="0 0 48 60">
      <Defs>
        <RadialGradient id={core} cx="50%" cy="60%" r="62%">
          <Stop offset="0" stopColor="#FFF3D6" />
          <Stop offset="0.34" stopColor="#FFD27A" />
          <Stop offset="0.68" stopColor="#F2A33C" />
          <Stop offset="1" stopColor="#E0612C" />
        </RadialGradient>
        {/* Outer body is ORANGE, not charcoal — warm tip at top, deep ember at the base. */}
        <LinearGradient id={coal} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF8C3A" />
          <Stop offset="0.5" stopColor="#E0612C" />
          <Stop offset="1" stopColor="#8A3410" />
        </LinearGradient>
      </Defs>
      {/* Flame silhouette: sharp tip, tapered body, tongue-lick on the left. */}
      <Path d="M24 3 C26 15 37 23 37 39 C37 49 31 56 24 56 C17 56 11 49 11 39 C11 30 17 26 20 32 C19 21 22 12 24 3 Z" fill={`url(#${coal})`} />
      <Path d="M24 13 C25.5 22 31 28 31 39 C31 47 28 51 24 51 C20 51 17 47 17 39 C17 32 20 30 22 34 C21 26 23 20 24 13 Z" fill={`url(#${core})`} />
      <Path d="M24 23 C25 29 27.5 33 27.5 40 C27.5 45 26 48 24 48 C22 48 20.5 45 20.5 40 C20.5 35 22 34 23 36 C22.5 31 23.5 27 24 23 Z" fill="#FFF1CE" opacity={0.85} />
    </Svg>
  );
}
```

(The `useId` unique-gradient-id note is the #1 reason a hand-built version would render as black/blank
blobs on Android — do not skip it.)

## 2 · Route the currency primitives through it
Fix these two in `src/components/economy/economy-bits.tsx` and most sites come along for free:
- `EmberPill` — replace `<Text style={styles.pillFlame}>🔥</Text>` with `<EmberIcon size={14} />`.
- `EmberAmount` — replace the leading `🔥 ` with `<EmberIcon size={13} />` in a row: return a
  `<View style={{flexDirection:'row',alignItems:'center',gap:4}}>` wrapping the icon + amount text.

## 3 · Swap the remaining CURRENCY sites; LEAVE streak/decorative flames
Replace `🔥` with `<EmberIcon />` (or better, use `<EmberAmount>`) ONLY where 🔥 means **embers**:
- `shop/index.tsx:208` (pack amount)
- `shop/box/[boxKey].tsx:151` (total price on the buy button)
- `shop/item/[itemId].tsx:115, 119, 123` (buy price, balance, salvage)
- `shop/open.tsx:219, 292` (dupe salvage payouts)
- `inventory/[itemId].tsx:161` (Sell button)
- `forge-pass.tsx:240` (`{ icon:'🔥', label: reward.amount }` — this is an ember reward on the track)

**Leave as the emoji — these are NOT currency:**
- Streaks: `leaderboards.tsx:53`, `friend-profile.tsx:238`, `group/[groupId]/leaderboard.tsx:49`,
  `lock-in/[checkInId].tsx:118, 130`, `people.tsx` nudge.
- Decorative / metric / goal: `forge-pass.tsx:76` (title), `challenge/create.tsx:352, 561` (Strain),
  `group/create.tsx` + `group/[groupId]/edit.tsx` (custom-goal emoji), `campfire-flame.tsx`.

**Plain-text contexts stay emoji too** — you can't render SVG inside an `Alert.alert` string or a
`Share.share` message, so leave the 🔥 in `box/[boxKey].tsx:39`, the `inventory/[itemId].tsx` sell
alerts (67/84/86/87), and `group/[groupId]/invite.tsx:52`. (Optionally swap those to the word
"embers.")

---

## Ship
All JS → OTA. Net effect: every ember *amount* in a rendered view shows the coal token; streaks,
campfires, and alert text keep the flame emoji. Verify on an Android build specifically — that's where
the gradient-id bug would show.
