import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberPill, RarityLabel, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { PurchaseSheet } from '@/components/economy/purchase-sheet';
import { SPACE_GUTTER, SpaceEmpty, SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useStopPreviewOnLeave } from '@/hooks/use-audio-preview';
import { useInventory } from '@/hooks/use-inventory';
import { useMemeDrops } from '@/hooks/use-meme-drops';
import { buyCosmetic, equipCosmetic } from '@/lib/api/inventory';
import { buyMemeDrop } from '@/lib/api/meme-drops';
import { getItem, SLOT_LABEL } from '@/lib/economy/catalog';
import { cosmeticEffect } from '@/lib/economy/cosmetic-effect';
import { countdownLabel, dropDateLabel, dropPhase } from '@/lib/economy/meme-drops';
import { requestInventoryRefresh } from '@/lib/economy/wallet-refresh';
import { getErrorMessage } from '@/lib/errors';
import { DIRECT_BUY_PRICE, RARITY_COLOR, SALVAGE_EMBERS, rarityGlow } from '@/lib/economy/rarity';

// Direct-buy detail (§8.4). The deterministic path: pay more than the box costs and skip the RNG.
// The price is always above the item's own salvage value, so buy→sell can never be an arbitrage.

export default function ShopItemScreen() {
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { embers, ownedKeys, refetch } = useInventory();
  const memeDrops = useMemeDrops();
  const [busy, setBusy] = useState(false);
  const [bought, setBought] = useState(false);
  const [equipping, setEquipping] = useState(false);
  useStopPreviewOnLeave(itemId);

  const found = getItem(itemId ?? '');
  if (!found) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <SpaceHeader title="Shop" />
        <SpaceEmpty title="That item doesn't exist." />
      </SafeAreaView>
    );
  }
  // Narrowed into a const so `buy()` closes over a non-nullable item.
  const item = found;

  // A Meme Monday drop (0243) is priced and windowed by the SERVER — this screen only mirrors the
  // schedule row so it can say "drops Mon, Nov 2" or "ends in 3d"; buy_meme_drop re-checks both.
  const isDrop = item.acquisition === 'drop';
  const drop = isDrop ? memeDrops.byKey.get(item.id) : undefined;
  const phase = drop ? dropPhase(drop, memeDrops.now) : null;
  const price = drop ? drop.price : DIRECT_BUY_PRICE[item.rarity];
  const owned = ownedKeys.has(item.id);
  // Prestige is not for sale — earned and Pass-exclusive items never reach this screen from the
  // Featured row, but a deep link could, so the gate is enforced here too.
  const purchasable = isDrop ? phase === 'live' : item.acquisition === 'box';
  const canAfford = embers >= price;
  const lockedLabel = !isDrop
    ? 'Earn-only — never for sale'
    : !memeDrops.loaded
      ? 'Checking the drop…'
      : phase === 'upcoming' && drop
        ? `Drops ${dropDateLabel(drop.unlocksAt)}`
        : phase === 'ended'
          ? 'This drop has ended'
          : 'Not on sale';

  // The refetch is what makes the buy visible: `buyCosmetic` mutates server-side only, so without
  // pulling get_inventory again the ember balance in the header, this screen's own "You already
  // own this" state, and the Owned grid all keep showing pre-purchase truth until a cold reload
  // (punchlist 8 §3). Awaited BEFORE the sheet opens so what it says is already true.
  async function buy() {
    setBusy(true);
    try {
      if (isDrop) {
        await buyMemeDrop(item);
      } else {
        await buyCosmetic(item);
      }
      await refetch();
      // Every other mounted balance (the shop pill under this screen) too, not just this one.
      requestInventoryRefresh();
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
    <SafeAreaView edges={['top']} style={styles.safe}>
      <SpaceHeader title={isDrop ? 'Meme Monday' : 'Buy direct'} right={<EmberPill embers={embers} />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.hero}>
          <View style={[styles.glow, { backgroundColor: rarityGlow(item.rarity, 0.5) }]} />
          {/* The same 3px rarity rule the shop grid and the inventory wear (mock 216). */}
          <View style={[styles.rarityBar, { backgroundColor: RARITY_COLOR[item.rarity] }]} />
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
          {/* What it DOES — the same type-derived line the Flame Pass detail sheet shows. */}
          <Text style={styles.effect}>{cosmeticEffect(item)}</Text>
          {item.slot ? <Text style={styles.slot}>Equips to your {SLOT_LABEL[item.slot]} slot — one active at a time.</Text> : null}
        </View>

        <View style={styles.ctas}>
          {owned ? (
            <View style={[styles.buyBtn, styles.inert]}>
              <Text style={[styles.buyBtnText, styles.buyBtnTextOff]}>You already own this</Text>
            </View>
          ) : !purchasable ? (
            <View style={[styles.buyBtn, styles.inert]}>
              <Text style={[styles.buyBtnText, styles.buyBtnTextOff]}>{lockedLabel}</Text>
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
          {isDrop ? (
            <Text style={styles.note}>
              {drop && phase === 'live'
                ? `Meme Monday drop — on sale for ${countdownLabel(drop.endsAt - memeDrops.now)} more, then it's gone for good.`
                : "Meme Monday drop — buyable only during its week, then it's gone for good."}{' '}
              Salvages back for {formatEmbers(SALVAGE_EMBERS[item.rarity])} embers.
            </Text>
          ) : (
            <Text style={styles.note}>
              Buying it outright costs more than gambling for it in a box — that&apos;s the price of certainty. Salvages
              back for {formatEmbers(SALVAGE_EMBERS[item.rarity])} embers.
            </Text>
          )}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: Spacing.six },
  // The hero is a kit panel now — the rarity rule rides its top edge and the glow sits inside it,
  // so the item reads as an object on a card rather than floating loose on the ground.
  hero: {
    height: 210,
    marginHorizontal: SPACE_GUTTER,
    marginBottom: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  rarityBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    opacity: 0.9,
  },
  previewRow: {
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  body: { paddingHorizontal: SPACE_GUTTER },
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
    color: Colors.spaceDim,
    marginTop: Spacing.twelve,
  },
  effect: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.ink,
    marginTop: Spacing.two,
  },
  slot: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    marginTop: Spacing.two,
  },
  ctas: {
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.four,
    gap: Spacing.two,
  },
  // SpaceButton's primary, hand-built because the label carries an inline ember glyph.
  buyBtn: {
    backgroundColor: Colors.navEmber,
    borderRadius: 16,
    minHeight: 50,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Can't afford / mid-buy: SpaceButton's off state — the same ember, fire turned down.
  disabled: {
    opacity: 0.45,
  },
  // Owned / not for sale: not an action at all, so no ember — a secondary panel carrying the reason.
  inert: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  buyBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  buyBtnText: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: '#2A0F05',
  },
  buyBtnTextOff: {
    fontFamily: Fonts.bodyBold,
    color: Colors.spaceDim,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
});
