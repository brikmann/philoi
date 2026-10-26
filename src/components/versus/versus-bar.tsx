import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { TIER_COLOR } from '@/lib/challenge-tier';
import { formatMetricValue, splitShare } from '@/lib/stats/format';
import type { VersusRow } from '@/types/house';

/** The opponent's side of every versus bar — the same violet the epic tier wears, so "them" is
 *  one colour app-wide rather than a fresh literal per screen. */
export const VERSUS_THEM_COLOR = TIER_COLOR.epic;
/** Their numbers and name, as text — the same violet lifted enough to read on a twilight card. */
export const VERSUS_THEM_TEXT = '#C9A6F0';

type VersusBarProps = {
  row: VersusRow;
  /** ⚔ — this stat is part of the challenge being sent. */
  flagged?: boolean;
};

// One stat, head to head (mock 292's `.vrow`): your raw value left, theirs right, the label between,
// and a split bar under it.
//
// THE RAW VALUES ARE THE TRUTH; the bar is only the shape of it. The fill is a / (a + b), which
// reads honestly for "who's ahead and by how much" but says nothing about scale — 61% of a 23-day
// streak race and 61% of a 1-day one look identical. So the formatted numbers sit above the bar,
// never inside it, and the percentages are a caption.
export function VersusBar({ row, flagged = false }: VersusBarProps) {
  const share = splitShare(row.a_value, row.b_value);
  const aPct = Math.round(share * 100);
  const bPct = 100 - aPct;
  // An empty side still gets a sliver, so a 100/0 bar reads as a bar with a loser, not a solid block.
  const aFlex = Math.max(share, 0.04);
  const bFlex = Math.max(1 - share, 0.04);
  const bothZero = row.a_value === 0 && row.b_value === 0;

  return (
    <View style={styles.row} accessibilityLabel={`${row.label}: you ${formatMetricValue(row.unit, row.a_value)}, them ${formatMetricValue(row.unit, row.b_value)}`}>
      <View style={styles.labels}>
        <Text style={[styles.value, row.leader === 'a' && styles.valueLead]}>{formatMetricValue(row.unit, row.a_value)}</Text>
        <Text style={styles.metric} numberOfLines={1}>
          {flagged ? <Text style={styles.sword}>⚔ </Text> : null}
          {row.emoji} {row.label.toUpperCase()}
        </Text>
        <Text style={[styles.value, styles.valueRight, row.leader === 'b' && styles.valueLeadThem]}>
          {formatMetricValue(row.unit, row.b_value)}
        </Text>
      </View>
      <View style={[styles.bar, flagged && styles.barFlagged]}>
        {bothZero ? (
          <View style={styles.empty} />
        ) : (
          <>
            <View style={[styles.left, { flex: aFlex }]}>
              {aPct >= 18 ? <Text style={styles.pct}>{aPct}%</Text> : null}
            </View>
            <View style={[styles.right, { flex: bFlex }]}>
              {bPct >= 18 ? <Text style={styles.pct}>{bPct}%</Text> : null}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: 12,
  },
  labels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 4,
  },
  value: {
    minWidth: 54,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  valueRight: {
    textAlign: 'right',
  },
  valueLead: {
    color: Colors.navEmber2,
  },
  valueLeadThem: {
    color: VERSUS_THEM_TEXT,
  },
  metric: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    letterSpacing: 0.3,
    color: Colors.spaceDim,
  },
  sword: {
    color: Colors.danger,
  },
  bar: {
    flexDirection: 'row',
    height: 16,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel2,
  },
  barFlagged: {
    borderWidth: 1,
    borderColor: 'rgba(232,106,90,0.45)',
  },
  left: {
    backgroundColor: Colors.navEmber,
    justifyContent: 'center',
    paddingLeft: 6,
  },
  right: {
    backgroundColor: VERSUS_THEM_COLOR,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 6,
  },
  empty: {
    flex: 1,
  },
  pct: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.twilight900,
  },
});
