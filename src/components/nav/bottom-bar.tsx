import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { Colors, Fonts } from '@/constants/theme';
import { useActiveSession } from '@/lib/active-session-context';

// THE BOTTOM BAR (mocks 301/302/304): Home · Search · 🔥Lock In · Leaderboard · Profile.
//
// The center slot is the hero — an elevated ember disc carrying the only FILLED glyph in the set.
// Every other slot is a stroke glyph: ember when active, faint when not. Only the five routes named
// here get a slot; any other screen in the (tabs) group (Challenges) stays routable but off the bar.

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const SLOTS: { route: string; label: string; glyph: NavGlyphName; center?: boolean }[] = [
  { route: 'index', label: 'Home', glyph: 'home' },
  { route: 'search', label: 'Search', glyph: 'search' },
  { route: 'lockin', label: 'Lock In', glyph: 'flame', center: true },
  { route: 'leaderboards', label: 'Board', glyph: 'trophy' },
  { route: 'profile', label: 'You', glyph: 'person' },
];

export function BottomBar({ state, navigation, insets }: TabBarProps) {
  const focusedName = state.routes[state.index]?.name;
  const { session: activeSession } = useActiveSession();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        {SLOTS.map((slot) => {
          const route = state.routes.find((r) => r.name === slot.route);
          if (!route) return null;
          const focused = focusedName === slot.route;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };

          if (slot.center) {
            return (
              <Pressable
                key={slot.route}
                onPress={onPress}
                style={styles.slot}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={activeSession ? 'Lock In, session running' : 'Lock In'}>
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
                  {activeSession ? <View style={styles.liveDot} /> : null}
                </View>
                <Text style={[styles.label, styles.labelCenter]}>{slot.label}</Text>
              </Pressable>
            );
          }

          const tint = focused ? Colors.navEmber2 : Colors.spaceFaint;
          return (
            <Pressable
              key={slot.route}
              onPress={onPress}
              style={styles.slot}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={slot.label}>
              <NavGlyph name={slot.glyph} size={24} color={focused ? Colors.navEmber : Colors.spaceFaint} />
              <Text style={[styles.label, { color: tint }]}>{slot.label}</Text>
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
