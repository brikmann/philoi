import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { Colors, Fonts } from '@/constants/theme';

// THE BOTTOM BAR, drawn (ShareSpot, mock 346): Home · Search · ➕Post · Lock In · You.
//
// POSTING IS THE CENTERPIECE. The raised slot is no longer a tab: it is the Post button, an ember
// rounded-square lifted out of the bar, and a tap opens the composer (agora/compose) from any screen.
// It is never "lit" — there is no Post screen to be on — so `active` only ever names one of the four
// tabs around it.
//
// Lock In moved off center onto a pencil (study/project, never crossed swords) and keeps its green
// live-session dot. Chat left the bar: 1:1 DMs live behind Home's ✉, group chats in Rooms (SHARED §3),
// so the unread-DM badge is the Home top bar's now, not this bar's.
//
// Presentational only — components/nav/global-footer.tsx decides when it shows, which slot is lit and
// where a tap goes, so the SAME bar sits under the tabs and under every drawer screen.

// `social` keeps its key and route: campfire "posts" buttons and installed builds deep-link /social.
// `chat` stays in the union — (tabs)/chat still exists and still lights a slot if one is ever drawn.
export type TabKey = 'index' | 'social' | 'lockin' | 'chat' | 'profile';
export type SlotKey = TabKey | 'post';

export const TAB_SLOTS: { key: SlotKey; href: string; label: string; glyph: NavGlyphName; center?: boolean }[] = [
  { key: 'index', href: '/', label: 'Home', glyph: 'home' },
  { key: 'social', href: '/social', label: 'Search', glyph: 'search' },
  { key: 'post', href: '/agora/compose', label: 'Post', glyph: 'plus', center: true },
  { key: 'lockin', href: '/lockin', label: 'Lock In', glyph: 'pencil' },
  { key: 'profile', href: '/profile', label: 'You', glyph: 'person' },
];

const HERO = 56;
const RING = 5;
/** Mock 346's `.pbtn`: a rounded square (18 of 54), not a disc — the Post button, not the old flame. */
const HERO_RADIUS = 18;

export function BottomBar({
  active,
  sessionLive,
  bottomInset,
  onSelect,
}: {
  /** The lit slot; null lights none. */
  active: TabKey | null;
  /** A lock-in is running — the green dot on the Lock In slot. */
  sessionLive: boolean;
  bottomInset: number;
  onSelect: (key: SlotKey) => void;
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
                accessibilityRole="button"
                accessibilityLabel="New post">
                <View style={styles.ring}>
                  <View style={styles.hero}>
                    <Svg width={HERO} height={HERO} style={StyleSheet.absoluteFill}>
                      <Defs>
                        <LinearGradient id="navHero" x1="0" y1="0" x2="1" y2="1">
                          <Stop offset="0" stopColor={Colors.navEmber} />
                          <Stop offset="0.5" stopColor={Colors.navEmber2} />
                          <Stop offset="1" stopColor={Colors.gold} />
                        </LinearGradient>
                      </Defs>
                      <Rect width={HERO} height={HERO} rx={HERO_RADIUS} fill="url(#navHero)" />
                    </Svg>
                    <NavGlyph name="plus" size={30} color="#160D26" />
                  </View>
                </View>
                <Text style={[styles.label, styles.labelCenter]}>{slot.label}</Text>
              </Pressable>
            );
          }

          const live = slot.key === 'lockin' && sessionLive;
          return (
            <Pressable
              key={slot.key}
              onPress={() => onSelect(slot.key)}
              style={styles.slot}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={live ? `${slot.label}, session running` : slot.label}>
              <View>
                <NavGlyph name={slot.glyph} size={24} color={focused ? Colors.navEmber2 : Colors.spaceFaint} />
                {live ? <View style={styles.liveDot} /> : null}
              </View>
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
  // Mock 346's `.pbtn`: lifted ~20px out of the bar, ringed in the screen colour (`0 0 0 5px
  // #120B22`) so it reads as a button sitting in a notch of the bar, with an ember glow under it.
  ring: {
    width: HERO + RING * 2,
    height: HERO + RING * 2,
    borderRadius: HERO_RADIUS + RING,
    marginTop: -26,
    backgroundColor: '#120B22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    width: HERO,
    height: HERO,
    borderRadius: HERO_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 12,
  },
  // A lock-in is running: green, top-right of the pencil.
  liveDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#39D98A',
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
});
