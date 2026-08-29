import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { CampfireBadge } from '@/components/campfire-badge';
import { CampfireBannerArt, bannerColors } from '@/components/campfire-banner-art';
import { heatToState } from '@/components/heat-flame';
import { FlameLogo } from '@/components/ui/flame-logo';
import { EmberFill } from '@/components/ui/ember-fill';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { RANK_TIER_LABEL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { CampfirePrivacy, Group, RankTierName } from '@/types/database';

// THE CAMPFIRE HEADER (mock 110 frames 1-3, mock 112 §A) — one cohesive ember treatment replacing
// the header CAMPFIRE_REDESIGN_SPEC calls the "biggest vibe-coded offender".
//
// WHAT WAS WRONG AND IS NOW GONE:
//  · a bright-blue floating settings gear, drawn as an absolute disc OVER the content, that showed
//    up mid-screen on several tabs. There is exactly one menu control now: the hamburger, top-right,
//    in the same chrome row as everything else.
//  · the big bottom "Lock in with the house" bar. Lock-in is a compact PILL in this row instead
//    (Noah's call), which frees the entire bottom edge for content and the chat composer.
//  · a banner hero that drew its art at zero width on Android, so the header was a black box with
//    text on it. See campfire-banner-art.tsx for the actual mechanism.
//
// TWO DENSITIES, ONE COMPONENT. `variant="full"` is the landing header (flame, name, meta, stats);
// `variant="collapsed"` is what Feed and Challenges wear — chrome row, inline name, tabs, nothing
// else — because a half-visible feed under a tall stat strip is the thing the redesign is fixing.
// Same row, same pill, same hamburger in both, so switching tabs doesn't reshuffle the controls.

export type CampfireTab = 'leaderboard' | 'feed' | 'challenges';

const TABS: { key: CampfireTab; label: string }[] = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'feed', label: 'Feed' },
  { key: 'challenges', label: 'Challenges' },
];

const HEAT_LABEL: Record<ReturnType<typeof heatToState>, string> = {
  roaring: 'ROARING',
  simmering: 'EMBERS',
  cold: '🖤 BURNT OUT',
};

const PRIVACY_LABEL: Record<CampfirePrivacy, string> = {
  open: 'Open',
  gated: 'Gated',
  private: 'Private',
};

