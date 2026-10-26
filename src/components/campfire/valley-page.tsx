import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { heatToFlameState, type CampfireFlameState } from '@/components/campfire-flame-stage';
import { CampfirePreviewSheet } from '@/components/campfire-preview-sheet';
import { HeatFlame } from '@/components/heat-flame';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SPACE_GUTTER, SpaceChip } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useActiveCircleLockIns } from '@/hooks/use-active-circle-lockins';
import { fetchDiscoverableGroups, type MyGroup } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import type { DiscoverableGroup } from '@/types/database';

// THE CAMPFIRE VALLEY — the map of fires behind /campfires.
//
// Lived inside the old pre-restructure Home (your-fire.tsx) as its second pager page, then as an
// export /campfires borrowed. That Home is gone with the nav restructure, so the page and the five
// helpers + styles it leans on moved here wholesale. Behaviour is unchanged; only the chrome around
// the fires (search, filter chips, the join/start rows) moved into the space-purple kit. The fires
// themselves — HeatFlame hearths, emoji tags, sizes, the dim/zoom animation — are content and stay.

// Deterministic per-id placement isn't enough on its own here — with potentially dozens of
// campfires, plain per-id hashing can land two nodes on top of each other. Instead, campfires
// are assigned to a small fixed set of pre-spread, non-overlapping slots (most-central slots
// go to the most active fires, matching "roaring = big + foreground"), so spacing is
// guaranteed regardless of how many are on screen.
function hashUnit(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}

const SLOT_COLS = [18, 50, 82];
const SLOT_ROWS = [16, 40, 64, 88];
const SLOTS: { left: number; top: number }[] = [];
SLOT_ROWS.forEach((row, ri) => {
  const offset = ri % 2 === 1 ? 12 : 0;
  SLOT_COLS.forEach((col) => SLOTS.push({ left: Math.min(92, col + offset), top: row }));
});
const SORTED_SLOTS = [...SLOTS].sort(
  (a, b) => Math.abs(a.left - 50) + Math.abs(a.top - 50) - (Math.abs(b.left - 50) + Math.abs(b.top - 50))
);

const STATE_WEIGHT: Record<CampfireFlameState, number> = { roar: 2, steady: 1, dead: 0 };

function layoutValleyNodes<T>(items: T[], idOf: (t: T) => string, stateOf: (t: T) => CampfireFlameState) {
  const sorted = [...items].sort((a, b) => {
    const byState = STATE_WEIGHT[stateOf(b)] - STATE_WEIGHT[stateOf(a)];
    return byState !== 0 ? byState : idOf(a).localeCompare(idOf(b));
  });
  return sorted.map((item, i) => {
    const slot = SORTED_SLOTS[i % SORTED_SLOTS.length];
    const wrap = Math.floor(i / SORTED_SLOTS.length);
    const jitter = wrap > 0 ? (hashUnit(idOf(item), 31 + wrap) - 0.5) * 16 : 0;
    return {
      item,
      left: Math.min(94, Math.max(6, slot.left + jitter)),
      top: Math.min(92, Math.max(8, slot.top + jitter * 0.6)),
    };
  });
}

// design-mocks/04's sizeFor(): roaring reads big/foreground, steady medium, cold/dead small.
//
// Bigger than the badge sizes these replaced (56/42/32), because a badge FILLS its box and the
// hearth does not: HeatFlame draws into a 120-unit scene where the coal bed spans x=45..89 and the
// tallest lick tops out at y=28, so roughly 45% of the box width and 70% of its height carry any
// art at all. At 56px the fire came out ~25px wide — a smudge. These are picked so the bed reads
// at about the diameter the badge frame used to occupy.
const SIZE_FOR_STATE: Record<CampfireFlameState, number> = { roar: 88, steady: 68, dead: 52 };

// The hearth's own bounds inside HeatFlame's 120-unit scene, as fractions of `size`. The box is
// square but the fire is not: everything below the coal bed's lower edge (y=111) and above the
// tallest roaring lick (y=28) is empty, and laying the node out against the full square would
// hang the campfire's name a third of a box below its fire.
const HEARTH_BOTTOM = 111 / 120;
const HEARTH_BOX = 0.82;

