import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FIRST-RUN SPINE — design-mocks/239-tutorial-unified.html ("ONE SPINE").
//
// One progress indicator for the whole first run: setup-handle.tsx draws it as `SETUP n / 5` and
// tutorial.tsx as `TOUR n / 20`, in the same place, at the same weight. That is what lets the
// hand-off from the last setup step to the first tour card read as the second half of one journey
// rather than as a second tutorial loading — the background stays, the spine stays, only the word
// on it changes.
//
// `sub` is the amber suffix a multi-step card adds (`· COSMETICS 3 / 9`), so someone nine taps
// into the cosmetics run still knows where that run sits in the whole.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The height of the row the spine sits in on BOTH halves — the tour's row carries Skip beside it, so
 * setup's row reserves the same height and the spine does not hop when the label changes.
 */
export const SPINE_ROW_HEIGHT = 20;

export function FirstRunSpine({
  total,
  filled,
  label,
  sub,
}: {
  /** Segment count. */
  total: number;
  /** How many segments are lit, from the left. */
  filled: number;
  /** `SETUP 2 / 5`, `TOUR 11 / 20`. */
  label: string;
  /** Optional amber suffix — `COSMETICS 3 / 9`. */
  sub?: string;
}) {
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={sub ? `${label}, ${sub}` : label}>
      <View style={styles.segs}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.seg, i < filled && styles.segOn]} />
        ))}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
        {sub ? <Text style={styles.sub}>{` · ${sub}`}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  segs: { flex: 1, flexDirection: 'row', gap: 3 },
  seg: { flex: 1, height: 4, borderRadius: 3, backgroundColor: '#3a2c58', opacity: 0.5 },
  segOn: { backgroundColor: Colors.amber, opacity: 1 },
  label: { fontFamily: Fonts.bodyBold, fontSize: 10, letterSpacing: 0.5, color: Colors.textTertiary },
  sub: { color: Colors.amber },
});
