import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BurningName } from '@/components/burning-name';
import { EquippedAvatarHalo } from '@/components/economy/applied-art';
import { ItemArt } from '@/components/economy/item-art';
import { PublicTitle } from '@/components/economy/loadout-bits';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePublicLoadout } from '@/hooks/use-public-loadouts';
import { useTrophyHall } from '@/hooks/use-trophy-hall';
import { track } from '@/lib/analytics';
import { fetchUserBoardPosition } from '@/lib/api/leaderboard-social';
import { fetchProfileById, fetchUserRank, type UserRank } from '@/lib/api/profile';
import { fetchPublicCollection, setProfileItemHidden } from '@/lib/api/trophy-hall';
import { useAuth } from '@/lib/auth/auth-context';
import { getItem, type CatalogItem, type EquipSlot } from '@/lib/economy/catalog';
import { RARITIES, RARITY_COLOR, RARITY_LABEL, RARITY_ORDER, rarityGlow, type Rarity } from '@/lib/economy/rarity';
import { ladderEarnMetric } from '@/lib/economy/relic-ladders';
import { formatRankTier, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { CollectionItem, Profile, PublicCollection } from '@/types/database';

// §7 — someone's collection, premium (mock 264, punchlist #12).
//
// READ-ONLY, on your own profile as well as anyone else's. Editing and equipping stay in the
// inventory behind the ⚙ menu; this is the showcase. The one owner-only affordance is hiding an item
// from visitors — it changes what others see, never what you own or wear.
//
// Identity first, then the gear: a centred hero (their halo round the person, the burning name, the
// title, rank + uni pills, a stat line), the EQUIPPED strip, and every owned item in one grid sorted
// rarest first. The grid is not grouped by type any more — the old per-type shelves read as a list,
// and "what's the rarest thing they have" is the question a visitor actually opens this to answer.
//
// Rarity dots use RARITY_COLOR, not the mock's own hexes — the mock's palette is a sketch of the same
// six tiers, and a second palette is exactly how the shop and this screen would drift apart.

/** The equipped strip's order — what reads as "their look" first, sound last. */
const SLOT_ORDER: EquipSlot[] = ['flame', 'halo', 'card', 'flare', 'particle', 'banner', 'title', 'audio', 'sfx_start', 'sfx_stop'];

/** Rarest first — the grid's sort and the legend's order. */
const RARITIES_DESC = [...RARITIES].reverse();

const GUTTER = Spacing.three;
const GRID_GAP = 9;

type Tile = CollectionItem & { item: CatalogItem; rarity: Rarity; equipped: boolean };

function tileRarity(row: Pick<CollectionItem, 'rarity_override'> | undefined, item: CatalogItem): Rarity {
  return (row?.rarity_override as Rarity | null | undefined) ?? item.rarity;
}

export default function CollectionScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const { profile: myProfile } = useAuth();

  const userId = userIdParam ?? myProfile?.id;

  const loadout = usePublicLoadout(userId);
  const hall = useTrophyHall(userId);
  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [rank, setRank] = useState<UserRank | null>(null);
  const [boardPosition, setBoardPosition] = useState<{ board: 'My uni' | 'Global'; rank: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let current = true;
    fetchPublicCollection(userId)
      .then((c) => {
        if (current) setCollection(c);
      })
      .catch(() => {
        if (current) setError(true);
      });
    // The hero's reads are each optional: a missing rank or uni seat drops its pill/stat, never the
    // screen.
    fetchProfileById(userId)
      .then((p) => {
        if (current) setOwner(p);
      })
      .catch(() => {});
    fetchUserRank(userId)
      .then((r) => {
        if (current) setRank(r);
      })
      .catch(() => {});
    fetchUserBoardPosition(userId)
      .then((b) => {
        if (current) setBoardPosition(b);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [userId]);

  useEffect(() => {
    if (collection) track('collection_viewed', { own: collection.is_owner, items: collection.items.length });
  }, [collection]);

  const { tiles, equipped } = useMemo(() => {
    if (!collection) return { tiles: [] as Tile[], equipped: [] as Tile[] };
    const equippedKeys = new Set(Object.values(collection.loadout ?? {}));
    const rows = new Map(collection.items.map((r) => [r.key, r]));

    const all: Tile[] = [];
    for (const row of collection.items) {
      const item = getItem(row.key);
      // An owned key this build has no catalog entry for — granted by a newer server. Dropped
      // rather than drawn blank, same as the inventory does.
      if (!item) continue;
      all.push({ ...row, item, rarity: tileRarity(row, item), equipped: equippedKeys.has(row.key) });
    }
    all.sort(
      (a, b) =>
        RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] ||
        Number(b.equipped) - Number(a.equipped) ||
        a.item.name.localeCompare(b.item.name)
    );

    // One tile per equipped KEY: the same SFX in both its slots is one item, shown once. A slot whose
    // key isn't in the visible items (a free default, or hidden from visitors) still shows — what
    // someone is wearing is public on every other surface already.
    const seen = new Set<string>();
    const worn: Tile[] = [];
    for (const slot of SLOT_ORDER) {
      const key = collection.loadout?.[slot];
      if (!key || seen.has(key)) continue;
      const item = getItem(key);
      if (!item) continue;
      seen.add(key);
      const row = rows.get(key);
      worn.push({
        key,
        rarity_override: row?.rarity_override ?? null,
        season_stamp: row?.season_stamp ?? null,
        acquired_at: row?.acquired_at ?? '',
        hidden: row?.hidden ?? false,
        item,
        rarity: tileRarity(row, item),
        equipped: true,
      });
    }
    return { tiles: all, equipped: worn };
  }, [collection]);

  async function toggleHidden(tile: Tile) {
    if (!collection?.is_owner || !userId) return;
    await setProfileItemHidden('cosmetic', tile.key, !tile.hidden);
    setCollection(await fetchPublicCollection(userId));
  }

  function openItem(tile: Tile) {
    const lines = [RARITY_LABEL[tile.rarity], tile.item.lore];
    if (tile.season_stamp) lines.splice(1, 0, tile.season_stamp);
    // A discipline relic's rarity IS its rung (§4a-2), so the closet can name what the rung cost
    // without fetching relic_progress — see ladderEarnMetric. Null for everything else.
    const earnedBy = ladderEarnMetric(tile.key, tile.rarity);
    if (earnedBy) lines.push(earnedBy);
    if (collection?.is_owner && tiles.some((t) => t.key === tile.key)) {
      Alert.alert(tile.item.name, lines.join('\n\n'), [
        { text: tile.hidden ? 'Show to visitors' : 'Hide from visitors', onPress: () => void toggleHidden(tile) },
        { text: 'Done', style: 'cancel' },
      ]);
    } else {
      Alert.alert(tile.item.name, lines.join('\n\n'));
    }
  }

  const name = owner?.display_name ?? '';
  const mythicCount = tiles.filter((t) => t.rarity === 'mythic').length;
  // Earned trophies only — an in-progress ladder rides in hall.relics but is not a trophy yet.
  const trophyCount = hall ? hall.relics.filter((r) => !r.in_progress).length + hall.badges.length : null;
  const tileSize = Math.floor((width - GUTTER * 2 - GRID_GAP * 2) / 3);

  const stats: { value: string; label: string }[] = [];
  if (collection) {
    stats.push({ value: String(tiles.length), label: 'ITEMS' });
    stats.push({ value: String(mythicCount), label: 'MYTHIC' });
  }
  if (trophyCount !== null) stats.push({ value: String(trophyCount), label: 'TROPHIES' });
  if (boardPosition) {
    stats.push({
      value: `#${boardPosition.rank.toLocaleString()}`,
      label: boardPosition.board === 'My uni' ? 'MY UNI' : 'GLOBAL',
    });
  }

  const metal = rank && !rank.muted ? RANK_TIER_METAL[rank.tier] : null;

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.top}>
          <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={18} color={Colors.muted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.container}>
          {/* ── HERO ── */}
          <View style={styles.hero}>
            <View>
              <EquippedAvatarHalo haloId={loadout.halo?.id} size={88}>
                {owner?.avatar_url ? (
                  <Image source={{ uri: owner.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={styles.disc}>
                    <Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </EquippedAvatarHalo>
              {/* Their flame rides the avatar as a badge — the avatar stays the PERSON (mock 248). */}
              {loadout.flame ? (
                <View style={styles.flameBadge} pointerEvents="none">
                  <ItemArt item={loadout.flame} size={26} motion="off" />
                </View>
              ) : null}
            </View>

            {name ? (
              <BurningName userId={userId} style={styles.name} hero>
                {name}
              </BurningName>
            ) : null}
            <View style={styles.title}>
              <PublicTitle loadout={loadout} />
            </View>

            {metal || owner?.university ? (
              <View style={styles.meta}>
                {metal && rank && !rank.muted ? (
                  <View style={[styles.rankPill, { backgroundColor: metal.inner, borderColor: metal.outer }]}>
                    <Text style={[styles.rankPillText, { color: metal.numeral }]}>
                      ◆ {formatRankTier(rank.tier, rank.division).toUpperCase()}
                    </Text>
                  </View>
                ) : null}
                {owner?.university ? (
                  <View style={styles.uniPill}>
                    <Text style={styles.uniPillText} numberOfLines={1}>
                      {owner.university}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {stats.length > 0 ? (
              <View style={styles.statLine}>
                {stats.map((s) => (
                  <View key={s.label} style={styles.stat}>
                    <Text style={styles.statValue}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {error ? <Text style={styles.empty}>Couldn&rsquo;t load this collection.</Text> : null}

          {/* ── EQUIPPED ── */}
          {equipped.length > 0 ? (
            <View>
              <Text style={styles.sectionHead}>EQUIPPED</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.loadRow}>
                {equipped.map((tile) => (
                  <Pressable
                    key={tile.key}
                    style={styles.slot}
                    onPress={() => openItem(tile)}
                    accessibilityRole="button"
                    accessibilityLabel={`${tile.item.name}, ${RARITY_LABEL[tile.rarity]}, equipped`}>
                    <View
                      style={[
                        styles.slotArt,
                        { borderColor: RARITY_COLOR[tile.rarity] + '66', shadowColor: RARITY_COLOR[tile.rarity] },
                      ]}>
                      <View style={[styles.tileGlow, { backgroundColor: rarityGlow(tile.rarity, 0.14) }]} />
                      <ItemArt item={tile.item} size={36} />
                      <View style={[styles.dot, { backgroundColor: RARITY_COLOR[tile.rarity] }]} />
                    </View>
                    <Text style={styles.slotLabel} numberOfLines={1}>
                      {tile.item.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* ── COLLECTION ── */}
          {collection && tiles.length === 0 && !error ? (
            <Text style={styles.empty}>
              {collection.is_owner
                ? 'Nothing collected yet. Open a box or finish a season and it lands here.'
                : 'Nothing to show here yet.'}
            </Text>
          ) : null}

          {tiles.length > 0 ? (
            <View>
              <Text style={styles.sectionHead}>COLLECTION · RAREST FIRST</Text>
              <View style={styles.grid}>
                {tiles.map((tile) => (
                  <ItemTile key={tile.key} tile={tile} size={tileSize} onPress={() => openItem(tile)} />
                ))}
              </View>

              <View style={styles.legend}>
                {RARITIES_DESC.map((r) => (
                  <View key={r} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: RARITY_COLOR[r] }]} />
                    <Text style={styles.legendText}>{RARITY_LABEL[r].charAt(0) + RARITY_LABEL[r].slice(1).toLowerCase()}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Visitors see the size of the gap, never what fills it. */}
          {collection && !collection.is_owner && collection.hidden_count > 0 ? (
            <Text style={styles.hiddenNote}>🔒 {collection.hidden_count} hidden by owner</Text>
          ) : null}

          {tiles.length > 0 ? (
            <Text style={styles.hint}>
              {collection?.is_owner
                ? 'Tap an item for its lore, or to hide it from visitors. Equipping stays in your inventory.'
                : 'Tap an item for its name, rarity and lore.'}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

function ItemTile({ tile, size, onPress }: { tile: Tile; size: number; onPress: () => void }) {
  const colour = RARITY_COLOR[tile.rarity];
  return (
    <Pressable
      style={[
        styles.tile,
        { width: size, height: size, borderColor: tile.equipped ? Colors.amber : colour + '55' },
        tile.equipped && styles.tileEquipped,
        tile.hidden && styles.tileHidden,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${tile.item.name}, ${RARITY_LABEL[tile.rarity]}${tile.equipped ? ', equipped' : ''}`}>
      <View style={[styles.tileGlow, { backgroundColor: rarityGlow(tile.rarity, 0.1) }]} />
      <ItemArt item={tile.item} size={Math.round(size * 0.34)} />
      <Text style={styles.tileName} numberOfLines={2}>
        {tile.item.name}
      </Text>
      <View style={[styles.dot, { backgroundColor: colour }]} />
      {tile.hidden ? <Text style={styles.hiddenMark}>🔒</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.one,
  },
  back: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  hero: {
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.two,
  },
  disc: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: Fonts.display,
    fontSize: 36,
    color: Colors.ember,
  },
  flameBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    marginTop: Spacing.twelve,
    fontFamily: Fonts.bodyBold,
    fontSize: 25,
    color: Colors.ink,
    textAlign: 'center',
  },
  title: {
    marginTop: 2,
    alignItems: 'center',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    maxWidth: '100%',
  },
  rankPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  rankPillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  uniPill: {
    flexShrink: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.cardDark,
  },
  uniPillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.muted,
  },
  statLine: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 22,
    marginTop: Spacing.three,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  statLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    color: Colors.muted,
  },
  sectionHead: {
    paddingHorizontal: GUTTER,
    paddingBottom: 7,
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: Colors.muted,
  },
  loadRow: {
    paddingHorizontal: GUTTER - 2,
    gap: 9,
  },
  slot: {
    width: 72,
    alignItems: 'center',
  },
  slotArt: {
    width: 72,
    height: 72,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  slotLabel: {
    marginTop: 4,
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.muted,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GUTTER,
  },
  tile: {
    borderRadius: Radius.card,
    borderWidth: 1.5,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  tileGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  tileEquipped: {
    borderWidth: 2,
  },
  tileHidden: {
    opacity: 0.45,
  },
  tileName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    lineHeight: 11,
    color: Colors.ink,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hiddenMark: {
    position: 'absolute',
    top: 4,
    left: 5,
    fontSize: 9,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: GUTTER,
    paddingTop: Spacing.twelve,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  empty: {
    paddingHorizontal: GUTTER,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 19,
  },
  hiddenNote: {
    paddingHorizontal: GUTTER,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  hint: {
    paddingHorizontal: GUTTER,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16,
  },
});
