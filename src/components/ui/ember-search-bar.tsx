import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

// The search field from mock 259, shared by the Leaderboard search and Friends so the two can't
// drift. Coral is the ACCENT here, not the fill: a dark cardDark field, a coral magnifier, and on
// focus an ember RING — a coral border plus a soft glow — where the old bars painted a solid coral
// border whether or not you were typing.
//
// The glow is the mock's `box-shadow: 0 0 0 3px rgba(224,97,44,.18)` drawn as a 3pt wrapper rather
// than a shadow: a spread ring has no RN shadow equivalent (shadowRadius blurs, and Android's
// elevation is grey). The wrapper is always there and only its colour changes, so focusing never
// shifts the layout by a pixel.

const RING = 3;
const RADIUS = 14;

export function EmberSearchBar({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  /** Margins/placement only — the field's own look is fixed. */
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.ring, focused && styles.ringOn, style]}>
      <View style={[styles.field, focused && styles.fieldOn]}>
        <Ionicons name="search" size={15} color={Colors.coral} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.textTertiary}
          value={value}
          onChangeText={onChangeText}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    padding: RING,
    borderRadius: RADIUS + RING,
    backgroundColor: 'transparent',
  },
  ringOn: {
    backgroundColor: 'rgba(224,97,44,0.18)',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.cardDark,
    borderWidth: 1.5,
    borderColor: '#342A52',
    borderRadius: RADIUS,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  fieldOn: {
    borderColor: Colors.coral,
  },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
    // See ui/text-input.tsx: without an explicit 0, iOS tracks the PLACEHOLDER out ("S e a r c h").
    letterSpacing: 0,
  },
});
