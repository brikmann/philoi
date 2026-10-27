import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BoxArt } from '@/components/economy/box-art';
import { OddsTable } from '@/components/economy/drop-odds';
import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberAmount, EmberPill } from '@/components/economy/economy-bits';
import { RewardGlyph } from '@/components/ui/glyphs-rewards';
import { SPACE_GUTTER, SpaceEmpty, SpaceHeader, SpaceSection } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useBoxOdds } from '@/hooks/use-box-odds';
import { useInventory } from '@/hooks/use-inventory';
import { buyBox } from '@/lib/api/inventory';
import { BOXES, OPEN_COUNTS, oddsAreRealLine, pityLineFrom, type BoxKey, type OpenCount } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import { RARITY_COLOR, RARITY_LABEL, SALVAGE_EMBERS, SALVAGE_PCT } from '@/lib/economy/rarity';

// Box detail (mock 57, 21g). This screen exists to satisfy a legal requirement, not just a design
// one: the audience skews students and minors, Belgium and the Netherlands ban paid loot boxes
// outright, and both app stores require published drop rates. So the odds table, the guarantee
// floors in plain language, and the free earn path are the *content* here — not fine print.

export default function BoxDetailScreen() {
  const router = useRouter();
  const { boxKey } = useLocalSearchParams<{ boxKey: string }>();
  const { embers, refetch } = useInventory();
  const [busy, setBusy] = useState(false);
  // The LIVE weights economy_roll_rarity rolls on, not this build's copy of them. Called before
  // the missing-box early return so the hook order is stable for an unknown key.
  const { rows: oddsRows, pity } = useBoxOdds(boxKey as BoxKey);

  const box = BOXES[boxKey as BoxKey];
  if (!box) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <SpaceHeader title="Loot box" />
        <SpaceEmpty title="That box doesn't exist." />
      </SafeAreaView>
    );
  }

  async function buyAndOpen(count: OpenCount) {
    const total = box.price * count;
    if (embers < total) {
      Alert.alert('Not enough embers', `You need ${total.toLocaleString('en-US')} embers for this. Lock in to earn more.`);
      return;
    }
    setBusy(true);
    try {
      // Buy first, then hand the fresh box ids to the open screen. The RESULT is rolled server-side
      // when each box is opened — this only creates the boxes to be opened.
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) ids.push(await buyBox(box.key));
      await refetch();
      router.push({ pathname: '/shop/open', params: { boxIds: ids.join(','), boxKey: box.key } });
    } catch (e) {
      Alert.alert("Couldn't buy that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* The box's own name is the hero's headline just below, so the bar names the kind of screen
          rather than saying it twice. */}
      <SpaceHeader title="Loot box" right={<EmberPill embers={embers} />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.hero}>
          {/* Pedestalled (mock 216): rarity glow, ground shadow and the slow float — this is
              the crate as an object, which is what a hero is for. */}
          <BoxArt boxKey={box.key} size={130} pedestal />
          <Text style={styles.heroName}>{box.name}</Text>
          <Text style={[styles.heroRarity, { color: RARITY_COLOR[box.rarity] }]}>{RARITY_LABEL[box.rarity]} BOX</Text>
          {/* Every box has a free path. That's a hard requirement (21g), so it sits in the hero
              rather than being buried below the buy buttons. */}
          <Text style={styles.howto}>Earn it free: {box.earnedBy}</Text>
        </View>

        <SpaceSection>Drop odds</SpaceSection>
        <OddsTable rows={oddsRows} />

        <Text style={styles.oddsReal}>{oddsAreRealLine(box)}</Text>

        {/* Deliberately its own section, below and visually separate from the odds table. The
            odds are what every open actually does; this is only a bad-luck backstop on top. Run
            together, they'd read as the odds being adjusted, which is exactly the impression the
            published-odds requirement exists to prevent. */}
        <SpaceSection>Bad-luck protection</SpaceSection>
        <View style={styles.guarantee}>
          <View style={styles.guaranteeRow}>
            <RewardGlyph name="shield" size={15} color={Colors.gold} />
            <Text style={styles.guaranteeText}>{pityLineFrom(pity)}</Text>
          </View>
          <Text style={styles.guaranteeSub}>
            This never lowers your chances — it only steps in if you go a long run without one.
          </Text>
        </View>

        <SpaceSection>Duplicates & salvage</SpaceSection>
        <View style={styles.guarantee}>
          <Text style={styles.salvageText}>
            Pull something you already own and it turns straight into embers — no wasted duplicates. You can also sell
            anything you own from your Inventory at the same rate.
          </Text>
          <View style={styles.salvageGrid}>
            {(Object.keys(SALVAGE_EMBERS) as (keyof typeof SALVAGE_EMBERS)[]).map((rarity) => (
              <View key={rarity} style={styles.salvageCell}>
                <Text style={[styles.salvageRarity, { color: RARITY_COLOR[rarity] }]}>{RARITY_LABEL[rarity]}</Text>
                <EmberAmount amount={SALVAGE_EMBERS[rarity]} />
                <Text style={styles.salvagePct}>{SALVAGE_PCT[rarity]}%</Text>
              </View>
            ))}
          </View>
          <Text style={styles.salvageText}>
            The rate drops as rarity climbs, so the best pulls are worth keeping rather than melting down.
          </Text>
        </View>

        <SpaceSection>How it opens</SpaceSection>
        <Text style={styles.crackCopy}>{box.crackCopy}</Text>

        {/* Count and price stack rather than sitting on one line: three batch sizes across, with a
            Promethean ×10 reading "🔥 80,000", won't fit a single row of one-liners. */}
        <View style={styles.buyRow}>
          {OPEN_COUNTS.map((count) => {
            const total = box.price * count;
            const unaffordable = embers < total;
            return (
              <Pressable
                key={count}
                style={[
                  styles.buy,
                  count === 1 ? styles.buyPrimary : styles.buyGhost,
                  (unaffordable || busy) && styles.buyDisabled,
                ]}
                disabled={unaffordable || busy}
                onPress={() => buyAndOpen(count)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${count} for ${total.toLocaleString('en-US')} embers`}>
                <Text style={count === 1 ? styles.buyText : styles.buyGhostText}>Open {count}</Text>
                <View style={styles.buyPriceRow}>
                  <EmberIcon size={11} />
                  <Text style={count === 1 ? styles.buyPrice : styles.buyGhostPrice}>
                    {total.toLocaleString('en-US')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.legal}>
          Odds are published and identical for everyone. Cosmetics only — nothing in this box affects XP, rank, or
          your place on any leaderboard.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  hero: {
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  heroName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
    marginTop: Spacing.two,
  },
  heroRarity: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginTop: Spacing.half,
  },
  howto: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: Spacing.twelve,
    paddingHorizontal: Spacing.four,
  },
  guarantee: {
    backgroundColor: Colors.spacePanel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    padding: Spacing.twelve,
    gap: Spacing.two,
  },
  guaranteeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  guaranteeText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.ink,
    flex: 1,
  },
  guaranteeSub: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.spaceDim,
  },
  oddsReal: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.spaceDim,
    marginTop: Spacing.two,
  },
  salvageText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.ink,
  },
  salvageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginVertical: Spacing.two,
  },
  salvageCell: {
    width: '31%',
    backgroundColor: Colors.spacePanel2,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    gap: 2,
  },
  salvageRarity: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    letterSpacing: 0.5,
  },
  salvagePct: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: Colors.spaceDim,
  },
  crackCopy: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12,
    lineHeight: 18,
    color: Colors.spaceDim,
  },
  buyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  // SpaceButton's shapes, kept hand-built because each button stacks a count over a price —
  // the kit's button is one label. ×1 is the ember action; the batch sizes are secondary panels.
  buy: {
    flex: 1,
    borderRadius: 16,
    minHeight: 50,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  buyPrimary: {
    backgroundColor: Colors.navEmber,
  },
  buyGhost: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  buyDisabled: {
    opacity: 0.45,
  },
  buyText: {
    fontFamily: Fonts.black,
    fontSize: 14,
    color: '#2A0F05',
  },
  buyPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  buyPrice: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: 'rgba(42,15,5,0.75)',
  },
  buyGhostText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  buyGhostPrice: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.spaceDim,
  },
  legal: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    lineHeight: 14,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
