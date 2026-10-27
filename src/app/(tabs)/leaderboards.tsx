import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BoardRow, NO_LOADOUT } from '@/components/board-row';
import { FitnessBoardPanel } from '@/components/fitness/fitness-board-panel';
import { LeaderboardList } from '@/components/leaderboard-list';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { PrivateClimb } from '@/components/private-climb';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { usePresence } from '@/hooks/use-presence';
import { usePublicLoadouts, useRefreshPublicLoadoutsOnFocus } from '@/hooks/use-public-loadouts';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMetricCatalog, useMetricLeaderboard } from '@/hooks/use-metric-leaderboard';
import { fetchMyProgram } from '@/lib/api/house';
import { rankVisibilityOf } from '@/lib/api/privacy';
import { useAuth } from '@/lib/auth/auth-context';
import { formatMetricValue } from '@/lib/stats/format';
import type { MetricCatalogRow, MetricLeaderboardRow, MetricScope, MyProgramRow } from '@/types/house';

// THE LEADERBOARD TAB — the new global board (nav restructure, mock 302). Clean and simple: one
// scope toggle, one metric picker, ranked rows that each carry the person's Heir identity (house
// seal + program line), you highlighted. Everything reads get_metric_leaderboard (0265) as-is.
//
// EVERY MEMBER IN SCOPE (0276): ranked people first, then everyone with nothing logged as "not
// ranked yet", so the board reads as the real member base. A server without 0276 just returns the
// ranked part (stats.ts falls back). The green dot is live presence (get_presence, polled while
// focused); "Live now" narrows the board to who's locked in this minute.
//
// Row body → Head-to-Head vs them. Avatar → their profile. Your own row → your Profile.
// The pre-restructure board screen is gone (ui_pass2 §8): this is the only board UI. The XP | Fitness
// toggle in the header swaps the Fitness board (FitnessBoardPanel) in on this same screen, under the
// same scope row — it used to push a separate /fitness screen, which now just redirects here.
// Challenges sits one tap away in the tools row; a campfire's own board lives on the campfire.

type Board = 'xp' | 'fitness';
const BOARDS: { key: Board; label: string }[] = [
  { key: 'xp', label: 'XP' },
  { key: 'fitness', label: 'Fitness' },
];

const SCOPES: { key: MetricScope; label: string }[] = [
  { key: 'global', label: 'Global' },
  { key: 'my_uni', label: 'My Uni' },
  { key: 'my_program', label: 'Program' },
  { key: 'friends', label: 'Friends' },
];

const DEFAULT_METRIC = 'season_xp';

// Server-written pushes still name the OLD board's scopes (0253 sends {"scope":"uni"}); map them
// onto this board's. 'camp' and 'vs' have no equivalent here and land on the Global default.
const LINKED_SCOPE: Record<string, MetricScope> = {
  uni: 'my_uni',
  my_uni: 'my_uni',
  house: 'my_program',
  my_program: 'my_program',
  global: 'global',
  friends: 'friends',
};

