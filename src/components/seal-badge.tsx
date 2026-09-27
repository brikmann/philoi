import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { EmberfallSeal } from '@/components/pass/emberfall-art';
import { useSealOwner } from '@/lib/economy/seal-owners';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE SEAL BADGE — the Emberfall Seal pinned beside a finisher's name (mock 223's `.seal`).
//
// The permanent half of the pass flex. <BurningName> is the temporary half: it burns while the
// entitlement is live. This one gates on OWNING `medal-emberfall-crown` (lib/economy/seal-owners),
// so a finisher keeps it after the pass lapses — which is the whole reason to finish the season.
//
// The sigil itself is EmberfallSeal, the same one the paywall gallery and the purchase reveal draw,
// shrunk to sit inline. Its slow spin and glow already park under Reduce Motion / a blurred screen
// (usePassMotion). Its glow spills past `size` by design; the layout box is exactly `size`, so it
// sits in a text row without pushing the line taller.
//
// <BurningName> places this after every name it's given a `userId` for, so the leaderboard,
// podium, Agora, campfire members and both profile headers get it without any wiring of their own.
// ══════════════════════════════════════════════════════════════════════════════════════════════

type Props = {
  /** Whose name this sits beside. Omit it and pass `owns` for a status that's already known. */
  userId?: string | null;
  /** Forces the answer. Wins over `userId`. */
  owns?: boolean;
  /** The disc's diameter. Roughly the name's font size reads best. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function SealBadge({ userId, owns, size = 14, style }: Props) {
  const fetched = useSealOwner(owns === undefined ? userId : null);
  if (!(owns ?? fetched)) return null;

  return (
    <View
      style={[styles.badge, { width: size, height: size }, style]}
      accessible
      accessibilityLabel="The Emberfall Seal">
      <EmberfallSeal size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
