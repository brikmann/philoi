import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberFlight, type FlightPoint } from '@/components/economy/ember-flight';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import type { OwnedItem } from '@/hooks/use-inventory';
import { fireEmberLand } from '@/lib/reward-feedback';
import { RARITY_COLOR, rarityGlow } from '@/lib/economy/rarity';

// The sell flow, on brand (design-mocks/100). Two frames, both of them ours:
//
//   1. CONFIRM - replaces the grey `Alert.alert('Sell X?')`. A system dialog is the one surface in
//      the app that cannot carry the item's own colour, and this is the moment rarity matters most:
//      the whole question is "is this worth 420 embers to you". So the item's art is the hero, its
//      name is typeset in its rarity's colour, and the payout is ember.
//
//   2. REWARD - replaces the second `Alert.alert('Sold')`. The embers fly into the balance chip and
//      the number ticks up under them, which is the reward ember loop the rest of the economy
//      already uses (mock 27's flight, reused here through EmberFlight).
//
// PRESENTATION ONLY. Neither frame decides, grants or computes anything: the payout shown is
// SALVAGE_EMBERS (already what the old dialog showed), the sale is the same `salvageCosmetic` RPC,
// and the number the balance LANDS on is the wallet's own, never `before + payout` - see the note
// on `serverBalance` below.

// ---------------------------------- Frame 1 - confirm ----------------------------------

type SellConfirmProps = {
  item: OwnedItem;
  /** SALVAGE_EMBERS[rarity] - display only; the server re-derives what it actually pays. */
  payout: number;
  balance: number;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SellConfirmScreen({ item, payout, balance, busy, onConfirm, onCancel }: SellConfirmProps) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <ScreenBackground>
        <SafeAreaView style={styles.safe}>
          <View style={styles.topbar}>
            <Pressable style={styles.back} onPress={onCancel} hitSlop={10} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={18} color={Colors.muted} />
            </Pressable>
            <BalancePill embers={balance} />
          </View>

          {/* Art alone, no name/rarity chip under it - the question below already says both, and
              repeating them here is what made the old dialog read as a form rather than a choice. */}
          <View style={styles.confirmHero}>
            <View style={[styles.disc, { backgroundColor: rarityGlow(item.rarity, 0.32) }]} />
            <ItemArt item={item} size={112} />
          </View>

          <View style={styles.confirmBody}>
            <Text style={styles.question}>
              Sell <Text style={{ color: RARITY_COLOR[item.rarity] }}>{item.name}</Text> for
            </Text>
            {/* The amount is its own line because the ember token is an SVG: anything inside a
                <Text> lays out as text, so the token cannot sit inline in the sentence above.
                Mock 100 breaks the line in exactly this place for exactly this reason. */}
            <View style={styles.amountLine}>
              <EmberIcon size={26} />
              <Text style={[styles.question, styles.amount]}>{formatEmbers(payout)} embers?</Text>
            </View>
            <Text style={styles.stakes}>{sellStakes(item)}</Text>
          </View>

          <View style={styles.foot}>
            <PrimaryButton label={`Sell · 🔥 ${formatEmbers(payout)}`} onPress={onConfirm} loading={busy} />
            <PrimaryButton label="Keep it" variant="ghost" onPress={onCancel} disabled={busy} />
          </View>
        </SafeAreaView>
      </ScreenBackground>
    </View>
  );
}

/**
 * The subline under the question. The old dialog escalated its wording for the items you can never
 * get back, and that escalation is the whole reason a confirm exists at all - so it survives the
 * reskin verbatim rather than being flattened into one generic "this is permanent".
 */
export function sellStakes(item: OwnedItem): string {
  if (item.oneOfOne || item.type === 'MEDAL' || item.seasonStamped) {
    return 'One of a kind and season-stamped. Selling it is PERMANENT — it can never be re-issued, and no amount of embers buys it back.';
  }
  if (item.source === 'earned') {
    return 'You earned this. Selling it is permanent — the only way to get it back is to earn it again.';
  }
  return 'Selling unequips it and is permanent.';
}

