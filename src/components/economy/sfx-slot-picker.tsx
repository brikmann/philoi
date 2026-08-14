import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { SfxSlot } from '@/lib/economy/catalog';

// Start / End / Both, in place of one Equip button (PUNCHLIST_13).
//
// An SFX has no slot of its own — the same anvil is a perfectly good opening hit AND closing hit,
// so the choice is the user's and has to be made at equip time. Three buttons rather than two
// toggles because "Both" is a real, common intent ("play the same thing twice") and expressing it
// as two separate taps would make the most-wanted option the most fiddly one.
//
// Each button is a toggle against what's already equipped: tapping the lit one clears that slot, so
// unequipping needs no separate control.

export type SfxChoice = SfxSlot | 'both';

type Props = {
  /** Which slots this item currently occupies. */
  slots: SfxSlot[];
  onChoose: (choice: SfxChoice) => void;
  disabled?: boolean;
};

const OPTIONS: { key: SfxChoice; label: string; hint: string }[] = [
  { key: 'sfx_start', label: 'Start', hint: 'when a lock-in begins' },
  { key: 'sfx_stop', label: 'End', hint: 'when a lock-in ends' },
  { key: 'both', label: 'Both', hint: 'open and close on it' },
];

export function SfxSlotPicker({ slots, onChoose, disabled }: Props) {
  const inStart = slots.includes('sfx_start');
  const inStop = slots.includes('sfx_stop');
  const inBoth = inStart && inStop;

  function isOn(key: SfxChoice): boolean {
    if (key === 'both') return inBoth;
    // Start/End read as lit only when that slot ALONE holds it — otherwise "Both" and both
    // individual buttons would all light at once and none of them would mean anything.
    return key === 'sfx_start' ? inStart && !inBoth : inStop && !inBoth;
  }

  return (
    <View>
      <Text style={styles.caption}>Play this sting…</Text>
      <View style={styles.row}>
        {OPTIONS.map((opt) => {
          const on = isOn(opt.key);
          return (
            <Pressable
              key={opt.key}
              style={[styles.btn, on && styles.btnOn, disabled && styles.btnDisabled]}
              onPress={() => onChoose(opt.key)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${opt.label} — ${opt.hint}${on ? ', equipped. Tap to remove' : ''}`}>
              <Text style={[styles.label, on && styles.labelOn]}>{opt.label}</Text>
              <Text style={[styles.hint, on && styles.hintOn]}>{on ? 'Equipped' : opt.hint}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>
        {inBoth
          ? 'Opening and closing on the same sound.'
          : inStart
            ? 'Fires when you start a lock-in.'
            : inStop
              ? 'Fires when you finish a lock-in.'
              : 'Not equipped. Tap a slot to put it in.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  btn: {
    flex: 1,
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.twelve,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 2,
  },
  btnOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.amber,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  labelOn: {
    color: Colors.amber,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 8.5,
    lineHeight: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  hintOn: {
    color: Colors.amber,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: Colors.muted,
    marginTop: Spacing.two,
  },
});
