import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { Colors, Fonts } from '@/constants/theme';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import { fitFontSize } from '@/components/share-card-frame';

// THE REWARD STAMP (mock 171) — the small pill under a hero that names WHAT YOU WON.
//
// 🔴 NEVER AN EMBER COUNT, and this is the whole design rule rather than a preference. The audience
// for a share card is someone who does not play: a currency number tells them nothing, and "I won
// 50 embers" is a weaker flex than "I won a Vessel of Hestia" even for someone who does. An object
// with a name is legible to a stranger; a balance is not. The challenge card's own header has said
// this since it was written — the stamp is what finally gives the rule somewhere to live for every
// card, and what surfaces the newer reward types (cosmetic titles, scoped-goal boxes) that had no
// representation on a card at all.
//
// It is deliberately dumb: it renders the name it is handed. Deciding what was won belongs to the
// server payload the card was built from.

export function ShareCardStamp({
  label,
  color,
  icon,
}: {
  /** "Won a Vessel of Hestia", "Unlocked \"Golden\"". A name, never a quantity. */
  label: string;
  color: string;
  icon?: ReactNode;
}) {
  return (
    <View style={[styles.stamp, { borderColor: color }]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text
        style={[styles.text, { color, fontSize: fitFontSize(label, 13, 10, 24) }]}
        numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The stamp for a box a win granted, or null when it granted none.
 *
 * Null rather than a placeholder: a card with nothing to stamp should show nothing, not an empty
 * pill. Every caller renders `{boxStamp(key) ?? null}`, so a rewardless win simply has a quieter
 * hero.
 */
export function boxStamp(boxKey: string | null | undefined, verb = 'Won'): ReactNode {
  if (!boxKey) return null;
  const box = BOXES[boxKey as BoxKey];
  if (!box) return null;
  return (
    <ShareCardStamp
      label={`${verb} a ${box.name}`}
      color={Colors.amber}
      icon={<BoxArt boxKey={boxKey as BoxKey} size={16} />}
    />
  );
}

const styles = StyleSheet.create({
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(20,14,30,0.72)',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 14,
    maxWidth: 260,
  },
  icon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: Fonts.bodyBold,
    flexShrink: 1,
  },
});
