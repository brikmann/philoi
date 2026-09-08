import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { OpenResult } from '@/lib/api/inventory';
import { RARITIES, RARITY_COLOR, RARITY_LABEL, rarityGlow, type Rarity } from '@/lib/economy/rarity';
import { fireLightTap, fireReveal } from '@/lib/reward-feedback';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ×5 / ×10 — THE FLIP-REVEAL. design-mocks/185 + 186, CODE_PROMPT_multi_open_reveal.md.
//
// WHAT THIS REPLACES AND WHY. `MultiDeal` dealt N crates in a cascade, each cracking in turn. That
// is the failure mode the spec names outright: ten serial crate sequences is up to sixteen seconds
// of animation nobody asked for, and it collapses ten separate moments into one long wait.
//
// The evidence-backed shape (Hearthstone's opener, cited in the prompt) is the opposite trade:
// ONE burst, then N face-down shards the player TAPS to flip. Anticipation is what actually pays
// out dopamine, and a tap is anticipation the player controls — they can mash through in four
// seconds or savour each one, and either way every card is still its own reveal instead of a
// spray-out. "Reveal all" exists for the third kind of player, who wants neither.
//
// 🔴 NO TELEGRAPH ON THE BACK FACE (#84). Every shard's back is identical — same border, same
// glyph, same everything. The instant a face-down card hints at what it is, the flip stops being
// a reveal. This is the same rule the crate's buildup follows, one screen later.
//
// 🔊 ONE STING, ON THE BURST, KEYED TO THE BEST PULL — and this is a deliberate reading of a spec
// that says two things. `CODE_PROMPT_multi_open_reveal.md`'s flip section asks for "a rarity-scaled
// sound on each flip"; its own Wiring section, and today's build directive, both say "one
// escalating sting keyed to the best pull's rarity ... not one sting per tile". The directive wins,
// and it is also the right call on the evidence already in this codebase: `fireBoxOpen` carries a
// note that ten cracks in two seconds "has to read as a run of cracks rather than a wall of them",
// and the six reveal cues are 1–5s with tails — reveal-mythic alone has a 5s aura tail. Ten of
// those overlapping is mush, and the Mythic sting would be buried under the nine after it.
//
// So the ladder fires ONCE, on the crate burst, at the best pull's rarity — the parent passes that
// rarity to `CrateOpen`. Each flip gets a soft tick, and a rare flip gets its rarity HAPTIC, which
// is the channel that can carry ten events without stacking.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Flip a shard's neighbours this far apart when "Reveal all" runs. Mock 185's ~90ms. */
const REVEAL_ALL_STAGGER_MS = 90;
const FLIP_MS = 420;

type Props = {
  results: OpenResult[];
  boxName: string;
  reduceMotion: boolean;
  /** All N revealed and the best pull has had its moment. */
  onDone: () => void;
  /** Equip the best pull, then finish. Absent while an equip is in flight. */
  onEquipBest?: (result: OpenResult) => void;
  equipping?: boolean;
};

