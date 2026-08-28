import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Colors, Fonts } from '@/constants/theme';

// The bar these feed is hidden (see tabBarStyle below) — the drawer is the nav now. They are kept,
// and moved onto the mock-158 vector set, so the four core destinations are drawn by the same hand
// here as in the drawer: one 24 grid, 1.8 stroke, grey outline -> filled ember. What was here
// before was three families at once (an Ionicons trophy, a MaterialCommunityIcons target, the
// brand FlameLogo), which is exactly the inconsistency mock 158 exists to end.

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
        // THE BOTTOM BAR IS RETIRED (mock 157 option B). One nav now — the side drawer in
        // components/nav/app-drawer.tsx — so Home/Leaderboards/Challenges/Profile are drawer rows
        // like everything else instead of the four destinations the app privileged by accident of
        // which navigator they landed in.
        //
        // The Tabs navigator itself STAYS, with its bar hidden. Every deep link, push and
        // notification route in the app names these paths (/(tabs)/challenges from the challenge
        // pushes, /?lockin=1 from a friend's nudge), and flattening the group into the root Stack
        // to delete a bar nobody can see would rewrite all of them for no visible gain.
        tabBarStyle: { display: 'none' },
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
          tabBarIcon: ({ focused }) => <PhiloiIcon name="home" size={23} active={focused} />,
        }}
      />
      <Tabs.Screen
        name="leaderboards"
        options={{
          title: 'Leaderboards',
          tabBarIcon: ({ focused }) => <PhiloiIcon name="leaderboards" size={23} active={focused} />,
        }}
      />
      <Tabs.Screen
        name="challenges"
        options={{
          title: 'Challenges',
          tabBarIcon: ({ focused }) => <PhiloiIcon name="challenges" size={23} active={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <PhiloiIcon name="profile" size={23} active={focused} />,
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
