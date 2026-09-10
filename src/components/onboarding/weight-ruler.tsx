import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// design-mocks/188 — the weight step's picker, the sibling of height-ruler.tsx (mock 128).
//
// WHY A SECOND COMPONENT RATHER THAN A GENERIC ONE. The two rulers look identical and are not the
// same control. Height is an integer in one unit with a lossless ft/in view; weight has to survive
// a round trip through lb, which is not a whole number of kg, so it carries a decimal and it snaps
// on a unit switch. Generalising them would mean one component with a `unitSystem` prop and two
// mutually exclusive halves — the height step would then be one edit away from inheriting a bug
// that only weight can have.
//
// ONE UNIT INTERNALLY, ALWAYS KILOGRAMS. `set_my_weight_kg` takes kg and Cindy divides a load by
// it, so kg is the only value that leaves this component. The lb/kg toggle changes what the ruler
// is DRAWN in and what a snap lands on, never the stored quantity.
//
// TWO DECIMALS, and it matters. 160 lb is 72.5748 kg. Rounded to a whole kg it comes back as
// 160.9 lb — the number the user picked is not the number they would be shown again, which reads
// as the app having quietly changed their weight. Two decimals round-trip every whole lb value
// back to itself.

/** Comfortably inside the column's `20 < weight_kg < 400` check and wide enough for everyone:
 *  ~77 lb to ~441 lb. Nothing outside it is selectable, so the RPC cannot be handed a value the
 *  constraint would reject. */
const MIN_KG = 35;
const MAX_KG = 200;

const LB_PER_KG = 2.2046226218;

/** 160 lb, the mock's opening value, expressed in the unit we store. Unlike height there is no
 *  server-side fallback this "already is" — a missing weight means Cindy asks or falls back to the
 *  demographic anchors — so this is only ever a sensible place to start scrolling from, and the
 *  step is skippable precisely because it is a default rather than a guess about this person. */
export const DEFAULT_WEIGHT_KG = 72.57;

/** lb is first because the mock opens on it and because the demographic this ships to is North
 *  American. Stored on the profile so Settings speaks the unit the user last chose. */
export type WeightUnit = 'lb' | 'kg';

/** Tick geometry per unit. lb ticks are NARROWER because a pound is smaller than a kilo, so there
 *  are ~2.2× more of them across the same span — the mirror image of height, where the coarser
 *  unit (inches) got the wider tick. Both work out to a labelled major roughly every 100pt. */
const TICK_WIDTH: Record<WeightUnit, number> = { lb: 10, kg: 20 };
/** Every Nth tick is a tall, labelled one: 10 lb, or 5 kg. */
const MAJOR_EVERY: Record<WeightUnit, number> = { lb: 10, kg: 5 };

const MIN_LB = Math.ceil(MIN_KG * LB_PER_KG);
const MAX_LB = Math.floor(MAX_KG * LB_PER_KG);

/** Two decimals, clamped into the column's range. The single place a kg value is rounded. */
const toKg = (kg: number) => Math.min(MAX_KG, Math.max(MIN_KG, Math.round(kg * 100) / 100));

export const kgToLb = (kg: number) => Math.round(kg * LB_PER_KG);

/** 72.57 → "72.6", 73 → "73". Trailing ".0" is noise on a number nobody reports to a tenth. */
export function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

/** What the readout shows, in whichever unit is on screen. Exported so Settings can render a
 *  stored weight in the user's own unit without duplicating the rounding. */
export function formatWeight(kg: number, unit: WeightUnit): string {
  return unit === 'lb' ? `${kgToLb(kg)}` : formatKg(kg);
}

type Props = {
  /** Always kilograms. */
  value: number;
  unit: WeightUnit;
  onUnitChange: (unit: WeightUnit) => void;
  /**
   * `source` is the whole reason this differs from HeightRuler's `onChange`.
   *
   * A unit switch has to move `value` — 72.57 kg is not on a whole-kg tick, so leaving it put
   * would show a readout that disagrees with the tick the cursor is sitting on. But a user who
   * toggles lb→kg out of curiosity and then taps Continue has not told us their weight, and the
   * caller must be able to tell that apart from a scroll. Folding the two together is how an
   * untouched default gets written to the profile as if it were a measurement.
   */
  onChange: (kg: number, source: 'scroll' | 'unit') => void;
};

