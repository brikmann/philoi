import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { Colors, Fonts } from '@/constants/theme';

// THE BOTTOM BAR, drawn (mocks 301/302/304): Home · Social · 🔥Lock In · Leaderboard · Profile.
// Mock 320 retasked Search as Social (💬): the feed, chats and posting; search lives inside it.
//
// Presentational only — components/nav/global-footer.tsx decides when it shows, which slot is lit and
// where a tap goes, so the SAME bar sits under the tabs and under every drawer screen.
//
// The center slot is the hero — an elevated ember disc carrying the only FILLED glyph in the set.
// Every other slot is a stroke glyph: ember when active, faint when not.

export type TabKey = 'index' | 'social' | 'lockin' | 'leaderboards' | 'profile';

export const TAB_SLOTS: { key: TabKey; href: string; label: string; glyph: NavGlyphName; center?: boolean }[] = [
  { key: 'index', href: '/', label: 'Home', glyph: 'home' },
  { key: 'social', href: '/social', label: 'Social', glyph: 'social' },
  { key: 'lockin', href: '/lockin', label: 'Lock In', glyph: 'flame', center: true },
  { key: 'leaderboards', href: '/leaderboards', label: 'Board', glyph: 'trophy' },
  { key: 'profile', href: '/profile', label: 'You', glyph: 'person' },
];

export function BottomBar({
  active,
  sessionLive,
  bottomInset,
  onSelect,
}: {
  /** The lit slot; null lights none. */
  active: TabKey | null;
  sessionLive: boolean;
  bottomInset: number;
  onSelect: (key: TabKey) => void;
}) {
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(bottomInset, 10) }]}>
      <View style={styles.bar}>
        {TAB_SLOTS.map((slot) => {
          const focused = active === slot.key;

          if (slot.center) {
            return (
              <Pressable
                key={slot.key}
                onPress={() => onSelect(slot.key)}
                style={styles.slot}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={sessionLive ? 'Lock In, session running' : 'Lock In'}>
                <View style={[styles.hero, focused && styles.heroOn]}>
                  <Svg width={48} height={48} style={StyleSheet.absoluteFill}>
                    <Defs>
                      <LinearGradient id="navHero" x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0" stopColor={Colors.navEmber} />
                        <Stop offset="1" stopColor={Colors.navEmber2} />
                      </LinearGradient>
                    </Defs>
                    <Rect x="0" y="0" width="48" height="48" rx="24" fill="url(#navHero)" />
                  </Svg>
                  <NavGlyph name="flame" size={28} color="#2A0F05" />
                  {sessionLive ? <View style={styles.liveDot} /> : null}
                </View>
                <Text style={[styles.label, styles.labelCenter]}>{slot.label}</Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={slot.key}
              onPress={() => onSelect(slot.key)}
              style={styles.slot}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={slot.label}>
              <NavGlyph name={slot.glyph} size={24} color={focused ? Colors.navEmber : Colors.spaceFaint} />
              <Text style={[styles.label, { color: focused ? Colors.navEmber2 : Colors.spaceFaint }]}>{slot.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.spacePanel,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  slot: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.spaceFaint,
  },
  labelCenter: {
    color: Colors.navEmber2,
  },
  // Lifted out of the bar, like mock 302's `.ni.center { transform: translateY(-10px) }`.
  hero: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
    borderWidth: 3,
    borderColor: Colors.spacePanel,
  },
  heroOn: {
    borderColor: Colors.navEmber2,
  },
  liveDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#39D98A',
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
});
