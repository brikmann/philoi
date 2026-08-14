import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { BoxArt } from '@/components/economy/box-art';
import { BoxCrack } from '@/components/economy/box-crack';
import type { BoxKey } from '@/lib/economy/boxes';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { OpenResult } from '@/lib/api/inventory';

// The ×10 card-shuffle deal (§8.5, mock 59).
//
// One box sits in the centre as the deck; ten copies deal off it into a 2×5 grid, top-left →
// bottom-right on a ~0.06s stagger. Then each cell runs the same crack + pulse in that same
// cascade order.
//
// The results are ALREADY DECIDED before this mounts — the animation is choreography over a
// settled outcome, never a source of one.
//
// It is also deliberately BLIND to those results (PUNCHLIST_14 §1). Cells used to carry
// `borderColor: RARITY_COLOR[rarity]` and the cracks flashed their tier, so a ×10 read as a rarity
// light-show that had already announced every pull before a single item appeared. Now the deal
// says "ten boxes are opening" and nothing more; rarity is the results grid's to reveal.

const STAGGER_MS = 60;
const DEAL_MS = 280;
const CRACK_STAGGER_MS = 220;

type Props = {
  boxKey: BoxKey;
  results: OpenResult[];
  reduceMotion: boolean;
  onDone: () => void;
};

export function MultiDeal({ boxKey, results, reduceMotion, onDone }: Props) {
  const [cracking, setCracking] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      // Reduced motion: no deal, no cascade — straight to the results grid (§8.5's closing note).
      onDone();
      return;
    }
    const dealDuration = results.length * STAGGER_MS + DEAL_MS;
    const t = setTimeout(() => setCracking(true), dealDuration);
    return () => clearTimeout(t);
  }, [reduceMotion, results.length, onDone]);

  // The last card's crack ends the whole sequence. Tracked by index rather than a count so a
  // dropped callback can't leave the screen stuck mid-animation.
  const lastIndex = results.length - 1;

  return (
    <View style={styles.wrap}>
      {/* The deck the cards deal off. Fades once the cascade starts so the grid owns the screen. */}
      {!cracking ? (
        <View style={styles.deck}>
          <BoxArt boxKey={boxKey} size={72} />
        </View>
      ) : null}

      <View style={styles.grid}>
        {results.map((r, i) => (
          <DealtCard
            key={`${r.cosmetic_key}-${i}`}
            index={i}
            boxKey={boxKey}
            cracking={cracking}
            onCracked={i === lastIndex ? onDone : undefined}
          />
        ))}
      </View>

      <Text style={styles.caption}>{cracking ? 'Opening…' : `Dealing ${results.length}…`}</Text>
    </View>
  );
}

function DealtCard({
  index,
  boxKey,
  cracking,
  onCracked,
}: {
  index: number;
  boxKey: BoxKey;
  cracking: boolean;
  onCracked?: () => void;
}) {
  // Cards fly in from the deck position (centre, above the grid) to their own slot.
  const dealt = useSharedValue(0);

  useEffect(() => {
    dealt.value = withDelay(index * STAGGER_MS, withTiming(1, { duration: DEAL_MS, easing: Easing.out(Easing.cubic) }));
  }, [index, dealt]);

  const style = useAnimatedStyle(() => ({
    opacity: dealt.value,
    transform: [
      { translateY: (1 - dealt.value) * -90 },
      { scale: 0.7 + dealt.value * 0.3 },
      { rotate: `${(1 - dealt.value) * (index % 2 === 0 ? -12 : 12)}deg` },
    ],
  }));

  return (
    // Neutral card border — the cell shows plain box art, not a rarity-tinted shape.
    <Animated.View style={[styles.cell, style]}>
      {cracking ? (
        <CascadedCrack index={index} boxKey={boxKey} onCracked={onCracked} />
      ) : (
        <BoxArt boxKey={boxKey} size={34} />
      )}
    </Animated.View>
  );
}

/** Delays each cell's crack so the ten open in the same order they were dealt. */
function CascadedCrack({
  index,
  boxKey,
  onCracked,
}: {
  index: number;
  boxKey: BoxKey;
  onCracked?: () => void;
}) {
  const [started, setStarted] = useState(index === 0);

  useEffect(() => {
    if (started) return;
    const t = setTimeout(() => setStarted(true), index * CRACK_STAGGER_MS);
    return () => clearTimeout(t);
  }, [index, started]);

  if (!started) return <BoxArt boxKey={boxKey} size={34} />;

  // BoxCrack already hops back to the JS thread before calling onDone, so this is a plain callback.
  return <BoxCrack boxKey={boxKey} reduceMotion={false} size={52} onDone={() => onCracked?.()} />;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  deck: {
    position: 'absolute',
    top: '18%',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  // 2×5 — five across, two rows (§8.5).
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    maxWidth: 340,
  },
  cell: {
    width: 58,
    height: 58,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.line,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: Spacing.five,
  },
});
