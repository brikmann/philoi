import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { Icon, type IconName } from '@/components/ui/icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchMatchSummary, type MatchSummary } from '@/lib/api/discover';
import { fetchGrindAlikes } from '@/lib/api/matchmaking';
import { useAuth } from '@/lib/auth/auth-context';
import { shortSchoolName } from '@/lib/universities';
import type { GrindAlike } from '@/types/social';

// MATCHMAKING (ShareSpot ss2, mock 383) — the discovery payoff. NO NEW ALGORITHM: the constellation
// is your node linked to the existing engine's top matches (get_grind_alikes, 0275/0285/0295), and
// the bars are 0299's get_match_summary — a count, over those same matches, of who shares your
// interests, program, campus and patron, and who's active now. Every number is a real count.
//
// Two entries: onboarding (after Interests, ?onboarding=1 → Your people, no way back) and Search's
// "Find who vibes with you" (closable; "See my crew" opens the People page).

const STAGE = 300;
const R = 112;
const NODE = 40;
const CENTER = 84;
const NODE_COLORS = ['#45C9D6', '#FFB05A', '#9D6BFF', '#FF6B5A', '#39D98A', '#45C9D6', '#B98BFF'];

type Signal = { key: string; icon: IconName; title: string; value: string; fraction: number };

