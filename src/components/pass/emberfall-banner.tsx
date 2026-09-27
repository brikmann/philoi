import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { EMBER, EmberfallSky, FallingEmbers, FlashText, HadesConstellation } from '@/components/pass/emberfall-art';
import { ShineSweep } from '@/components/pass/pass-motion';
import { Fonts } from '@/constants/theme';
import { SEASON } from '@/lib/economy/forge-pass';

// The Emberfall banner at the very top of the Shop (design-mocks/224) — the shop's door into the
// Flame Pass paywall. Constellation, falling embers, the flashing "Own Emberfall", one line of the
// tale, and the price. The whole card is the tap target; it opens the paywall and nothing else.
//
// The price is the store's localized string, passed in; null (offering not loaded) drops the price
// rather than inventing one. The shop hides this banner for anyone who already owns the pass.

const BANNER_MIN_H = 210;
/** The figure's band at the top of the card — it scales to fit and centres, clear of the copy. */
const CONST_H = 112;

export function EmberfallBanner({ price, onPress }: { price: string | null; onPress: () => void }) {
  const [w, setW] = useState(0);
  const [h, setH] = useState(BANNER_MIN_H);
  const seasonNumber = SEASON.id.replace('S', '');

  function onLayout(e: LayoutChangeEvent) {
    setW(e.nativeEvent.layout.width);
    setH(e.nativeEvent.layout.height);
  }

  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Own ${SEASON.name}. Unlock the Flame Pass${price ? `, ${price} per semester` : ''}`}>
      <EmberfallSky kind="banner" />
      <FallingEmbers count={6} fall={h + 20} />
      {w > 0 ? (
        <View style={styles.const} pointerEvents="none">
          <HadesConstellation width={w} height={CONST_H} />
        </View>
      ) : null}

      <View style={styles.inner}>
        <Text style={styles.tag}>FLAME PASS · SEASON {seasonNumber}</Text>
        <View style={styles.ownRow}>
          <FlashText style={styles.own}>{`Own ${SEASON.name}`}</FlashText>
        </View>
        <Text style={styles.hook}>
          Every ember can <Text style={styles.hi}>raise you or ruin you</Text>. Burn bright, earn exclusive looks, and set
          your name on fire.
        </Text>
        <View style={styles.ctaRow}>
          <View style={styles.btn}>
            <Text style={styles.btnText}>Unlock the Flame Pass</Text>
            <ShineSweep period={3400} opacity={0.5} />
          </View>
          {price ? <Text style={styles.price}>{price} / sem</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: BANNER_MIN_H,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,158,77,0.4)',
  },
  pressed: {
    opacity: 0.92,
  },
  const: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  inner: {
    paddingTop: 116,
    paddingBottom: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  tag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.9,
    color: EMBER.e2,
    marginBottom: 6,
  },
  ownRow: {
    marginBottom: 8,
  },
  own: {
    fontFamily: Fonts.black,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  hook: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12,
    lineHeight: 18,
    color: EMBER.ink,
    opacity: 0.92,
    textAlign: 'center',
    maxWidth: 290,
    marginBottom: 14,
  },
  hi: {
    fontFamily: Fonts.bodyBold,
    fontStyle: 'italic',
    color: EMBER.e2,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  btn: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: EMBER.e2,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  btnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: '#20100a',
  },
  price: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: EMBER.e2,
  },
});
