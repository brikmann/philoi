import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuraTier } from '@/components/economy/applied-art';
import { CosmeticContextPair } from '@/components/economy/cosmetic-in-context';
import { EmberPill, RarityLabel } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { EquippedTitle } from '@/components/economy/loadout-bits';
import { ProfileHero } from '@/components/economy/profile-hero';
import { EmberBands, SeasonChip, isSeasonItem } from '@/components/economy/season-chip';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory, type OwnedItem } from '@/hooks/use-inventory';
import { equipCosmetic } from '@/lib/api/inventory';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';
import {
  CAMPFIRE_FINISHER_TITLE,
  isCampfireFinisherKey,
  itemsOfType,
  titleLabel,
  type CatalogItem,
  type ItemType,
} from '@/lib/economy/catalog';
import { passUnlockLevel } from '@/lib/economy/forge-pass';
import { useLoadout } from '@/lib/economy/loadout';
import { RARITY_COLOR, RARITY_ORDER } from '@/lib/economy/rarity';
import { getErrorMessage } from '@/lib/errors';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LOADOUT — browse & equip (mock 250). The hub the inventory links into.
//
//   • Live preview up top — ProfileHero, the profile's own composite, wearing the signed-in user's
//     loadout store. An equip below awaits the inventory refetch, which pushes into that store, so
//     the preview AND the profile tab re-render off the same write. There is no second copy of
//     "what you're wearing" here to fall out of step.
//   • Slot tabs — Flame · Card · Halo · Particle · Flare · Title · Banner · Audio. SFX folds into
//     Audio (mock 250's note): both are things you hear.
//   • Owned grid — rarity-bordered; the equipped one ringed and badged "Equipped". Tap to equip.
//   • Locked items — the rest of the live catalog for that slot, greyed, each saying how to get it
//     (Flame Pass level, box drop, or the earn condition). A browsable "here's what's next".
//
// The flame is shown BESIDE the identity, never as the avatar: the avatar is the person (mock 248).
// ══════════════════════════════════════════════════════════════════════════════════════════════

type SlotTab = { key: string; label: string; glyph: keyof typeof Ionicons.glyphMap; types: ItemType[] };

const TABS: SlotTab[] = [
  { key: 'flame', label: 'Flame', glyph: 'flame', types: ['FLAME'] },
  { key: 'card', label: 'Card', glyph: 'albums-outline', types: ['CARD'] },
  { key: 'halo', label: 'Halo', glyph: 'ellipse-outline', types: ['HALO'] },
  { key: 'particle', label: 'Particle', glyph: 'sparkles-outline', types: ['PARTICLE'] },
  { key: 'flare', label: 'Flare', glyph: 'scan-outline', types: ['FLARE'] },
  { key: 'title', label: 'Title', glyph: 'text-outline', types: ['TITLE'] },
  { key: 'banner', label: 'Banner', glyph: 'flag-outline', types: ['BANNER'] },
  { key: 'audio', label: 'Audio', glyph: 'musical-notes-outline', types: ['AUDIO', 'SFX'] },
];

/** A tile in the grid: an owned item (equippable), or a catalog item you don't have yet. */
type Tile = { kind: 'owned'; item: OwnedItem } | { kind: 'locked'; item: CatalogItem };

/**
 * How to get a locked item, short enough for a tile. The catalog's own `howToGet` wins — it is the
 * sentence that describes what the SERVER grants on — and the acquisition route covers the rest.
 */
function howToGet(item: CatalogItem): string {
  if (item.howToGet) return item.howToGet;
  switch (item.acquisition) {
    case 'forge-pass-S1': {
      const level = passUnlockLevel(item.id);
      if (level === 0) return 'Flame Pass · instant';
      return level ? `Flame Pass Lv ${level}` : 'Flame Pass';
    }
    case 'box':
      return 'Box drop';
    case 'earned':
      return 'Earned by standing';
    case 'default':
      return 'Starter set';
  }
}

