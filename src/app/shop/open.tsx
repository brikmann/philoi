import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoxCrack } from '@/components/economy/box-crack';
import { MultiDeal } from '@/components/economy/multi-deal';
import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberAmount, RarityLabel, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { ErrorBoundary } from '@/components/error-boundary';
import { Screen } from '@/components/ui/screen';
import { useRevealPreview, useRevealSting } from '@/hooks/use-audio-preview';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useShareRank } from '@/hooks/use-share-rank';
import { UnlockShareCard } from '@/components/economy/unlock-share-card';
import { useAuth } from '@/lib/auth/auth-context';
import { equipCosmetic, openBox, type OpenResult } from '@/lib/api/inventory';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import { shareCardImage } from '@/lib/share-card';
import { getItem } from '@/lib/economy/catalog';
import { getErrorMessage } from '@/lib/errors';
import { RARITY_COLOR, rarityGlow, type Rarity } from '@/lib/economy/rarity';

// Box open (mocks 58/59, 21h). Three beats: crack → pulse → REWARD MENU.
//
// The critical ordering rule from §8.5: the SERVER decides everything (roll, guarantees, dupe
// conversion) before a single frame plays. So this screen opens every box up front, holds the
// finished results, and only then animates. The animation is a flourish over a decided outcome —
// it can never change what you got, and a crash mid-animation cannot cost you the pull.

type Phase = 'rolling' | 'animating' | 'menu';

export default function BoxOpenScreen() {
  // The pull is BANKED before this screen renders a frame — the server granted it, salvaged the
  // dupes and spent the box the moment openBox() returned. So a render throw anywhere downstream
  // (a catalog key this build doesn't know, an art kind with no case, a null out of jsonb) must
  // never read as "you lost the box": the boundary catches it, reports the real stack to Sentry,
  // and hands the user through to the inventory the items are already sitting in.
  return (
    <ErrorBoundary title="That box opened — the screen didn't" exitTo="/inventory" exitLabel="Go to inventory">
      <BoxOpenFlow />
    </ErrorBoundary>
  );
}

function BoxOpenFlow() {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { boxIds, boxKey } = useLocalSearchParams<{ boxIds: string; boxKey: string }>();

  const [results, setResults] = useState<OpenResult[]>([]);
  const [phase, setPhase] = useState<Phase>('rolling');
  const [error, setError] = useState<string | null>(null);
  const [unopened, setUnopened] = useState(0);
  const [equipping, setEquipping] = useState(false);

  const ids = (boxIds ?? '').split(',').filter(Boolean);
  const isMulti = ids.length > 1;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Sequential rather than parallel: each open advances the server-side pity counter, and
      // concurrent opens would race on it and could hand out the guarantee twice.
      const out: OpenResult[] = [];
      let failure: unknown = null;
      for (const id of ids) {
        try {
          out.push(await openBox(id));
        } catch (e) {
          // Stop on the first failure — whatever broke one open will break the rest, and the
          // boxes that haven't been touched stay unopened rows the user can come back to.
          failure = e;
          break;
        }
      }
      if (cancelled) return;

      // A ×10 that dies on the fourth box has still GRANTED three items. Throwing the whole screen
      // away over the failure would hide them (punchlist 9 §1's symptom — embers gone, nothing to
      // show for it), so anything that did land gets revealed and the shortfall is stated.
      if (out.length > 0) {
        setUnopened(ids.length - out.length);
        setResults(out);
        setPhase('animating');
      } else {
        setError(getErrorMessage(failure, "Couldn't open that box."));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately runs once: `ids` is derived from a route param that never changes for a given
    // mount, and re-running would re-open boxes that are already spent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAnimationDone = useCallback(() => setPhase('menu'), []);

  if (error) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          {/* The single most important thing to say here: a box that fails to open is not a box
              that was consumed. open_loot_box only marks it opened inside the transaction that
              grants the item, so an unopened row is still sitting in the inventory — and after
              punchlist 9 §1, someone hitting this has typically just paid for it. */}
          <Text style={styles.errorNote}>
            {ids.length > 1 ? 'Those boxes are' : 'That box is'} still unopened in your inventory — nothing was lost.
            Try again from there.
          </Text>
          <Pressable style={styles.ghostBtn} onPress={() => router.replace('/inventory')}>
            <Text style={styles.ghostBtnText}>Go to inventory</Text>
          </Pressable>
          <Pressable style={styles.plainBtn} onPress={() => router.back()}>
            <Text style={styles.plainBtnText}>Back</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (phase === 'rolling' || results.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.rolling}>Opening…</Text>
        </View>
      </Screen>
    );
  }

  if (phase === 'animating') {
    return isMulti ? (
      <Screen>
        <MultiDeal
          boxKey={(boxKey as BoxKey) ?? 'kindling'}
          results={results}
          reduceMotion={reduceMotion}
          onDone={onAnimationDone}
        />
      </Screen>
    ) : (
      <Screen>
        <View style={styles.center}>
          <BoxCrack
            boxKey={(boxKey as BoxKey) ?? 'kindling'}
            reduceMotion={reduceMotion}
            onDone={onAnimationDone}
            size={220}
          />
        </View>
      </Screen>
    );
  }

  return isMulti ? (
    <MultiMenu results={results} unopened={unopened} onDone={() => router.replace('/inventory')} />
  ) : (
    <SingleMenu
      result={results[0]}
      equipping={equipping}
      onEquip={async () => {
        const item = results[0].item;
        if (!item?.slot) return;
        setEquipping(true);
        try {
          await equipCosmetic(item);
          router.replace('/inventory');
        } catch (e) {
          Alert.alert("Couldn't equip that", getErrorMessage(e, 'Something went wrong.'));
        } finally {
          setEquipping(false);
        }
      }}
      onCollect={() => router.replace('/inventory')}
    />
  );
}

