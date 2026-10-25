import { Tabs } from 'expo-router';


// THE BOTTOM BAR IS BACK (nav restructure, mocks 301/302) — ShareSpot-style, social first:
// Home (the community feed) · Search · 🔥 Lock In (center) · Leaderboard · Profile. The drawer behind
// the top-right ☰ keeps everything else (components/nav/app-drawer.tsx).
//
// The bar itself is NOT drawn here any more (ui_pass2 §2): components/nav/global-footer.tsx mounts it
// once under the root navigator, so the same bar shows on drawer screens too. `tabBar` returns null.
//
// Challenges stays IN this group, off the bar (the footer only draws the five slots it names): the
// challenge pushes and every server-written route deep-link to /(tabs)/challenges, and moving the
// file would break all of them. It's reachable from the Leaderboard tab and from the drawer.

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{
        headerShown: false,
        // THE BIG ONE for freezeOnBlur (see enableFreeze() in ../_layout.tsx). Every tab stays
        // mounted for the life of the app; blurred tabs stop rendering until they're looked at again.
        freezeOnBlur: true,
        // Transparent so the root <ScreenBackground> shows through — without a colour here the
        // scene falls back to react-navigation's default WHITE.
        sceneStyle: { backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="lockin" options={{ title: 'Lock In' }} />
      <Tabs.Screen name="leaderboards" options={{ title: 'Leaderboard' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="challenges" options={{ title: 'Challenges', href: null }} />
    </Tabs>
  );
}
