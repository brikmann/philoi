import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BoardRow, NO_LOADOUT } from '@/components/board-row';
import { BoardTrackerBanner } from '@/components/fitness/tracker-prompts';
import { CompeteGlyph } from '@/components/ui/glyphs-compete';
import { SpaceEmpty, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useFitnessTracking } from '@/hooks/use-fitness-tracking';
import { usePublicLoadouts, type PublicLoadout } from '@/hooks/use-public-loadouts';
import { fetchUniversityShortNames } from '@/lib/api/groups';
import { shortName } from '@/lib/format';
import type { MetricLeaderboardRow } from '@/types/house';

// The list half of the Fitness board (mock 289) and an exercise board (mocks 294/295): rank ·
// avatar · name over a compact "Kin · Laurier" line · value · ⚔. Your own row is highlighted in the
// list AND pinned under it with where you stand ("14 km behind Aisha."), so the one number you
// opened the board for never scrolls away.
//
// Rows are the XP board's BoardRow (see FitnessBoardRow), so both boards read as one format.

// Short school names change about once a year; one read per process, shared by every board.
let shortNamesCache: Record<string, string> | null = null;

function useUniversityShortNames(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>(shortNamesCache ?? {});
  useEffect(() => {
    if (shortNamesCache) return;
    fetchUniversityShortNames()
      .then((n) => {
        shortNamesCache = n;
        setNames(n);
      })
      .catch(() => {
        // Full names below — a failed fetch shouldn't block the board.
      });
  }, []);
  return names;
}

/** "Kin · Laurier" — the program's short label and the school, whichever the row has. */
export function identityLine(row: Pick<MetricLeaderboardRow, 'program_abbrev' | 'university'>, shortNames: Record<string, string>): string {
  const school = row.university ? (shortNames[row.university] ?? row.university) : null;
  return [row.program_abbrev, school].filter(Boolean).join(' · ');
}

/** "14 km behind Aisha." / "You're #1 — 9 km ahead of Jordan." — null when you aren't on the board. */
export function standingLine(rows: MetricLeaderboardRow[], formatValue: (v: number) => string): string | null {
  const me = rows.find((r) => r.is_me);
  if (!me) return null;
  const top = rows[0];
  if (me.rank === 1) {
    const second = rows.find((r) => r.rank === 2);
    if (!second) return "You're #1.";
    const lead = me.value - second.value;
    return lead > 0
      ? `You're #1 — ${formatValue(lead)} ahead of ${shortName(second.display_name)}.`
      : `You're #1, level with ${shortName(second.display_name)}.`;
  }
  const gap = top.value - me.value;
  return gap > 0 ? `${formatValue(gap)} behind ${shortName(top.display_name)}.` : `Level with ${shortName(top.display_name)} for #1.`;
}

