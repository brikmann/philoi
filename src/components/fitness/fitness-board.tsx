import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CosmeticAvatar } from '@/components/economy/public-identity';
import { HouseSeal } from '@/components/house/house-seal';
import { EmptyState } from '@/components/ui/empty-state';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePublicLoadouts, type PublicLoadout } from '@/hooks/use-public-loadouts';
import { fetchUniversityShortNames } from '@/lib/api/groups';
import { shortName } from '@/lib/format';
import type { MetricLeaderboardRow } from '@/types/house';

// The list half of the Fitness board (mock 289) and an exercise board (mocks 294/295): rank ·
// avatar · name over a compact "Kin · Laurier" line · value · ⚔. Your own row is highlighted in the
// list AND pinned under it with where you stand ("14 km behind Aisha."), so the one number you
// opened the board for never scrolls away.
//
// Deliberately not LeaderboardPersonRow: that row is the XP board's (tier label + rank hexagon),
// and a fitness board ranks on one real number, so the rank hexagon would be noise here.

/** Gold/silver/bronze for the PLACE — same values as leaderboard-person-row's. */
const MEDAL_COLOR: Record<number, string> = { 1: '#F5C542', 2: '#CFD3DC', 3: '#D08A4F' };

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

  return (
    <View style={styles.wrap}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.user_id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={Colors.coral} />}
        ListHeaderComponent={header}
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
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListFooterComponent={footer}
        ListEmptyComponent={
          loading ? null : error ? (
            <EmptyState emoji="🏋️" title="Couldn't load this board" body={error} />
          ) : (
            <EmptyState emoji="🏋️" title={emptyTitle} body={emptyBody} />
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
      ) : rows.length > 0 && !loading ? (
        <View style={styles.pinned}>
          <Text style={styles.standing}>You&apos;re not on this board yet.</Text>
        </View>
      ) : null}
    </View>
  );
}

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
    <Pressable
      style={[styles.row, row.is_me && styles.rowMe]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.display_name}, rank ${row.rank}, ${value}`}>
      <Text style={[styles.pos, MEDAL_COLOR[row.rank] ? { color: MEDAL_COLOR[row.rank] } : null]}>{row.rank}</Text>
      {/* Static flares: a board is a long list. */}
      <CosmeticAvatar userId={row.user_id} name={row.display_name} avatarUrl={row.avatar_url} size={30} loadout={loadout} motion="reduced" />
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>
          {shortName(row.display_name)}
          {row.is_me ? ' · you' : ''}
        </Text>
        {identity || row.patron_key ? (
          <View style={styles.identityRow}>
            {/* The board already carries patron_key, so the seal draws without a per-row lookup. */}
            {row.patron_key ? <HouseSeal patronKey={row.patron_key} size={12} /> : null}
            {identity ? (
              <Text style={styles.sub} numberOfLines={1}>
                {identity}
              </Text>
            ) : null}
          </View>
        ) : null}
        {verification && onPressVerification && !row.is_me ? (
          <Pressable onPress={onPressVerification} hitSlop={6} accessibilityRole="button" accessibilityLabel="About this PR">
            {verification}
          </Pressable>
        ) : (
          verification
        )}
      </View>
      <View style={styles.valueColumn}>
        <Text style={styles.val}>{value}</Text>
        {valueCaption ? <Text style={styles.valSub}>{valueCaption}</Text> : null}
      </View>
      {row.is_me ? (
        <View style={styles.versusSpacer} />
      ) : (
        <Pressable
          style={styles.versus}
          onPress={onVersus}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Versus ${row.display_name}`}>
          <Text style={styles.versusLabel}>⚔</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.card,
  },
  rowMe: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
  },
  pos: {
    width: 18,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
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
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sub: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  verify: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.textTertiary,
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
  valSub: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  versus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  versusSpacer: {
    width: 28,
  },
  versusLabel: {
    fontSize: 13,
    color: Colors.amber,
  },
  pinned: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    backgroundColor: Colors.twilight900,
    gap: Spacing.one,
  },
  standing: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.amber,
    textAlign: 'center',
  },
});
