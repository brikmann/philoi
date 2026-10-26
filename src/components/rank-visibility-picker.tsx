import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SettingsGlyph } from '@/components/ui/glyphs-settings';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { RankVisibility } from '@/types/database';

// SEASON RANK VISIBILITY — the three-way dial (CODE_PROMPT_season_privacy.md, migration 0217).
//
// ONE COMPONENT FOR BOTH PLACES IT APPEARS. Onboarding and Settings render this same control and
// write through the same RPC, so the two can never describe the dial differently. The copy per
// option answers the two questions someone asks before choosing: who can see me, and what do I see.
//
// The rewards line is not decoration. The single most likely misreading of a privacy setting in a
// competitive app is "hiding costs me something" — it does not, and the control says so every time
// it is on screen.

type Option = {
  value: RankVisibility;
  label: string;
  icon: (color: string) => ReactNode;
  copy: string;
};

const OPTIONS: Option[] = [
  {
    value: 'public',
    label: 'Public',
    icon: (c) => <SettingsGlyph name="globe" size={14} color={c} />,
    copy: 'Anyone can see your rank. You see the full boards and where you stand on them.',
  },
  {
    value: 'friends',
    label: 'Friends',
    icon: (c) => <NavGlyph name="person" size={14} color={c} />,
    copy: 'Only your friends can see your rank. Your boards show just you and your friends.',
  },
  {
    value: 'private',
    label: 'Private',
    icon: (c) => <UiGlyph name="lock" size={14} color={c} />,
    copy: 'Nobody sees your rank. No boards, no comparisons — just your own climb.',
  },
];

export function RankVisibilityPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: RankVisibility;
  onChange: (next: RankVisibility) => void;
  disabled?: boolean;
}) {
  const selected = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <View>
      <View style={styles.track} accessibilityRole="radiogroup">
        {OPTIONS.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              style={[styles.segment, on && styles.segmentOn]}
              disabled={disabled}
              onPress={() => {
                if (!on) onChange(o.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled }}
              accessibilityLabel={`${o.label}. ${o.copy}`}>
              {o.icon(on ? Colors.navEmber2 : Colors.spaceDim)}
              <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.copy}>{selected.copy}</Text>
      <Text style={styles.rewards}>Your rewards don&apos;t change either way.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  // Space-purple selected state: the ember wash + ring SpaceChip uses, not a solid coral slab.
  segmentOn: {
    backgroundColor: 'rgba(255,122,47,0.14)',
    borderColor: Colors.navEmber,
  },
  segmentLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  segmentLabelOn: {
    color: Colors.navEmber2,
  },
  copy: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.ink,
    marginTop: Spacing.twelve,
  },
  rewards: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: Spacing.one,
  },
});