// ---------------------------------- Frame 2 - reward ----------------------------------

const FLY_COUNT = 12;
const FLY_STAGGER = 55;
const FLY_DURATION = 900;
/** The number starts moving as the first embers arrive, not when they set off. */
const TICK_START_MS = 620;
const TICK_MS = 1000;

type SellRewardProps = {
  itemName: string;
  /** What the server said it paid - `salvageCosmetic`'s return, not a client sum. */
  embers: number;
  /** The balance as it stood the instant before the sale, snapshotted by the caller. */
  balanceBefore: number;
  /**
   * The wallet's own post-sale figure once `requestInventoryRefresh` has landed, or null while that
   * read is still in flight. This is what the counter finishes on: `balanceBefore + embers` is the
   * animation's provisional aim only, and would be wrong the moment anything else moved the wallet
   * in the same window (the "balance had nowhere to land" note in goal-streak-reward-screen).
   */
  serverBalance: number | null;
  onDone: () => void;
};

export function SellRewardScreen({ itemName, embers, balanceBefore, serverBalance, onDone }: SellRewardProps) {
  const reduceMotion = useReduceMotion();
  const [display, setDisplay] = useState(balanceBefore);
  const [geo, setGeo] = useState<{ from: FlightPoint; to: FlightPoint } | null>(null);

  const rootRef = useRef<View>(null);
  const originRef = useRef<View>(null);
  const pillRef = useRef<View>(null);
  const landed = useRef(0);
  const tickDone = useRef(false);
  const bump = useSharedValue(0);

  // Re-aimed rather than restarted when the server figure arrives mid-count: the digits are already
  // moving by then, and restarting them would read as a correction.
  const target = useRef(balanceBefore + embers);
  useEffect(() => {
    if (serverBalance != null) target.current = serverBalance;
  }, [serverBalance]);

  // Once the count-up has finished the wallet is the only authority left, so if its read lands late
  // (or lands again) the pill follows it.
  useEffect(() => {
    if (tickDone.current && serverBalance != null) setDisplay(serverBalance);
  }, [serverBalance]);

  // Measured in window coordinates and rebased onto the root, so the arc runs between two real
  // on-screen points. The pill's x depends on how many digits the balance has - exactly the kind of
  // thing a hardcoded target gets wrong for the players with the most embers.
  useEffect(() => {
    if (reduceMotion) return;
    const raf = requestAnimationFrame(() => {
      rootRef.current?.measureInWindow((ox, oy) => {
        originRef.current?.measureInWindow((fx, fy, fw, fh) => {
          pillRef.current?.measureInWindow((px, py, pw, ph) => {
            setGeo({
              from: { x: fx + fw / 2 - ox, y: fy + fh / 2 - oy },
              to: { x: px + pw * 0.28 - ox, y: py + ph / 2 - oy },
            });
          });
        });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  // The count-up. Reduce-motion keeps it (a number that visibly changes is the point) and loses only
  // the flight, so the balance still moves rather than silently swapping figures.
  useEffect(() => {
    let raf: ReturnType<typeof requestAnimationFrame> | undefined;
    const start = balanceBefore;
    const timer = setTimeout(
      () => {
        const t0 = Date.now();
        const step = () => {
          const p = Math.min((Date.now() - t0) / TICK_MS, 1);
          const eased = 1 - (1 - p) * (1 - p);
          setDisplay(Math.round(start + (target.current - start) * eased));
          if (p < 1) {
            raf = requestAnimationFrame(step);
          } else {
            tickDone.current = true;
            setDisplay(target.current);
          }
        };
        raf = requestAnimationFrame(step);
      },
      reduceMotion ? 0 : TICK_START_MS
    );
    return () => {
      clearTimeout(timer);
      if (raf !== undefined) cancelAnimationFrame(raf);
    };
    // One count-up per mount. reduceMotion only decides WHEN it starts, and it has resolved before
    // the first frame in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire-once mount effect
  }, []);

  function handleLand() {
    landed.current += 1;
    bump.value = withSequence(withTiming(1, { duration: 90 }), withTiming(0, { duration: 260 }));
    // Every third arrival, not every one: twelve light taps inside 1.5s is a buzzing phone rather
    // than a run of ticks (the same reasoning fireBoxOpen uses for a x10 deal).
    if (landed.current % 3 === 1) fireEmberLand();
  }

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + bump.value * 0.12 }] }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScreenBackground>
        <SafeAreaView style={styles.safe}>
          <View style={styles.root} ref={rootRef} collapsable={false}>
            <View style={styles.topbar}>
              <Pressable style={styles.back} onPress={onDone} hitSlop={10} accessibilityLabel="Done">
                <Ionicons name="chevron-back" size={18} color={Colors.muted} />
              </Pressable>
              <Animated.View style={pillStyle}>
                <BalancePill embers={display} innerRef={pillRef} lit />
              </Animated.View>
            </View>

            <View style={styles.rewardBody}>
              <View style={styles.plusRow} ref={originRef} collapsable={false}>
                <EmberIcon size={44} />
                <Text style={styles.plus}>+{formatEmbers(embers)}</Text>
              </View>
              <Text style={styles.soldLabel}>Sold {itemName}</Text>
            </View>

            <View style={styles.foot}>
              <PrimaryButton label="Done" variant="ghost" onPress={onDone} />
            </View>

            {!reduceMotion && geo
              ? Array.from({ length: FLY_COUNT }, (_, i) => (
                  <EmberFlight
                    key={i}
                    index={i}
                    count={FLY_COUNT}
                    from={geo.from}
                    to={geo.to}
                    delay={i * FLY_STAGGER}
                    duration={FLY_DURATION}
                    size={13}
                    lift={70}
                    onLand={handleLand}
                  />
                ))
              : null}
          </View>
        </SafeAreaView>
      </ScreenBackground>
    </View>
  );
}

// ---------------------------------- shared bits ----------------------------------

/**
 * The top-right balance - mock 100's tinted variant of the `EmberPill` the shop and inventory pin.
 * Local rather than `EmberPill` because this one has to be MEASURABLE (it is the drift target) and
 * lit while the embers land, neither of which a pill built for a static header should have to carry
 * everywhere else.
 */
function BalancePill({
  embers,
  innerRef,
  lit,
}: {
  embers: number;
  innerRef?: React.RefObject<View | null>;
  lit?: boolean;
}) {
  return (
    <View
      ref={innerRef}
      collapsable={false}
      style={[styles.pill, lit && styles.pillLit]}
      accessibilityLabel={`${formatEmbers(embers)} embers`}>
      <EmberIcon size={15} />
      <Text style={styles.pillText}>{formatEmbers(embers)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,210,122,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.28)',
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  pillLit: {
    borderColor: 'rgba(255,210,122,0.5)',
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ember,
    fontVariant: ['tabular-nums'],
  },
  confirmHero: {
    height: 172,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.four,
  },
  disc: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
  },
  confirmBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  question: {
    fontFamily: Fonts.bodyBold,
    fontSize: 27,
    lineHeight: 36,
    color: Colors.ink,
    textAlign: 'center',
  },
  amountLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  amount: {
    color: Colors.ember,
  },
  stakes: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.twelve,
  },
  foot: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.twelve,
  },
  rewardBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Sits above the true centre, where mock 100 puts it - the embers need room to climb.
    paddingBottom: 96,
  },
  plusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
  },
  plus: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 58,
    color: Colors.ember,
    fontVariant: ['tabular-nums'],
  },
  soldLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    marginTop: Spacing.two,
    textAlign: 'center',
  },
});
