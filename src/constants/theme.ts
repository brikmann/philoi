import { Platform } from 'react-native';

// Source of truth: PHILOI_UI_SPEC.md §1-2 (twilight-purple palette + Inter type). Ship as
// the ONLY theme for now (no live light/dark toggle) — every consumer just reads these same
// token names, so repointing the values here is what cascades the retheme app-wide with
// zero per-file edits.
export const Colors = {
  // Twilight base — see spec §1's twilight-900/800/700/600 scale.
  twilight900: '#14111C', // deepest — nav bar, phone frame, behind everything
  cream: '#1B1726', // twilight-800 — app background, every screen
  forgeBg: '#17131F', // immersive rank-up backdrop — the dark twilight the forge settles into (design-mocks/32's radial floor), darker than cream, never the flat plum
  card: '#241C38', // twilight-700 — elevated surface: cards, sheets, fields, discover rows
  disabled: '#2D2740', // twilight-600 — controls, avatar bg, progress-track bg
  plum: '#3A2E5C', // plum-500 — brand plum accent surface, logo backplate

  // Firelight accent
  coral: '#E0612C',
  amber: '#F2A33C',
  ember: '#FFD27A',
  logBrown: '#8A5A2B',
  logBrownDark: '#6E4423',

  // Text & lines
  ink: '#FFF6EC', // text-primary
  muted: '#A99CBD', // text-secondary
  textTertiary: '#7C7194', // hints, disabled text
  line: 'rgba(255,255,255,0.08)', // hairline borders
  lineStrong: 'rgba(255,255,255,0.12)', // field borders

  // Semantic
  green: '#3DA85C', // success — streak alive
  sky: '#4FB0E5', // info

  // State chips (roaring/warm vs. going-cold) — §6/§7
  achieverBg: '#3A2A22', // warm chip bg
  achieverText: '#FFD27A', // warm chip text (= ember)
  coldChipBg: '#3A3350',
  coldChipText: '#C9BDE6',
  soloChipText: '#CBBFE0', // muted lavender used for "solo"/off-state labels on dark surfaces
  coldButtonText: '#E7DDF5', // CTA button "cold variant" text — §7, pairs with coldChipBg
  selectedBg: '#2B2036', // design-mocks' selected-state purple surface (tile/pill/row selected, invite card bg)
  cardDark: '#20182F', // darker stat-card surface, between disabled and twilight-900
  trackAlt: '#4A4460', // secondary/muted progress-track fill and divider dots
  warmSubtext: '#E7C9B8', // muted peachy subtext on a lit/achiever-bg surface (selected pill sub, live lock-in card detail line)
  danger: '#E86A5A', // destructive action text/icon (leave/delete campfire) — design-mocks/19
  dangerBg: '#3A1F24', // destructive row's icon-tile background, pairs with danger

  // ── "Ember" design language (DESIGN_LANGUAGE_EMBER.md) ──
  // The deep-purple radial that is now THE background on every screen (§2). Consumed by
  // <ScreenBackground>. Deliberately NOT a flat colour — the washed-out lighter variants it
  // replaces are what made the daily-fire screen look grey.
  //
  // THREE stops, not two (punchlist 20.1): with only from -> to, the purple was spent inside the
  // top ~15% of a tall phone and the rest of the screen sat on #161320, which reads as black in
  // the body. bgRadialMid carries the purple down through the middle of the screen so the ramp
  // lands as depth rather than as a lit strip above a black page.
  bgRadialFrom: '#2C1B36',
  bgRadialMid: '#231830',
  bgRadialTo: '#161320',
  // The near-black used for text ON an ember-gradient fill (§3). Orange-black rather than pure
  // black so it reads as burnt into the button rather than pasted on top.
  onEmber: '#3A1608',
  // The forward/urgent accent (§7): today's fire zone on the home XP bar, and the `~time`
  // projection on the lock-in rank bar. Always this, never the tier colour — tier colour says
  // where you ARE, orange says what you're chasing.
  emberForward: '#FF7A2F',
} as const;

/**
 * The ember gradient (§2/§3) — `#E0612C → #F2A33C → #FFD27A`. Exported as an ordered array because
 * every consumer is an SVG <LinearGradient> needing per-stop colours, and duplicating the three hex
 * values at each call site is exactly the copy-paste this token set exists to stop.
 *
 * 135° for fills (buttons, bars), vertical for the flame glyph.
 */
export const EMBER_GRADIENT = ['#E0612C', '#F2A33C', '#FFD27A'] as const;

export type ThemeColor = keyof typeof Colors;

// Inter only (replaces Fredoka + Nunito) — three weights per spec §2: 400 regular, 500
// medium (default for labels/headings), 600 for big numbers (rank, XP, session time). No
// rounded display face. Existing call sites keep their key names (display/body/etc.) so the
// font swap needed zero per-file edits — only the values below changed.
export const Fonts = Platform.select({
  default: {
    display: 'Inter_500Medium',
    displayMedium: 'Inter_500Medium',
    displayHeavy: 'Inter_600SemiBold', // big numerals — lock-in timer, XP totals, rank
    body: 'Inter_400Regular',
    bodySemiBold: 'Inter_500Medium',
    bodyBold: 'Inter_600SemiBold',
    bodyExtraBold: 'Inter_600SemiBold',
  },
})!;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  twelve: 12, // exact 12px step from PHILOI_UI_SPEC.md §1's 4/8/12/16/24/32 scale
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  input: 14,
  button: 14,
  card: 12,
  pill: 999,
} as const;

export const Shadow = {
  primaryButton: {
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 6,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
