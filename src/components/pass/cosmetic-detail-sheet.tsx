import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EMBER, Laurel } from '@/components/pass/emberfall-art';
import { CosmeticRender, cosmeticTitle } from '@/components/pass/emberfall-gallery';
import { Fonts } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import { cosmeticEffect } from '@/lib/economy/cosmetic-effect';
import { passUnlockLevel } from '@/lib/economy/forge-pass';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ONE COSMETIC, UP CLOSE — the sheet a tapped gallery card or track chip opens.
//
// The gallery card is a teaser: a small render and one line of lore. This is the answer to "but what
// IS it": the same render at full size, the name, rarity and unlock level, the lore, and what the
// item DOES once it's yours. Tap outside, swipe back, or Close dismisses.
//
// Also exports the pieces: <DetailSheet> (the frame) and <CosmeticDetail> (one item's body), which
// the pass track composes into a per-level sheet.
//
// 🔴 NOTHING HERE IS TYPED IN PER ITEM. Name, lore and rarity come from catalog.ts; the level from
// the pass track (passUnlockLevel); the effect line from the item's TYPE (cosmetic-effect.ts). An
// item the pass never grants shows no level pill rather than an invented one.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The gallery's renders are drawn for a 106pt stage; the sheet shows them this much bigger. */
const RENDER_SCALE = 1.65;

export function CosmeticDetailSheet({
  item,
  name,
  onClose,
}: {
  /** The item to show, or null for a closed sheet. */
  item: CatalogItem | null;
  /** Whose name the render wears — the viewer's first name. */
  name: string;
  onClose: () => void;
}) {
  return (
    <DetailSheet visible={item !== null} onClose={onClose}>
      {item ? <CosmeticDetail item={item} name={name} /> : null}
    </DetailSheet>
  );
}

/**
 * The bottom-sheet frame: a scrim that dismisses on tap, a grip, a scrolling body, and Close. The
 * pass track fills it with a whole level's lane (two cosmetics at L50 and L100), so the body
 * scrolls rather than assuming one item fits.
 */
export function DetailSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        {/* Swallows taps so only the backdrop dismisses. */}
        <Pressable
          style={[styles.sheet, { maxHeight: height * 0.88, paddingBottom: insets.bottom + 18 }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={styles.grip} />
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * One cosmetic, in full: the render at sheet size, the pills, the name, the lore and the effect.
 * `showLevel` is off where the level is already the sheet's heading (a track row).
 */
export function CosmeticDetail({ item, name, showLevel = true }: { item: CatalogItem; name: string; showLevel?: boolean }) {
  const level = showLevel ? passUnlockLevel(item.id) : null;
  const rarity = RARITY_COLOR[item.rarity];
  return (
    <View>
      <View style={styles.pills}>
        {level !== null ? (
          <View style={[styles.pill, level === 0 ? styles.pillNow : styles.pillLv]}>
            <Text style={[styles.pillText, level === 0 && styles.pillTextNow]}>
              {level === 0 ? '⚡ Instant with the pass' : `Unlocks at Lv ${level}`}
            </Text>
          </View>
        ) : null}
        <View style={[styles.pill, { backgroundColor: rarity }]}>
          <Text style={[styles.pillText, styles.pillTextNow]}>{RARITY_LABEL[item.rarity].toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.stage}>
        <View style={styles.laurelL}>
          <Laurel height={150} />
        </View>
        <View style={styles.laurelR}>
          <Laurel height={150} flip />
        </View>
        <View style={styles.scaled}>
          <CosmeticRender item={item} name={name} />
        </View>
      </View>

      <Text style={styles.name}>{cosmeticTitle(item)}</Text>
      <Text style={styles.lore}>{item.lore}</Text>

      <View style={styles.effect}>
        <Text style={styles.effectHead}>WHAT IT DOES</Text>
        <Text style={styles.effectText}>{cosmeticEffect(item)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,3,9,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#140c20',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: EMBER.line2,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  grip: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: EMBER.line2,
    marginBottom: 14,
  },
  pills: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pillNow: {
    backgroundColor: EMBER.e2,
  },
  pillLv: {
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: EMBER.line,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: EMBER.warm,
  },
  pillTextNow: {
    color: '#160a02',
  },
  stage: {
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  laurelL: {
    position: 'absolute',
    left: 4,
    top: 20,
    opacity: 0.85,
  },
  laurelR: {
    position: 'absolute',
    right: 4,
    top: 20,
    opacity: 0.85,
  },
  scaled: {
    transform: [{ scale: RENDER_SCALE }],
  },
  name: {
    fontFamily: Fonts.black,
    fontSize: 19,
    color: EMBER.ink,
    textAlign: 'center',
    marginTop: 4,
  },
  lore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12.5,
    lineHeight: 18,
    color: EMBER.dim,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 8,
  },
  effect: {
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,180,90,0.35)',
    backgroundColor: 'rgba(42,22,44,0.7)',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  effectHead: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: EMBER.e2,
  },
  effectText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 18.5,
    color: EMBER.warm,
    marginTop: 4,
  },
  close: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: EMBER.line2,
  },
  closeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: EMBER.warm,
  },
});