export function FitnessBoard({
  rows,
  loading,
  error,
  onRefresh,
  formatValue,
  valueCaption,
  onPressRow,
  onPressVerification,
  onVersus,
  header,
  footer,
  emptyTitle,
  emptyBody,
}: {
  rows: MetricLeaderboardRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /** Formats a value AND a gap ("14 km behind") — so it must take any number, not just a row's. */
  formatValue: (value: number) => string;
  /** A small line under each value — "this month", "est 1RM". */
  valueCaption?: string;
  onPressRow: (row: MetricLeaderboardRow) => void;
  /** When set, a row's "✓ clip on file" / "unverified" line opens the verification sheet. */
  onPressVerification?: (row: MetricLeaderboardRow) => void;
  onVersus: (row: MetricLeaderboardRow) => void;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  emptyTitle: string;
  emptyBody: string;
}) {
  const shortNames = useUniversityShortNames();
  // One get_public_loadouts call for the whole board — see the batching note in economy/public-identity.tsx.
  const loadouts = usePublicLoadouts(rows.map((r) => r.user_id));
  const me = rows.find((r) => r.is_me);
  const standing = standingLine(rows, formatValue);
  // Mock 314: with no tracker connected, the slot you'd hold is the nudge — a "not tracked yet"
  // row pinned where yours would be, and a Connect banner over the list. Both vanish for good once
  // any tracker is on (use-fitness-tracking.ts); a real row of yours always wins over the slot.
  const tracking = useFitnessTracking();
  const untracked = !tracking.loading && !tracking.trackingOn;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={Colors.navEmber} />}
        ListHeaderComponent={
          <>
            <BoardTrackerBanner style={styles.banner} />
            {header}
          </>
        }
        renderItem={({ item }) => (
          <FitnessBoardRow
            row={item}
            value={formatValue(item.value)}
            valueCaption={valueCaption}
            identity={identityLine(item, shortNames)}
            loadout={loadouts[item.user_id]}
            onPress={() => onPressRow(item)}
            onPressVerification={onPressVerification ? () => onPressVerification(item) : undefined}
            onVersus={() => onVersus(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        ListFooterComponent={footer}
        ListEmptyComponent={
          loading ? null : error ? (
            <SpaceEmpty title="Couldn't load this board" body={error} />
          ) : (
            <SpaceEmpty title={emptyTitle} body={emptyBody} />
          )
        }
      />
      {/* Pinned: you, wherever you are on the board, and the gap to the top. */}
      {me ? (
        <View style={styles.pinned}>
          <FitnessBoardRow
            row={me}
            value={formatValue(me.value)}
            valueCaption={valueCaption}
            identity={identityLine(me, shortNames)}
            loadout={loadouts[me.user_id]}
            onPress={() => onPressRow(me)}
            onVersus={() => {}}
          />
          {standing ? <Text style={styles.standing}>{standing}</Text> : null}
        </View>
      ) : untracked && !loading ? (
        <View style={styles.pinned}>
          <View style={[styles.row, styles.rowUntracked]} accessibilityLabel="You, not tracked yet">
            <Text style={styles.pos}>—</Text>
            <View style={styles.who}>
              <Text style={styles.name}>You · not tracked yet</Text>
            </View>
            <View style={styles.valueColumn}>
              <Text style={styles.val}>—</Text>
            </View>
            <View style={styles.versusSpacer} />
          </View>
        </View>
      ) : rows.length > 0 && !loading ? (
        <View style={styles.pinned}>
          <Text style={styles.standing}>You&apos;re not on this board yet.</Text>
        </View>
      ) : null}
    </View>
  );
}

// The XP board's row (components/board-row.tsx), so a loadout reads the same on every board —
// flare edge and glow, halo, title, and the equipped card's animated backdrop. This fills its
// fitness slots: the "Kin · Laurier" line, the PR-clip status, the window caption and ⚔ Versus.
// The whole row (and the avatar) opens their profile; Versus is its own button.
function FitnessBoardRow({
  row,
  value,
  valueCaption,
  identity,
  loadout,
  onPress,
  onPressVerification,
  onVersus,
}: {
  row: MetricLeaderboardRow;
  value: string;
  valueCaption?: string;
  identity: string;
  loadout?: PublicLoadout;
  onPress: () => void;
  onPressVerification?: () => void;
  onVersus: () => void;
}) {
  // null for anything but an exercise metric. ✓ = a clip is on file for review — never a watch link.
  const verification =
    row.verified === null ? null : row.verified ? (
      <Text style={[styles.verify, styles.verifyOk]}>✓ clip on file</Text>
    ) : (
      <Text style={styles.verify}>no clip · unverified</Text>
    );

  return (
    <BoardRow
      row={row}
      value={value}
      valueCaption={valueCaption}
      loadout={loadout ?? NO_LOADOUT}
      onPressRow={onPress}
      onPressAvatar={onPress}
      identity={
        identity ? (
          <Text style={styles.sub} numberOfLines={1}>
            {identity}
          </Text>
        ) : null
      }
      extra={
        verification && onPressVerification && !row.is_me ? (
          <Pressable onPress={onPressVerification} hitSlop={6} accessibilityRole="button" accessibilityLabel="About this PR">
            {verification}
          </Pressable>
        ) : (
          verification
        )
      }
      trailing={
        row.is_me ? (
          <View style={styles.versusSpacer} />
        ) : (
          <Pressable
            style={styles.versus}
            onPress={onVersus}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Versus ${row.display_name}`}>
            <CompeteGlyph name="versus" size={15} color={Colors.navEmber2} />
          </Pressable>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.four,
  },
  // SpaceRow's panel; your own row takes the ember edge the Leaderboard tab gives it.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  // The empty slot: dimmed, never the ember "you" edge — it isn't a place you hold yet.
  rowUntracked: {
    opacity: 0.5,
    borderStyle: 'dashed',
  },
  banner: {
    marginBottom: Spacing.two,
  },
  pos: {
    width: 20,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceFaint,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  sub: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.spaceDim,
  },
  verify: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.spaceFaint,
    marginTop: 1,
  },
  verifyOk: {
    color: Colors.green,
  },
  valueColumn: {
    alignItems: 'flex-end',
  },
  val: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  versus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  versusSpacer: {
    width: 28,
  },
  pinned: {
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
    backgroundColor: Colors.spaceBg,
    gap: Spacing.one,
  },
  standing: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.navEmber2,
    textAlign: 'center',
  },
});
