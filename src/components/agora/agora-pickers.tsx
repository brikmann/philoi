import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  ACHIEVEMENT_FILTERS,
  ACHIEVEMENT_SECTIONS,
  attachmentView,
} from '@/lib/agora-attachment';
import { fetchAgoraAchievements, fetchAgoraLockIns } from '@/lib/api/agora';
import { formatDistanceKm, formatSessionDuration, formatRelativeTime } from '@/lib/format';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import type { AgoraAchievement, AgoraLockIn, GoalType } from '@/types/database';

// Mock 162 panels 4 and 5 — the two "pull from what's already yours" sheets the composer attaches
// from. Both render their rows through `attachmentView`, the same function that draws the posted
// card, so what you pick in the sheet is literally what everyone else will see.

/** The shell both sheets share, so the square has one bottom-sheet language and not three. */
function PickerSheet({
  visible,
  title,
  hint,
  height,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  hint?: string;
  height: `${number}%`;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.wrap}>
        <View style={[styles.sheet, { height }]}>
          <View style={styles.grabber} />
          <View style={styles.headRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={19} color={Colors.textTertiary} />
            </Pressable>
          </View>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

// ───────────────────────────── achievements ─────────────────────────────

export type AchievementChoice = {
  kind: AgoraAchievement['kind'];
  refId: string | null;
  key: string | null;
  /** Purely for the composer's "attached" chip — the post's own copy is frozen server-side. */
  label: string;
};

export function AgoraAchievementPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (choice: AchievementChoice) => void;
}) {
  const [rows, setRows] = useState<AgoraAchievement[] | null>(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!visible) return;
    let live = true;
    fetchAgoraAchievements()
      .then((r) => {
        if (live) setRows(r);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [visible]);

  // Grouped into the mock's four sections rather than shown as one flat list: "everything you've
  // ever earned" is a long scroll, and the headers are what make it navigable without search.
  const sections = useMemo(() => {
    const all = rows ?? [];
    return ACHIEVEMENT_SECTIONS.map((s) => ({
      ...s,
      items: all.filter((r) => r.section === s.key && (filter === 'all' || filter === s.key)),
    })).filter((s) => s.items.length > 0);
  }, [rows, filter]);

  return (
    <PickerSheet
      visible={visible}
      title="Share an achievement"
      hint="Anything you've earned or posted"
      height="86%"
      onClose={onClose}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}>
        {ACHIEVEMENT_FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.chip, filter === f.key && styles.chipOn]}
            accessibilityRole="button">
            <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {rows === null ? (
        <ActivityIndicator color={Colors.coral} style={styles.loader} />
      ) : sections.length === 0 ? (
        <Text style={styles.empty}>
          Nothing here yet. Lock in, rank up, or post a milestone — then come back and show it off.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {sections.map((section) => (
            <View key={section.key}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {section.items.map((row) => {
                const view = attachmentView(row.kind, row.facts);
                if (!view) return null;
                return (
                  <Pressable
                    key={`${row.kind}:${row.ref_id ?? row.item_key ?? section.key}`}
                    style={styles.row}
                    accessibilityRole="button"
                    onPress={() =>
                      onPick({
                        kind: row.kind,
                        refId: row.ref_id,
                        key: row.item_key,
                        label: view.title,
                      })
                    }>
                    <View style={[styles.rowIcon, { backgroundColor: view.tint }]}>
                      <Ionicons name={view.icon} size={19} color={Colors.ink} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {view.title}
                      </Text>
                      {view.subtitle ? (
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {view.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </PickerSheet>
  );
}

// ───────────────────────────── lock-ins ─────────────────────────────

export function AgoraLockInPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (choice: AchievementChoice) => void;
}) {
  const [rows, setRows] = useState<AgoraLockIn[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    fetchAgoraLockIns()
      .then((r) => {
        if (live) setRows(r);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [visible]);

  return (
    <PickerSheet
      visible={visible}
      title="Share a lock-in"
      hint="A session you've finished"
      height="76%"
      onClose={onClose}>
      {rows === null ? (
        <ActivityIndicator color={Colors.coral} style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No finished sessions yet. Lock in once and it shows up here.</Text>
          }
          renderItem={({ item }) => {
            const goal = (item.goal_type ?? 'custom') as GoalType;
            const meta = GOAL_TYPE_META[goal] ?? GOAL_TYPE_META.custom;
            const bits = [
              item.duration_seconds ? formatSessionDuration(item.duration_seconds) : null,
              item.distance_m ? formatDistanceKm(item.distance_m) : null,
              formatRelativeTime(item.completed_at),
            ].filter(Boolean);
            return (
              <Pressable
                style={styles.row}
                accessibilityRole="button"
                onPress={() =>
                  onPick({
                    kind: 'lockin',
                    refId: item.id,
                    key: null,
                    label: item.goal_label?.trim() || meta.label,
                  })
                }>
                <View style={[styles.rowIcon, styles.rowIconMuted]}>
                  <Ionicons name={GOAL_TYPE_ICON[goal] ?? 'lock-closed-outline'} size={19} color={Colors.amber} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.goal_label?.trim() || meta.label}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {bits.join(' · ')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </Pressable>
            );
          }}
        />
      )}
    </PickerSheet>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6,5,10,0.6)',
  },
  wrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: Colors.lineStrong,
    paddingBottom: Spacing.four,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: Spacing.two,
    marginBottom: 10,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    paddingHorizontal: Spacing.four,
    marginTop: 2,
  },
  chips: {
    gap: 6,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.twelve,
  },
  chip: {
    borderRadius: Radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  chipOn: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.muted,
  },
  chipTextOn: {
    color: Colors.onEmber,
  },
  loader: {
    marginTop: Spacing.five,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.five,
    marginTop: Spacing.five,
  },
  list: {
    paddingBottom: Spacing.five,
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconMuted: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
    marginTop: 2,
  },
});
