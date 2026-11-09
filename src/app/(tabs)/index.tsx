import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HomeFeed } from '@/components/home/home-feed';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { RoomsTab } from '@/components/rooms/rooms-tab';
import { Colors, Fonts } from '@/constants/theme';

// HOME = THE FEED (ShareSpot mock 344). You open the app and land in the social feed.
//   · Top bar: brand, then ✉ Messages · 🔔 Notifications · ☰ Menu — nothing else (AppTopBar).
//   · Submenu: Home (friends + your rooms) · Friends (friends only) · Rooms (mock 374, group chats).
// The old "you + your people" surface (mock 318, HomeConnectionSurface) is retired from this route;
// its collective shows up as a feed card instead ("your people are on a roll").

type Pane = 'home' | 'friends' | 'rooms';
const PANES: { key: Pane; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'friends', label: 'Friends' },
  { key: 'rooms', label: 'Rooms' },
];

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lockin?: string; pane?: string }>();
  const [pane, setPane] = useState<Pane>(params.pane === 'rooms' || params.pane === 'friends' ? params.pane : 'home');

  // A friend's "lock in?" nudge still deep-links to /?lockin=1 (0207 writes that route server-side
  // and installed builds read it). Starting a session lives on the Lock In tab, so forward there.
  useEffect(() => {
    if (params.lockin === '1') {
      router.setParams({ lockin: undefined });
      router.navigate('/lockin');
    }
  }, [params.lockin, router]);

  // The tab stays mounted, so a later /?pane=rooms (the menu's Rooms row) has to flip it.
  const [seenPane, setSeenPane] = useState(params.pane);
  if (params.pane !== seenPane) {
    setSeenPane(params.pane);
    if (params.pane === 'rooms' || params.pane === 'friends' || params.pane === 'home') setPane(params.pane);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar />
      <View style={styles.tabs} accessibilityRole="tablist">
        {PANES.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPane(p.key)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: pane === p.key }}>
            <Text style={[styles.tabText, pane === p.key && styles.tabTextOn]}>{p.label}</Text>
            {pane === p.key ? <View style={styles.underline} /> : null}
          </Pressable>
        ))}
      </View>
      {pane === 'rooms' ? <RoomsTab /> : <HomeFeed key={pane} scope={pane === 'friends' ? 'friends' : 'all'} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 22, paddingHorizontal: 18, paddingBottom: 10 },
  tab: { paddingVertical: 4, alignItems: 'center' },
  tabText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.spaceDim },
  tabTextOn: { fontFamily: Fonts.bodyBold, color: Colors.ink },
  underline: { marginTop: 4, height: 3, width: 22, borderRadius: 2, backgroundColor: Colors.navEmber },
});