export default function LoadoutScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { owned, embers, loading, refetch } = useInventory();
  const loadout = useLoadout();
  const { session: activeSession } = useActiveSession();
  const auraTier = useAuraTier(activeSession);
  const [tab, setTab] = useState<SlotTab>(TABS[0]);
  // The id mid-equip. One at a time: a second tap while the first is in flight would race two
  // equips into one slot, and whichever lands last would win silently.
  const [pending, setPending] = useState<string | null>(null);

  const tiles = useMemo<Tile[]>(() => {
    const mine = owned.filter((o) => tab.types.includes(o.type));
    const ownedIds = new Set(mine.map((o) => o.id));
    // A campfire finisher is owned as `<template>:<challenge>`, so the bare template never matches
    // an owned id. Once you hold any finisher, the template is not something you're missing.
    const ownsFinisher = mine.some((o) => isCampfireFinisherKey(o.id));

    const ownedTiles: Tile[] = [...mine]
      .sort((a, b) => Number(b.equipped) - Number(a.equipped) || RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity])
      .map((item) => ({ kind: 'owned', item }));
    const lockedTiles: Tile[] = tab.types
      .flatMap((t) => itemsOfType(t))
      .filter((i) => !ownedIds.has(i.id) && !(ownsFinisher && i.id === CAMPFIRE_FINISHER_TITLE))
      // Nearest-first: what you could plausibly get next leads, the mythic chase closes the grid.
      .sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity])
      .map((item) => ({ kind: 'locked', item }));
    return [...ownedTiles, ...lockedTiles];
  }, [owned, tab]);

  const ownedCount = tiles.filter((t) => t.kind === 'owned').length;
  // Owned tiles sort equipped-first, so this is the tab's equipped piece when there is one.
  const equippedHere = tiles.find((t) => t.kind === 'owned' && t.item.equipped)?.item;

  async function equip(item: OwnedItem) {
    if (pending) return;
    setPending(item.id);
    try {
      await equipCosmetic(item);
      // Feeds the loadout store (use-inventory) — which is what the preview above and the profile
      // tab both render from. That one write IS "the preview and the profile update together".
      await refetch();
    } catch (e) {
      Alert.alert("Couldn't equip that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setPending(null);
    }
  }

  function onTile(t: Tile) {
    if (t.kind === 'locked') {
      Alert.alert(displayName(t.item), `${howToGet(t.item)}\n\n${t.item.lore}`);
      return;
    }
    // An SFX picks Start / End / Both, and the equipped item's Unequip lives on its detail screen —
    // a bare tap here must never silently pick a slot or empty one.
    if (t.item.type === 'SFX' || t.item.equipped) {
      router.push({ pathname: '/inventory/[itemId]', params: { itemId: t.item.id } });
      return;
    }
    void equip(t.item);
  }

  const flame = loadout.flame;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.ink} />
          </Pressable>
          <Text style={styles.title}>Loadout</Text>
          <EmberPill embers={embers} />
        </View>

        {/* ── Live preview ── */}
        <ProfileHero
          userId={profile?.id}
          name={profile?.display_name ?? 'You'}
          avatarUrl={profile?.avatar_url}
          loadout={loadout}
          avatarSize={56}
          auraTier={auraTier}
          title={loadout.title ? <EquippedTitle /> : <Text style={styles.noTitle}>No title equipped</Text>}
          trailing={
            flame ? (
              <View style={styles.flame} accessibilityLabel={`Flame: ${flame.name}`}>
                <ItemArt item={flame} size={34} />
              </View>
            ) : null
          }>
          <Text style={styles.previewMeta}>Live preview — updates as you equip</Text>
        </ProfileHero>

        {/* ── Slot tabs ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map((t) => {
            const on = t.key === tab.key;
            return (
              <Pressable
                key={t.key}
                style={[styles.tab, on && styles.tabOn]}
                onPress={() => setTab(t)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}>
                {on ? <EmberBands /> : null}
                <Ionicons name={t.glyph} size={13} color={on ? INK_ON_EMBER : Colors.muted} />
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.shead}>
          <Text style={styles.sheadL}>
            {tab.label} · {ownedCount} owned
          </Text>
          <Text style={styles.sheadR}>tap to equip</Text>
        </View>

        {loading && owned.length === 0 ? <ActivityIndicator color={Colors.ember} style={styles.spinner} /> : null}

        <View style={styles.grid}>
          {tiles.map((t) => (
            <LoadoutTile key={`${t.kind}:${t.item.id}`} tile={t} pending={pending === t.item.id} onPress={() => onTile(t)} />
          ))}
        </View>

        {/* Below the grid, so picking stays at the top: the equipped piece on its real surfaces. */}
        {equippedHere ? <CosmeticContextPair item={equippedHere} /> : null}

        <Pressable style={styles.invLink} onPress={() => router.push('/inventory')} accessibilityRole="button">
          <Text style={styles.invLinkText}>Open full inventory</Text>
          <Ionicons name="chevron-forward" size={13} color={Colors.muted} />
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function displayName(item: CatalogItem & { seasonStamp?: string | null }): string {
  return item.labelIsStamp || item.type === 'TITLE' ? titleLabel(item).name : item.name;
}

