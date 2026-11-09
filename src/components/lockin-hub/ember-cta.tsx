import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

/** The ember gradient (ss0 §9 `--eg`): #ff7a2f → #ffb05a → #ffd166 at 135°. */
export const EMBER_GRADIENT = [Colors.navEmber, Colors.navEmber2, Colors.gold] as const;

/** Dark ink on the ember pill — the only primary-CTA text colour (ss0 §9). */
const CTA_INK = '#2A0F05';

/**
 * The primary CTA: an ember-gradient pill with dark ink text. `big` is the hero size Lock In's
 * "Start a Lock-In" uses; the default is the in-card size ("Send duel", "Lock in").
 */
export function EmberCta({
  label,
  onPress,
  big = false,
  disabled = false,
  loading = false,
  leading,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  big?: boolean;
  disabled?: boolean;
  loading?: boolean;
  leading?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: loading }}
      style={({ pressed }) => [styles.wrap, big && styles.wrapBig, off && styles.off, pressed && !off && styles.pressed, style]}>
      <LinearGradient
        colors={EMBER_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fill, big && styles.fillBig]}>
        {loading ? (
          <ActivityIndicator color={CTA_INK} />
        ) : (
          <>
            {leading}
            <Text style={[styles.label, big && styles.labelBig]}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 999,
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  wrapBig: {
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 10,
  },
  fill: {
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fillBig: {
    paddingVertical: 18,
  },
  label: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: CTA_INK,
  },
  labelBig: {
    fontSize: 18,
  },
  off: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
});
