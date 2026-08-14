import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberAmount, EmberPill, SectionLabel } from '@/components/economy/economy-bits';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { buyBox } from '@/lib/api/inventory';
import { BOXES, OPEN_COUNTS, oddsAreRealLine, oddsRows, pityLine, type BoxKey, type OpenCount } from '@/lib/economy/boxes';
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

  const box = BOXES[boxKey as BoxKey];
  if (!box) {
    return (
      <Screen>
        <Text style={styles.missing}>That box doesn&apos;t exist.</Text>
      </Screen>
    );
  }

  async function buyAndOpen(count: OpenCount) {
    const total = box.price * count;
    if (embers < total) {
      Alert.alert('Not enough embers', `You need 🔥 ${total.toLocaleString('en-US')} for this. Lock in to earn more.`);
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
          <BoxArt boxKey={box.key} size={130} />
          <Text style={styles.heroName}>{box.name}</Text>
          <Text style={[styles.heroRarity, { color: RARITY_COLOR[box.rarity] }]}>{RARITY_LABEL[box.rarity]} BOX</Text>
          {/* Every box has a free path. That's a hard requirement (21g), so it sits in the hero
              rather than being buried below the buy buttons. */}
          <Text style={styles.howto}>Earn it free: {box.earnedBy}</Text>
        </View>

        <SectionLabel label="Drop odds" />
        <View style={styles.odds}>
          {oddsRows(box).map(({ rarity, pct }) => (
            <View key={rarity} style={styles.oddRow}>
              <View style={[styles.dot, { backgroundColor: RARITY_COLOR[rarity] }]} />
              <Text style={styles.oddName}>{RARITY_LABEL[rarity].charAt(0) + RARITY_LABEL[rarity].slice(1).toLowerCase()}</Text>
              <View style={styles.oddBar}>
                <View style={[styles.oddFill, { width: `${pct}%`, backgroundColor: RARITY_COLOR[rarity] }]} />
              </View>
              <Text style={styles.oddPct}>{pct.toFixed(1)}%</Text>
            </View>
          ))}
        </View>

        <Text style={styles.oddsReal}>{oddsAreRealLine(box)}</Text>

        {/* Deliberately its own section, below and visually separate from the odds table. The
            odds are what every open actually does; this is only a bad-luck backstop on top. Run
            together, they'd read as the odds being adjusted, which is exactly the impression the
            published-odds requirement exists to prevent. */}
        <SectionLabel label="Bad-luck protection" />
        <View style={styles.guarantee}>
          <View style={styles.guaranteeRow}>
            <Ionicons name="shield-checkmark" size={13} color={Colors.amber} />
            <Text style={styles.guaranteeText}>{pityLine(box)}</Text>
          </View>
          <Text style={styles.guaranteeSub}>
            This never lowers your chances — it only steps in if you go a long run without one.
          </Text>
        </View>

        <SectionLabel label="Duplicates & salvage" />
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

        <SectionLabel label="How it opens" />
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.three,
  },
  flex: { flex: 1 },
  missing: {
    fontFamily: Fonts.body,
    color: Colors.muted,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
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
    fontSize: 11,
    lineHeight: 16,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.twelve,
    paddingHorizontal: Spacing.four,
  },
  odds: {
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
    padding: Spacing.twelve,
    gap: Spacing.two,
  },
  oddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  oddName: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ink,
    width: 74,
  },
  oddBar: {
    flex: 1,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
  },
  oddFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  oddPct: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ink,
    width: 48,
    textAlign: 'right',
  },
  guarantee: {
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
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
    color: '#e7ddf5',
    flex: 1,
  },
  guaranteeSub: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
  },
  oddsReal: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
  salvageText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: '#e7ddf5',
  },
  salvageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginVertical: Spacing.two,
  },
  salvageCell: {
    width: '31%',
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
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
    color: Colors.textTertiary,
  },
  crackCopy: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12,
    lineHeight: 18,
    color: Colors.muted,
  },
  buyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  buy: {
    flex: 1,
    borderRadius: 13,
    paddingVertical: 11,
    alignItems: 'center',
    gap: 2,
  },
  buyPrimary: {
    backgroundColor: Colors.plum,
  },
  buyGhost: {
    backgroundColor: Colors.card,
  },
  buyDisabled: {
    opacity: 0.4,
  },
  buyText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  buyPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  buyPrice: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.75)',
  },
  buyGhostText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#c79bec',
  },
  buyGhostPrice: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  legal: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    lineHeight: 14,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
