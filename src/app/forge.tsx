import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmberPill, RarityLabel } from '@/components/economy/economy-bits';
import { ForgeStrike } from '@/components/economy/forge-strike';
import { ItemArt } from '@/components/economy/item-art';
import { PreviewButton } from '@/components/economy/preview-button';
import { ErrorBoundary } from '@/components/error-boundary';
import { Screen } from '@/components/ui/screen';
import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useRevealPreview, useRevealSting } from '@/hooks/use-audio-preview';
import { useInventory, type OwnedItem } from '@/hooks/use-inventory';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { forgeCombine, isTierCompleteError, type ForgeResult } from '@/lib/api/forge';
import {
  FORGE_LADDER,
  dropPoolAt,
  isForgeFuel,
  isRungReachable,
  isTierComplete,
  stepRecipeLabel,
  stepTabLabel,
  type ForgeStep,
} from '@/lib/economy/forge';
import { RARITY_COLOR, rarityGlow, type Rarity } from '@/lib/economy/rarity';
import { getErrorMessage } from '@/lib/errors';

// THE FORGE (mock 155). Hephaestus' domain: hammer cosmetics you don't want into one you might.
//
// What it is NOT, which is the thing to hold on to while reading this file: a new currency, a
// crafting economy, or a second set of numbers to balance. There is no scrap resource, no ember
// cost, no yield to tune. "Scraps" is the word for cosmetics you already own and don't care about,
// and the whole feature is one inventory-combine — N of a rarity in, one of the next rarity out.
// Everything on screen therefore reads off the catalog and the inventory that already exist.
//
// Two facts are load-bearing and neither is decided here:
//
//   1. The OUTPUT TIER is guaranteed; the gamble is which item OF that tier you get. So there is no
//      "you might get nothing" state to render, and the CTA never has to hedge.
//   2. The server decides everything before a single frame plays (§8.5, the same rule shop/open.tsx
//      follows). forgeCombine has already deleted the inputs and granted the result by the time it
//      resolves — the hammer strike is a flourish over a settled outcome, and a render throw
//      downstream cannot cost anyone the combine. That is what the ErrorBoundary below is for.
//
// Deliberately NOT built (see the report): mock 155's "Stoke — reroll the result · 30 ✦" toggle, and
// the mixed-rarity gamble mode. Both are ember-priced gambles with their own odds to settle, and
// this build's confirmed mechanic is the deterministic tier-up. The seam is clean for either.

export default function ForgeScreen() {
  // The combine is BANKED before the reveal renders a frame. A crash in the reveal — a catalog key
  // this build doesn't know, an art kind with no case — must never read as "the Forge ate my
  // items": the boundary catches it and hands the user to the inventory the new item is already in.
  return (
    <ErrorBoundary title="That forged — the screen didn't" exitTo="/inventory" exitLabel="Go to inventory">
      <ForgeFlow />
    </ErrorBoundary>
  );
}

type Phase = 'picking' | 'forging' | 'reveal';

