import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { LIVE_SESSION_BAR_HEIGHT } from '@/components/live-session-bar';
import { Colors, Fonts } from '@/constants/theme';
import { useActiveSession } from '@/lib/active-session-context';

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
  const { session } = useActiveSession();
  const topInset = session ? LIVE_SESSION_BAR_HEIGHT : 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.coral,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: { backgroundColor: Colors.card, borderTopColor: Colors.line },
        tabBarLabelStyle: styles.label,
        // backgroundColor here is load-bearing, not cosmetic: without it this nested Tabs
        // navigator's scene falls back to react-navigation's default (WHITE) background, and the
        // paddingTop band reserved for the live-session bar renders as a white stripe across the
        // top of every tab during a lock-in. Pin it to the app background so the inset is dark.
        sceneStyle: { paddingTop: topInset, backgroundColor: Colors.cream },
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