export function WeightRuler({ value, unit, onUnitChange, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  // The last value a scroll produced. Compared against before firing a haptic so the tick only
  // clicks when the number actually changes, not on every pixel of momentum.
  const lastReportedRef = useRef(value);

  const tickWidth = TICK_WIDTH[unit];
  const majorEvery = MAJOR_EVERY[unit];

  // One entry per selectable position, in whatever unit the ruler is currently drawn in. kg mode
  // steps by 1 kg; lb mode steps by a whole pound, so a snap in that mode lands on a pound
  // boundary rather than on whichever kilogram happened to be nearest.
  const ticks = useMemo(() => {
    if (unit === 'kg') {
      return Array.from({ length: MAX_KG - MIN_KG + 1 }, (_, i) => ({
        kg: MIN_KG + i,
        label: `${MIN_KG + i}`,
      }));
    }
    return Array.from({ length: MAX_LB - MIN_LB + 1 }, (_, i) => {
      const lb = MIN_LB + i;
      return { kg: toKg(lb / LB_PER_KG), label: `${lb}` };
    });
  }, [unit]);

  /** Nearest tick to a kg value — the bridge between the stored quantity and a scroll offset. */
  const indexForKg = useCallback(
    (kg: number) => {
      let best = 0;
      let bestDelta = Infinity;
      ticks.forEach((tick, i) => {
        const delta = Math.abs(tick.kg - kg);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = i;
        }
      });
      return best;
    },
    [ticks]
  );

  // Centre the current value whenever the ruler is (re)measured or the unit changes — a unit
  // switch rebuilds `ticks` with a different width and stride, so the old offset points somewhere
  // else entirely. `animated: false` because this is a re-anchor, not a movement the user asked
  // for.
  useEffect(() => {
    if (width === 0) return;
    scrollRef.current?.scrollTo({ x: indexForKg(value) * tickWidth, animated: false });
    // `value` is deliberately absent: this re-anchors on measurement and unit change only.
    // Including it would yank the ruler back under the user's thumb on every tick they scroll past.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, unit, tickWidth, indexForKg]);

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / tickWidth);
    const tick = ticks[Math.min(ticks.length - 1, Math.max(0, index))];
    if (!tick || tick.kg === lastReportedRef.current) return;
    lastReportedRef.current = tick.kg;
    // The ruler's whole affordance is that it clicks past notches. Selection is the lightest
    // haptic there is — anything heavier on a control that fires dozens of times per drag is a buzz.
    Haptics.selectionAsync().catch(() => {});
    onChange(tick.kg, 'scroll');
  }

  /**
   * Switch units, and land the value on a tick of the new one.
   *
   * Done here rather than in an effect on `unit` so it cannot fire on mount — an effect would
   * report a value change before the user had touched anything, which is exactly the state the
   * `source` argument exists to keep out of the profile.
   */
  function handleUnit(next: WeightUnit) {
    if (next === unit) return;
    onUnitChange(next);
    const snapped =
      next === 'kg' ? toKg(Math.round(value)) : toKg(Math.round(value * LB_PER_KG) / LB_PER_KG);
    if (snapped !== value) {
      lastReportedRef.current = snapped;
      onChange(snapped, 'unit');
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.readout}>{formatWeight(value, unit)}</Text>
      <Text style={styles.unit}>{unit === 'lb' ? 'pounds' : 'kilograms'}</Text>

      <View style={styles.ruler} onLayout={handleLayout}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={tickWidth}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={handleScroll}
          // Half the viewport of padding at each end is what lets the FIRST and LAST tick reach
          // the centre line. Without it the ruler could only ever select its middle 80%.
          contentContainerStyle={{ paddingHorizontal: Math.max(0, width / 2) }}>
          {ticks.map((tick, i) => {
            const major = i % majorEvery === 0;
            return (
              <View key={`${unit}-${tick.kg}-${i}`} style={[styles.tick, { width: tickWidth }]}>
                <View style={[styles.tickMark, major ? styles.tickMajor : styles.tickMinor]} />
                {major ? <Text style={styles.tickLabel}>{tick.label}</Text> : null}
              </View>
            );
          })}
        </ScrollView>
        {/* The centre line is the cursor: the ruler moves, this stays. pointerEvents none so it
            never eats a drag that was meant for the scroller underneath it. */}
        <View style={styles.centerLine} pointerEvents="none" />
      </View>

      <View style={styles.toggle} accessibilityRole="tablist">
        {(['lb', 'kg'] as WeightUnit[]).map((option) => {
          const on = unit === option;
          return (
            <Pressable
              key={option}
              onPress={() => handleUnit(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={option === 'lb' ? 'Pounds' : 'Kilograms'}
              style={[styles.toggleOption, on && styles.toggleOptionOn]}>
              <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  readout: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 44,
    letterSpacing: -1,
    color: Colors.ember,
  },
  unit: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.muted,
    marginTop: -2,
    marginBottom: Spacing.four,
  },
  ruler: {
    height: 78,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  tick: {
    alignItems: 'center',
  },
  tickMark: {
    width: 2,
    backgroundColor: Colors.trackAlt,
  },
  tickMajor: {
    height: 40,
    backgroundColor: Colors.muted,
  },
  tickMinor: {
    height: 22,
  },
  tickLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: Spacing.one,
  },
  centerLine: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1.5,
    top: 8,
    width: 3,
    height: 52,
    borderRadius: 2,
    backgroundColor: Colors.amber,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.input,
    padding: 3,
    marginTop: Spacing.four,
  },
  toggleOption: {
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: Radius.card,
  },
  toggleText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  toggleTextOn: {
    color: Colors.onEmber,
  },
  toggleOptionOn: {
    backgroundColor: Colors.amber,
  },
});
