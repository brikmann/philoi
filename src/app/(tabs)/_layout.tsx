import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { Colors, Fonts } from '@/constants/theme';

// Line icons, not emoji (PHILOI_UI_SPEC.md §4b, design-mocks/33) — emoji render inconsistently
// across devices and ignore the tab bar's tint-color entirely. Campfires keeps the brand flame
// vector (the signature mark, deliberately "the odd one out among line icons" per the mock's own
// caption) — the other three are Ionicons outlines, active = coral, inactive = muted, color only
// (no focused background chip, matching the mock exactly).
// Mock 33's icons don't swap shape between states at all — color is the ONLY active signal
// (same line glyph throughout), so these render one consistent outline variant each.
function LeaderboardsTabIcon({ focused }: { focused: boolean }) {
  return <Ionicons name="trophy-outline" size={23} color={focused ? Colors.coral : Colors.muted} />;
}

function ChallengesTabIcon({ focused }: { focused: boolean }) {
  // Ionicons has no literal bullseye/target glyph — MaterialCommunityIcons (bundled in the same
  // @expo/vector-icons package, no extra install) does.
  return <MaterialCommunityIcons name="target" size={22} color={focused ? Colors.coral : Colors.muted} />;
}

function ProfileTabIcon({ focused }: { focused: boolean }) {
  return <Ionicons name="person-outline" size={22} color={focused ? Colors.coral : Colors.muted} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.coral,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: { backgroundColor: Colors.card, borderTopColor: Colors.line },
        tabBarLabelStyle: styles.label,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Campfires',
          tabBarIcon: () => <FlameIcon size={24} background={null} />,
        }}
      />
      <Tabs.Screen
        name="leaderboards"
        options={{
          title: 'Leaderboards',
          tabBarIcon: ({ focused }) => <LeaderboardsTabIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="challenges"
        options={{
          title: 'Challenges',
          tabBarIcon: ({ focused }) => <ChallengesTabIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <ProfileTabIcon focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
  },
});
