import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberPill, RarityLabel, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { PurchaseSheet } from '@/components/economy/purchase-sheet';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useStopPreviewOnLeave } from '@/hooks/use-audio-preview';
import { useInventory } from '@/hooks/use-inventory';
import { buyCosmetic, equipCosmetic } from '@/lib/api/inventory';
import { getItem, SLOT_LABEL } from '@/lib/economy/catalog';
import { getErrorMessage } from '@/lib/errors';
import { DIRECT_BUY_PRICE, SALVAGE_EMBERS, rarityGlow } from '@/lib/economy/rarity';

// Direct-buy detail (§8.4). The deterministic path: pay more than the box costs and skip the RNG.
// The price is always above the item's own salvage value, so buy→sell can never be an arbitrage.

export default function ShopItemScreen() {
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { embers, ownedKeys, refetch } = useInventory();
  const [busy, setBusy] = useState(false);
  const [bought, setBought] = useState(false);
  const [equipping, setEquipping] = useState(false);
  useStopPreviewOnLeave(itemId);

  const found = getItem(itemId ?? '');
  if (!found) {
    return (
      <Screen>
        <Text style={styles.missing}>That item doesn&apos;t exist.</Text>
      </Screen>
    );
  }
  // Narrowed into a const so `buy()` closes over a non-nullable item.
  const item = found;

  const price = DIRECT_BUY_PRICE[item.rarity];
  const owned = ownedKeys.has(item.id);
  // Prestige is not for sale — earned and Pass-exclusive items never reach this screen from the
  // Featured row, but a deep link could, so the gate is enforced here too.
  const purchasable = item.acquisition === 'box';
  const canAfford = embers >= price;

  // The refetch is what makes the buy visible: `buyCosmetic` mutates server-side only, so without
  // pulling get_inventory again the ember balance in the header, this screen's own "You already
  // own this" state, and the Owned grid all keep showing pre-purchase truth until a cold reload
  // (punchlist 8 §3). Awaited BEFORE the sheet opens so what it says is already true.
  async function buy() {
    setBusy(true);
    try {
      await buyCosmetic(item);
      await refetch();
      setBought(true);
    } catch (e) {
      Alert.alert("Couldn't buy that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function equipJustBought() {
    if (!item.slot) return;
    setEquipping(true);
    try {
      await equipCosmetic(item);
      await refetch();
      setBought(false);
      router.replace('/inventory');
    } catch (e) {
      Alert.alert("Couldn't equip that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setEquipping(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.ink} />
          </Pressable>
          <View style={styles.flex} />
          <EmberPill embers={embers} />
        </View>

        <View style={styles.hero}>
          <View style={[styles.glow, { backgroundColor: rarityGlow(item.rarity, 0.5) }]} />
          <ItemArt item={item} size={120} />
        </View>

        {/* Audition before paying (PUNCHLIST_11). This matters most HERE of the three spots: an
            audio cosmetic's art is decorative, so without a preview the buy decision is made on a
            name and one line of lore. Renders nothing when the item has no clip. */}
        <View style={styles.previewRow}>
          <PreviewButton item={item} />
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{item.name}</Text>
          <RarityLabel rarity={item.rarity} type={item.type} size={10} />
          <Text style={styles.lore}>{item.lore}</Text>
          {item.slot ? <Text style={styles.slot}>Equips to your {SLOT_LABEL[item.slot]} slot — one active at a time.</Text> : null}
        </View>

        <View style={styles.ctas}>
          {owned ? (
            <View style={[styles.buyBtn, styles.disabled]}>
              <Text style={styles.buyBtnText}>You already own this</Text>
            </View>
          ) : !purchasable ? (
            <View style={[styles.buyBtn, styles.disabled]}>
              <Text style={styles.buyBtnText}>Earn-only — never for sale</Text>
            </View>
          ) : (
            <Pressable
              style={[styles.buyBtn, (!canAfford || busy) && styles.disabled]}
              disabled={!canAfford || busy}
              onPress={buy}>
              <View style={styles.buyBtnRow}>
                <Text style={styles.buyBtnText}>Buy ·</Text>
                <EmberIcon size={14} />
                <Text style={styles.buyBtnText}>{formatEmbers(price)}</Text>
              </View>
            </Pressable>
          )}
          {!canAfford && purchasable && !owned ? (
            <Text style={styles.note}>You have {formatEmbers(embers)} embers. Lock in to earn more.</Text>
          ) : null}
          <Text style={styles.note}>
            Buying it outright costs more than gambling for it in a box — that&apos;s the price of certainty. Salvages
            back for {formatEmbers(SALVAGE_EMBERS[item.rarity])} embers.
          </Text>
        </View>
      </ScrollView>

      <PurchaseSheet
        visible={bought}
        item={item}
        price={price}
        onEquip={item.slot ? equipJustBought : undefined}
        equipping={equipping}
        onViewInventory={() => {
          setBought(false);
          router.replace('/inventory');
        }}
        onClose={() => {
          setBought(false);
          router.back();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  flex: { flex: 1 },
  missing: { fontFamily: Fonts.body, color: Colors.muted },
  hero: {
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  previewRow: {
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  body: { paddingHorizontal: Spacing.four },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
  },
  lore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12.5,
    lineHeight: 19,
    color: '#b7a9cc',
    marginTop: Spacing.twelve,
  },
  slot: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: Spacing.two,
  },
  ctas: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    gap: Spacing.two,
  },
  buyBtn: {
    backgroundColor: Colors.coral,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.45,
    backgroundColor: Colors.card,
  },
  buyBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  buyBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
