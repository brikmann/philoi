import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ItemArt } from '@/components/economy/item-art';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { fetchPublicCollection, setProfileItemHidden } from '@/lib/api/trophy-hall';
import { fetchProfileById } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { TYPE_FILTERS, getItem, type CatalogItem, type ItemType } from '@/lib/economy/catalog';
import { RARITY_COLOR, RARITY_LABEL, RARITY_ORDER, rarityGlow, type Rarity } from '@/lib/economy/rarity';
import type { CollectionItem, PublicCollection } from '@/types/database';

// §7 — the RL-style closet (mock Frame 4).
//
// READ-ONLY, on your own profile as well as anyone else's. Editing and equipping stay in the
// inventory behind the ⚙ menu; this is the showcase. Splitting them that way is what let §1 delete
// the "Inventory & loadout" row from the profile without losing the ability to SEE a collection —
// and it is the only reason this screen can point at another person at all.
//
// Grouped by type, rarity-sorted inside each group, the equipped tile ringed. No separate
// "equipped" strip above the grid: the ring already says which one it is, and a second copy of the
// same tiles is the kind of duplication §1 was cutting.

/** Group order — the catalog's own, minus the ALL pseudo-filter. One list, so it can't drift. */
const GROUPS = TYPE_FILTERS.filter((f) => f.key !== 'ALL') as { key: ItemType; label: string }[];

type Tile = CollectionItem & { item: CatalogItem; rarity: Rarity; equipped: boolean };

export default function CollectionScreen() {
  const router = useRouter();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const { profile: myProfile } = useAuth();

  const userId = userIdParam ?? myProfile?.id;
  const isOwn = !!userId && userId === myProfile?.id;

  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
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
    return () => {
      current = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || isOwn) return;
    fetchProfileById(userId)
      .then((p) => setOwnerName(p.display_name))
      .catch(() => {});
  }, [userId, isOwn]);

  useEffect(() => {
    if (collection) track('collection_viewed', { own: collection.is_owner, items: collection.items.length });
  }, [collection]);

  // key -> true for anything in a slot. Built once so no tile has to scan the loadout.
  const equippedKeys = useMemo(
    () => new Set(Object.values(collection?.loadout ?? {})),
    [collection]
  );

  const grouped = useMemo(() => {
    if (!collection) return [];
    const byType = new Map<ItemType, Tile[]>();
    for (const row of collection.items) {
      const item = getItem(row.key);
      // An owned key this build has no catalog entry for — granted by a newer server. Dropped
      // rather than drawn blank, same as the inventory does.
      if (!item) continue;
      const rarity = (row.rarity_override as Rarity | null) ?? item.rarity;
      const tile: Tile = { ...row, item, rarity, equipped: equippedKeys.has(row.key) };
      byType.set(item.type, [...(byType.get(item.type) ?? []), tile]);
    }
    return GROUPS.flatMap((g) => {
      const tiles = byType.get(g.key);
      if (!tiles || tiles.length === 0) return [];
      // Rarity-sorted (Mythic → Common); the equipped one floats to the front of its rarity so the
      // ring is easy to find in a long group.
      const sorted = [...tiles].sort(
        (a, b) =>
          RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] ||
          Number(b.equipped) - Number(a.equipped) ||
          a.item.name.localeCompare(b.item.name)
      );
      return [{ ...g, tiles: sorted }];
    });
  }, [collection, equippedKeys]);

  async function toggleHidden(tile: Tile) {
    if (!collection?.is_owner || !userId) return;
    await setProfileItemHidden('cosmetic', tile.key, !tile.hidden);
    setCollection(await fetchPublicCollection(userId));
  }

  function openItem(tile: Tile) {
    const lines = [RARITY_LABEL[tile.rarity], tile.item.lore];
    if (tile.season_stamp) lines.splice(1, 0, tile.season_stamp);
    if (collection?.is_owner) {
      Alert.alert(tile.item.name, lines.join('\n\n'), [
        { text: tile.hidden ? 'Show to visitors' : 'Hide from visitors', onPress: () => void toggleHidden(tile) },
        { text: 'Done', style: 'cancel' },
      ]);
    } else {
      Alert.alert(tile.item.name, lines.join('\n\n'));
    }
  }

  const title = isOwn ? 'Your Collection' : ownerName ? `${ownerName.split(' ')[0]}'s Collection` : 'Collection';

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.muted} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.topSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.container}>
          {error ? <Text style={styles.empty}>Couldn&rsquo;t load this collection.</Text> : null}

          {collection && grouped.length === 0 && !error ? (
            <Text style={styles.empty}>
              {isOwn
                ? 'Nothing collected yet. Open a box or finish a season and it lands here.'
                : 'Nothing to show here yet.'}
            </Text>
          ) : null}

          {grouped.map((group) => (
            <View key={group.key}>
              <View style={styles.groupHead}>
                <Text style={styles.groupLabel}>
                  {group.label.toUpperCase()}
                  {group.key === 'RELIC' || group.key === 'MEDAL' ? (
                    <Text style={styles.groupEarned}> · earned</Text>
                  ) : null}
                </Text>
                <Text style={styles.groupCount}>{group.tiles.length} owned</Text>
              </View>
              <View style={styles.grid}>
                {group.tiles.map((tile) => (
                  <ItemTile key={tile.key} tile={tile} onPress={() => openItem(tile)} />
                ))}
              </View>
            </View>
          ))}

          {/* Visitors see the size of the gap, never what fills it. */}
          {collection && !collection.is_owner && collection.hidden_count > 0 ? (
            <Text style={styles.hiddenNote}>🔒 {collection.hidden_count} hidden by owner</Text>
          ) : null}

          {grouped.length > 0 ? (
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

function ItemTile({ tile, onPress }: { tile: Tile; onPress: () => void }) {
  const colour = RARITY_COLOR[tile.rarity];
  return (
    <Pressable
      style={[
        styles.tile,
        { borderColor: colour + '8c' },
        tile.equipped && styles.tileEquipped,
        tile.hidden && styles.tileHidden,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${tile.item.name}, ${RARITY_LABEL[tile.rarity]}${tile.equipped ? ', equipped' : ''}`}>
      <View style={[styles.tileGlow, { backgroundColor: rarityGlow(tile.rarity, 0.16) }]} />
      <ItemArt item={tile.item} size={32} />
      {tile.equipped ? (
        <View style={styles.equippedTag}>
          <Text style={styles.equippedText}>EQUIPPED</Text>
        </View>
      ) : null}
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
    gap: 8,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  topSpacer: {
    width: 22,
  },
  container: {
    padding: Spacing.four,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.six,
    gap: Spacing.twelve,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 19,
  },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  groupLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.muted,
  },
  groupEarned: {
    fontFamily: Fonts.body,
    color: Colors.textTertiary,
  },
  groupCount: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    color: Colors.textTertiary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Four across, matching the mock's igrid. The gap is subtracted per row so tiles stay square.
  tile: {
    width: '22.5%',
    aspectRatio: 1,
    borderRadius: Radius.card,
    borderWidth: 1,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // The ring IS the equipped marker (§7) — no separate strip above the grid.
  tileEquipped: {
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  tileHidden: {
    opacity: 0.45,
  },
  equippedTag: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.amber,
    paddingVertical: 1,
    alignItems: 'center',
  },
  equippedText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 6.5,
    letterSpacing: 0.3,
    color: Colors.onEmber,
  },
  hiddenMark: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: 9,
  },
  hiddenNote: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16,
  },
});
