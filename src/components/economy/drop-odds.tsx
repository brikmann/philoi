import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBoxOdds } from '@/hooks/use-box-odds';
import { BOXES, oddsAreRealLine, pityLineFrom, type BoxKey } from '@/lib/economy/boxes';
import type { OddsRow } from '@/lib/economy/odds';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';

// The disclosure itself, in one place so every surface that has to show it shows the SAME thing:
// the box-detail screen renders <OddsTable> inline, and the inventory stack sheet and the open
// flow reach it through <DropOddsSheet>. Rows come from useBoxOdds, i.e. the live
// economy_config.box_odds the server rolls on — no screen holds its own copy.
//
// Kept deliberately plain. This is a legal disclosure (Play's paid-random-items rule, the
// Belgium/NL bans, a student/minor audience), so it reads as information rather than as a pitch:
// no gradients on the numbers, no "your luck", nothing that could be mistaken for a sales surface.

function titleCase(rarity: string): string {
  const label = RARITY_LABEL[rarity as keyof typeof RARITY_LABEL] ?? rarity.toUpperCase();
  return label.charAt(0) + label.slice(1).toLowerCase();
}

export function OddsTable({ rows }: { rows: OddsRow[] }) {
  return (
    <View style={styles.odds}>
      {rows.map(({ rarity, pct, label }) => (
        <View key={rarity} style={styles.oddRow} accessibilityRole="text" accessibilityLabel={`${titleCase(rarity)} ${label} percent`}>
          <View style={[styles.dot, { backgroundColor: RARITY_COLOR[rarity] }]} />
          <Text style={styles.oddName}>{titleCase(rarity)}</Text>
          <View style={styles.oddBar}>
            <View style={[styles.oddFill, { width: `${Math.max(pct, 0.8)}%`, backgroundColor: RARITY_COLOR[rarity] }]} />
          </View>
          <Text style={styles.oddPct}>{label}%</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The tappable affordance. Policy wants the odds one obvious tap away BEFORE embers are committed,
 * which is what this is for on the stack sheet and the open flow — screens that otherwise go
 * straight from a button to a spent box.
 */
export function DropOddsLink({ onPress, label = 'View drop rates' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable style={styles.link} onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name="stats-chart" size={13} color={Colors.muted} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

export function DropOddsSheet({ boxKey, onClose }: { boxKey: BoxKey | null; onClose: () => void }) {
  // Mounted unconditionally so the hook order never changes with `boxKey` — the fetch is a cached
  // module-level promise, so an invisible sheet costs nothing.
  const { rows, pity } = useBoxOdds(boxKey);
  const box = boxKey ? BOXES[boxKey] : null;

  return (
    <Modal visible={!!box} animationType="fade" transparent onRequestClose={onClose}>
      {box ? (
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{box.name} · drop rates</Text>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
              <OddsTable rows={rows} />
              <Text style={styles.note}>{oddsAreRealLine(box)}</Text>
              <View style={styles.guarantee}>
                <Ionicons name="shield-checkmark" size={13} color={Colors.amber} />
                <Text style={styles.guaranteeText}>{pityLineFrom(pity)}</Text>
              </View>
              <Text style={styles.note}>
                Cosmetics only — nothing in this box affects XP, rank, or your place on any leaderboard.
              </Text>
            </ScrollView>
            <Pressable style={styles.closeBtn} onPress={onClose} accessibilityRole="button">
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  odds: {
    alignSelf: 'stretch',
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
    padding: Spacing.twelve,
    gap: Spacing.two,
  },
  oddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  oddName: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ink,
    width: 74,
  },
  oddBar: {
    flex: 1,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
  },
  oddFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  oddPct: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ink,
    width: 52,
    textAlign: 'right',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  linkText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
    textDecorationLine: 'underline',
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,14,0.62)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    maxHeight: '80%',
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    textAlign: 'center',
  },
  sheetScroll: {
    marginTop: Spacing.three,
  },
  sheetBody: {
    gap: Spacing.twelve,
    paddingBottom: Spacing.two,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.muted,
  },
  guarantee: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
    padding: Spacing.twelve,
  },
  guaranteeText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.ink,
  },
  closeBtn: {
    marginTop: Spacing.three,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
  },
  closeBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
});