// No live heat/activity data exists for circles you haven't joined (lock_in_sessions' RLS
// scopes visibility to circle-mates only) — member_count is the honest proxy for discovery
// nodes, bucketed into the same three visual sizes.
function stateForMemberCount(count: number): CampfireFlameState {
  if (count >= 15) return 'roar';
  if (count >= 4) return 'steady';
  return 'dead';
}

// THE NODE IS THE CAMPFIRE, AND THE EMOJI IS ITS NAME TAG (#186).
//
// This map has swung between two wrong answers. It drew a bare <HeatFlame> and nothing else, so
// six of your own campfires were six identical fires told apart only by the label underneath;
// mock 168 answered that with <CampfireBadge>, which centres the creator's EMOJI in a lit frame
// and carries heat as an aura around it. That fixed identity and lost the campfire: at cold heat
// the aura is null by design, so a quiet fire rendered as an emoji in a box — Noah's report, in
// one line: "it just shows the icons as emojis and not the actual campfire mock we scoped… the
// icon + emoji should only be an internal identifier."
//
// So the centrepiece goes back to the scoped hearth — mock 110's `.coals`, mock 112's `.coals`,
// the same <HeatFlame> the campfire header and the home carousel wear — and the emoji comes along
// as a CHIP pinned to the bed. Identity without taking the middle.
//
// NOT <CampfireFlameStage>: that component is retired (its own header says so). It animates the
// BRAND SILHOUETTE at three opacities, which is exactly what the coal-bed gauge was built to
// replace — a campfire that has gone cold has to look like dead coals, not like the app's logo
// dimmed. Only its `heatToFlameState` / CampfireFlameState survive, and only for node SIZING.
//
// PHILOI_UI_SPEC.md §10's performance rule ("fully animate only the few roaring fires") is honoured
// by HeatFlame itself: roaring throws sparks, simmering just glows, cold runs three drifting puffs
// and no licks at all — and below 70px it drops the two blur-softened outer licks, which is why the
// dead/steady sizes above stay under that line.
const HEAT_FOR_STATE: Record<CampfireFlameState, number> = { roar: 1, steady: 0.35, dead: 0 };

/**
 * One valley node's art: the campfire itself, with its owner's emoji as a corner identifier.
 *
 * The chip is anchored to the BED rather than to the box corner. HeatFlame's upper third is empty
 * for everything but a roaring fire, so a true top-right chip would float in dead space with
 * nothing to belong to; sitting it on the coals' right shoulder reads as a tag ON the fire.
 */
function ValleyCampfireArt({ emoji, heat, size }: { emoji: string; heat: number; size: number }) {
  const chip = Math.max(15, Math.round(size * 0.3));
  return (
    <View style={{ width: size, height: size * HEARTH_BOX }}>
      {/* Pulled down so the coal bed's lower edge lands on the box's, which is what puts the
          campfire's name directly under its fire instead of a third of a box below it. */}
      <View style={{ position: 'absolute', left: 0, bottom: -(HEARTH_BOTTOM - HEARTH_BOX) * size }}>
        <HeatFlame heat={heat} size={size} />
      </View>
      <View
        style={[
          styles.nodeEmojiChip,
          { width: chip, height: chip, borderRadius: chip / 2, right: -chip * 0.12, bottom: 0 },
        ]}>
        <Text style={{ fontSize: chip * 0.58 }}>{emoji}</Text>
      </View>
    </View>
  );
}

function ValleyNode({
  id,
  name,
  emoji,
  cue,
  state,
  heat,
  gated,
  left,
  top,
  dimmed,
  active,
  onPress,
}: {
  id: string;
  name: string;
  emoji: string;
  cue: string;
  state: CampfireFlameState;
  /** Drives the aura. Real heat for your own fires; the member-count proxy for discovery. */
  heat: number;
  gated: boolean;
  left: number;
  top: number;
  dimmed: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(active ? 1.7 : 1, { duration: 380, easing: Easing.bezier(0.22, 0.61, 0.36, 1) });
  }, [active, scale]);

  useEffect(() => {
    opacity.value = withTiming(dimmed ? 0.15 : 1, { duration: 350 });
  }, [dimmed, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[styles.node, { left: `${left}%`, top: `${top}%`, zIndex: active ? 9 : 2 }, animatedStyle]}
      pointerEvents={dimmed ? 'none' : 'auto'}
      key={id}>
      <Pressable onPress={onPress} style={styles.nodeTouch}>
        <ValleyCampfireArt emoji={emoji} heat={heat} size={SIZE_FOR_STATE[state]} />
        <View style={styles.nodeLabelRow}>
          {gated && <UiGlyph name="lock" size={10} color={Colors.spaceDim} />}
          <Text style={styles.nodeLabel} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text style={styles.nodeCue}>{cue}</Text>
      </Pressable>
    </Animated.View>
  );
}

