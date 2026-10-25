import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { DISCIPLINE_LABELS } from '@/lib/api/identity';
import type { DisciplineBucket, DisciplineMixRow } from '@/types/social';

// Mock 283's discipline mix — what this person ACTUALLY locks in on, from their check-ins this
// season (get_discipline_mix). It's the honest, earned version of "interests": nobody types it in,
// so nobody can fake it, and it's the field grind-alike matching reads. The caption says so out
// loud because that is the whole point of the bar.
//
// Empty when there's nothing to draw — no lock-ins this season, the dial keeping this viewer out,
// or the RPC failing — and an empty mix renders nothing rather than a zero-width bar.

const BUCKET_COLOR: Record<DisciplineBucket, string> = {
  study: Colors.sky,
  gym: Colors.emberForward,
  run: Colors.green,
  // Mock 283's `--legend` violet — Deep Work has no token of its own.
  deep_work: '#B98BFF',
  other: Colors.trackAlt,
};

export function DisciplineMixBar({ mix, isOwn }: { mix: DisciplineMixRow[]; isOwn: boolean }) {
  if (mix.length === 0) return null;
  // Server pcts are rounded ints, so they can sum to 99 or 101; flex weights make the bar fill
  // exactly regardless.
  const rows = [...mix].sort((a, b) => b.pct - a.pct);

  return (
    <View>
      <Text style={styles.seclbl}>Discipline mix · this season</Text>
      <View style={styles.card}>
        <View style={styles.bar}>
          {rows.map((r) => (
            <View key={r.bucket} style={{ flex: r.pct, backgroundColor: BUCKET_COLOR[r.bucket] }} />
          ))}
        </View>
        <View style={styles.key}>
          {rows.map((r) => (
            <View key={r.bucket} style={styles.keyItem}>
              <View style={[styles.swatch, { backgroundColor: BUCKET_COLOR[r.bucket] }]} />
              <Text style={styles.keyText}>
                {DISCIPLINE_LABELS[r.bucket]} {r.pct}%
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.caption}>
          Computed from {isOwn ? 'your' : 'their'} lock-ins — can&apos;t be faked.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seclbl: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    padding: 13,
  },
  bar: {
    flexDirection: 'row',
    height: 11,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 2,
  },
  key: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 4,
    marginTop: 8,
  },
  keyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  keyText: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 9,
  },
});
