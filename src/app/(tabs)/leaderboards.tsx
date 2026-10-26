import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HouseSeal } from '@/components/house/house-seal';
import { IdentityLine } from '@/components/house/identity-line';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { PrivateClimb } from '@/components/private-climb';
import { usePresence } from '@/hooks/use-presence';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMetricCatalog, useMetricLeaderboard } from '@/hooks/use-metric-leaderboard';
import { fetchMyProgram } from '@/lib/api/house';
import { rankVisibilityOf } from '@/lib/api/privacy';
import { useAuth } from '@/lib/auth/auth-context';
import { formatMetricValue } from '@/lib/stats/format';
import type { PresenceRow } from '@/types/database';
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
// The pre-restructure board screen is gone (ui_pass2 §8): this is the only board UI. Fitness boards
// and Challenges sit one tap away in the tools row; a campfire's own board lives on the campfire.

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
  const { scope: linkedScope } = useLocalSearchParams<{ scope?: string }>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the route param, which changes on a push tap while the tab stays mounted
    if (linkedScope && LINKED_SCOPE[linkedScope]) setPickedScope(LINKED_SCOPE[linkedScope]);
  }, [linkedScope]);
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

  const { rows, loading, error, refetch } = useMetricLeaderboard({
    metric: held || !stat ? null : stat.metric,
    scope,
    window: stat?.metric_window ?? 'all',
    includeUnranked: true,
  });
  const presence = usePresence(rows.map((r) => r.user_id));
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

          <View style={styles.tools}>
            <Pressable style={styles.metric} onPress={() => setPickerOpen(true)} accessibilityRole="button">
              <Text style={styles.metricText} numberOfLines={1}>
                {stat ? `${stat.emoji} ${stat.label}` : 'Loading stats…'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={Colors.spaceDim} />
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
            <QuickLink label="Fitness" onPress={() => router.push('/fitness')} />
            <QuickLink label="Challenges" onPress={() => router.push('/challenges')} />
          </View>

          {gate !== 'none' ? (
            <GateNotice gate={gate} />
          ) : (
            <FlatList
              data={shownRows}
              keyExtractor={(r) => r.user_id}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={refetch} tintColor={Colors.navEmber} />}
              ListEmptyComponent={
                loading ? (
                  <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
                ) : (
                  <Text style={styles.empty}>
                    {error ?? (liveOnly ? 'Nobody on this board is locked in right now.' : 'Nobody on this board yet — lock in and open it.')}
                  </Text>
                )
              }
              renderItem={({ item }) => (
                <BoardRow
                  row={item}
                  value={item.rank == null ? '—' : format(item.value)}
                  presence={presence[item.user_id]}
                  onPressRow={openRow}
                  onPressAvatar={openProfile}
                />
              )}
            />
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

function BoardRow({
  row,
  value,
  presence,
  onPressRow,
  onPressAvatar,
}: {
  row: MetricLeaderboardRow;
  value: string;
  presence: PresenceRow | undefined;
  onPressRow: (row: MetricLeaderboardRow) => void;
  onPressAvatar: (row: MetricLeaderboardRow) => void;
}) {
  const rankColor = row.rank === 1 ? Colors.gold : row.is_me ? Colors.navEmber2 : Colors.spaceDim;
  const initials = (row.display_name || row.handle || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Pressable
      style={[styles.row, row.is_me && styles.rowMe]}
      onPress={() => onPressRow(row)}
      accessibilityRole="button"
      accessibilityLabel={`${row.rank == null ? 'Not ranked yet' : row.rank}. ${row.is_me ? 'You' : row.display_name}${presence?.locked_in ? ', locked in now' : ''}, ${value}${row.is_me ? '' : '. Head-to-head'}`}>
      <Text style={[styles.rank, { color: rankColor }]}>{row.rank ?? '—'}</Text>
      <Pressable onPress={() => onPressAvatar(row)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Open profile">
        {row.avatar_url ? (
          <Image source={{ uri: row.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <Avatar label={initials} size={36} />
        )}
        {/* Presence: bright = locked in now, soft = online. Nothing when neither. */}
        {presence?.locked_in || presence?.online ? (
          <View style={[styles.presenceDot, !presence.locked_in && styles.presenceDotOnline]} />
        ) : null}
      </Pressable>
      <View style={styles.who}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {row.is_me ? 'You' : row.display_name}
          </Text>
          {row.patron_key ? <HouseSeal patronKey={row.patron_key} size={13} /> : null}
        </View>
        {row.rank == null ? (
          <Text style={styles.identity}>Not ranked yet</Text>
        ) : (
          <IdentityLine userId={row.user_id} university={row.university} style={styles.identity} />
        )}
      </View>
      <Text style={styles.value}>{value}</Text>
    </Pressable>
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
  presenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#39D98A',
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
  presenceDotOnline: {
    backgroundColor: '#2A8A5C',
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
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: 6,
  },
  loader: {
    marginTop: Spacing.five,
  },
  empty: {
    marginTop: Spacing.five,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowMe: {
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.08)',
  },
  rank: {
    width: 24,
    textAlign: 'center',
    fontFamily: Fonts.black,
    fontSize: 15,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  who: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  identity: {
    color: Colors.spaceDim,
  },
  value: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 14,
    color: Colors.ink,
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
