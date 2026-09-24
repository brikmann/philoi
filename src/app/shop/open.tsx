import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { CrateOpen } from '@/components/economy/crate-open';
import { DropOddsLink, DropOddsSheet } from '@/components/economy/drop-odds';
import { FlipReveal, bestPull, bestPullRarity } from '@/components/economy/flip-reveal';
import { RarityLabel, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { ErrorBoundary } from '@/components/error-boundary';
import { Screen } from '@/components/ui/screen';
import { useRevealPreview } from '@/hooks/use-audio-preview';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useShareCardCapture } from '@/hooks/use-share-card-capture';
import { useShareRank } from '@/hooks/use-share-rank';
import { UnlockShareCard } from '@/components/economy/unlock-share-card';
import { useAuth } from '@/lib/auth/auth-context';
import { equipCosmetic, openBox, type OpenResult } from '@/lib/api/inventory';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import { getItem } from '@/lib/economy/catalog';
import { requestInventoryRefresh } from '@/lib/economy/wallet-refresh';
import { getErrorMessage } from '@/lib/errors';
import { rarityGlow, type Rarity } from '@/lib/economy/rarity';

// Box open (mocks 58/59, 21h). Three beats: crack → pulse → REWARD MENU.
//
// The critical ordering rule from §8.5: the SERVER decides everything (roll, guarantees, dupe
// conversion) before a single frame plays. So this screen opens every box up front, holds the
// finished results, and only then animates. The animation is a flourish over a decided outcome —
// it can never change what you got, and a crash mid-animation cannot cost you the pull.