export default function Matchmaking() {
  const router = useRouter();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const first = onboarding === '1';
  const { profile } = useAuth();
  const [summary, setSummary] = useState<MatchSummary | null | undefined>(undefined);
  const [nodes, setNodes] = useState<GrindAlike[] | null>(null);
  // The reveal takes a beat on purpose: the constellation draws, then the bars, then the count.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([fetchMatchSummary().catch(() => null), fetchGrindAlikes(undefined, 7).catch(() => [])]).then(([s, n]) => {
      if (!live) return;
      setSummary(s);
      setNodes(n);
    });
    const t = setTimeout(() => live && setRevealed(true), 1600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);

  const ready = summary !== undefined && nodes !== null;
  const school = profile?.university ? shortSchoolName(profile.university) : null;
  const view = useMemo(() => (ready ? toView(summary ?? null, nodes ?? [], school) : null), [ready, summary, nodes, school]);

  const next = () => {
    if (first) router.replace({ pathname: '/discover/your-people', params: { onboarding: '1' } } as never);
    else router.replace('/discover/people' as never);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      {!first ? (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/social'))}
          style={styles.close}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close">
          <Icon name="close" size={20} color={Colors.ink} />
        </Pressable>
      ) : null}
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>MATCHING YOU</Text>
        <Text style={styles.h}>{revealed && view ? (view.total > 0 ? 'Found your people' : 'You’re early') : 'Finding your people…'}</Text>

        <View style={styles.stage} accessible accessibilityLabel={view ? `${view.total} matches` : 'Matching'}>
          <Svg width={STAGE} height={STAGE} style={StyleSheet.absoluteFill}>
            {ready
              ? positions(Math.max(nodes?.length ?? 0, 5)).map((p, i) => (
                  <Line key={i} x1={STAGE / 2} y1={STAGE / 2} x2={p.x} y2={p.y} stroke="#8A5A3A" strokeWidth={1.5} opacity={0.8} />
                ))
              : null}
          </Svg>
          {ready
            ? positions(Math.max(nodes?.length ?? 0, 5)).map((p, i) => {
                const n = nodes?.[i];
                return (
                  <Animated.View
                    key={n?.user_id ?? `ghost-${i}`}
                    entering={ZoomIn.delay(150 + i * 160).springify()}
                    style={[styles.node, { left: p.x - NODE / 2, top: p.y - NODE / 2 }]}>
                    {n ? (
                      <MatchAvatar name={n.display_name} avatarUrl={n.avatar_url} size={NODE} live={n.live} />
                    ) : (
                      <View style={[styles.ghost, { backgroundColor: NODE_COLORS[i % NODE_COLORS.length] }]} />
                    )}
                  </Animated.View>
                );
              })
            : null}
          <View style={styles.me}>
            {profile ? <MatchAvatar name={profile.display_name ?? 'You'} avatarUrl={profile.avatar_url ?? null} size={CENTER - 8} /> : null}
          </View>
        </View>

        {revealed && view ? (
          <>
            {view.signals.map((s, i) => (
              <Animated.View key={s.key} entering={FadeInDown.delay(i * 140)} style={styles.signal}>
                <Icon name={s.icon} size={16} color={Colors.navEmber2} />
                <View style={styles.flex}>
                  <View style={styles.signalTop}>
                    <Text style={styles.signalTitle}>{s.title}</Text>
                    <Text style={styles.signalValue} numberOfLines={1}>
                      {s.value}
                    </Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.round(s.fraction * 100)}%` }]} />
                  </View>
                </View>
              </Animated.View>
            ))}
            <Animated.Text entering={FadeIn.delay(view.signals.length * 140 + 120)} style={styles.found}>
              {view.note}
            </Animated.Text>
          </>
        ) : null}
      </ScrollView>
      <View style={styles.foot}>
        <PrimaryButton label={first ? 'See my crew →' : 'See everyone →'} onPress={next} disabled={!revealed} />
      </View>
    </SafeAreaView>
  );
}

function positions(n: number) {
  const count = Math.min(Math.max(n, 1), 7);
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return { x: STAGE / 2 + R * Math.cos(a), y: STAGE / 2 + R * Math.sin(a) };
  });
}

function toView(summary: MatchSummary | null, nodes: GrindAlike[], school: string | null) {
  // Prefer the server's counts (0299). Before 0299 lands, count the same signals off the top
  // matches' own reasons — fewer rows, same meaning.
  if (summary && !summary.discoverable) {
    return {
      total: 0,
      signals: [] as Signal[],
      note: 'Matching is off, so no one’s matched yet. Turn it on anytime in Settings. You’ll still get rooms that fit.',
    };
  }
  const s =
    summary && summary.discoverable
      ? summary
      : {
          total: nodes.length,
          live: nodes.filter((n) => n.live).length,
          interests: {
            count: nodes.filter((n) => n.reasons.some((r) => r.key.startsWith('tag:'))).length,
            labels: [...new Set(nodes.flatMap((n) => n.reasons.filter((r) => r.key.startsWith('tag:')).map((r) => r.label)))],
          },
          program: { count: nodes.filter((n) => n.reasons.some((r) => r.key === 'house')).length, label: null },
          campus: { count: nodes.filter((n) => n.reasons.some((r) => r.key === 'uni' || r.key === 'house')).length, label: school },
          patron: { count: nodes.filter((n) => n.reasons.some((r) => r.key === 'patron')).length, label: null },
        };
  const frac = (c: number) => (s.total === 0 ? 0 : Math.max(c > 0 ? 0.06 : 0, c / s.total));
  const labels = s.interests.labels;
  const signals: Signal[] = [
    {
      key: 'interests',
      icon: 'target',
      title: 'Shared interests',
      value: labels.length === 0 ? `${s.interests.count}` : labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : ''),
      fraction: frac(s.interests.count),
    },
    { key: 'program', icon: 'study', title: 'Same program', value: s.program.label ?? `${s.program.count}`, fraction: frac(s.program.count) },
    {
      key: 'campus',
      icon: 'campus',
      title: 'Same campus',
      value: s.campus.label ? shortSchoolName(s.campus.label) : `${s.campus.count}`,
      fraction: frac(s.campus.count),
    },
    { key: 'patron', icon: 'temple', title: 'Same patron', value: s.patron.label ?? `${s.patron.count}`, fraction: frac(s.patron.count) },
    { key: 'active', icon: 'flame', title: 'Active now', value: `${s.live} live`, fraction: frac(s.live) },
  ];
  // A signal nobody shares (and no label to show) is noise — drop it rather than draw an empty bar.
  const shown = signals.filter((g) => g.fraction > 0 || (g.key !== 'active' && g.key !== 'patron' && g.value !== '0'));
  const note =
    s.total === 0
      ? 'No one lines up yet. New people join every day, and rooms are open now.'
      : `Found ${s.total} ${s.total === 1 ? 'person' : 'people'} who vibe with you`;
  return { total: s.total, signals: shown, note };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  flex: { flex: 1, minWidth: 0 },
  close: { position: 'absolute', top: 56, right: Spacing.three, zIndex: 2, padding: 4 },
  body: { alignItems: 'center', paddingHorizontal: Spacing.four, paddingTop: Spacing.five, paddingBottom: Spacing.four },
  eyebrow: { fontFamily: Fonts.bodyBold, fontSize: 13, letterSpacing: 2, color: Colors.navEmber2 },
  h: { marginTop: Spacing.two, fontFamily: Fonts.bodyBold, fontSize: 26, color: Colors.ink, textAlign: 'center' },
  stage: { width: STAGE, height: STAGE, marginVertical: Spacing.three },
  node: { position: 'absolute', width: NODE, height: NODE },
  // Placeholder dots when there are fewer matches than slots — dim, so they never read as people.
  ghost: { width: NODE, height: NODE, borderRadius: NODE / 2, opacity: 0.35 },
  me: {
    position: 'absolute',
    left: STAGE / 2 - CENTER / 2,
    top: STAGE / 2 - CENTER / 2,
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.navEmber,
    shadowColor: Colors.navEmber,
    shadowOpacity: 0.7,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  signal: { flexDirection: 'row', alignItems: 'center', gap: Spacing.twelve, alignSelf: 'stretch', marginBottom: Spacing.twelve },
  signalTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  signalTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  signalValue: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.spaceDim },
  track: { marginTop: 6, height: 7, borderRadius: 4, backgroundColor: Colors.spacePanel2, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4, backgroundColor: Colors.navEmber2 },
  found: { marginTop: Spacing.two, fontFamily: Fonts.bodyBold, fontSize: 16, color: '#39D98A', textAlign: 'center' },
  foot: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
});
