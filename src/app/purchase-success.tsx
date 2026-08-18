import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { getItem } from '@/lib/economy/catalog';
import { LEVEL_ZERO_UNLOCK, type PassReward } from '@/lib/economy/forge-pass';
import { emberPackForProduct, isForgePassProduct } from '@/lib/economy/iap';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';
import { fireReveal } from '@/lib/reward-feedback';

// What you see the moment a real-money purchase clears (#71).
//
// The important thing this screen does is NOT celebrate — it's to show the user what they actually
// received, because the grant is asynchronous. The store charged them on the device; the embers and
// the entitlement are written by the RevenueCat webhook a beat later. So this renders the expected
// contents immediately and refetches inventory underneath, rather than blocking on a spinner while
// a webhook lands. If the refetch shows nothing yet, the copy says "landing shortly" instead of
// claiming a grant that hasn't happened.
//
// Reached with ?product=<store product id>.

export default function PurchaseSuccessScreen() {
  const router = useRouter();
  const { product } = useLocalSearchParams<{ product?: string }>();
  const { refetch } = useInventory();
  const [settled, setSettled] = useState(false);

  const productId = product ?? '';
  const isPass = isForgePassProduct(productId);
  const pack = emberPackForProduct(productId);

  useEffect(() => {
    // The Mythic sting for the flare — the Pass's headline unlock is a Mythic and deserves the same
    // audio the box reveals give one. Ember packs get nothing: a currency top-up isn't a pull.
    if (isPass) fireReveal('mythic', false);
  }, [isPass]);

  // Refetch twice: once now, once after a short delay. The webhook usually lands within a second or
  // two, and a single immediate refetch would almost always miss it — which would leave a correct
  // purchase looking like a failed one.
  useEffect(() => {
    let cancelled = false;
    void refetch();
    const t = setTimeout(() => {
      if (cancelled) return;
      void refetch();
      setSettled(true);
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [refetch]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>{isPass ? 'FLAME PASS UNLOCKED' : 'EMBERS ADDED'}</Text>

        {isPass ? (
          <>
            <Text style={styles.title}>The season is yours</Text>
            <Text style={styles.sub}>
              The Premium lane is open for every level you&apos;ve already climbed, and these three land right now:
            </Text>
            <View style={styles.grid}>
              {LEVEL_ZERO_UNLOCK.map((reward, i) => (
                <UnlockTile key={i} reward={reward} />
              ))}
            </View>
          </>
        ) : pack ? (
          <>
            <View style={styles.emberHero}>
              <EmberIcon size={54} />
              <Text style={styles.emberAmount}>{formatEmbers(pack.embers)}</Text>
            </View>
            <Text style={styles.title}>{pack.name}</Text>
            <Text style={styles.sub}>
              Spend them on boxes or buy a cosmetic outright. Embers never buy XP, rank, or a place on any leaderboard.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Purchase complete</Text>
            <Text style={styles.sub}>Your reward is on its way to your inventory.</Text>
          </>
        )}

        <Text style={styles.settle}>
          {settled
            ? 'If anything is missing, reopen the app — the store receipt is on file and will reconcile.'
            : 'Landing in your inventory…'}
        </Text>

        <Pressable style={styles.cta} onPress={() => router.replace(isPass ? '/forge-pass' : '/shop')}>
          <Text style={styles.ctaText}>{isPass ? 'Open the track' : 'Back to the shop'}</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/inventory')} hitSlop={8}>
          <Text style={styles.secondary}>View inventory</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function UnlockTile({ reward }: { reward: PassReward }) {
  if (reward.kind === 'embers') {
    return (
      <View style={styles.tile}>
        <EmberIcon size={34} />
        <Text style={styles.tileName}>{formatEmbers(reward.amount)}</Text>
        <Text style={styles.tileMeta}>EMBERS</Text>
      </View>
    );
  }
  if (reward.kind !== 'item') return null;
  const item = getItem(reward.itemId);
  if (!item) return null;
  return (
    <View style={styles.tile}>
      <ItemArt item={item} size={40} />
      <Text style={styles.tileName} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={[styles.tileMeta, { color: RARITY_COLOR[item.rarity] }]}>
        {RARITY_LABEL[item.rarity].toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.six,
    paddingBottom: Spacing.six,
    alignItems: 'center',
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: '#FFD27A',
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 26,
    color: Colors.ink,
    marginTop: Spacing.two,
    textAlign: 'center',
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.two,
    maxWidth: 300,
  },
  grid: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: 14,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  tileName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  tileMeta: {
    fontFamily: Fonts.body,
    fontSize: 8,
    letterSpacing: 0.6,
    color: Colors.textTertiary,
  },
  emberHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  emberAmount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 44,
    color: Colors.ember,
  },
  settle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.five,
    maxWidth: 290,
  },
  cta: {
    marginTop: Spacing.four,
    paddingVertical: 14,
    paddingHorizontal: 34,
    borderRadius: 14,
    backgroundColor: '#FFD27A',
  },
  ctaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#2a0f06',
  },
  secondary: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
    paddingVertical: Spacing.one,
  },
});
