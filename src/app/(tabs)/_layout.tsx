import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
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
  // The root Stack's own `contentStyle.paddingTop` (see app/_layout.tsx's `topInset`) only
  // reserves space for the floating live-session bar on screens pushed directly onto that
  // Stack — it does NOT cascade into this nested Tabs navigator (punchlist 2, §0: the bar was
  // "overlapping/crowding the Leaderboard & Challenge titles" specifically, since Home's own
  // greeting/hero content happened to leave enough headroom to hide the same bug). `sceneStyle`
  // is this navigator's own equivalent — applied here so every tab's shared TabHeader chrome
  // gets pushed below the bar uniformly, without each of the 4 screens reserving it separately.
  // No inset any more — the live-session pill is retired (Ember pass §3).
  const topInset = 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.coral,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: { backgroundColor: Colors.card, borderTopColor: Colors.line },
        tabBarLabelStyle: styles.label,
        // Still load-bearing, still not cosmetic: without a colour here the scene falls back to
        // react-navigation's default WHITE. But it must be the radial's OUTER stop, not the old
        // flat cream — cream is opaque and was painting straight over the deep-purple radial on
        // every tab, which is why Settings/Profile/Challenges read as flat dark while screens
        // outside the tab navigator looked right (punchlist 16 §1).
        sceneStyle: { paddingTop: topInset, backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          // Home, not Campfires — this tab is the flame / lock-in hub now and campfires is a
          // hamburger destination (punchlist 16 §4).
          title: 'Home',
          tabBarIcon: () => <FlameLogo size={24} />,
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
