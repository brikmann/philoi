import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { Colors, Fonts } from '@/constants/theme';

// THE BOTTOM BAR, drawn (mock 331, connection-first): Home · Discover · 🔥Lock In · Chat · You.
//
// No Leaderboard slot. "Lock In" beside "Leaderboard" read as "you're being ranked"; ranking is now
// something you walk into from You → Standings, never chrome. The two community tabs flank the flame
// on each side: Discover (the Agora feed, the `social` route) and Chat (friends, forests, campfires).
//
// Presentational only — components/nav/global-footer.tsx decides when it shows, which slot is lit and
// where a tap goes, so the SAME bar sits under the tabs and under every drawer screen.
//
// The center slot is the button-in-button: an ember disc floating above the bar inside a ring the
// colour of the screen, carrying the only FILLED glyph in the set. Every other slot is a stroke
// glyph: ember when active, faint when not.
//
// Chat carries the unread-DM count — the only badge on the bar. It used to be a paper-plane glyph in
// the top-right globals; the declutter pass moved it to the tab that owns conversations.

// `social` keeps its key and route: campfire "posts" buttons and installed builds deep-link /social.
export type TabKey = 'index' | 'social' | 'lockin' | 'chat' | 'profile';

export const TAB_SLOTS: { key: TabKey; href: string; label: string; glyph: NavGlyphName; center?: boolean }[] = [
  { key: 'index', href: '/', label: 'Home', glyph: 'home' },
  { key: 'social', href: '/social', label: 'Discover', glyph: 'compass' },
  { key: 'lockin', href: '/lockin', label: 'Lock In', glyph: 'flame', center: true },
  { key: 'chat', href: '/chat', label: 'Chat', glyph: 'chat' },
  { key: 'profile', href: '/profile', label: 'You', glyph: 'person' },
];

const HERO = 64;
const RING = 6;

export function BottomBar({
  active,
  sessionLive,
  chatUnread = 0,
  bottomInset,
  onSelect,
}: {
  /** The lit slot; null lights none. */
  active: TabKey | null;
  sessionLive: boolean;
  /** Unread direct messages, drawn on the Chat slot. */
  chatUnread?: number;
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
                <View style={styles.ring}>
                  <View style={[styles.hero, focused && styles.heroOn]}>
                    <Svg width={HERO} height={HERO} style={StyleSheet.absoluteFill}>
                      <Defs>
                        <LinearGradient id="navHero" x1="0" y1="0" x2="1" y2="1">
                          <Stop offset="0" stopColor={Colors.navEmber} />
                          <Stop offset="0.5" stopColor={Colors.navEmber2} />
                          <Stop offset="1" stopColor={Colors.gold} />
                        </LinearGradient>
                      </Defs>
                      <Circle cx={HERO / 2} cy={HERO / 2} r={HERO / 2} fill="url(#navHero)" />
                    </Svg>
                    <NavGlyph name="flame" size={32} color="#160D26" />
                    {sessionLive ? <View style={styles.liveDot} /> : null}
                  </View>
                </View>
                <Text style={[styles.label, styles.labelCenter]}>{slot.label}</Text>
              </Pressable>
            );
          }

          const badge = slot.key === 'chat' ? chatUnread : 0;
          return (
            <Pressable
              key={slot.key}
              onPress={() => onSelect(slot.key)}
              style={styles.slot}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge > 0 ? `${slot.label}, ${badge} unread` : slot.label}>
              <View>
                <NavGlyph name={slot.glyph} size={24} color={focused ? Colors.navEmber2 : Colors.spaceFaint} />
                {badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                  </View>
                ) : null}
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
  // Mock 331's `.flame`: lifted ~30px out of the bar, ringed in the screen colour (`0 0 0 6px
  // #120B22`) so it reads as a button sitting in a notch of the bar, with an ember glow under it.
  ring: {
    width: HERO + RING * 2,
    height: HERO + RING * 2,
    borderRadius: HERO / 2 + RING,
    marginTop: -36,
    backgroundColor: '#120B22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    width: HERO,
    height: HERO,
    borderRadius: HERO / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  heroOn: {
    borderColor: 'rgba(255,255,255,0.45)',
  },
  // The top bar's badge, moved here: ember pill, top-right of the glyph.
  badge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.black,
    fontSize: 9,
    color: '#1A1030',
  },
  liveDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#39D98A',
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
});
