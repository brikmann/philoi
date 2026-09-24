import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { DropOddsLink, DropOddsSheet } from '@/components/economy/drop-odds';
import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useDropPool } from '@/hooks/use-drop-pool';
import { campfireFinisherLabel } from '@/lib/challenge-reward-copy';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import type { CatalogItem } from '@/lib/economy/catalog';
import type { OddsRow } from '@/lib/economy/odds';
import { RARITY_COLOR, RARITY_LABEL, RARITY_ORDER, type Rarity } from '@/lib/economy/rarity';

// "WHAT'S UP FOR GRABS" — design-mocks/217's prize pool, for a campfire race.
//
// Three things, top to bottom, and every one of them is the server's:
//   1. the winner's box + embers — preview_challenge_reward, handed in by the screen;
//   2. the finisher ladder — 0212 mints one title per ranked racer, spelled as campfire_finisher_label;
//   3. what the box can roll — useDropPool, i.e. 0090's allowlist ∩ the pool openBox sends, cut to
//      the rarities this box's LIVE odds can land. The odds line is written from those same rows.
//
// No local reward or rarity table: the first economy retune has to move this panel with it.

/** Cells in the grid, including the "+N more" tile. Four columns, two rows — mock 217. */
const GRID_CELLS = 8;

/** Gold, silver, bronze, then one colour for every place after. */
const MEDAL = ['#FFD27A', '#C9D1DF', '#C98A4A', Colors.trackAlt];

function medalColor(place: number): string {
  return MEDAL[Math.min(Math.max(place, 1), 4) - 1];
}

function titleCase(r: Rarity): string {
  const s = RARITY_LABEL[r];
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function withArticle(r: Rarity): string {
  const word = titleCase(r);
  return /^[AEIOU]/.test(word) ? `an ${word}` : `a ${word}`;
}

/**
 * A spread, not the first N. One item per rarity in turn, most likely tier first, so a slim-shot
 * Legendary is on screen beside the Rares it will usually lose to — then shown in rarity order.
 */
function representative(items: CatalogItem[], odds: OddsRow[], count: number): CatalogItem[] {
  const byRarity = [...odds]
    .sort((a, b) => b.pct - a.pct)
    .map((row) => items.filter((i) => i.rarity === row.rarity));
  const picked: CatalogItem[] = [];
  for (let round = 0; picked.length < count && byRarity.some((b) => b.length > round); round += 1) {
    for (const bucket of byRarity) {
      if (picked.length < count && bucket[round]) picked.push(bucket[round]);
    }
  }
  return picked.sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]);
}

/**
 * "The Vessel of Hestia favours Rare–Epic, with a 7.2% shot at a Legendary." From the live rows the
 * drop-rates sheet prints — the percentage is the disclosure's own label, never re-rounded here.
 */
function oddsLine(boxName: string, odds: OddsRow[]): string | null {
  if (odds.length === 0) return null;
  if (odds.length === 1) return `Every pull from the ${boxName} is ${withArticle(odds[0].rarity)}.`;
  const favoured = [...odds].sort((a, b) => b.pct - a.pct).slice(0, 2);
  const [lo, hi] = favoured.map((r) => r.rarity).sort((a, b) => RARITY_ORDER[a] - RARITY_ORDER[b]);
  const range = `${titleCase(lo)}–${titleCase(hi)}`;
  // Rows arrive in rarity order, so the last is the rarest tier this box can land.
  const rarest = odds[odds.length - 1];
  if (favoured.some((r) => r.rarity === rarest.rarity)) return `The ${boxName} favours ${range}.`;
  return `The ${boxName} favours ${range}, with a ${rarest.label}% shot at ${withArticle(rarest.rarity)}.`;
}

