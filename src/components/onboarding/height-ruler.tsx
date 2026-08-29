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

// design-mocks/128 — the height step's picker.
//
// WHY A RULER AND NOT A TEXT FIELD. Height is the one number in onboarding nobody wants to type,
// and a numeric keyboard over a two-line question is the fastest way to make an optional step feel
// like a form. A ruler you shove is also self-validating: there is no way to scroll to 9 cm or to
// fat-finger a weight into it, which is exactly what the column's `50 < height_cm < 260` check
// (migration 0119) exists to catch after the fact.
//
// ONE UNIT INTERNALLY, ALWAYS CENTIMETRES. `set_my_height_cm` takes cm and `stride_m_for` divides
// by 100, so cm is the only value that ever leaves this component. The ft/in toggle changes the
// ruler's GRAIN — the tick spacing and what a snap lands on — not the stored quantity, which is
// what keeps a unit switch from being a lossy round trip through two conversions.

/** Comfortably inside the column's `50 < height_cm < 260` check, and wide enough to cover
 *  everyone: 3'11" to 7'3". Nothing outside it can be selected, so the RPC cannot be sent a value
 *  the constraint would reject. */
const MIN_CM = 120;
const MAX_CM = 220;

/** The adult-average fallback stride is 0.75 m, which `stride_m_for` derives from 0.42 × height —
 *  so 178 cm IS the server's current assumption about everyone. Opening there means the picker
 *  starts where an un-set user already effectively is, and a scroll is a correction rather than a
 *  measurement from scratch. */
export const DEFAULT_HEIGHT_CM = 178;

const CM_PER_INCH = 2.54;

type Unit = 'cm' | 'ftin';

/** Tick geometry per unit. Wider ticks for inches because there are ~2.5× fewer of them across the
 *  same span, and a 14pt inch tick would leave the ruler looking half-empty. */
const TICK_WIDTH: Record<Unit, number> = { cm: 14, ftin: 30 };
/** Every Nth tick is a tall, labelled one: 5 cm, or a whole foot. */
const MAJOR_EVERY: Record<Unit, number> = { cm: 5, ftin: 12 };

const MIN_IN = Math.ceil(MIN_CM / CM_PER_INCH);
const MAX_IN = Math.floor(MAX_CM / CM_PER_INCH);

const clampCm = (cm: number) => Math.min(MAX_CM, Math.max(MIN_CM, Math.round(cm)));

/** 175 → "5′ 9″". Rounds to the nearest inch, and carries 12″ up to the next foot so nothing ever
 *  renders as 5′ 12″. */
export function formatFeetInches(cm: number): string {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return `${Math.floor(totalInches / 12)}′ ${totalInches % 12}″`;
}

type Props = {
  /** Always centimetres. */
  value: number;
  onChange: (cm: number) => void;
};

export function HeightRuler({ value, onChange }: Props) {
  const [unit, setUnit] = useState<Unit>('cm');
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  // The last value a scroll produced. Compared against before firing a haptic so the tick only
  // clicks when the number actually changes, not on every pixel of momentum.
  const lastReportedRef = useRef(value);

  const tickWidth = TICK_WIDTH[unit];
  const majorEvery = MAJOR_EVERY[unit];

  // One entry per selectable position, in whatever unit the ruler is currently drawn in. cm mode
  // steps by 1 cm; ft/in mode steps by a whole inch, so a snap in that mode lands on an inch
  // boundary rather than on whichever centimetre happened to be nearest.
  const ticks = useMemo(() => {
    if (unit === 'cm') {
      return Array.from({ length: MAX_CM - MIN_CM + 1 }, (_, i) => ({
        cm: MIN_CM + i,
        label: `${MIN_CM + i}`,
      }));
    }
    return Array.from({ length: MAX_IN - MIN_IN + 1 }, (_, i) => {
      const inches = MIN_IN + i;
      return {
        cm: clampCm(inches * CM_PER_INCH),
        // Majors land on whole feet, so the label is just the foot mark — "5′" under the tick that
        // is 5 feet, exactly like the mock's bare "150" / "155".
        label: `${Math.floor(inches / 12)}′`,
      };
    });
  }, [unit]);

  /** Nearest tick to a cm value — the bridge between the stored quantity and a scroll offset. */
  const indexForCm = useCallback(
    (cm: number) => {
      let best = 0;
      let bestDelta = Infinity;
      ticks.forEach((tick, i) => {
        const delta = Math.abs(tick.cm - cm);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = i;
        }
      });
      return best;
    },
    [ticks]
  );

  // Centre the current value whenever the ruler is (re)measured or the unit changes — a unit switch
  // rebuilds `ticks` with a different width and stride, so the old offset points somewhere else
  // entirely. `animated: false` because this is a re-anchor, not a movement the user asked for.
  useEffect(() => {
    if (width === 0) return;
    scrollRef.current?.scrollTo({ x: indexForCm(value) * tickWidth, animated: false });
    // `value` is deliberately absent: this re-anchors on measurement and unit change only. Including
    // it would yank the ruler back under the user's thumb on every tick they scroll past.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, unit, tickWidth, indexForCm]);

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / tickWidth);
    const tick = ticks[Math.min(ticks.length - 1, Math.max(0, index))];
    if (!tick || tick.cm === lastReportedRef.current) return;
    lastReportedRef.current = tick.cm;
    // The ruler's whole affordance is that it clicks past notches. Selection is the lightest one
    // there is — anything heavier on a control that fires dozens of times per drag is a buzz.
    Haptics.selectionAsync().catch(() => {});
    onChange(tick.cm);
  }

  return (
    <View style={styles.root}>
      <Text style={styles.readout}>{unit === 'cm' ? value : formatFeetInches(value)}</Text>
      <Text style={styles.unit}>{unit === 'cm' ? 'centimetres' : 'feet & inches'}</Text>

      <View style={styles.ruler} onLayout={handleLayout}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={tickWidth}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={handleScroll}
          // Half the viewport of padding at each end is what lets the FIRST and LAST tick reach the
          // centre line. Without it the ruler could only ever select the middle 80% of its range.
          contentContainerStyle={{ paddingHorizontal: Math.max(0, width / 2) }}>
          {ticks.map((tick, i) => {
            const major = i % majorEvery === 0;
            return (
              <View key={`${unit}-${tick.cm}-${i}`} style={[styles.tick, { width: tickWidth }]}>
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
        {(['cm', 'ftin'] as Unit[]).map((option) => {
          const on = unit === option;
          return (
            <Pressable
              key={option}
              onPress={() => setUnit(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={option === 'cm' ? 'Centimetres' : 'Feet and inches'}
              style={[styles.toggleOption, on && styles.toggleOptionOn]}>
              <Text style={[styles.toggleText, on && styles.toggleTextOn]}>
                {option === 'cm' ? 'cm' : 'ft / in'}
              </Text>
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
  toggleOptionOn: {
    backgroundColor: Colors.amber,
  },
  toggleText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  toggleTextOn: {
    color: Colors.onEmber,
  },
});
