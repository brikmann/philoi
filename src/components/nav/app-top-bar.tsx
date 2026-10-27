import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNavDrawer } from '@/components/nav/app-drawer';
import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useNotifications } from '@/hooks/use-notifications';
import { fetchMyDmThreads } from '@/lib/api/dm';

// THE TOP-RIGHT GLOBALS (mocks 301/302): brand left; Search · Shop · Messages · Notifications · Menu
// right, on every tab. Search is here rather than inside Social so it's findable from anywhere
// (pre-submission fix E11) — it pushes its own screen. The drawer behind ☰ holds everything that doesn't earn a slot on the bottom bar — the
// Shop is there too, but it's one tap from anywhere now rather than two.

export function AppTopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();
  const onSearch = usePathname() === '/search';
  const { open } = useNavDrawer();
  const { unread, refreshCount } = useNotifications();
  const [dmUnread, setDmUnread] = useState(0);

  // Counts refresh on focus: tabs stay mounted (frozen) for the life of the app, so a mount-only
  // read would show this morning's number all day.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      refreshCount();
      fetchMyDmThreads()
        .then((threads) => {
          if (live) setDmUnread(threads.reduce((n, t) => n + (t.unread ?? 0), 0));
        })
        .catch(() => {
          // A badge is flavour — a failed read just shows no count.
        });
      return () => {
        live = false;
      };
    }, [refreshCount])
  );

  return (
    <View style={styles.bar}>
      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.brand}>
          <NavGlyph name="flame" size={20} color={Colors.navEmber} />
          <Text style={styles.brandText}>philoi</Text>
        </View>
      )}
      <View style={styles.actions}>
        {right}
        {onSearch ? null : <GlobalButton glyph="search" label="Search" onPress={() => router.push('/search')} />}
        <GlobalButton icon={<PhiloiIcon name="shop" size={20} color={Colors.ink} />} label="Shop" onPress={() => router.push('/shop')} />
        <GlobalButton glyph="plane" label="Messages" badge={dmUnread} onPress={() => router.push('/messages')} />
        <GlobalButton glyph="bell" label="Notifications" badge={unread} onPress={() => router.push('/notifications')} />
        <GlobalButton glyph="menu" label="Menu" onPress={open} />
      </View>
    </View>
  );
}

function GlobalButton({
  glyph,
  icon,
  label,
  badge = 0,
  onPress,
}: {
  glyph?: NavGlyphName;
  /** For a global with no NavGlyph — the Shop wears the drawer's own PhiloiIcon, so the two match. */
  icon?: ReactNode;
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}>
      {icon ?? (glyph ? <NavGlyph name={glyph} size={19} color={Colors.ink} /> : null)}
      {badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandText: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
    letterSpacing: -0.3,
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
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
});
