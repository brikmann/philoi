import { useEffect, useId, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { ItemArt } from '@/components/economy/item-art';
import { usePassMotion } from '@/components/pass/pass-motion';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { EMBERFALL_SET, type CatalogItem, type ItemType } from '@/lib/economy/catalog';
import { RARITY_COLOR, RARITY_LABEL, RARITY_ORDER } from '@/lib/economy/rarity';

// "N ITEMS TO BE UNLOCKED" (mock 200-v2): a big preview of one Emberfall cosmetic, auto-cycling,
// over a tappable grid of the whole set.
//
// DATA-DRIVEN. The list is EMBERFALL_SET straight out of catalog.ts — the same array the track's
// grants resolve against — rendered with the real ItemArt every other surface uses. The mock's
// tinted line-glyphs were stand-ins so the artboard could render without assets; here the actual
// flame/halo/flare/card/banner/relic/medal/title/sfx art is the preview.

/** How each TYPE shows up on a profile — the mock's one-line "how it flexes" caption. */
const FLEX_BY_TYPE: Partial<Record<ItemType, string>> = {
  FLARE: 'Wraps your whole profile in living fire',
  HALO: 'A ring of embers orbiting your avatar',
  CARD: 'Reskins your lock-in share cards',
  BANNER: 'Flies across the top of your profile',
  MEDAL: 'Pinned beside your name',
  SFX: 'The sound your lock-ins ring with',
  TITLE: 'A title worn under your name',
  FLAME: 'Recolours the flame on your profile',
  RELIC: 'Displayed in your trophy hall',
  PARTICLE: 'Embers drifting off your flame',
  AUDIO: 'Plays under your lock-ins',
};

const CYCLE_MS = 2000;

export function useEmberfallSet(): CatalogItem[] {
  // Rarest first — the preview opens on the Mythic capstone, not on whichever item was typed first.
  return useMemo(
    () => [...EMBERFALL_SET].sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]),
    []
  );
}

export function SetShowcase({ items }: { items: CatalogItem[] }) {
  const run = usePassMotion();
  const [index, setIndex] = useState(0);
  // Tapping a tile is the user taking over: the auto-cycle stops so their pick stays on screen.
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!run || paused || items.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [run, paused, items.length]);

  const current = items[index];
  if (!current) return null;

  return (
    <View style={styles.box}>
      <Preview item={current} />
      <View style={styles.grid}>
        {items.map((item, i) => (
          <Pressable
            key={item.id}
            style={[styles.thumb, i === index && styles.thumbOn]}
            onPress={() => {
              setPaused(true);
              setIndex(i);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: i === index }}
            accessibilityLabel={`${RARITY_LABEL[item.rarity]} ${item.name.replace(/^"|"$/g, '')}`}>
            <ItemArt item={item} size={30} />
            <View style={[styles.rarityDot, { backgroundColor: RARITY_COLOR[item.rarity] }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Preview({ item }: { item: CatalogItem }) {
  const run = usePassMotion();
  const color = RARITY_COLOR[item.rarity];
  const grad = `setGlow-${useId()}`;
  const pop = useSharedValue(1);

  // The mock's `fxin`: each new pick pops in from 70% with a little overshoot.
  useEffect(() => {
    if (!run) {
      pop.value = 1;
      return;
    }
    pop.value = 0.7;
    pop.value = withSpring(1, { damping: 9, stiffness: 180 });
  }, [item.id, run, pop]);

  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!run) return;
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: 250 });
  }, [item.id, run, opacity]);

  const artStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: pop.value }] }));

  return (
    <View>
      <View style={styles.preview}>
        <View style={styles.glow} pointerEvents="none">
          <Svg width={180} height={130}>
            <Defs>
              <RadialGradient id={grad} cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={color} stopOpacity="0.6" />
                <Stop offset="0.7" stopColor={color} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Ellipse cx={90} cy={65} rx={90} ry={65} fill={`url(#${grad})`} />
          </Svg>
        </View>
        <Animated.View style={artStyle}>
          <ItemArt item={item} size={84} />
        </Animated.View>
      </View>
      <View style={styles.meta}>
        <View style={[styles.chip, { borderColor: color, backgroundColor: `${color}2E` }]}>
          <Text style={[styles.chipText, { color }]}>{RARITY_LABEL[item.rarity]}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.flex}>{FLEX_BY_TYPE[item.type] ?? item.lore}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#1D1426',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.16)',
    borderRadius: 18,
    paddingTop: 14,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  preview: {
    height: 124,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    alignItems: 'center',
    marginTop: 4,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 5,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.7,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  flex: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    lineHeight: 14,
    color: '#B8ABCF',
    marginTop: 4,
    minHeight: 28,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  thumb: {
    // Four across with three 7pt gaps taken out.
    width: '22.6%',
    aspectRatio: 1,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#181322',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbOn: {
    borderColor: Colors.ember,
    backgroundColor: '#211A30',
    shadowColor: Colors.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 6,
  },
  rarityDot: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
