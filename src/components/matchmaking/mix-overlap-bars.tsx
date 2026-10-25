import { StyleSheet, Text, View } from 'react-native';

import { MIX_BUCKETS } from '@/components/matchmaking/config';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { MatchMix } from '@/types/social';

type MixOverlapBarsProps = {
  theirs: MatchMix | null;
  mine: MatchMix | null;
  theirName: string;
};

const pct = (v: number | undefined) => Math.max(0, Math.min(100, Number.isFinite(v) ? (v as number) : 0));

// Mock 299 phone 2: their mix as the solid ember bar, yours as a dashed outline over the same
// track — the overlap IS the reason, so it is drawn rather than stated. A dashed box rather than a
// dashed left edge: iOS only draws dashes when all four borders match.
export function MixOverlapBars({ theirs, mine, theirName }: MixOverlapBarsProps) {
  if (!theirs && !mine) return null;
  return (
    <View style={styles.wrap}>
      {MIX_BUCKETS.map((b) => {
        const t = pct(theirs?.[b.key]);
        const m = pct(mine?.[b.key]);
        return (
          <View key={b.key} style={styles.row} accessibilityLabel={`${b.label}: ${theirName} ${Math.round(t)}%, you ${Math.round(m)}%`}>
            <Text style={styles.label}>{b.label}</Text>
            <View style={styles.track}>
              {theirs ? <View style={[styles.fill, { width: `${t}%` }]} /> : null}
              {mine && m > 0 ? <View style={[styles.mine, { width: `${m}%` }]} /> : null}
            </View>
          </View>
        );
      })}
      <Text style={styles.legend}>
        Solid = {theirName}&apos;s mix · dashed = yours
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: 7,
  },
  label: {
    width: 64,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  track: {
    flex: 1,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.cardDark,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 5,
    backgroundColor: Colors.coral,
  },
  mine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 5,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.coldChipText,
  },
  legend: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: Spacing.one,
  },
});