function foundedLabel(createdAt: string | undefined): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  // "founded Jul '26" — a founding YEAR is the flex, the day isn't.
  return `founded ${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
}

type CampfireHeaderProps = {
  group: Group | null;
  variant: 'full' | 'collapsed';
  tab: CampfireTab;
  onTabChange: (tab: CampfireTab) => void;
  onBack: () => void;
  onLockIn: () => void;
  onOptions: () => void;
  /** 0-1 from get_my_campfire_heat() — drives the coal-bed states, same mapping as everywhere. */
  heat: number;
  memberCount: number;
  lockedInToday: number;
  /** Null hides the strip entirely — three zeroed tiles say less than no strip at all. */
  stats: { avgStreak: number; avgHoursPerDay: number; liveChallenges: number } | null;
  /** Dot on the hamburger when there are join requests waiting (admins only, gated by the caller). */
  hasPendingRequests?: boolean;
  /** Disables the pill while a session is already running — one lock-in at a time, app-wide. */
  lockInDisabled?: boolean;
};

export function CampfireHeader({
  group,
  variant,
  tab,
  onTabChange,
  onBack,
  onLockIn,
  onOptions,
  heat,
  memberCount,
  lockedInToday,
  stats,
  hasPendingRequests = false,
  lockInDisabled = false,
}: CampfireHeaderProps) {
  // The banner belongs to the CAMPFIRE (0134), so it is read off the campfire's own column and
  // not off whatever its owner happens to have equipped.
  //
  // It used to be the owner's equipped BANNER, resolved through the loadout store for the owner
  // and get_public_loadouts for everyone else. That made one owner's two fires fly the same art,
  // made setting a campfire's banner restyle the owner's profile, and needed a hand-written push
  // into the loadout store to repaint at all. All three go away with the column: every viewer
  // reads the same value from the same row, and the picker re-reads the group.
  //
  // Null = never chosen, and bannerColors already falls back to the base hearth for an unknown or
  // missing key.
  const { from, to } = bannerColors(group?.banner_item_id);

  const full = variant === 'full';
  const state = heatToState(heat);
  const gateMetal = group?.min_join_tier ? RANK_TIER_METAL[group.min_join_tier as RankTierName] : null;

  return (
    <View style={[styles.header, full ? styles.headerFull : styles.headerCollapsed]}>
      <CampfireBannerArt from={from} to={to} />

      {/* ONE chrome row. Back · (name, collapsed only) · Lock in · options. */}
      <View style={styles.topbar}>
        <Pressable style={styles.iconBtn} onPress={onBack} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={17} color={Colors.ink} />
        </Pressable>

        {!full && (
          <Text style={styles.inlineName} numberOfLines={1}>
            {group?.name ?? '…'}
          </Text>
        )}

        <View style={styles.spacer} />

        <Pressable onPress={onLockIn} disabled={lockInDisabled} accessibilityRole="button" accessibilityLabel="Lock in">
          {lockInDisabled ? (
            <View style={[styles.lockPill, styles.lockPillOff]}>
              <Text style={styles.lockPillLabelOff}>Locked in</Text>
            </View>
          ) : (
            <EmberFill style={styles.lockPill} radius={Radius.pill}>
              {/* Near-black, not the ember ramp — the brand gradient on top of the brand gradient
                  reads as a smudge. Mock 110's pill draws the flame in #2a1400 for the same reason. */}
              <FlameLogo size={13} color={Colors.onEmber} />
              <Text style={styles.lockPillLabel}>Lock in</Text>
            </EmberFill>
          )}
        </Pressable>

        <Pressable style={styles.iconBtn} onPress={onOptions} hitSlop={8} accessibilityLabel="Campfire options">
          <Ionicons name="menu" size={17} color={Colors.ink} />
          {hasPendingRequests && <View style={styles.optionsBadge} />}
        </Pressable>
      </View>

      {full && (
        <>
          {/* The campfire's own badge, at header size (mock 168's fourth frame). It was a bare
              <HeatFlame> — the collective heat and nothing else — so the landing header for
              "Late Night Library" and for "Grind Szn" drew the identical fire and the emoji their
              owners picked appeared nowhere on the screen that is most about them. Cold still
              reads "BURNT OUT" underneath; that is the relight nudge and the badge doesn't say it. */}
          <View style={styles.heatWrap} pointerEvents="none">
            <CampfireBadge emoji={group?.emoji ?? '🔥'} heat={heat} size={64} />
            <Text style={styles.heatState}>
              {HEAT_LABEL[state]} · {lockedInToday} OF {memberCount} TODAY
            </Text>
          </View>

          <Text style={styles.name} numberOfLines={2}>
            {group?.name ?? '…'}
          </Text>

          <View style={styles.metaRow}>
            <FlameLogo size={11} />
            <Text style={styles.meta} numberOfLines={1}>
              {' '}
              {group ? PRIVACY_LABEL[group.privacy] : '—'} · {memberCount} {memberCount === 1 ? 'member' : 'members'}
              {group?.created_at ? ` · ${foundedLabel(group.created_at)}` : ''}
            </Text>
          </View>

          {gateMetal && group?.min_join_tier && (
            <View style={[styles.gate, { borderColor: gateMetal.outer }]}>
              <Svg width={10} height={11} viewBox="0 0 100 100">
                <Polygon points="50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27" fill={gateMetal.inner} />
              </Svg>
              <Text style={[styles.gateLabel, { color: gateMetal.text }]}>
                {RANK_TIER_LABEL[group.min_join_tier as RankTierName]}+ to join
              </Text>
            </View>
          )}

          {stats && (
            <View style={styles.stats}>
              <StatTile value={`${Math.round(stats.avgStreak)}`} unit="d" label="AVG STREAK" lit />
              <StatTile value={`${stats.avgHoursPerDay}`} unit="h" label="LOCKED / DAY" />
              <StatTile value={`${stats.liveChallenges}`} label="LIVE CHALLENGES" lit={stats.liveChallenges > 0} />
            </View>
          )}
        </>
      )}

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={styles.tabSlot}
              onPress={() => onTabChange(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              {on ? (
                <EmberFill style={styles.tab} radius={11}>
                  <Text style={[styles.tabLabel, styles.tabLabelOn]}>{t.label}</Text>
                </EmberFill>
              ) : (
                <View style={[styles.tab, styles.tabOff]}>
                  <Text style={styles.tabLabel}>{t.label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StatTile({ value, unit, label, lit }: { value: string; unit?: string; label: string; lit?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, lit && styles.statValueLit]}>
        {value}
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  headerFull: {
    paddingTop: Spacing.one,
    paddingBottom: 10,
  },
  headerCollapsed: {
    paddingTop: Spacing.one,
    paddingBottom: 8,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,14,26,0.6)',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  optionsBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.coral,
    borderWidth: 1.5,
    borderColor: Colors.twilight900,
  },
  inlineName: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
    marginLeft: 2,
  },
  spacer: {
    flex: 1,
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  lockPillLabel: {
    // Near-black on the gradient (DESIGN_LANGUAGE_EMBER §3) — cream would halve the contrast.
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.onEmber,
  },
  lockPillOff: {
    backgroundColor: Colors.disabledSurface,
    borderWidth: 1,
    borderColor: Colors.disabledBorder,
    borderRadius: Radius.pill,
  },
  lockPillLabelOff: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.disabledText,
  },
  heatWrap: {
    alignItems: 'center',
    marginTop: 6,
  },
  heatState: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.9,
    color: '#C98A4A',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 6,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 26,
    lineHeight: 28,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: '#C8BCDD',
  },
  gate: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(20,17,28,0.72)',
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 9,
    marginTop: 7,
  },
  gateLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(23,18,38,0.72)',
    borderWidth: 1,
    borderColor: '#241C38',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  statValueLit: {
    color: Colors.amber,
  },
  statUnit: {
    fontSize: 11,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 8.5,
    letterSpacing: 0.3,
    color: '#8F83A8',
    marginTop: 2,
  },
  tabs: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
  },
  tabSlot: {
    flex: 1,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: Spacing.one,
  },
  tabOff: {
    backgroundColor: 'rgba(23,18,38,0.7)',
    borderWidth: 1,
    borderColor: '#241C38',
  },
  tabLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#C8BCDD',
  },
  tabLabelOn: {
    color: Colors.onEmber,
  },
});
