import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';

// The header band's exact geometry, exported so anything that needs to sit inside that band
// (Home's pager dots, which overlay it rather than stacking above it) shares one source of
// truth — if these change, the title stays pixel-aligned across all four tabs for free.
export const TAB_HEADER_HEIGHT = 44;
export const TAB_HEADER_PADDING_TOP = Spacing.three;

type TabHeaderProps = {
  title: string;
  /** A small amber flame-tile chip to the left of the title, matching Home's existing look —
   * omit for tabs that don't want it (Leaderboard/Challenges/Profile don't use one today). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional right-aligned content (e.g. Profile's settings/people icons). */
  right?: ReactNode;
};

// One shared header for all four main tabs (Campfires/"Your fire", Leaderboard, Challenges,
// Profile) — same top inset, height, and title type size everywhere, so switching tabs doesn't
// jump the title. Each screen renders only this for its title row; any tab-specific content
// (pill rows, buttons, stats) goes in its own container below, with no additional top padding
// of its own (this component already accounts for it).
export function TabHeader({ title, icon, right }: TabHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.left}>
        {icon && (
          <View style={styles.iconChip}>
            <Ionicons name={icon} size={13} color={Colors.amber} />
          </View>
        )}
        <Text style={styles.title}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: TAB_HEADER_HEIGHT,
    paddingHorizontal: Spacing.four,
    paddingTop: TAB_HEADER_PADDING_TOP,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  iconChip: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 18,
    color: Colors.ink,
  },
});
