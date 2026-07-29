import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { CampfirePrivacy } from '@/types/database';

const OPTIONS: { value: CampfirePrivacy; icon: keyof typeof Ionicons.glyphMap; label: string; sub: string }[] = [
  { value: 'open', icon: 'flame', label: 'Open', sub: 'Shows in the valley · anyone can join' },
  { value: 'gated', icon: 'lock-closed', label: 'Gated', sub: 'Shows in the valley · you approve who joins' },
  { value: 'private', icon: 'eye-off', label: 'Private', sub: 'Hidden · join by code only' },
];

// design-mocks/10's "Who can join" 3-way radio selector (PHILOI_UI_SPEC.md §14) — shared by
// the create flow and campfire settings/Edit campfire, since privacy is editable any time.
export function PrivacySelector({ value, onChange }: { value: CampfirePrivacy; onChange: (v: CampfirePrivacy) => void }) {
  return (
    <View style={styles.priv}>
      {OPTIONS.map((opt) => {
        const on = value === opt.value;
        return (
          <Pressable key={opt.value} style={[styles.popt, on && styles.poptOn]} onPress={() => onChange(opt.value)}>
            <View style={[styles.icon, on && styles.iconOn]}>
              <Ionicons name={opt.icon} size={15} color={on ? Colors.amber : Colors.soloChipText} />
            </View>
            <View style={styles.m}>
              <Text style={styles.a}>{opt.label}</Text>
              <Text style={styles.b}>{opt.sub}</Text>
            </View>
            <View style={[styles.rd, on && styles.rdOn]}>{on && <View style={styles.rdHole} />}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  priv: {
    gap: 7,
  },
  popt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 11,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Radius.card,
  },
  poptOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOn: {
    backgroundColor: Colors.achieverBg,
  },
  m: {
    flex: 1,
  },
  a: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  b: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
    marginTop: 1,
  },
  rd: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.trackAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rdOn: {
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  rdHole: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.card,
  },
});
