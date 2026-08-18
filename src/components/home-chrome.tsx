import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlameLogo } from '@/components/ui/flame-logo';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { SEASON, msUntilSeasonBoundary, seasonPhase } from '@/lib/economy/forge-pass';

// Home's entire top row (DESIGN_LANGUAGE_EMBER §5, mock 92): the season pill centred, one
// hamburger on the right, and nothing else.
//
// What this replaces: a title plus two loose icon buttons (Shop, Friends) that had grown by
// accretion — every new destination meant another glyph competing with the hero. Collapsing them
// into one menu is what lets the flame own the screen while keeping everything one tap away.

/** "S1 EMBERFALL · 90d 0h" — always visible, so the season is never something you have to go look for. */
export function SeasonPill() {
  const [now, setNow] = useState(() => Date.now());

  // Hour granularity is all the label shows, but ticking every minute keeps a screen left open
  // from sitting on a stale number for an hour.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const phase = seasonPhase(now);
  const left = msUntilSeasonBoundary(now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);

  // The countdown means something different in each phase, so the prefix has to say which —
  // "90d" against a season that hasn't opened yet would read as time remaining in it.
  const countdown =
    phase === 'closed'
      ? 'ended'
      : phase === 'upcoming'
        ? `opens in ${days}d`
        : phase === 'claim-window'
          ? `${days}d to claim`
          : `${days}d ${hours}h`;

  return (
    <View style={styles.pill}>
      <FlameLogo size={12} />
      <Text style={styles.pillText}>
        {SEASON.id} {SEASON.name.toUpperCase()}
      </Text>
      <Text style={styles.pillSep}>·</Text>
      <Text style={styles.pillCountdown}>{countdown}</Text>
    </View>
  );
}

type MenuItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  /** Settings sits apart — it's app config, not a place you go to play. */
  sub?: boolean;
};

const MENU: MenuItem[] = [
  // First, and first for a reason: campfires lost its bottom-tab slot in §4, so this is now the
  // only way in. Anything that used to be one tap from the tab bar has to be one tap from here.
  { label: 'Campfires', icon: 'bonfire-outline', route: '/campfires' },
  { label: 'Friends', icon: 'people-outline', route: '/people' },
  { label: 'Inventory', icon: 'grid-outline', route: '/inventory' },
  // A market stall, per §5 — `storefront` is the closest Ionicon to the mock's awning glyph.
  { label: 'Shop', icon: 'storefront-outline', route: '/shop' },
  { label: 'Forge Pass', icon: 'shield-checkmark-outline', route: '/forge-pass' },
  { label: 'Settings', icon: 'settings-outline', route: '/settings', sub: true },
];

export function HomeMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function go(route: string) {
    // Close BEFORE navigating: leaving the modal mounted across a route change leaves it stranded
    // over the destination on Android.
    setOpen(false);
    router.push(route as never);
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Menu">
        <Ionicons name="menu" size={24} color={Colors.ink} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* The backdrop is the dismiss target — a menu with no visible close button needs
            tapping-away to work, and it's the gesture people try first. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <SafeAreaView edges={['top']}>
            {/* Stops a tap inside the sheet from bubbling to the backdrop and closing it. */}
            <Pressable style={styles.menu} onPress={() => {}}>
              {MENU.map((item) => (
                <Pressable
                  key={item.route}
                  style={[styles.menuRow, item.sub && styles.menuRowSub]}
                  onPress={() => go(item.route)}
                  accessibilityRole="button">
                  <Ionicons name={item.icon} size={18} color={item.sub ? Colors.textTertiary : Colors.ink} />
                  <Text style={[styles.menuLabel, item.sub && styles.menuLabelSub]}>{item.label}</Text>
                </Pressable>
              ))}
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.card,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.1,
    color: Colors.ember,
  },
  pillSep: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },
  pillCountdown: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.muted,
    fontVariant: ['tabular-nums'],
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  menu: {
    alignSelf: 'flex-end',
    marginTop: Spacing.two,
    marginRight: Spacing.three,
    minWidth: 190,
    borderRadius: 16,
    paddingVertical: Spacing.one,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 13,
    paddingHorizontal: Spacing.three,
  },
  menuRowSub: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    marginTop: 4,
  },
  menuLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  menuLabelSub: {
    color: Colors.textTertiary,
  },
});