export default function LeaderboardTab() {
  const router = useRouter();
  const { profile } = useAuth();
  // The viewer's own visibility dial, honoured exactly as the old board did: private sees only their
  // own climb, friends-only sees only the Friends board.
  const dial = rankVisibilityOf(profile);
  const [pickedScope, setPickedScope] = useState<MetricScope>('global');
  const [board, setBoard] = useState<Board>('xp');
  const { scope: linkedScope, board: linkedBoard } = useLocalSearchParams<{ scope?: string; board?: string }>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the route param, which changes on a push tap while the tab stays mounted
    if (linkedScope && LINKED_SCOPE[linkedScope]) setPickedScope(LINKED_SCOPE[linkedScope]);
  }, [linkedScope]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same: /fitness redirects here with ?board=fitness
    if (linkedBoard === 'fitness' || linkedBoard === 'xp') setBoard(linkedBoard);
  }, [linkedBoard]);
  const scope: MetricScope = dial === 'friends' ? 'friends' : pickedScope;
  const scopes = dial === 'friends' ? SCOPES.filter((s) => s.key === 'friends') : SCOPES;

  const { catalog } = useMetricCatalog();
  const [metricKey, setMetricKey] = useState(DEFAULT_METRIC);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const stat = catalog.find((r) => r.key === metricKey) ?? null;

  const [program, setProgram] = useState<MyProgramRow | null>(null);
  const [programLoaded, setProgramLoaded] = useState(false);
  useEffect(() => {
    fetchMyProgram()
      .then(setProgram)
      .catch(() => setProgram(null))
      .finally(() => setProgramLoaded(true));
  }, []);

  // Same gates as the fitness board: a scope that can't have a board for this viewer explains itself.
  const gate: 'none' | 'no_school' | 'unverified' | 'no_program' =
    scope === 'my_uni' && !profile?.university
      ? 'no_school'
      : scope === 'my_uni' && !profile?.university_email_verified
        ? 'unverified'
        : scope === 'my_program' && programLoaded && !program
          ? 'no_program'
          : 'none';
  const held = dial === 'private' || gate !== 'none' || (scope === 'my_program' && !programLoaded) || !stat;

  // The scope gate and program fetch hold both boards; the XP fetch also waits while Fitness shows.
  const scopeHeld = gate !== 'none' || (scope === 'my_program' && !programLoaded);
  const { rows, loading, error, refetch } = useMetricLeaderboard({
    metric: held || board !== 'xp' || !stat ? null : stat.metric,
    scope,
    window: stat?.metric_window ?? 'all',
    includeUnranked: true,
  });
  const presence = usePresence(rows.map((r) => r.user_id));
  // Each row wears its owner's gear (mock 307): one batched read for the board, re-read on focus so
  // someone who re-equipped since you last looked isn't frozen in their old loadout.
  const rowIds = useMemo(() => rows.map((r) => r.user_id), [rows]);
  const loadouts = usePublicLoadouts(rowIds);
  useRefreshPublicLoadoutsOnFocus(rowIds);
  const liveCount = rows.filter((r) => presence[r.user_id]?.locked_in).length;
  const shownRows = liveOnly ? rows.filter((r) => presence[r.user_id]?.locked_in) : rows;

  const format = (v: number) => (stat ? formatMetricValue(stat.unit, v) : String(v));

  function openProfile(row: MetricLeaderboardRow) {
    if (row.is_me) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId: row.user_id } });
  }

  function openRow(row: MetricLeaderboardRow) {
    if (row.is_me) router.push('/profile');
    else router.push({ pathname: '/versus', params: { with: row.user_id } });
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar />
      <View style={styles.head}>
        <Text style={styles.title}>Leaderboard</Text>
        {dial === 'private' ? null : (
          <View style={styles.boardToggle}>
            {BOARDS.map((b) => {
              const on = b.key === board;
              return (
                <Pressable
                  key={b.key}
                  onPress={() => setBoard(b.key)}
                  style={[styles.boardBtn, on && styles.boardBtnOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${b.label} board`}>
                  <Text style={[styles.boardText, on && styles.boardTextOn]}>{b.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {dial === 'private' ? (
        <PrivateClimb />
      ) : (
        <>
          <View style={styles.scope}>
            {scopes.map((s) => {
              const on = s.key === scope;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => setPickedScope(s.key)}
                  style={[styles.scopeBtn, on && styles.scopeBtnOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}>
                  <Text style={[styles.scopeText, on && styles.scopeTextOn]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {board === 'fitness' ? (
            <FitnessBoardPanel
              scope={scope}
              held={scopeHeld}
              notice={gate !== 'none' ? <GateNotice gate={gate} /> : null}
              program={program}
              actions={<QuickLink label="Challenges" onPress={() => router.push('/challenges')} />}
            />
          ) : (
            <>
              <View style={styles.tools}>
                <Pressable style={styles.metric} onPress={() => setPickerOpen(true)} accessibilityRole="button">
                  <Text style={styles.metricText} numberOfLines={1}>
                    {stat ? `${stat.emoji} ${stat.label}` : 'Loading stats…'}
                  </Text>
                  <UiGlyph name="down" size={14} color={Colors.spaceDim} />
                </Pressable>
                <Pressable
                  style={[styles.live, liveOnly && styles.liveOn]}
                  onPress={() => setLiveOnly((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: liveOnly }}
                  accessibilityLabel={`Live now, ${liveCount} locked in`}>
                  <View style={styles.liveDot} />
                  <Text style={[styles.liveText, liveOnly && styles.liveTextOn]}>Live {liveCount > 0 ? liveCount : ''}</Text>
                </Pressable>
                <QuickLink label="Challenges" onPress={() => router.push('/challenges')} />
              </View>

              {gate !== 'none' ? (
                <GateNotice gate={gate} />
              ) : (
                // The same list, pinned "you" bar and states the Fitness board draws (LeaderboardList).
                <LeaderboardList
                  rows={rows}
                  data={shownRows}
                  loading={loading}
                  error={error}
                  onRefresh={refetch}
                  formatValue={format}
                  emptyTitle={liveOnly ? 'Nobody live right now' : 'Nobody on this board yet'}
                  emptyBody={liveOnly ? 'Nobody on this board is locked in right now.' : 'Lock in and open it.'}
                  renderRow={(item) => (
                    <BoardRow
                      row={item}
                      value={item.rank == null ? '—' : format(item.value)}
                      presence={presence[item.user_id]}
                      loadout={loadouts[item.user_id] ?? NO_LOADOUT}
                      onPressRow={openRow}
                      onPressAvatar={openProfile}
                    />
                  )}
                />
              )}
            </>
          )}
        </>
      )}

      <MetricPicker
        visible={pickerOpen}
        catalog={catalog}
        selectedKey={metricKey}
        onPick={(r) => {
          setMetricKey(r.key);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

function QuickLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quick} onPress={onPress} accessibilityRole="button">
      <Text style={styles.quickText}>{label}</Text>
    </Pressable>
  );
}

function GateNotice({ gate }: { gate: 'no_school' | 'unverified' | 'no_program' }) {
  const router = useRouter();
  const copy =
    gate === 'no_program'
      ? { title: 'Pick your program', body: 'Your program names your house — pick it to rank against every Heir of it.', cta: 'Pick my program', route: '/house/change-program?ceremony=1' }
      : gate === 'unverified'
        ? { title: 'Verify your campus email', body: 'My Uni boards are for verified students.', cta: 'Verify', route: '/campus' }
        : { title: 'Add your university', body: 'Tell us where you study to see your school’s board.', cta: 'Add school', route: '/campus' };
  return (
    <View style={styles.gate}>
      <Text style={styles.gateTitle}>{copy.title}</Text>
      <Text style={styles.gateBody}>{copy.body}</Text>
      <Pressable style={styles.gateBtn} onPress={() => router.push(copy.route as never)} accessibilityRole="button">
        <Text style={styles.gateBtnText}>{copy.cta}</Text>
      </Pressable>
    </View>
  );
}

function MetricPicker({
  visible,
  catalog,
  selectedKey,
  onPick,
  onClose,
}: {
  visible: boolean;
  catalog: MetricCatalogRow[];
  selectedKey: string;
  onPick: (row: MetricCatalogRow) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Grouped by the catalog's own group labels, in catalog order — the 26-stat library (mock 293).
  const groups = useMemo(() => {
    const out: { label: string; rows: MetricCatalogRow[] }[] = [];
    for (const r of [...catalog].sort((a, b) => a.sort - b.sort)) {
      const g = out.find((x) => x.label === r.group_label);
      if (g) g.rows.push(r);
      else out.push({ label: r.group_label, rows: [r] });
    }
    return out;
  }, [catalog]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.sheetTitle}>Rank by</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {groups.map((g) => (
              <View key={g.label}>
                <Text style={styles.sheetGroup}>{g.label}</Text>
                {g.rows.map((r) => {
                  const on = r.key === selectedKey;
                  return (
                    <Pressable
                      key={r.key}
                      style={[styles.sheetRow, on && styles.sheetRowOn]}
                      onPress={() => onPick(r)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}>
                      <Text style={styles.sheetEmoji}>{r.emoji}</Text>
                      <Text style={[styles.sheetLabel, on && styles.sheetLabelOn]}>{r.label}</Text>
                      {on ? <Ionicons name="checkmark" size={16} color={Colors.navEmber} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 22,
    color: Colors.ink,
  },
  // XP | Fitness — a compact twin of the scope control, beside the title.
  boardToggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  boardBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  boardBtnOn: {
    backgroundColor: Colors.spacePanel2,
  },
  boardText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  boardTextOn: {
    color: Colors.navEmber2,
  },
  scope: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    padding: 3,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  scopeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  scopeBtnOn: {
    backgroundColor: Colors.spacePanel2,
  },
  scopeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  scopeTextOn: {
    color: Colors.navEmber2,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  metric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  metricText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  liveOn: {
    backgroundColor: 'rgba(57,217,138,0.14)',
    borderColor: '#39D98A',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#39D98A',
  },
  liveText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  liveTextOn: {
    color: '#39D98A',
  },
  quick: {
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  quickText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.legend,
  },
  gate: {
    margin: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    gap: 6,
  },
  gateTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  gateBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  gateBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.navEmber,
  },
  gateBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#2A0F05',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,14,0.6)',
  },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: Colors.spacePanel,
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  sheetTitle: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  sheetGroup: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: Spacing.three,
    marginBottom: 4,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  sheetRowOn: {
    backgroundColor: Colors.spacePanel2,
  },
  sheetEmoji: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
  },
  sheetLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.spaceDim,
  },
  sheetLabelOn: {
    color: Colors.ink,
  },
});
