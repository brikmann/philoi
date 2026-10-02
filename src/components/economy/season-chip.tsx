import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts, Radius } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import { mix } from '@/lib/economy/colour';
import { SEASON } from '@/lib/economy/forge-pass';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE EMBERFALL MARK (mock 247, Option 1 — "Season chip").
//
// One gradient pill, "EMBERFALL · S1", dropped next to the rarity tag on any season item. It never
// touches the item's art: the art keeps its own colours, and the gradient only ever says "this is
// Emberfall". The same chip sits by the rank strip on a profile (mock 248) to say which season the
// rank is being played in.
//
// ── HOW THE GRADIENT IS DRAWN ──
//
// No SVG and no measured layout. The pill's background is a row of flex:1 bands, each painted the
// ramp's value at its centre — the same banding gradient-title.tsx uses for text, applied to a
// box. An absolutely-positioned <Svg> sized by style alone measures ZERO on Android (the trap
// applied-art.tsx's card backdrop documents), and a chip sits on dense grids where a per-chip
// onLayout pass would be a real cost. Six bands across a ~70pt pill between two stops this close in
// hue read as one smooth ramp.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** THE Emberfall gradient (mock 247's `--ember`). Exported so a surface that needs the ramp for
 *  something other than the chip (a slot tab, an Equipped badge) uses the same two stops. */
export const EMBERFALL_FROM = '#E0612C';
export const EMBERFALL_TO = '#F5C542';

const BANDS = 6;

/** Whether `item` carries the season mark. Driven by the catalog's own flag, never a list here. */
export function isSeasonItem(item: Pick<CatalogItem, 'seasonStamped'> | null | undefined): boolean {
  return item?.seasonStamped === true;
}

/** The pill's own label — "EMBERFALL · S1" — from the season constant, so S2 retitles it. */
export const SEASON_CHIP_LABEL = `${SEASON.name} · ${SEASON.id}`.toUpperCase();

type ChipSize = 'xs' | 'sm' | 'md';

const SIZE: Record<ChipSize, { font: number; padH: number; padV: number; spacing: number }> = {
  // Inventory/loadout grid tiles — the tile is ~105pt wide, so this has to sit on one line under
  // a 7pt rarity label without wrapping.
  xs: { font: 6.5, padH: 5, padV: 1.5, spacing: 0.4 },
  // Cards and the rank strip — mock 247/248's 10px pill.
  sm: { font: 9, padH: 8, padV: 2.5, spacing: 0.5 },
  // The unlock reveal and item detail, where it sits under a 22pt name.
  md: { font: 10.5, padH: 10, padV: 3.5, spacing: 0.6 },
};

/**
 * The Emberfall season chip. Renders unconditionally — callers gate it, normally on
 * `isSeasonItem(item)`, so the "which items" rule lives in the catalog and not in every screen.
 */
export function SeasonChip({
  size = 'sm',
  label = SEASON_CHIP_LABEL,
  style,
}: {
  size?: ChipSize;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const s = SIZE[size];
  return (
    <View
      style={[styles.pill, { paddingHorizontal: s.padH, paddingVertical: s.padV }, style]}
      accessibilityLabel={`${SEASON.name} season ${SEASON.id.replace(/\D/g, '')} item`}>
      <EmberBands />
      <Text style={[styles.text, { fontSize: s.font, letterSpacing: s.spacing }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The Emberfall ramp as a fill, for any pill or tab that should read as "the season's colour" (the
 * loadout's active slot tab, an Equipped badge). Absolutely fills its parent — give the parent
 * `overflow: 'hidden'` and a radius.
 */
export function EmberBands() {
  return (
    <View style={styles.bands} pointerEvents="none">
      {Array.from({ length: BANDS }, (_, i) => (
        <View key={i} style={[styles.band, { backgroundColor: mix(EMBERFALL_FROM, EMBERFALL_TO, (i + 0.5) / BANDS) }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // No alignSelf: rows (a rarity line, the rank strip) size it to its text already, and centred
  // tiles centre it. A caller in a stretching column passes `style={{ alignSelf: 'flex-start' }}`.
  pill: {
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  bands: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  band: {
    flex: 1,
    // A hair of overlap so adjacent bands never leave a sub-pixel seam on a fractional width.
    marginRight: -0.5,
  },
  text: {
    fontFamily: Fonts.bodyBold,
    // Mock 247's ink on the ember ramp — near-black plum, not pure black, so it sits IN the pill.
    color: '#1a1020',
    textTransform: 'uppercase',
  },
});
