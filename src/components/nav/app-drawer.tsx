import { usePathname, useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhiloiIcon, type PhiloiIconName } from '@/components/ui/philoi-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// THE SINGLE NAV (mock 157 option B, drawn per mocks 158/159/161).
//
// Philoi had TWO navigations and they disagreed about what the app contains: a bottom tab bar with
// Home/Leaderboards/Challenges/Profile, and a top-right menu with Campfires/Friends/Inventory/
// Shop/Flame Pass/Settings. Neither one told you the other existed, and a destination's rank in
// the app was decided by which of the two it happened to land in. Mock 157 puts the whole app in
// one grouped drawer: PLAY is the core loop, SOCIAL is the gathering places, REWARDS is the
// economy, and Settings sits apart because it is app config, not a place you go to play.
//
// The cost is real and worth naming: Home/Leaderboards/Challenges/Profile are two taps now
// (open drawer, pick) instead of one, which is exactly the trade-off mock 157's own caption
// flags. What it buys is the whole bottom edge back — the flame and the campfire valley get the
// screen — and one place where every destination is visible at once.

type NavRow = {
  key: string;
  label: string;
  icon: PhiloiIconName;
  route: string;
  /** Paths that light this row up. Defaults to `route`. */
  match?: string[];
  badge?: string;
  /**
   * Mock 158's `.mrow.forge` treatment — an ember left border, ember icon and ember label, on a
   * faint ember wash. One row in the whole drawer gets it, and mock 158 gives it to the Forge.
   *
   * Not a "NEW" badge (the Agora has one of those, and it is a different promise): a badge says
   * "recently added" and goes stale, this says "this row leads its group". It sits UNDER the active
   * state — the screen you are on is still the one drawn filled and orange, because a permanently
   * lit row that also looked selected would break the one signal the drawer has.
   */
  lit?: boolean;
};

type NavGroup = { title: string; rows: NavRow[] };

const GROUPS: NavGroup[] = [
  {
    title: 'Play',
    rows: [
      { key: 'home', label: 'Home', icon: 'home', route: '/', match: ['/'] },
      { key: 'leaderboards', label: 'Leaderboards', icon: 'leaderboards', route: '/leaderboards' },
      { key: 'challenges', label: 'Challenges', icon: 'challenges', route: '/challenges' },
      { key: 'profile', label: 'Profile', icon: 'profile', route: '/profile' },
    ],
  },
  {
    title: 'Social',
    rows: [
      // The Agora leads Social (mock 161) — the gathering places sit together, and the town square
      // is the newest of them. The route itself is Agent 3's; this row is what points at it.
      { key: 'agora', label: 'The Agora', icon: 'agora', route: '/agora', badge: 'NEW' },
      { key: 'campfires', label: 'Campfires', icon: 'campfires', route: '/campfires' },
      {
        key: 'friends',
        label: 'Friends',
        icon: 'friends',
        route: '/people',
        match: ['/people', '/add-friend', '/friend-profile'],
      },
    ],
  },
  {
    title: 'Rewards',
    rows: [
      { key: 'pass', label: 'Flame Pass', icon: 'pass', route: '/forge-pass' },
      { key: 'shop', label: 'Shop', icon: 'shop', route: '/shop' },
      { key: 'inventory', label: 'Inventory', icon: 'inventory', route: '/inventory' },
      // Mock 161's fourth Rewards row. It was held back until /forge existed — a menu row that
      // lands on "Unmatched Route" is worse than a row that is not there — and the screen ships in
      // this commit, so here it is, one line as promised.
      //
      // `lit` is mock 158's `.mrow.forge` treatment: an ember left border, an ember label and an
      // ember icon. The only row in the drawer that gets it. Mock 158 gives it to the Forge and
      // nothing else, which is the point — it is not a "new" badge that goes stale, it is the row
      // the Rewards group is built around.
      { key: 'forge', label: 'Forge', icon: 'forge', route: '/forge', lit: true },
    ],
  },
];

const SETTINGS_ROW: NavRow = { key: 'settings', label: 'Settings', icon: 'settings', route: '/settings' };

