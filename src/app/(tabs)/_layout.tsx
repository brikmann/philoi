import { Tabs } from 'expo-router';


// THE BOTTOM BAR (mock 331, connection-first): Home · Discover · 🔥 Lock In (raised center) · Chat · You.
// Connection is the chrome; ranking is something you choose to walk into, never implied by the bar.
// The drawer behind the top-right ☰ keeps everything else (components/nav/app-drawer.tsx).
//
// The bar itself is NOT drawn here any more (ui_pass2 §2): components/nav/global-footer.tsx mounts it
// once under the root navigator, so the same bar shows on drawer screens too. `tabBar` returns null.
//
// Discover is the `social` route (the Agora feed) — the file keeps its name because campfire "posts"
// buttons and installed builds deep-link /social?channel=…. Chat is the conversation hub that used
// to be the Social tab's second pane.
//
// Leaderboards and Challenges stay IN this group, off the bar (the footer only draws the five slots it
// names): pushes and every server-written route deep-link to /(tabs)/leaderboards and
// /(tabs)/challenges, and moving the files would break all of them. The board is reached from
// You → Standings; Challenges from the drawer.

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
      <Tabs.Screen name="social" options={{ title: 'Discover' }} />
      <Tabs.Screen name="lockin" options={{ title: 'Lock In' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
      <Tabs.Screen name="leaderboards" options={{ title: 'Standings', href: null }} />
      <Tabs.Screen name="challenges" options={{ title: 'Challenges', href: null }} />
    </Tabs>
  );
}