/** Best pull in the haul — headlines the ×10 grid and drives the ray colour. */
function bestOf(results: OpenResult[]): Rarity {
  const order: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  return results.reduce<Rarity>((best, r) => {
    const rarity = (r.item?.rarity ?? 'common') as Rarity;
    return order.indexOf(rarity) > order.indexOf(best) ? rarity : best;
  }, 'common');
}

// ── Single: the hero screen (§8.5 stage 3) ──
function SingleMenu({
  result,
  equipping,
  onEquip,
  onCollect,
}: {
  result: OpenResult;
  equipping: boolean;
  onEquip: () => void;
  onCollect: () => void;
}) {
  const { profile } = useAuth();
  const shareRank = useShareRank();
  const cardRef = useRef<View>(null);
  const item = result.item ?? getItem(result.cosmetic_key);
  // Auditions the pull the moment it's revealed, when an audio cosmetic is what dropped — hearing
  // it is the reveal for those items, the way the art is for every other type. Hook runs before the
  // null guard below so it isn't called conditionally.
  useRevealPreview(item?.id);
  // On a 1× the sting is simply that item's own tier (PUNCHLIST_14 §2). Above the null guard for
  // the same reason as useRevealPreview — hooks may not be called conditionally.
  useRevealSting(item?.rarity, result.dupe);
  if (!item) return null;

  const oddsPct = BOXES[result.box_key as BoxKey]?.odds[item.rarity] ?? 0;

  async function onShare() {
    try {
      await shareCardImage(cardRef, 'Share your unlock');
    } catch (e) {
      Alert.alert("Couldn't share that", getErrorMessage(e, 'Something went wrong.'));
    }
  }

  return (
    <Screen padded={false}>
      {/* Off-screen render target for the capture. Positioned rather than conditionally mounted so
          the ref is attached and laid out before the first tap on Share. */}
      <View style={styles.offscreen} pointerEvents="none">
        <UnlockShareCard
          ref={cardRef}
          item={item}
          oddsPct={oddsPct}
          handle={profile?.handle ?? null}
          tier={shareRank.tier}
          division={shareRank.division}
        />
      </View>
      <View style={styles.heroWrap}>
        <View style={[styles.heroGlow, { backgroundColor: rarityGlow(item.rarity, 0.45) }]} />
        <ItemArt item={item} size={140} />
      </View>
      <View style={styles.heroBody}>
        <View style={styles.newTag}>
          <Text style={styles.newTagText}>{result.dupe ? 'DUPLICATE' : 'NEW'}</Text>
        </View>
        <Text style={styles.heroName}>{item.name}</Text>
        <RarityLabel rarity={item.rarity} type={item.type} size={10} />
        {/* The auto-play above fires once; this is the replay. */}
        <View style={styles.previewRow}>
          <PreviewButton item={item} />
        </View>
        <Text style={styles.heroLore}>{item.lore}</Text>

        {result.dupe ? (
          <View style={styles.dupeNote}>
            <Text style={styles.dupeText}>
              You already owned this, so it turned into <Text style={styles.dupeEmbers}>{formatEmbers(result.embers)} embers</Text>.
              No duplicate sits dead in your inventory.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.ctaBar}>
        {!result.dupe && item.slot ? (
          <Pressable style={styles.primaryBtn} onPress={onEquip} disabled={equipping}>
            <Text style={styles.primaryBtnText}>{equipping ? 'Equipping…' : `Equip ${item.type.toLowerCase()}`}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.ghostBtn} onPress={onCollect}>
          <Text style={styles.ghostBtnText}>Collect → Inventory</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={onShare}>
          <Text style={styles.ghostBtnText}>Share</Text>
        </Pressable>
        <Text style={styles.oddsFlex}>
          {result.dupe ? 'Salvaged automatically' : `${RARITY_LABEL_TEXT[item.rarity]} pull from a ${result.box_key} box`}
        </Text>
      </View>
    </Screen>
  );
}

const RARITY_LABEL_TEXT: Record<Rarity, string> = {
  common: 'A Common',
  uncommon: 'An Uncommon',
  rare: 'A Rare',
  epic: 'An Epic',
  legendary: 'A Legendary',
  mythic: 'A MYTHIC',
};

// ── ×10: the results grid, dupes dimmed with their payout (§8.5 stage 3) ──
function MultiMenu({
  results,
  unopened,
  onDone,
}: {
  results: OpenResult[];
  /** Boxes in this batch that never opened — still unopened rows, not losses. */
  unopened: number;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const shareRank = useShareRank();
  const cardRef = useRef<View>(null);
  const best = bestOf(results);
  const dupeEmbers = results.reduce((sum, r) => sum + (r.dupe ? r.embers : 0), 0);
  const bestResult = results.find((r) => r.item?.rarity === best);
  const bestItem = bestResult?.item;
  // Hero pull only. Ten previews firing down a results grid would be a pile-up, not a reward.
  useRevealPreview(bestItem?.id);
  // The common→mythic sting, once for the haul's best pull (PUNCHLIST_14 §2). Muted when that pull
  // is a dupe — a dupe salvages to embers instead of granting the item, so the full war-horn would
  // be celebrating something the user didn't get.
  useRevealSting(best, bestResult?.dupe ?? false);

  async function onShare() {
    try {
      await shareCardImage(cardRef, 'Share your haul');
    } catch (e) {
      Alert.alert("Couldn't share that", getErrorMessage(e, 'Something went wrong.'));
    }
  }

  return (
    <Screen padded={false}>
      {/* ×10 leads with the best pull; the rest of the haul rides as a rarity-bordered chip
          strip (§8.5 / mock 60). */}
      {bestItem ? (
        <View style={styles.offscreen} pointerEvents="none">
          <UnlockShareCard
            ref={cardRef}
            item={bestItem}
            oddsPct={BOXES[bestResult?.box_key as BoxKey]?.odds[bestItem.rarity] ?? 0}
            handle={profile?.handle ?? null}
            tier={shareRank.tier}
            division={shareRank.division}
            haul={results.flatMap((r) => (r.item && r.item.id !== bestItem.id ? [r.item] : []))}
          />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.multiContent} showsVerticalScrollIndicator={false}>
        {/* A plain count leads, not the giant rarity-coloured BEST PULL hero that used to collide
            with everything on the screen (PUNCHLIST_14 §1). The best pull still gets named — it's
            genuinely the headline of the haul — but at the weight of a subtitle, and the grid
            below is what the screen is actually for. */}
        <Text style={styles.multiHeader}>You opened {results.length}</Text>
        {bestItem ? (
          <>
            <Text style={styles.multiBest}>
              Best: <Text style={{ color: RARITY_COLOR[best] }}>{bestItem.name}</Text>
            </Text>
            <View style={styles.previewRow}>
              <PreviewButton item={bestItem} />
            </View>
          </>
        ) : null}
        {dupeEmbers > 0 ? (
          <View style={styles.multiDupesRow}>
            <Text style={styles.multiDupes}>Duplicates salvaged for</Text>
            <EmberIcon size={12} />
            <Text style={styles.multiDupes}>{formatEmbers(dupeEmbers)}</Text>
          </View>
        ) : null}
        {unopened > 0 ? (
          <Text style={styles.multiUnopened}>
            {unopened} {unopened === 1 ? 'box' : 'boxes'} couldn&apos;t be opened — still unopened in your inventory.
          </Text>
        ) : null}

        <View style={styles.grid}>
          {results.map((r, i) => {
            const item = r.item;
            // An item the server granted that this build's catalog doesn't have still occupies a
            // cell. Dropping it silently would render nine cells for a ×10 and quietly hide the
            // one thing that went wrong; the key is shown so it's identifiable from a screenshot.
            if (!item) {
              return (
                <View key={`${r.cosmetic_key}-${i}`} style={[styles.gridCell, styles.gridCellDupe]}>
                  <Text style={styles.gridName} numberOfLines={2}>
                    {r.cosmetic_key}
                  </Text>
                  <Text style={styles.gridUnknown}>Update the app to see this</Text>
                </View>
              );
            }
            return (
              <View key={`${r.cosmetic_key}-${i}`} style={[styles.gridCell, r.dupe && styles.gridCellDupe]}>
                <ItemArt item={item} size={38} />
                <Text style={styles.gridName} numberOfLines={1}>
                  {item.name}
                </Text>
                <RarityLabel rarity={item.rarity} size={7} />
                {r.dupe ? <EmberAmount amount={r.embers} style={styles.gridEmbers} size={10} /> : null}
              </View>
            );
          })}
        </View>

        <Pressable style={styles.primaryBtn} onPress={onDone}>
          <Text style={styles.primaryBtnText}>Collect all → Inventory</Text>
        </Pressable>
        {bestItem ? (
          <Pressable style={[styles.ghostBtn, styles.multiShare]} onPress={onShare}>
            <Text style={styles.ghostBtnText}>Share the haul</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  rolling: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.muted,
  },
  dealing: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: Spacing.four,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  errorNote: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
    paddingHorizontal: Spacing.five,
    marginTop: -Spacing.two,
  },
  plainBtn: {
    paddingVertical: Spacing.two,
  },
  plainBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  heroWrap: {
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGlow: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
  },
  heroBody: {
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  newTag: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
    marginBottom: Spacing.two,
  },
  newTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 1,
    color: '#fff',
  },
  heroName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 24,
    color: Colors.ink,
    textAlign: 'center',
  },
  previewRow: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  heroLore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12.5,
    lineHeight: 19,
    color: '#b7a9cc',
    textAlign: 'center',
    marginTop: Spacing.twelve,
  },
  dupeNote: {
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.twelve,
    marginTop: Spacing.three,
  },
  dupeText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
  },
  dupeEmbers: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ember,
  },
  ctaBar: {
    marginTop: 'auto',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
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
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ember,
  },
  oddsFlex: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  multiContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.six,
  },
  // The count is the headline now and the best pull is its subtitle — the reverse of the old
  // hierarchy, where a 22pt rarity-coloured item name dominated the screen before the grid it was
  // supposedly introducing (PUNCHLIST_14 §1).
  multiHeader: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
    textAlign: 'center',
  },
  multiBest: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  multiDupesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: Spacing.one,
  },
  multiDupes: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  multiUnopened: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.coral,
    textAlign: 'center',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.four,
    marginBottom: Spacing.four,
  },
  gridCell: {
    width: '18.4%',
    backgroundColor: Colors.cardDark,
    borderRadius: 11,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    gap: 2,
  },
  // Dupes dimmed with their payout, per §8.5 — they read as "already had it, here's the embers"
  // rather than as a loss.
  gridCellDupe: {
    opacity: 0.45,
  },
  gridName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  gridEmbers: {
    fontSize: 8,
  },
  gridUnknown: {
    fontFamily: Fonts.body,
    fontSize: 6.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  multiShare: {
    marginTop: Spacing.two,
  },
  // Parked off-screen rather than unmounted: view-shot can only capture a view that is actually
  // laid out, and mounting it on tap would race the capture.
  offscreen: {
    position: 'absolute',
    left: -9999,
    top: 0,
  },
});
