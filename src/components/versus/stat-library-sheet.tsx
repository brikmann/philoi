import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { MAX_COMPARE_STATS } from '@/components/versus/send-plan';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { MetricCatalogRow } from '@/types/house';

type StatLibrarySheetProps = {
  visible: boolean;
  catalog: MetricCatalogRow[];
  /** Keys already in the compare zone. */
  selected: ReadonlySet<string>;
  onToggle: (row: MetricCatalogRow) => void;
  onClose: () => void;
};

type Group = { key: string; label: string; rows: MetricCatalogRow[] };

// The full stat library (mock 293) — 26 stats in 7 groups, straight from metric_catalog so a new
// stat is a row on the server and never a client release.
//
// Tap-to-add rather than the mock's drag: drag-and-drop in React Native is a gesture library's
// worth of code for what is, on a phone, the same decision made with one tap. A chip already in
// the compare zone shows a tick and taps back out. The ⚔ badge marks what can also be a challenge;
// the rest are compare-only, because you can't challenge a number that isn't won in a window.
export function StatLibrarySheet({ visible, catalog, selected, onToggle, onClose }: StatLibrarySheetProps) {
  const insets = useSafeAreaInsets();
  const full = selected.size >= MAX_COMPARE_STATS;

  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const row of [...catalog].sort((a, b) => a.sort - b.sort)) {
      const last = out[out.length - 1];
      if (last && last.key === row.group_key) last.rows.push(row);
      else out.push({ key: row.group_key, label: row.group_label, rows: [row] });
    }
    return out;
  }, [catalog]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grab} />
          <View style={styles.header}>
            <Text style={styles.title}>Add stats to compare</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.subRow}>
            <View style={styles.subSword}>
              <Icon name="versus" size={13} color={Colors.danger} />
            </View>
            <Text style={styles.sub}>
              means it&apos;s also challengeable — an achievable, verifiable target you can throw down for. The rest
              are compare-only.
              {full ? ` That's ${MAX_COMPARE_STATS} — the most one head-to-head holds.` : ''}
            </Text>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {groups.map((group) => (
              <View key={group.key}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <View style={styles.chips}>
                  {group.rows.map((row) => {
                    const on = selected.has(row.key);
                    const disabled = !on && full;
                    return (
                      <Pressable
                        key={row.key}
                        onPress={() => onToggle(row)}
                        disabled={disabled}
                        style={[styles.chip, on && styles.chipOn, disabled && styles.chipDisabled]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled }}
                        accessibilityLabel={`${row.label}${row.challengeable ? ', challengeable' : ''}`}>
                        {on ? (
                          <UiGlyph name="check" size={12} color={Colors.navEmber2} />
                        ) : (
                          <Text style={styles.chipEmoji}>{row.emoji}</Text>
                        )}
                        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{row.label}</Text>
                        {row.challengeable ? <Icon name="versus" size={11} color={Colors.danger} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    maxHeight: '86%',
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.spaceLine,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spaceLine,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
  },
  done: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.navEmber2,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
  },
  sub: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.spaceDim,
  },
  subSword: {
    marginTop: 1.5,
  },
  list: {
    marginTop: Spacing.two,
  },
  listContent: {
    paddingBottom: Spacing.three,
  },
  groupLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: 14,
    marginBottom: 7,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipOn: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipEmoji: {
    fontSize: 12,
  },
  chipLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  chipLabelOn: {
    color: Colors.navEmber2,
  },
});