const PANEL_WIDTH = 292;
const OPEN_MS = 220;
const CLOSE_MS = 170;

type NavDrawerValue = { open: () => void; close: () => void };
const NavDrawerContext = createContext<NavDrawerValue>({ open: () => {}, close: () => {} });

/** Opens the one nav from anywhere — a header button, an empty state, a deep link. */
export function useNavDrawer(): NavDrawerValue {
  return useContext(NavDrawerContext);
}

/**
 * Mounted once, above the navigator, in app/_layout.tsx. The drawer renders inside a <Modal>, so
 * it sits over whatever screen is on top regardless of where this provider lives in the tree —
 * which is what lets ONE instance serve every route instead of each screen carrying its own copy
 * of the menu, the way home-chrome's did.
 */
export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setOpen(true), close: () => setOpen(false) }), []);

  return (
    <NavDrawerContext.Provider value={value}>
      {children}
      <AppDrawer open={open} onClose={value.close} />
    </NavDrawerContext.Provider>
  );
}

/**
 * The hamburger. One control, one glyph, every surface that has a header.
 *
 * Rendered at the caller's tint rather than the nav grey: this sits in a header next to a title,
 * not in a list of destinations, so it takes the header's colour.
 */
export function DrawerButton({ color = Colors.ink, size = 22 }: { color?: string; size?: number }) {
  const { open } = useNavDrawer();
  return (
    <Pressable onPress={open} hitSlop={10} accessibilityRole="button" accessibilityLabel="Menu">
      <PhiloiIcon name="menu" size={size} color={color} />
    </Pressable>
  );
}

function AppDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  // Held mounted through the closing animation — a <Modal> unmounts its children the instant
  // `visible` flips, so animating the panel out means keeping it here a beat longer than `open`.
  const [mounted, setMounted] = useState(open);
  const t = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      t.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
      return;
    }

    // 🔴 THE UNMOUNT IS A JS TIMER, NOT THE ANIMATION'S COMPLETION CALLBACK.
    //
    // What used to be here:
    //
    //     t.value = withTiming(0, { ... }, (finished) => {
    //       if (finished) runOnJS(setMounted)(false);
    //     });
    //
    // That third argument is a WORKLET — Babel compiles it onto the UI runtime with
    // `{ runOnJS, setMounted }` captured into its `__closure`, which means React's state setter has
    // to be serialised across the runtime boundary and called back 170ms later. It crashed the app
    // outright, every time, on every drawer row:
    //
    //     libworklets.so  jsi.h:2014  Value::getObject(IRuntime&) &&: assertion "isObject()" failed
    //     signal 6 (SIGABRT), thread mqt_v_js, via CallInvoker::invokeAsync
    //
    // A hard SIGABRT, not a JS error — so nothing reached Metro, LogBox, or a red screen; the app
    // simply vanished to the home screen. It took a tombstone off the device to see it at all.
    //
    // `go()` calls onClose() and then router.navigate() in the same tick, so the route tree is
    // already being torn down while that 170ms animation runs. By the time the completion worklet
    // fires and asks the JS runtime for its captured setter, what comes back is not an object, and
    // worklets asserts rather than degrading.
    //
    // The fix is to not cross the boundary at all. Nothing here needs to run on the UI thread: the
    // animation is pure shared-value interpolation that Reanimated drives by itself, and the only
    // JS work is a setState that a plain timer does perfectly well. Fewer moving parts than the
    // version that crashed.
    //
    // The cleanup is load-bearing too, and it is what the old `finished` check was doing: reopen
    // the drawer mid-close and the timer is cancelled, so it cannot unmount a panel that is on its
    // way back in.
    t.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) });
    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, t]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -PANEL_WIDTH * (1 - t.value) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: t.value }));

  const go = useCallback(
    (route: string) => {
      // Close BEFORE navigating: leaving the modal mounted across a route change strands it over
      // the destination on Android — the same bug the old home menu had to guard.
      onClose();
      // navigate(), not push(). A menu is not a "go deeper" gesture: pushing would stack a second
      // Home on top of the Shop you opened from the last drawer visit, and three trips through the
      // menu would leave three back-presses of history that no user built on purpose. navigate()
      // returns to a screen already in the stack and only pushes when there isn't one.
      //
      // Cast for the reason every other route table in this app casts: expo-router's typed routes
      // cannot type destinations held as data.
      router.navigate(route as never);
    },
    [onClose, router]
  );

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {/* The backdrop is the dismiss target — a drawer with no visible close button needs
            tapping-away to work, and it is the gesture people try first. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
        </Animated.View>

        <Animated.View style={[styles.panel, panelStyle]}>
          <SafeAreaView edges={['top', 'bottom']} style={styles.panelInner}>
            <View style={styles.head}>
              <Text style={styles.headTitle}>Menu</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close menu">
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              {GROUPS.map((group) => (
                <View key={group.title} style={styles.group}>
                  <Text style={styles.groupTitle}>{group.title.toUpperCase()}</Text>
                  {group.rows.map((row) => (
                    <Row key={row.key} row={row} pathname={pathname} onPress={() => go(row.route)} />
                  ))}
                </View>
              ))}

              <View style={styles.group}>
                <Row row={SETTINGS_ROW} pathname={pathname} onPress={() => go(SETTINGS_ROW.route)} muted />
              </View>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function isActive(row: NavRow, pathname: string): boolean {
  const targets = row.match ?? [row.route];
  return targets.some((target) =>
    target === '/' ? pathname === '/' : pathname === target || pathname.startsWith(target + '/')
  );
}

function Row({
  row,
  pathname,
  onPress,
  muted = false,
}: {
  row: NavRow;
  pathname: string;
  onPress: () => void;
  muted?: boolean;
}) {
  const active = isActive(row, pathname);
  // Mock 159: the screen you are on is filled + Philoi orange, everything else is a grey outline.
  // Style AND colour, so the active row still reads at 21px in a list of eleven.
  //
  // A `lit` row (mock 158's `.mrow.forge`) sits between the two: ember, but outline rather than
  // filled, so the active row is still the only filled glyph in the drawer.
  const restTint = row.lit ? Colors.amber : muted ? Colors.textTertiary : Colors.muted;

  return (
    <Pressable
      style={[styles.row, row.lit && styles.rowLit, active && styles.rowActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      <PhiloiIcon name={row.icon} size={21} active={active} color={active ? undefined : restTint} />
      <Text
        style={[
          styles.rowLabel,
          row.lit && styles.rowLabelLit,
          active && styles.rowLabelActive,
          muted && styles.rowLabelMuted,
        ]}>
        {row.label}
      </Text>
      {row.badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{row.badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: 'rgba(6,4,10,0.62)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: '#17111F',
    borderRightWidth: 1,
    borderRightColor: '#2E2542',
  },
  panelInner: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  close: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.textTertiary,
  },
  scroll: {
    paddingBottom: Spacing.four,
  },
  group: {
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: '#201830',
    marginTop: 4,
  },
  groupTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: '#6A5D84',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  rowActive: {
    backgroundColor: 'rgba(242,163,60,0.10)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.amber,
    paddingLeft: 15,
  },
  // Mock 158's `.mrow.forge`: the same ember left border, over a wash weaker than the active row's
  // so the two never read as the same state. Listed BEFORE rowActive at the call site, so being on
  // /forge still paints the full active treatment over the top.
  rowLit: {
    backgroundColor: 'rgba(242,163,60,0.055)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.amber,
    paddingLeft: 15,
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#C9BFE0',
  },
  // Mock 158's `.mrow.forge .mt` — the ember label that comes with the lit border.
  rowLabelLit: {
    color: Colors.ember,
  },
  rowLabelActive: {
    color: Colors.ember,
  },
  rowLabelMuted: {
    color: Colors.textTertiary,
  },
  badge: {
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: Colors.achieverBg,
  },
  badgeLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.6,
    color: Colors.achieverText,
  },
});