// "Mine" nodes need their own live "N locked in now" cue — a dedicated component so that hook
// is called unconditionally per real node instance.
function MyFireValleyNode({
  group,
  heat,
  left,
  top,
  dimmed,
  active,
  onPress,
}: {
  group: MyGroup;
  heat: number;
  left: number;
  top: number;
  dimmed: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const activeLockIns = useActiveCircleLockIns(group.id);
  const state = heatToFlameState(heat);
  const cue = activeLockIns.length > 0 ? `${activeLockIns.length} locked in` : state === 'dead' ? 'gone cold' : 'steady';

  return (
    <ValleyNode
      id={group.id}
      name={group.name}
      emoji={group.emoji}
      cue={cue}
      state={state}
      heat={heat}
      gated={false}
      left={left}
      top={top}
      dimmed={dimmed}
      active={active}
      onPress={onPress}
    />
  );
}

type Filter = 'mine' | 'school' | 'classes' | 'popular';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'mine', label: 'My fires' },
  { key: 'school', label: 'My school' },
  { key: 'classes', label: 'Classes' },
  { key: 'popular', label: 'Popular' },
];

export function ValleyPage({ myGroups, heatByGroupId }: { myGroups: MyGroup[]; heatByGroupId: Record<string, number> }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [filter, setFilter] = useState<Filter>('mine');
  const [search, setSearch] = useState('');
  const [discoverable, setDiscoverable] = useState<DiscoverableGroup[]>([]);
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (filter === 'mine') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchDiscoverableGroups(undefined, search, 50);
        if (!cancelled) setDiscoverable(data);
      } catch {
        if (!cancelled) setDiscoverable([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filter, search]);

  // Switching filters repopulates the valley (PHILOI_UI_SPEC.md §10).
  const discoveryPool = useMemo(() => {
    let pool = discoverable;
    if (filter === 'school' && profile?.university) {
      pool = pool.filter((g) => (g.school ?? g.owner_university) === profile.university);
    } else if (filter === 'classes') {
      pool = pool.filter((g) => g.course_code != null);
    } else if (filter === 'popular') {
      pool = [...pool].sort((a, b) => b.member_count - a.member_count);
    }
    return pool;
  }, [filter, discoverable, profile]);

  const mineFiltered = useMemo(
    () => myGroups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [myGroups, search]
  );

  const laidOutMine = useMemo(
    () => layoutValleyNodes(mineFiltered, (g) => g.id, (g) => heatToFlameState(heatByGroupId[g.id] ?? 0)),
    [mineFiltered, heatByGroupId]
  );
  const laidOutDiscovery = useMemo(
    () => layoutValleyNodes(discoveryPool, (g) => g.id, (g) => stateForMemberCount(g.member_count)),
    [discoveryPool]
  );

  return (
    // 'position' behavior (not 'padding') — the discovery search bar (styles.disc) is
    // absolutely positioned at the bottom, which padding-based avoidance can't reach at all
    // (padding only affects normal-flow layout). 'position' shifts this whole wrapped view,
    // absolutely-positioned children included, so the search bar actually clears the keyboard
    // (PHILOI_UI_SPEC.md §4b — "no input should ever sit behind the keyboard").
    //
    // contentContainerStyle IS LOAD-BEARING ON iOS. 'position' wraps the children in an inner View
    // that only takes contentContainerStyle — `style` lands on the outer one. Without flex:1 that
    // inner View is zero-height, so every absolute child is placed against a 0px box: the valley
    // nodes pile up at the top and `disc` (bottom: 0) renders above the screen. Android passes
    // behavior undefined, gets no inner View, and never showed it.
    <KeyboardAvoidingView
      style={styles.valley}
      contentContainerStyle={styles.valley}
      behavior={Platform.OS === 'ios' ? 'position' : undefined}>
      <View style={styles.stage2}>
        {filter === 'mine'
          ? laidOutMine.map(({ item: group, left, top }) => (
              <MyFireValleyNode
                key={group.id}
                group={group}
                heat={heatByGroupId[group.id] ?? 0}
                left={left}
                top={top}
                dimmed={previewGroupId !== null && previewGroupId !== group.id}
                active={previewGroupId === group.id}
                onPress={() => setPreviewGroupId(group.id)}
              />
            ))
          : laidOutDiscovery.map(({ item: group, left, top }) => (
              <ValleyNode
                key={group.id}
                id={group.id}
                name={group.name}
                emoji={group.emoji}
                cue={
                  filter === 'classes' && group.course_code
                    ? `class · ${group.member_count} in`
                    : `${group.member_count} member${group.member_count === 1 ? '' : 's'}`
                }
                state={stateForMemberCount(group.member_count)}
                heat={HEAT_FOR_STATE[stateForMemberCount(group.member_count)]}
                gated={group.privacy === 'gated'}
                left={left}
                top={top}
                dimmed={previewGroupId !== null && previewGroupId !== group.id}
                active={previewGroupId === group.id}
                onPress={() => setPreviewGroupId(group.id)}
              />
            ))}
      </View>

      {/* The discovery dock: a space panel pinned to the bottom of the valley. It sits directly on
          top of the global bottom bar's edge, so it carries a top hairline and no bottom inset. */}
      <View style={styles.disc}>
        <View style={styles.search}>
          <NavGlyph name="search" size={15} color={Colors.spaceDim} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search campfires, courses, schools"
            placeholderTextColor={Colors.spaceFaint}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <SpaceChip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </View>

        {/* Join-by-code and start-your-own share one row now (they were two stacked lines) — the
            short labels are the visible ones; the full sentences live on as accessibility labels. */}
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.codeRow, pressed && styles.pressed]}
            onPress={() => router.push('/join')}
            accessibilityRole="button"
            accessibilityLabel="Have a code? Join a private campfire">
            <SocialGlyph name="key" size={14} color={Colors.spaceDim} />
            <Text style={styles.codeLabel} numberOfLines={1}>
              Have a code?
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.startRow, pressed && styles.pressed]}
            onPress={() => router.push('/group/create')}
            accessibilityRole="button"
            accessibilityLabel="Start a campfire of your own">
            <UiGlyph name="add" size={14} color={Colors.navEmber2} />
            <Text style={styles.startLabel} numberOfLines={1}>
              Start a campfire
            </Text>
          </Pressable>
        </View>
      </View>

      <CampfirePreviewSheet groupId={previewGroupId} onClose={() => setPreviewGroupId(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  valley: {
    flex: 1,
    // Transparent so the root's background shows through on /campfires.
    backgroundColor: 'transparent',
  },
  stage2: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 16,
    // Clears the discovery dock (search + chips + action row).
    bottom: 150,
  },
  node: {
    position: 'absolute',
    alignItems: 'center',
    width: 100,
    marginLeft: -50,
  },
  nodeTouch: {
    alignItems: 'center',
  },
  // The emoji, demoted to an identifier (#186). A disc rather than a bare glyph so it reads as a
  // tag pinned to the fire and keeps its legibility over the bed's own bright coals.
  nodeEmojiChip: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spaceBg,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  nodeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    maxWidth: 100,
  },
  nodeLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.ink,
    flexShrink: 1,
  },
  nodeCue: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.navEmber2,
  },
  disc: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.spaceBg,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
    paddingTop: 12,
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: 12,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13,
    color: Colors.ink,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  codeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 8,
  },
  codeLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  startRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.45)',
    backgroundColor: 'rgba(255,122,47,0.10)',
    borderRadius: Radius.pill,
    paddingVertical: 8,
  },
  startLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  pressed: {
    opacity: 0.85,
  },
});