// 'flipping' is the ×5/×10 leg, and it is where a batch ENDS: the flip-reveal's own spotlight is
// the last screen, and its "Collect all" leaves for the inventory. 'menu' is the single pull's hero
// and nothing else reaches it.
//
// 🔴 THERE IS ONE REVEAL PATH PER COUNT, and that is the whole point of this shape. A batch used to
// run the shards AND then a second grid (`MultiMenu`, deleted) that drew the same best pull and the
// same tiles again, so finishing the flips looked like the reveal restarting. A ×1 runs the crate
// and then its hero. Neither leg can fall through into the other's screen.
type Phase = 'rolling' | 'animating' | 'flipping' | 'menu';

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
  // Play's loot-box rule wants the drop rates one obvious tap away in the flow that spends the
  // box, not only on the detail screen that sold it. So the odds ride the pre-reveal beats here,
  // while the crate is still shut — reachable, and gone by the time the item is on screen so it
  // never reads as a pitch over the result.
  const [oddsOpen, setOddsOpen] = useState(false);

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

  // 🔴 ONLY EVER ADVANCES THE CRATE, never whatever came after it. `CrateOpen` hands a batch over
  // at the lid-off frame and is told not to report a finish (`handsOff`), but this guard is what
  // makes the ordering safe by construction rather than by that one flag being passed: a stray
  // `onDone` from any future caller cannot drag the screen out of 'flipping' and skip the flips.
  // That bug was the ×10 report — the cards appeared and were replaced before they could be tapped.
  const onAnimationDone = useCallback(
    () => setPhase((prev) => (prev === 'animating' ? 'menu' : prev)),
    []
  );

  // The box moved the wallet before this screen drew a frame: every dupe in the haul salvaged to
  // embers inside `open_loot_box`'s transaction. So leaving asks the pills to refetch — otherwise
  // the inventory this navigates INTO still shows the pre-open balance until something remounts it.
  const leaveForInventory = useCallback(() => {
    requestInventoryRefresh();
    router.replace('/inventory');
  }, [router]);

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

  const key = (boxKey as BoxKey) ?? 'kindling';
  const oddsFooter = (
    <>
      <DropOddsLink onPress={() => setOddsOpen(true)} label="Drop rates for this box" />
      <DropOddsSheet boxKey={oddsOpen ? key : null} onClose={() => setOddsOpen(false)} />
    </>
  );

  if (phase === 'rolling' || results.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.rolling}>Opening…</Text>
          {oddsFooter}
        </View>
      </Screen>
    );
  }

  if (phase === 'animating') {
    // ONE CRATE, ONE BURST, whether this is a ×1 or a ×10 — mock 186. The batch open used to deal
    // N crates in a cascade; ten serial crate sequences is up to sixteen seconds of animation and
    // it collapses ten reveals into one long wait.
    //
    // 🔊 The burst's sting is the BEST PULL's rarity on a batch, and the item's own on a single.
    // That is what makes one sting correct rather than a compromise: the loudest thing in the haul
    // is what the crate should sound like opening.
    return (
      <Screen>
        <View style={styles.center}>
          <CrateOpen
            boxKey={key}
            itemRarity={bestPullRarity(results)}
            reduceMotion={reduceMotion}
            label={`Opening ${isMulti ? `×${results.length} · ` : ''}${BOXES[key].name}`}
            size={220}
            // A batch swaps to the shards ON the lid-off frame, so the ray field the crate threw is
            // still up behind them (mock 186 keeps it as the backdrop rather than flashing it away).
            //
            // `handsOff` is the load-bearing half of that. This used to rely on the swap unmounting
            // the crate before its own `onDone` fired 140ms later, which is a race the Promethean
            // Vault loses — see the flag's own docstring. The flag closes the finish on the burst
            // frame instead, and hands the rarity sting to the flip-reveal, which is the only
            // screen that knows when the best pull is actually on screen.
            handsOff={isMulti}
            onBurst={isMulti ? () => setPhase('flipping') : undefined}
            onDone={onAnimationDone}
          />
          {oddsFooter}
        </View>
      </Screen>
    );
  }

  // Matched on isMulti rather than on 'flipping' so that a batch has no reachable screen past the
  // spotlight at all — not even if some future edit lets the phase reach 'menu'.
  if (isMulti) {
    return (
      <Screen>
        <MultiHaul
          results={results}
          boxKey={key}
          unopened={unopened}
          reduceMotion={reduceMotion}
          onDone={leaveForInventory}
        />
      </Screen>
    );
  }

  return (
    <SingleMenu
      result={results[0]}
      equipping={equipping}
      onEquip={async () => {
        const item = results[0].item;
        if (!item?.slot) return;
        setEquipping(true);
        try {
          await equipCosmetic(item);
          leaveForInventory();
        } catch (e) {
          Alert.alert("Couldn't equip that", getErrorMessage(e, 'Something went wrong.'));
        } finally {
          setEquipping(false);
        }
      }}
      onCollect={leaveForInventory}
    />
  );
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
  // 🐛 MOUNTED ON THE TAP, not for the life of the screen — see useShareCardCapture. A full story
  // card was being rendered off-screen behind every single reveal for a share most users never do.
  const { cardRef, mounted: cardMounted, onCardLayout, capture } = useShareCardCapture();
  const item = result.item ?? getItem(result.cosmetic_key);
  // Auditions the pull the moment it's revealed, when an audio cosmetic is what dropped — hearing
  // it is the reveal for those items, the way the art is for every other type. Hook runs before the
  // null guard below so it isn't called conditionally.
  useRevealPreview(item?.id);
  // On a 1× the sting is simply that item's own tier (PUNCHLIST_14 §2). Above the null guard for
  // the same reason as useRevealPreview — hooks may not be called conditionally.
  // 🔇 NO STING HERE ANY MORE. CrateOpen fires the rarity ladder on the lid-off frame, which is
  // where the spec puts it and where it actually lands with the picture. Leaving this call in
  // would play the same cue a second time as this screen mounts — audibly a stutter, and on a
  // Mythic two overlapping 5s tails.
  if (!item) return null;

  const oddsPct = BOXES[result.box_key as BoxKey]?.odds[item.rarity] ?? 0;

  async function onShare() {
    try {
      await capture('Share your unlock');
    } catch (e) {
      Alert.alert("Couldn't share that", getErrorMessage(e, 'Something went wrong.'));
    }
  }

  return (
    <Screen padded={false}>
      {/* Off-screen render target, mounted only while a capture is in flight. `onCardLayout` is
          what replaces the old "render it up front and hope" — the capture waits for this. */}
      {cardMounted ? (
        <View style={styles.offscreen} pointerEvents="none" onLayout={onCardLayout}>
          <UnlockShareCard
            ref={cardRef}
            item={item}
            oddsPct={oddsPct}
            handle={profile?.handle ?? null}
            tier={shareRank.tier}
            division={shareRank.division}
          />
        </View>
      ) : null}
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

// ── ×10: the flip-reveal owns the whole batch (mock 185 + 186) ──
//
// 🔴 WHAT THIS REPLACES. `MultiMenu` was a second results screen that rendered AFTER the flips: its
// own best-pull headline, its own rarity-bordered grid, its own "Collect all". Two screens saying
// the same thing in a row is what "'Add all to inventory' reverts to the old animation" was — the
// user finished the reveal and the reveal appeared to start over. `FlipReveal`'s spotlight is that
// screen, so this is now a wrapper with no UI of its own.
//
// What it does own is the two things a presentational reveal component should not: the off-screen
// share-card capture, and the equip round trip.
function MultiHaul({
  results,
  boxKey,
  unopened,
  reduceMotion,
  onDone,
}: {
  results: OpenResult[];
  boxKey: BoxKey;
  /** Boxes in this batch that never opened — still unopened rows, not losses. */
  unopened: number;
  reduceMotion: boolean;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const shareRank = useShareRank();
  // 🐛 MOUNTED ON THE TAP, not for the life of the screen — see useShareCardCapture. The worst case
  // for the old always-mounted pattern was exactly this screen: a ×10 rendered a complete 360×640
  // story card during the reveal animation, for a haul the user may never share.
  const { cardRef, mounted: cardMounted, onCardLayout, capture } = useShareCardCapture();
  const [equipping, setEquipping] = useState(false);

  const bestResult = results[bestPull(results)];
  const bestItem = bestResult?.item;
  // 🔇 NO `useRevealPreview` HERE. This wrapper mounts with the face-down grid, so auditioning the
  // best pull's audio from it would announce the haul before a single card turned. It belongs to
  // the spotlight, which mounts at the crescendo — see BestPullSpotlight.

  const onShare = useCallback(async () => {
    try {
      await capture('Share your haul');
    } catch (e) {
      Alert.alert("Couldn't share that", getErrorMessage(e, 'Something went wrong.'));
    }
  }, [capture]);

  const onEquipBest = useCallback(
    async (result: OpenResult) => {
      // A dupe granted embers, not the item — there is nothing in the inventory to equip.
      const item = result.dupe ? undefined : result.item;
      if (!item?.slot) return;
      setEquipping(true);
      try {
        await equipCosmetic(item);
        // The same exit as Collect, deliberately: both leave for the inventory and both have to
        // refresh the wallet the dupes in this haul already moved. Two copies of that pair is how
        // one of them ends up missing the refresh.
        onDone();
      } catch (e) {
        Alert.alert("Couldn't equip that", getErrorMessage(e, 'Something went wrong.'));
      } finally {
        setEquipping(false);
      }
    },
    [onDone]
  );

  return (
    <>
      {/* Parked off-screen, mounted only while a capture is in flight. `onCardLayout` is what
          replaces the old "render it up front and hope" — the capture waits for this. */}
      {bestItem && cardMounted ? (
        <View style={styles.offscreen} pointerEvents="none" onLayout={onCardLayout}>
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
      <FlipReveal
        results={results}
        boxName={BOXES[boxKey].name}
        reduceMotion={reduceMotion}
        unopened={unopened}
        equipping={equipping}
        // Only offered when the best pull is a NEW item with a slot. A dupe or a slotless SFX
        // cosmetic would hand the user a button that silently does nothing.
        onEquipBest={!bestResult?.dupe && bestItem?.slot ? onEquipBest : undefined}
        onShare={bestItem ? onShare : undefined}
        onDone={onDone}
      />
    </>
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
  // Parked off-screen rather than unmounted: view-shot can only capture a view that is actually
  // laid out, and mounting it on tap would race the capture.
  offscreen: {
    position: 'absolute',
    left: -9999,
    top: 0,
  },
});
