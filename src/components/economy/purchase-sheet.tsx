import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { RarityLabel, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import { rarityGlow } from '@/lib/economy/rarity';

// The direct-buy confirmation (punchlist 8 §3). Buying used to end in Alert.alert('Bought', …) —
// an OS dialog with a system font and a system button, in a shop whose entire job is to make the
// thing you just paid for feel worth having. A 600-ember Rare deserves the same beat as pulling
// one out of a box.
//
// So this is the reveal, minus the crack: the item under its own rarity glow, the rarity/type
// line, what it cost, and the two things you actually want next — equip it, or go look at it.
// Same components the box-open menu uses (ItemArt + RarityLabel), so the two read as one language.

type Props = {
  visible: boolean;
  item: CatalogItem;
  /** Embers spent — echoed back so the balance change is accounted for, not just observed. */
  price: number;
  onEquip?: () => void;
  equipping?: boolean;
  onViewInventory: () => void;
  onClose: () => void;
};

export function PurchaseSheet({ visible, item, price, onEquip, equipping, onViewInventory, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.artWrap}>
            <View style={[styles.glow, { backgroundColor: rarityGlow(item.rarity, 0.45) }]} />
            <ItemArt item={item} size={96} />
          </View>

          <View style={styles.tag}>
            <Text style={styles.tagText}>UNLOCKED</Text>
          </View>
          <Text style={styles.name}>{item.name}</Text>
          <RarityLabel rarity={item.rarity} type={item.type} size={10} />
          <Text style={styles.lore}>{item.lore}</Text>
          <Text style={styles.spent}>{formatEmbers(price)} embers spent · it&apos;s in your inventory</Text>

          <View style={styles.ctas}>
            {onEquip ? (
              <Pressable style={styles.primaryBtn} onPress={onEquip} disabled={equipping}>
                <Text style={styles.primaryBtnText}>
                  {equipping ? 'Equipping…' : `Equip ${item.type.toLowerCase()}`}
                </Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.ghostBtn} onPress={onViewInventory}>
              <Text style={styles.ghostBtnText}>View in inventory</Text>
            </Pressable>
            <Pressable style={styles.plainBtn} onPress={onClose}>
              <Text style={styles.plainBtnText}>Keep shopping</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,14,0.62)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    alignItems: 'center',
  },
  artWrap: {
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
  },
  tag: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
    marginBottom: Spacing.two,
  },
  tagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 1,
    color: '#fff',
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 21,
    color: Colors.ink,
    textAlign: 'center',
  },
  lore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12,
    lineHeight: 18,
    color: '#b7a9cc',
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  spent: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
  ctas: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  primaryBtn: {
    backgroundColor: Colors.coral,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#2a1608',
  },
  ghostBtn: {
    backgroundColor: Colors.cardDark,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ember,
  },
  plainBtn: {
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  plainBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
});
