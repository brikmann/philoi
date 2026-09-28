import { Redirect, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CosmeticRender, COSMETIC_SURFACES, type CosmeticSurface } from '@/components/economy/cosmetic-render';
import { ItemArt } from '@/components/economy/item-art';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import {
  ITEM_TYPES,
  TYPE_FILTERS,
  itemsOfType,
  titleLabel,
  type CatalogItem,
  type ItemType,
} from '@/lib/economy/catalog';
import { cosmeticEffect } from '@/lib/economy/cosmetic-effect';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// COSMETIC PREVIEW GALLERY — the dev review harness (CODE_ORCHESTRATION_build10, Agent 1 §★).
//
// Renders EVERY cosmetic in the catalog (all 11 types) with its REAL native renderer, grouped by
// type and labelled name + rarity, so the craft is signed off on actual device output rather than
// on a CSS mock. Tap any tile to stage it on its real surface — a profile, the lock-in screen, or a
// group chat — via <CosmeticRender>, the same dispatch the shipped surfaces use.
//
// DEV-GATED like the owns_premium audit tool (task #220): visible only in a dev build (__DEV__) or
// to a dev account (profiles.is_dev). Reached from Settings → Dev tools → "Cosmetic Preview
// Gallery". A user can neither see the entry nor, if they deep-link the route, load the screen.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TYPE_LABEL: Record<ItemType, string> = TYPE_FILTERS.reduce(
  (acc, f) => (f.key === 'ALL' ? acc : { ...acc, [f.key]: f.label }),
  {} as Record<ItemType, string>,
);

function displayName(item: CatalogItem): string {
  return item.type === 'TITLE' ? `"${titleLabel(item).name}"` : item.name;
}

export default function CosmeticGalleryScreen() {
  const { profile } = useAuth();
  const [surface, setSurface] = useState<CosmeticSurface>('art');
  const [selected, setSelected] = useState<CatalogItem>(() => itemsOfType('FLAME')[0]);

  const sections = useMemo(
    () => ITEM_TYPES.map((type) => ({ type, items: itemsOfType(type) })).filter((s) => s.items.length > 0),
    [],
  );

  // Defence in depth: the Settings entry is already gated, but the route is reachable by deep link.
  if (!__DEV__ && !profile?.is_dev) return <Redirect href="/settings" />;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Cosmetic Gallery', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.scroll} stickyHeaderIndices={[0]}>
        {/* Sticky stage + surface switch. */}
        <View style={styles.stageWrap}>
          <View style={styles.surfaceRow}>
            {COSMETIC_SURFACES.map((s) => {
              const on = s.key === surface;
              return (
                <Pressable
                  key={s.key}
                  style={[styles.surfacePill, on && styles.surfacePillOn]}
                  onPress={() => setSurface(s.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}>
                  <Text style={[styles.surfacePillText, on && styles.surfacePillTextOn]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.stage}>
            <CosmeticRender item={selected} surface={surface} />
          </View>

          <Text style={styles.stageName} numberOfLines={1}>
            {displayName(selected)}
          </Text>
          <Text style={[styles.stageMeta, { color: RARITY_COLOR[selected.rarity] }]}>
            {RARITY_LABEL[selected.rarity]} · {TYPE_LABEL[selected.type]}
          </Text>
          <Text style={styles.stageEffect} numberOfLines={2}>
            {cosmeticEffect(selected)}
          </Text>
        </View>

        {sections.map(({ type, items }) => (
          <View key={type} style={styles.section}>
            <Text style={styles.sectionTitle}>
              {TYPE_LABEL[type]} <Text style={styles.sectionCount}>· {items.length}</Text>
            </Text>
            <View style={styles.grid}>
              {items.map((item) => {
                const on = item.id === selected.id;
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.tile, on && styles.tileOn]}
                    onPress={() => setSelected(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName(item)}, ${RARITY_LABEL[item.rarity]} ${TYPE_LABEL[item.type]}`}>
                    <View style={styles.tileArt}>
                      <ItemArt item={item} size={64} motion="off" />
                    </View>
                    <Text style={styles.tileName} numberOfLines={2}>
                      {displayName(item)}
                    </Text>
                    <Text style={[styles.tileRarity, { color: RARITY_COLOR[item.rarity] }]} numberOfLines={1}>
                      {RARITY_LABEL[item.rarity]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const TILE_WIDTH = '31%';

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: Spacing.six,
  },
  stageWrap: {
    backgroundColor: Colors.forgeBg,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardDark,
  },
  surfaceRow: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  surfacePill: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.cardDark,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    alignItems: 'center',
  },
  surfacePillOn: {
    backgroundColor: Colors.ember,
    borderColor: Colors.ember,
  },
  surfacePillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  surfacePillTextOn: {
    color: '#2a1608',
  },
  stage: {
    minHeight: 200,
    justifyContent: 'center',
  },
  stageName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    marginTop: Spacing.two,
  },
  stageMeta: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stageEffect: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: Spacing.one,
  },
  section: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  sectionCount: {
    fontFamily: Fonts.body,
    color: Colors.muted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tile: {
    width: TILE_WIDTH,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.cardDark,
    backgroundColor: Colors.card,
    padding: Spacing.two,
    alignItems: 'center',
  },
  tileOn: {
    borderColor: Colors.ember,
  },
  tileArt: {
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  tileRarity: {
    fontFamily: Fonts.body,
    fontSize: 10,
    marginTop: 2,
  },
});