export function PrizePoolPanel({
  boxKey,
  embers,
  campfire,
  settled,
  myPlace,
}: {
  /** The box the server preview says the top band takes. Null = unscoped or embers-only. */
  boxKey: BoxKey | null;
  embers: number | null;
  campfire: string;
  settled: boolean;
  /** The viewer's settled place, when there is one — their title is the one drawn large. */
  myPlace: number | null;
}) {
  const [open, setOpen] = useState(true);
  const [oddsOpen, setOddsOpen] = useState(false);
  const { items, odds, ready } = useDropPool(boxKey);
  const box = boxKey ? BOXES[boxKey] : null;

  const heroPlace = myPlace ?? 1;
  const shown = items.length <= GRID_CELLS ? items : representative(items, odds, GRID_CELLS - 1);
  const more = items.length - shown.length;
  const legend = odds.filter((row) => shown.some((i) => i.rarity === row.rarity));
  const line = box ? oddsLine(box.name, odds) : null;

  return (
    <View style={styles.pool}>
      <Pressable
        style={styles.toggle}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}>
        <Text style={styles.toggleText}>What&apos;s up for grabs</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.muted} />
      </Pressable>

      {open ? (
        <>
          {box && embers != null ? (
            <View style={styles.head}>
              <BoxArt boxKey={boxKey!} size={36} motion="off" />
              <View style={styles.headText}>
                <Text style={styles.headName}>{box.name}</Text>
                <Text style={styles.headSub}>
                  {settled ? 'The top band took' : 'The top band takes'} the box · +{embers.toLocaleString('en-US')} embers
                </Text>
              </View>
            </View>
          ) : null}

          <Text style={styles.up}>🏅 Every finisher earns a badge</Text>
          <View style={styles.champ}>
            <View style={[styles.medal, { backgroundColor: medalColor(heroPlace) }]}>
              <Text style={styles.medalText}>{heroPlace}</Text>
            </View>
            <View style={styles.champText}>
              <Text style={[styles.champName, { color: heroPlace <= 3 ? medalColor(heroPlace) : Colors.ink }]}>
                {campfireFinisherLabel(campfire, heroPlace)}
              </Text>
              <Text style={styles.champSub}>
                Auto-minted to your profile when the race settles · can&apos;t be sold or forged.
              </Text>
            </View>
            <Text style={styles.excl}>{myPlace != null ? 'Yours' : 'Winner'}</Text>
          </View>
          <View style={styles.places}>
            {[1, 2, 3].map((place) => (
              <View key={place} style={styles.pl}>
                <View style={[styles.plDot, { backgroundColor: medalColor(place) }]} />
                <Text style={styles.plText}>{campfireFinisherLabel(place === 1 ? campfire : '', place)}</Text>
              </View>
            ))}
            <View style={styles.pl}>
              <View style={[styles.plDot, { backgroundColor: medalColor(4) }]} />
              <Text style={styles.plText}>Nth Place Finisher</Text>
            </View>
          </View>

          {/* The box's contents only once the server's allowlist has answered — a pool drawn from
              the bundle alone could promise an item the roll can no longer produce. */}
          {box && ready && items.length > 0 ? (
            <>
              <Text style={styles.up}>🏆 {settled ? 'The top band took' : 'The top band also takes'} — what&apos;s in the box</Text>
              <View style={styles.grid}>
                {shown.map((item) => (
                  <View key={item.id} style={styles.it} accessibilityLabel={`${item.name}, ${titleCase(item.rarity)}`}>
                    <View style={[styles.rdot, { backgroundColor: RARITY_COLOR[item.rarity] }]} />
                    <ItemArt item={item} size={34} motion="off" />
                    <Text style={styles.iname} numberOfLines={2}>
                      {item.name.replace(/^"|"$/g, '')}
                    </Text>
                  </View>
                ))}
                {more > 0 ? (
                  <View style={[styles.it, styles.more]}>
                    <Text style={styles.moreText}>+{more} more</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.legend}>
                {legend.map((row) => (
                  <View key={row.rarity} style={styles.lg}>
                    <View style={[styles.plDot, { backgroundColor: RARITY_COLOR[row.rarity] }]} />
                    <Text style={styles.lgText}>{titleCase(row.rarity)}</Text>
                  </View>
                ))}
              </View>
              {line ? <Text style={styles.odds}>{line}</Text> : null}
              <DropOddsLink onPress={() => setOddsOpen(true)} />
            </>
          ) : null}
        </>
      ) : null}

      <DropOddsSheet boxKey={oddsOpen ? boxKey : null} onClose={() => setOddsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  pool: {
    marginTop: Spacing.three,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  toggleText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.muted,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headText: {
    flex: 1,
  },
  headName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  headSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 2,
  },
  up: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.muted,
    marginTop: 18,
    marginBottom: 10,
  },
  champ: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(224,97,44,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.4)',
  },
  medal: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.onEmber,
  },
  champText: {
    flex: 1,
  },
  champName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
  },
  champSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
    marginTop: 2,
  },
  excl: {
    alignSelf: 'flex-start',
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.onEmber,
    backgroundColor: Colors.ember,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  places: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  pl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  plDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  plText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.muted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  it: {
    // Four to a row: (100% - 3 gaps) / 4, rounded down so float slop never wraps a fourth tile.
    width: '22.8%',
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 12,
    paddingTop: 9,
    paddingBottom: 8,
    paddingHorizontal: 4,
    gap: 5,
  },
  rdot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  iname: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    lineHeight: 12,
    color: Colors.ink,
    textAlign: 'center',
  },
  more: {
    justifyContent: 'center',
  },
  moreText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  lg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lgText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  odds: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
    marginTop: 10,
    marginBottom: 6,
  },
});