function ForgeFlow() {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { embers, owned, ownedKeys, loading, error, refetch } = useInventory();
  // The Inventory shortcut (mock 156 frame 2) deep-links with a rarity and a pre-made selection, so
  // "send these to the Forge" lands on a recipe that is already half full rather than on a blank one.
  const params = useLocalSearchParams<{ rarity?: string; items?: string }>();

  const [pickedRarity, setPickedRarity] = useState<Rarity | null>(
    FORGE_LADDER.some((s) => s.from === params.rarity) ? (params.rarity as Rarity) : null
  );
  const [selected, setSelected] = useState<string[]>(
    (params.items ?? '').split(',').filter(Boolean)
  );
  const [phase, setPhase] = useState<Phase>('picking');
  const [result, setResult] = useState<ForgeResult | null>(null);
  const [consumedItems, setConsumedItems] = useState<OwnedItem[]>([]);
  const [busy, setBusy] = useState(false);

  // Every owned item that is legal fuel, bucketed by rarity. Season items, relics and starter gear
  // never enter this map, so they cannot be selected — the server refuses them too, but a screen
  // that offers something and then fails the call is worse than one that never offers it.
  const fuelByRarity = useMemo(() => {
    const map = new Map<Rarity, OwnedItem[]>();
    for (const item of owned) {
      if (!isForgeFuel(item)) continue;
      map.set(item.rarity, [...(map.get(item.rarity) ?? []), item]);
    }
    return map;
  }, [owned]);

  // Open on the highest rung you can actually complete — the one you came here to use. Falling back
  // to the first rung would put a new user on Common, which is the one rung nobody can finish.
  //
  // 🐛 "The Forge is broken" (Noah, on-device). It was this line, and it had nothing to do with the
  // backend: the landing rung was chosen on FUEL ALONE. Owning three legendaries selected Legendary
  // → Mythic — and both test accounts own all five droppable mythics, so that rung is closed by
  // `tier_complete`. A closed rung does not merely disable the button: the fuel grid is REPLACED by
  // the "every mythic is yours" panel, so the screen opens with no items to feed, nothing to
  // animate and nothing to grant. Exactly the report, and every rung below it was open the whole
  // time.
  //
  // So a rung has to be OPEN to be landed on, not just affordable. `isRungReachable` joins the test
  // for the same reason: a rung the content can't satisfy is equally a dead screen to open on.
  const isOpen = (s: ForgeStep) => isRungReachable(s) && !isTierComplete(s.into, ownedKeys);
  const step: ForgeStep =
    FORGE_LADDER.find((s) => s.from === pickedRarity) ??
    [...FORGE_LADDER].reverse().find((s) => isOpen(s) && (fuelByRarity.get(s.from)?.length ?? 0) >= s.need) ??
    // Nothing is fillable yet. Still land on an OPEN rung so the picker shows real fuel and asks for
    // more, rather than on a closed one that explains why it can never be used.
    [...FORGE_LADDER].reverse().find((s) => isOpen(s) && (fuelByRarity.get(s.from)?.length ?? 0) > 0) ??
    [...FORGE_LADDER].find(isOpen) ??
    FORGE_LADDER[2];

  const fuel = fuelByRarity.get(step.from) ?? [];
  const picked = fuel.filter((i) => selected.includes(i.ownedId));
  const reachable = isRungReachable(step);
  // Owning the whole target tier closes the rung: the Forge only ever outputs something you don't
  // own, so there is nothing left for it to make. Checked here so the recipe greys out before any
  // effort goes into filling it — the server refuses it anyway, with `tier_complete`, having
  // consumed nothing.
  const tierComplete = isTierComplete(step.into, ownedKeys);
  const ready = picked.length === step.need && !tierComplete;
  // The size of the set the roll actually draws from — what's left at the target tier, not the tier.
  const unownedAtTarget = dropPoolAt(step.into).filter((i) => !ownedKeys.has(i.id)).length;

  function chooseStep(next: ForgeStep) {
    setPickedRarity(next.from);
    // Selection does not survive a rarity change: fuel is rarity-locked, so carrying it over would
    // mean a recipe holding items it cannot use.
    setSelected([]);
  }

  function toggle(item: OwnedItem) {
    setSelected((prev) => {
      if (prev.includes(item.ownedId)) return prev.filter((id) => id !== item.ownedId);
      if (prev.length >= step.need) return prev;
      return [...prev, item.ownedId];
    });
  }

  async function onForge() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      // Snapshot what is going in BEFORE the call: the rows are gone server-side the moment it
      // returns, and the strike animation draws exactly the items the user chose.
      setConsumedItems(picked);
      const res = await forgeCombine(step.from, picked.map((i) => i.ownedId));
      setResult(res);
      setSelected([]);
      setPhase('forging');
      // Refetched now rather than after the animation so the inventory behind the reveal is already
      // correct when the user collects.
      void refetch();
    } catch (e) {
      setConsumedItems([]);
      // tier_complete is not a failure, it is an answer — and the one thing the user needs to hear
      // is that the attempt cost them nothing. Titled accordingly rather than as an error.
      if (isTierCompleteError(e)) {
        Alert.alert(
          `You own every ${step.into}`,
          `There's nothing left for the Forge to make at that tier, so your ${step.from}s weren't touched. Try a different reforge path.`
        );
      } else {
        Alert.alert("The Forge wouldn't take that", getErrorMessage(e, 'Something went wrong.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const onStrikeDone = useCallback(() => setPhase('reveal'), []);

  if (phase === 'forging' && result) {
    return (
      <Screen padded={false}>
        {/* The kicker is UNDER the strike in z-order, so the closing flash washes it out along with
            everything else — a label still sitting there on white would break the hand-off. */}
        <View style={styles.strikeWrap}>
          <Text style={styles.forgingKicker}>FORGING…</Text>
          <ForgeStrike inputs={consumedItems} reduceMotion={reduceMotion} onDone={onStrikeDone} />
        </View>
      </Screen>
    );
  }

  if (phase === 'reveal' && result) {
    return (
      <ForgeReveal
        result={result}
        onDone={() => router.replace('/inventory')}
        onAgain={() => {
          setResult(null);
          setConsumedItems([]);
          setPhase('picking');
        }}
      />
    );
  }

  // EVERY RUNG CLOSED. Not a variant of the per-rung "you own every Epic" panel — that one tells you
  // to pick another path, and here there is no other path to pick. Noah's main account is in exactly
  // this state (it owns all 64 droppable cosmetics), so the old screen greeted it with a dead recipe
  // and an instruction it could not follow, which is the other half of "the Forge doesn't work".
  //
  // Checked only once the inventory has actually loaded: `owned` is empty on the first frame, which
  // makes every tier look complete for a moment, and flashing "you finished the collection" at
  // someone who owns nothing would be the worst possible version of this screen.
  const anyOpen = FORGE_LADDER.some(isOpen);
  if (!loading && !error && owned.length > 0 && !anyOpen) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.top}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={22} color={Colors.ink} />
            </Pressable>
            <View style={styles.titleRow}>
              <PhiloiIcon name="forge" size={20} color={Colors.ember} />
              <Text style={styles.title}>The Forge</Text>
            </View>
            <EmberPill embers={embers} />
          </View>
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>The Forge has nothing left to make you.</Text>
            <Text style={styles.emptyBody}>
              You own every one of the {dropPoolAt('common').length +
                dropPoolAt('uncommon').length +
                dropPoolAt('rare').length +
                dropPoolAt('epic').length +
                dropPoolAt('legendary').length +
                dropPoolAt('mythic').length}{' '}
              cosmetics the Forge can produce, at every rarity. It only ever outputs something you
              don&apos;t own, so every path is closed — and nothing of yours will be taken.
            </Text>
            <Text style={styles.emptyBody}>
              Season and Flame Pass items are earned, never forged. New drops open the Forge back up.
            </Text>
            <Pressable style={styles.emptyCta} onPress={() => router.push('/inventory')}>
              <Text style={styles.emptyCtaText}>Go to inventory</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.ink} />
          </Pressable>
          <View style={styles.titleRow}>
            <PhiloiIcon name="forge" size={20} color={Colors.ember} />
            <Text style={styles.title}>The Forge</Text>
          </View>
          <EmberPill embers={embers} />
        </View>
        <Text style={styles.subtitle}>Combine items to craft a higher rarity.</Text>

        {/* ── The reforge path (mock 155's tab strip) ── */}
        <View style={styles.tabs}>
          {FORGE_LADDER.map((s) => {
            const on = s.from === step.from;
            const have = fuelByRarity.get(s.from)?.length ?? 0;
            // Two different ways a rung can be shut, dimmed the same way because they are the same
            // news to the user: this path has nothing to give you.
            const shut = !isRungReachable(s) || isTierComplete(s.into, ownedKeys);
            return (
              <Pressable
                key={s.from}
                style={[styles.tab, on && styles.tabOn, shut && styles.tabDead]}
                onPress={() => chooseStep(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: shut }}
                accessibilityLabel={
                  isTierComplete(s.into, ownedKeys)
                    ? `${stepRecipeLabel(s)}, closed — you own every ${s.into}`
                    : `${stepRecipeLabel(s)}, you have ${have}`
                }>
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{stepTabLabel(s)}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── The recipe ── */}
        <View style={styles.recipe}>
          <Text style={styles.recipeLabel}>{stepRecipeLabel(step)}</Text>
          <View style={styles.slots}>
            {Array.from({ length: step.need }).map((_, i) => {
              const item = picked[i];
              return item ? (
                <Pressable
                  key={item.ownedId}
                  style={[styles.slot, { borderColor: RARITY_COLOR[step.from] }]}
                  onPress={() => toggle(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}>
                  <ItemArt item={item} size={30} />
                </Pressable>
              ) : (
                <View key={`empty-${i}`} style={[styles.slot, styles.slotEmpty]}>
                  <Text style={styles.slotPlus}>+</Text>
                </View>
              );
            })}
            <Text style={styles.arrow}>→</Text>
            <View style={[styles.out, { borderColor: RARITY_COLOR[step.into] }]}>
              <Text style={[styles.outQ, { color: RARITY_COLOR[step.into] }]}>?</Text>
            </View>
          </View>
          <Text style={[styles.recipeHint, tierComplete && styles.recipeHintShut]}>
            {tierComplete
              ? `You own every ${step.into} — nothing to forge toward`
              : ready
                ? `Ready — one ${step.into} you don't own, guaranteed`
                : `Pick ${step.need - picked.length} more ${step.from} from below`}
          </Text>
        </View>

        {/* ── What you'll get ──
            The pool is named honestly, including how much of it is still open to you, because
            "a random Epic" without a denominator is the kind of claim a loot screen shouldn't make.
            Since 0139 the denominator is the UN-OWNED count, not the pool size — that is the set the
            roll actually draws from, so it is the number that tells the truth. */}
        <Text style={styles.sectionLabel}>What you&apos;ll get</Text>
        <View style={styles.explain}>
          {tierComplete ? (
            <Text style={styles.explainText}>
              You own <Text style={{ color: RARITY_COLOR[step.into], fontFamily: Fonts.bodyBold }}>every {step.into}</Text>{' '}
              the Forge can make — all {dropPoolAt(step.into).length} of them. This path has nothing
              left to give you, so it won&apos;t take your {step.from}s. Pick another above.
            </Text>
          ) : (
            <Text style={styles.explainText}>
              A <Text style={{ color: RARITY_COLOR[step.into], fontFamily: Fonts.bodyBold }}>random {step.into}</Text> you
              don&apos;t own — flame, particle, card, halo, whatever the Forge spits out, one of the{' '}
              {unownedAtTarget} still missing from your collection. Never a duplicate, and never
              embers instead.
            </Text>
          )}
          <Text style={styles.explainFine}>
            Season and Flame Pass items can never be forged — not made by the Forge, and never taken
            by it. Relics are earned, not fuel.
          </Text>
        </View>

        {/* ── The fuel ── */}
        <Text style={styles.sectionLabel}>
          Your {step.from}s · {fuel.length} eligible
        </Text>

        {loading ? <Text style={styles.hint}>Loading…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Every rung is satisfiable today, so this branch is dead — and it stays, because Common is
            satisfiable with zero margin (it needs 4 and exactly 4 commons can drop). Retire one and
            the recipe becomes impossible, which would otherwise present as an inventory that looks
            empty for no reason. Cheaper to say it than to debug it. */}
        {!reachable ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>This recipe isn&apos;t open yet.</Text>
            <Text style={styles.emptyBody}>
              {stepRecipeLabel(step)} needs {step.need} different {step.from}s, and only{' '}
              {dropPoolAt(step.from).length} can drop today. Nothing you can do about it — pick
              another path above.
            </Text>
          </View>
        ) : tierComplete ? (
          /* The completionist's dead end, and it should read as an achievement rather than an
             error — they finished the tier. The one thing that must be unambiguous is that their
             fuel is safe, because the previous behaviour here was to eat it and pay embers. */
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Every {step.into} is yours.</Text>
            <Text style={styles.emptyBody}>
              All {dropPoolAt(step.into).length} of them. The Forge only makes things you don&apos;t
              own, so this path is closed — and your {step.from}s stay exactly where they are.
            </Text>
          </View>
        ) : !loading && fuel.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No {step.from}s to spare.</Text>
            <Text style={styles.emptyBody}>
              Only items from the box drop pool can be forged. Open a box or win a challenge, then
              come back with the ones you don&apos;t want.
            </Text>
            <Pressable style={styles.emptyCta} onPress={() => router.push('/shop')}>
              <Text style={styles.emptyCtaText}>Open the Shop</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.grid}>
            {fuel.map((item) => {
              const on = selected.includes(item.ownedId);
              const full = !on && picked.length >= step.need;
              return (
                <Pressable
                  key={item.ownedId}
                  style={[styles.cell, on && styles.cellOn, full && styles.cellFull]}
                  onPress={() => toggle(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: full }}
                  accessibilityLabel={`${item.name}, ${item.rarity}${item.equipped ? ', equipped' : ''}`}>
                  <ItemArt item={item} size={34} />
                  <Text style={styles.cellName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {/* Equipping is not protection — the server clears the loadout row with the item.
                      Saying so on the tile is the only warning there is going to be. */}
                  {item.equipped ? <Text style={styles.cellWorn}>WORN</Text> : null}
                  {on ? (
                    <View style={styles.cellTick}>
                      <Text style={styles.cellTickText}>✓</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={styles.ctaBar}>
        <Pressable
          style={[styles.primaryBtn, (!ready || busy) && styles.primaryBtnOff]}
          onPress={onForge}
          disabled={!ready || busy}
          accessibilityRole="button">
          <PhiloiIcon name="forge" size={18} color={ready && !busy ? Colors.onEmber : Colors.textTertiary} />
          <Text style={[styles.primaryBtnText, (!ready || busy) && styles.primaryBtnTextOff]}>
            {busy
              ? 'Forging…'
              : tierComplete
                ? `Nothing left to forge at ${step.into}`
                : ready
                  ? 'Forge'
                  : `Forge · needs ${step.need - picked.length} more ${step.from}`}
          </Text>
        </Pressable>
        <Text style={styles.ctaFine}>The Forge is free — the items are the cost.</Text>
      </View>
    </Screen>
  );
}

// ── The reveal ──
// Built from the same primitives shop/open.tsx's SingleMenu uses — ItemArt, RarityLabel,
// PreviewButton and the two reveal hooks — so a forged Legendary lands with the same weight as a
// pulled one. Not shared as a component because the two say different things around the item: a box
// names its odds, and the Forge names what it ate.
function ForgeReveal({
  result,
  onDone,
  onAgain,
}: {
  result: ForgeResult;
  onDone: () => void;
  onAgain: () => void;
}) {
  const item = result.item;
  // Auditions an audio cosmetic the moment it's revealed — hearing it IS the reveal for those items.
  // Both hooks sit above the null guard because hooks may not be called conditionally.
  useRevealPreview(item?.id);
  useRevealSting(item?.rarity, result.dupe);

  if (!item) {
    // The server granted something this build's catalog doesn't know. Say so with the key rather
    // than rendering blank — it is already in the inventory either way.
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Forged {result.cosmetic_key}</Text>
          <Text style={styles.emptyBody}>Update the app to see this one.</Text>
          <Pressable style={styles.ghostBtn} onPress={onDone}>
            <Text style={styles.ghostBtnText}>Go to inventory</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.heroWrap}>
        <View style={[styles.heroGlow, { backgroundColor: rarityGlow(item.rarity, 0.45) }]} />
        <ItemArt item={item} size={140} />
      </View>
      <View style={styles.heroBody}>
        <View style={styles.forgedTag}>
          <Text style={styles.forgedTagText}>
            FORGED · {result.consumed} × {result.input_rarity.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.heroName}>{item.name}</Text>
        <RarityLabel rarity={item.rarity} type={item.type} size={10} />
        <View style={styles.previewRow}>
          <PreviewButton item={item} />
        </View>
        <Text style={styles.heroLore}>{item.lore}</Text>
        {/* No dupe branch, and that is the point. Since 0139 the roll draws only from what you don't
            own, so a reveal is always something new — there is no "turned into embers instead" case
            left to render, and a screen that still handled it would be describing behaviour the
            server refuses to produce. */}
      </View>

      {/* Pushed to the bottom with marginTop rather than pinned like the picker's bar: there is no
          scrolling content to sit over here, and a bordered bar under a hero reads as a toolbar. */}
      <View style={styles.revealCtas}>
        <Pressable style={styles.primaryBtn} onPress={onDone}>
          <Text style={styles.primaryBtnText}>Add to inventory</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={onAgain}>
          <Text style={styles.ghostBtnText}>Forge again</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: 140,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: Spacing.half,
    marginBottom: Spacing.three,
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.one,
    marginBottom: Spacing.twelve,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: Radius.card,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  tabOn: {
    borderColor: Colors.amber,
    backgroundColor: Colors.achieverBg,
  },
  // A rung with no way to fill it reads as dimmed rather than hidden — the ladder is the ladder,
  // and a missing tab would be a lie about the design.
  tabDead: {
    opacity: 0.45,
  },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.textTertiary,
  },
  tabTextOn: {
    color: Colors.ember,
  },
  recipe: {
    backgroundColor: Colors.cardDark,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.twelve,
    alignItems: 'center',
  },
  recipeLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.4,
    color: Colors.muted,
    marginBottom: Spacing.two,
  },
  slots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  slot: {
    width: 44,
    height: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: Colors.card,
  },
  slotEmpty: {
    borderStyle: 'dashed',
    borderColor: Colors.trackAlt,
    backgroundColor: Colors.twilight900,
  },
  slotPlus: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.trackAlt,
  },
  arrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.amber,
    marginHorizontal: 2,
  },
  out: {
    width: 50,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: Colors.twilight900,
  },
  outQ: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
  },
  recipeHint: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.amber,
    marginTop: Spacing.twelve,
    textAlign: 'center',
  },
  // A closed rung drops out of ember: the amber line is the call to action, and "you own every Epic"
  // is not one. It is information, and it should read at the weight of information.
  recipeHintShut: {
    color: Colors.textTertiary,
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  explain: {
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.twelve,
    gap: Spacing.two,
  },
  explainText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.muted,
  },
  explainFine: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  cell: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    padding: Spacing.one,
  },
  cellOn: {
    borderColor: Colors.amber,
    backgroundColor: Colors.selectedBg,
  },
  // Not disabled — still tappable to no effect would be confusing, so it dims to say "the recipe is
  // full, put something back first".
  cellFull: {
    opacity: 0.4,
  },
  cellName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: Colors.ink,
    textAlign: 'center',
  },
  cellWorn: {
    fontFamily: Fonts.bodyBold,
    fontSize: 6.5,
    letterSpacing: 0.6,
    color: Colors.amber,
  },
  cellTick: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTickText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.onEmber,
  },
  empty: {
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
  },
  emptyCta: {
    backgroundColor: Colors.card,
    borderRadius: Radius.button,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.one,
  },
  emptyCtaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ember,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.coral,
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
    backgroundColor: Colors.twilight900,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.coral,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryBtnOff: {
    backgroundColor: Colors.disabled,
  },
  primaryBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.onEmber,
  },
  primaryBtnTextOff: {
    color: Colors.textTertiary,
  },
  ctaFine: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  revealCtas: {
    marginTop: 'auto',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
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
  // ── forging ──
  strikeWrap: {
    flex: 1,
  },
  // Parked absolutely near the top and rendered BEFORE the strike, so the strike's full-screen
  // flash paints over it. Laid out in flow it would sit above the stage and survive the wash,
  // leaving one grey label on a white screen at the exact moment the reveal takes over.
  forgingKicker: {
    position: 'absolute',
    top: 90,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.muted,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  // ── reveal ──
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
  forgedTag: {
    backgroundColor: Colors.amber,
    borderRadius: Radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
    marginBottom: Spacing.two,
  },
  forgedTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 1,
    color: Colors.onEmber,
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
});