function LoadoutTile({ tile, pending, onPress }: { tile: Tile; pending: boolean; onPress: () => void }) {
  const { item } = tile;
  const locked = tile.kind === 'locked';
  const equipped = tile.kind === 'owned' && tile.item.equipped;
  const colour = RARITY_COLOR[item.rarity];

  return (
    <Pressable
      style={[styles.tile, { borderColor: colour + '66' }, equipped && styles.tileEquipped]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: equipped, disabled: locked }}
      accessibilityLabel={`${displayName(item)}${equipped ? ', equipped' : locked ? `, locked. ${howToGet(item)}` : ''}`}>
      {equipped ? (
        <View style={styles.equippedBadge}>
          <EmberBands />
          <Text style={styles.equippedBadgeText}>✓ Equipped</Text>
        </View>
      ) : null}
      {locked ? <Ionicons name="lock-closed" size={10} color={Colors.textTertiary} style={styles.lock} /> : null}

      {/* Greyed rather than hidden: the art still says what you'd be getting. */}
      <View style={[styles.art, locked && styles.artLocked]}>
        {pending ? <ActivityIndicator color={Colors.ember} /> : <ItemArt item={item} size={38} />}
      </View>
      <Text style={[styles.name, locked && styles.nameLocked]} numberOfLines={1}>
        {displayName(item)}
      </Text>
      {locked ? (
        <Text style={styles.hint} numberOfLines={2}>
          {howToGet(item)}
        </Text>
      ) : (
        <View style={styles.tags}>
          <RarityLabel rarity={item.rarity} size={7} />
          {isSeasonItem(item) ? <SeasonChip size="xs" /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** Mock 250's ink on the ember ramp. */
const INK_ON_EMBER = '#1a1020';

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.twelve,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
    flex: 1,
  },
  noTitle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  previewMeta: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
    marginTop: 4,
  },
  flame: {
    paddingTop: 2,
  },
  tabs: {
    gap: 7,
    paddingTop: Spacing.three + 2,
    paddingBottom: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#2a2140',
    backgroundColor: '#1b1430',
    overflow: 'hidden',
  },
  tabOn: {
    borderColor: 'transparent',
  },
  tabText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  tabTextOn: {
    color: INK_ON_EMBER,
  },
  shead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.two,
  },
  sheadL: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  sheadR: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  spinner: {
    marginVertical: Spacing.four,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '31.5%',
    aspectRatio: 0.86,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#18112b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 3,
    overflow: 'hidden',
  },
  // Mock 250's `.it.sel` — the ember ring. A thicker border in the ramp's orange rather than a
  // shadow, which Android would draw grey.
  tileEquipped: {
    borderWidth: 2,
    borderColor: '#FF8A2C',
    backgroundColor: '#22152a',
  },
  equippedBadge: {
    position: 'absolute',
    top: 5,
    alignSelf: 'center',
    borderRadius: Radius.pill,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    zIndex: 2,
  },
  equippedBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    color: INK_ON_EMBER,
  },
  lock: {
    position: 'absolute',
    top: 7,
    right: 8,
  },
  art: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artLocked: {
    opacity: 0.4,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  nameLocked: {
    color: Colors.muted,
  },
  tags: {
    alignItems: 'center',
    gap: 3,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 7.5,
    lineHeight: 10,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  invLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: Spacing.four,
  },
  invLinkText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
});