export function FlipReveal({
  results,
  boxName,
  reduceMotion,
  onDone,
  onEquipBest,
  equipping,
}: Props) {
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());
  const [spotlight, setSpotlight] = useState(false);

  const bestIndex = useMemo(() => bestPull(results), [results]);
  const best = results[bestIndex];
  const bestRarity = asRarity(best?.rarity);

  const flip = useCallback(
    (i: number) => {
      setRevealed((prev) => {
        if (prev.has(i)) return prev;
        const next = new Set(prev);
        next.add(i);
        // The end crescendo runs when the LAST shard turns, regardless of which one it was — mock
        // 185 is explicit that flipping the best pull mid-way still gets its spotlight at the end.
        if (next.size === results.length) {
          setTimeout(() => setSpotlight(true), reduceMotion ? 0 : 650);
        }
        return next;
      });
      // Tick + the rarity haptic. NOT the rarity sting — see the header.
      fireLightTap();
      const r = asRarity(results[i]?.rarity);
      if (r === 'epic' || r === 'legendary' || r === 'mythic') {
        // fireReveal at dupe volume: the haptic pattern is what is wanted here, and passing dupe
        // drops the cue to 0.4 so a big flip is felt without ten cues fighting the burst's sting.
        fireReveal(r, true);
      }
    },
    [reduceMotion, results]
  );

  const revealAll = useCallback(() => {
    results.forEach((_, i) => {
      if (revealed.has(i)) return;
      setTimeout(() => flip(i), reduceMotion ? 0 : i * REVEAL_ALL_STAGGER_MS);
    });
  }, [flip, reduceMotion, results, revealed]);

  const counts = useMemo(() => rarityCounts(results), [results]);

  if (spotlight) {
    return (
      <BestPullSpotlight
        results={results}
        best={best}
        bestRarity={bestRarity}
        counts={counts}
        reduceMotion={reduceMotion}
        onDone={onDone}
        onEquipBest={onEquipBest ? () => onEquipBest(best) : undefined}
        equipping={equipping}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.label}>
          ×{results.length} · {boxName}
        </Text>
        <Text style={styles.count}>
          {revealed.size} / {results.length} revealed
        </Text>
      </View>
      <Text style={styles.hint}>Tap the shards to reveal</Text>

      <ScrollView contentContainerStyle={styles.gridWrap} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {results.map((r, i) => (
            <Shard
              key={`${r.cosmetic_key}-${i}`}
              result={r}
              revealed={revealed.has(i)}
              reduceMotion={reduceMotion}
              onPress={() => flip(i)}
            />
          ))}
        </View>
      </ScrollView>

      {revealed.size < results.length ? (
        <Pressable style={styles.revealAll} onPress={revealAll} accessibilityRole="button">
          <Text style={styles.revealAllText}>Reveal all →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One face-down card, and the item under it. */
function Shard({
  result,
  revealed,
  reduceMotion,
  onPress,
}: {
  result: OpenResult;
  revealed: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const turn = useSharedValue(0);
  const pop = useSharedValue(0);
  const rarity = asRarity(result.rarity);
  const tint = RARITY_COLOR[rarity];

  // Driven from the PROP rather than owned locally, so "Reveal all" flips a card through the same
  // path a tap does — one source of truth for whether a shard is face up.
  //
  // In an effect, not in the render body. Writing a shared value during render is the thing the
  // React Compiler's ref rule rejects, and it would also fire again on any unrelated re-render of
  // the parent — which, with ten shards and a revealed-count in state, is every single flip.
  useEffect(() => {
    if (!revealed) return;
    if (reduceMotion) {
      // Still tap-paced: the card turns instantly on the tap rather than not turning at all.
      turn.value = 1;
      return;
    }
    turn.value = withTiming(1, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) });
    pop.value = withDelay(
      FLIP_MS * 0.55,
      withSequence(withTiming(1, { duration: 260 }), withTiming(0, { duration: 420 }))
    );
  }, [revealed, reduceMotion, turn, pop]);

  const backStyle = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 1 : 0,
    transform: [{ perspective: 600 }, { rotateY: `${turn.value * 180}deg` }],
  }));
  const frontStyle = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 0 : 1,
    transform: [{ perspective: 600 }, { rotateY: `${turn.value * 180 - 180}deg` }],
  }));
  const calloutStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pop.value, [0, 0.4, 1], [0, 1, 0]),
    transform: [
      { translateY: interpolate(pop.value, [0, 1], [6, -22]) },
      { scale: interpolate(pop.value, [0, 0.4, 1], [0.7, 1.1, 1]) },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={revealed}
      accessibilityRole="button"
      accessibilityLabel={revealed ? (result.item?.name ?? 'Revealed') : 'Tap to reveal'}
      style={styles.cell}>
      {/* BACK — identical for every shard, whatever is under it (#84). */}
      <Animated.View style={[styles.face, styles.back, backStyle]}>
        <Text style={styles.backGlyph}>🔥</Text>
      </Animated.View>

      {/* FRONT */}
      <Animated.View
        style={[
          styles.face,
          styles.front,
          { borderColor: tint, backgroundColor: rarityGlow(rarity, 0.18), shadowColor: tint },
          frontStyle,
        ]}>
        {result.item ? <ItemArt item={result.item} size={38} /> : <Text style={styles.backGlyph}>◆</Text>}
        <Text style={[styles.tag, { color: tint }]} numberOfLines={1}>
          {RARITY_LABEL[rarity]}
        </Text>
        {/* Dupes salvage rather than stack (§8.3), and the haul is the only place the user finds
            out. A small note, not a reveal of its own — they did not "get" a second copy. */}
        {result.dupe && result.embers > 0 ? (
          <Text style={styles.dupe}>+{result.embers}</Text>
        ) : null}
      </Animated.View>

      {/* The rarity callout — the second channel pointing at a rare pull, alongside the colour. */}
      <Animated.View style={[styles.callout, calloutStyle]} pointerEvents="none">
        <Text style={[styles.calloutText, { color: tint }]}>
          {RARITY_LABEL[rarity]}
          {rarity === 'mythic' ? '!!' : rarity === 'epic' || rarity === 'legendary' ? '!' : ''}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/** The crescendo: the rarest thing in the haul, alone, then the sorted grid under it. */
function BestPullSpotlight({
  results,
  best,
  bestRarity,
  counts,
  reduceMotion,
  onDone,
  onEquipBest,
  equipping,
}: {
  results: OpenResult[];
  best: OpenResult | undefined;
  bestRarity: Rarity;
  counts: [Rarity, number][];
  reduceMotion: boolean;
  onDone: () => void;
  onEquipBest?: () => void;
  equipping?: boolean;
}) {
  const tint = RARITY_COLOR[bestRarity];
  // Rarity-sorted, best first — the haul reads as a ranking rather than as the order the server
  // happened to roll them in.
  const sorted = useMemo(
    () => [...results].sort((a, b) => rank(asRarity(b.rarity)) - rank(asRarity(a.rarity))),
    [results]
  );

  return (
    <View style={styles.root}>
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(320)}
        style={styles.spotlight}>
        <View style={[styles.discGlow, { backgroundColor: rarityGlow(bestRarity, 0.42) }]} />
        <View style={[styles.disc, { borderColor: tint, backgroundColor: rarityGlow(bestRarity, 0.2) }]}>
          {best?.item ? <ItemArt item={best.item} size={84} /> : null}
        </View>
        <Text style={[styles.bestRibbon, { color: tint }]}>★ BEST PULL</Text>
        <Text style={styles.bestName} numberOfLines={2}>
          {best?.item?.name ?? 'Your best pull'}
        </Text>
      </Animated.View>

      {/* Counts by rarity, high → low. */}
      <View style={styles.summary}>
        {counts.map(([r, n]) => (
          <View key={r} style={[styles.chip, { borderColor: RARITY_COLOR[r] }]}>
            <Text style={[styles.chipText, { color: RARITY_COLOR[r] }]}>
              {n} {RARITY_LABEL[r]}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.gridWrap} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {sorted.map((r, i) => {
            const rar = asRarity(r.rarity);
            return (
              <View
                key={`${r.cosmetic_key}-${i}`}
                style={[styles.tile, { borderColor: RARITY_COLOR[rar] }]}>
                {r.item ? <ItemArt item={r.item} size={34} /> : null}
                {/* NEW on a first-time pull; a dupe already said what it converted to. */}
                {!r.dupe ? <Text style={styles.newBadge}>NEW</Text> : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {onEquipBest ? (
          <Pressable
            style={[styles.primary, { borderColor: tint }, equipping && styles.disabled]}
            onPress={onEquipBest}
            disabled={equipping}
            accessibilityRole="button">
            <Text style={[styles.primaryText, { color: tint }]}>
              {equipping ? 'Equipping…' : 'Equip best'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondary} onPress={onDone} accessibilityRole="button">
          <Text style={styles.secondaryText}>Add all to inventory</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────── helpers ───────────────────────────

function rank(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/** The server sends rarity as a bare string; anything unrecognised reads as common rather than
 *  crashing the haul. A build whose catalog predates a rarity should still show the pull. */
function asRarity(value: string | undefined): Rarity {
  return (RARITIES as readonly string[]).includes(value ?? '') ? (value as Rarity) : 'common';
}

/** Index of the rarest pull. Ties keep the FIRST, per mock 181. */
export function bestPull(results: OpenResult[]): number {
  let bestI = 0;
  for (let i = 1; i < results.length; i += 1) {
    if (rank(asRarity(results[i].rarity)) > rank(asRarity(results[bestI].rarity))) bestI = i;
  }
  return bestI;
}

/** The rarity the ONE burst sting should play at — the best pull's. Exported so the screen can
 *  hand it to `CrateOpen` without re-deriving the sort. */
export function bestPullRarity(results: OpenResult[]): Rarity {
  return asRarity(results[bestPull(results)]?.rarity);
}

function rarityCounts(results: OpenResult[]): [Rarity, number][] {
  const tally = new Map<Rarity, number>();
  for (const r of results) {
    const rar = asRarity(r.rarity);
    tally.set(rar, (tally.get(rar) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => rank(b[0]) - rank(a[0]));
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingTop: Spacing.four },
  top: { alignItems: 'center', gap: 2 },
  label: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  count: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.muted },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, marginTop: Spacing.two },
  gridWrap: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  // 5-wide: ×5 is one row, ×10 is two — the shape mock 185 specifies.
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two, maxWidth: 5 * 68 },
  cell: { width: 60, height: 78 },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backfaceVisibility: 'hidden',
  },
  back: { backgroundColor: '#1a1327', borderColor: '#3a2c58' },
  backGlyph: { fontSize: 22, color: '#6a5f86' },
  front: { borderWidth: 2, shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, gap: 2 },
  tag: { fontFamily: Fonts.body, fontSize: 7.5, letterSpacing: 0.5 },
  dupe: { fontFamily: Fonts.body, fontSize: 8, color: Colors.amber },
  callout: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  calloutText: { fontFamily: Fonts.displayHeavy, fontSize: 13, letterSpacing: 0.6 },
  spotlight: { alignItems: 'center', paddingTop: Spacing.three },
  discGlow: { position: 'absolute', top: 0, width: 190, height: 190, borderRadius: 95, opacity: 0.7 },
  disc: {
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bestRibbon: { fontFamily: Fonts.displayHeavy, fontSize: 12, letterSpacing: 1.4, marginTop: Spacing.two },
  bestName: { fontFamily: Fonts.display, fontSize: 20, color: Colors.ink, textAlign: 'center', marginTop: 2 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.one, marginTop: Spacing.three, paddingHorizontal: Spacing.three },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  chipText: { fontFamily: Fonts.body, fontSize: 9.5, letterSpacing: 0.6 },
  tile: {
    width: 56,
    height: 56,
    borderRadius: Radius.card,
    borderWidth: 2,
    backgroundColor: '#171023',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBadge: { position: 'absolute', top: 2, right: 3, fontFamily: Fonts.body, fontSize: 7, color: Colors.green, letterSpacing: 0.4 },
  revealAll: {
    marginBottom: Spacing.four,
    backgroundColor: '#160f26',
    borderWidth: 1,
    borderColor: '#2c2340',
    borderRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingVertical: 10,
  },
  revealAllText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  footer: { width: '100%', paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  primary: { borderWidth: 1.5, borderRadius: Radius.card, paddingVertical: 13, alignItems: 'center' },
  primaryText: { fontFamily: Fonts.bodyBold, fontSize: 15 },
  secondary: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.muted },
  disabled: { opacity: 0.5 },
});
