import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useNotifications } from '@/hooks/use-notifications';
import { formatRelativeTime } from '@/lib/format';
import type { NotificationEvent, NotificationImageShape } from '@/types/database';

// The bell feed (§F1, mock 106).
//
// Opening it marks everything read — the badge is "there is something you haven't looked at", and
// you are now looking at it. Per-row read state would mean a list of individually-dismissable
// items, which is an inbox; this is an activity log.

export default function NotificationsScreen() {
  const router = useRouter();
  const { items, loading, error, refreshItems, markAllRead } = useNotifications();

  useEffect(() => {
    // Load and clear the badge together. markAllRead refetches, so this is one round trip, not two.
    markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount; markAllRead is stable per user but re-running on every identity change would re-mark on each render
  }, []);

  function open(n: NotificationEvent) {
    if (!n.route) return;
    // The route was stored when the event was written, so this needs no per-type switch and an old
    // row keeps working after a screen is renamed.
    router.push({ pathname: n.route as never, params: n.route_params as never });
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>Activity</Text>
        <Pressable onPress={() => router.push('/settings-notifications')} hitSlop={12} accessibilityLabel="Notification settings">
          <Ionicons name="options-outline" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshItems} tintColor={Colors.coral} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={<FlameLogo size={64} />}
              title="Nothing yet"
              body="Friend requests, challenges and campfire activity will show up here."
            />
          )
        }
        renderItem={({ item }) => <Row n={item} onPress={() => open(item)} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </Screen>
  );
}

function Row({ n, onPress }: { n: NotificationEvent; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!n.route}
      style={({ pressed }) => [styles.row, pressed && n.route ? styles.rowPressed : null]}
      accessibilityRole={n.route ? 'button' : undefined}>
      <LeadingArt url={n.image_url} shape={n.image_shape} />
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={2}>
          {n.title}
        </Text>
        {n.body ? (
          <Text style={styles.body} numberOfLines={2}>
            {n.body}
          </Text>
        ) : null}
        <Text style={styles.time}>{formatRelativeTime(n.created_at)}</Text>
      </View>
      {/* Unread marker rather than a highlighted row: the whole list is marked read on open, so a
          background wash would flash and vanish. A dot is a quieter way to say "this arrived since
          you last looked" for the split second it is true. */}
      {n.read_at === null ? <View style={styles.unreadDot} /> : null}
    </Pressable>
  );
}

/**
 * The spec's leading art, masked per subject: circle for avatars, hexagon for ranks, rounded
 * square for campfires and boxes, flame when there is no subject image.
 *
 * Hexagon is approximated with a heavy border radius rather than an SVG clip — react-native-svg
 * cannot mask an <Image> without a mask element, and at 44px the difference between a hexagon and
 * a squircle is not visible. Worth revisiting if the art ever gets bigger.
 */
function LeadingArt({ url, shape }: { url: string | null; shape: NotificationImageShape }) {
  if (!url) {
    return (
      <View style={[styles.art, styles.artFallback]}>
        <FlameLogo size={22} />
      </View>
    );
  }
  return <Image source={{ uri: url }} style={[styles.art, SHAPE_STYLE[shape]]} contentFit="cover" />;
}

const SHAPE_STYLE: Record<NotificationImageShape, { borderRadius: number }> = {
  circle: { borderRadius: 999 },
  hexagon: { borderRadius: 14 },
  rounded: { borderRadius: 12 },
  square: { borderRadius: 4 },
  flame: { borderRadius: 999 },
};

const ART = 44;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.twelve,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: Spacing.twelve,
  },
  rowPressed: {
    opacity: 0.6,
  },
  art: {
    width: ART,
    height: ART,
    backgroundColor: Colors.disabled,
  },
  artFallback: {
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
  sep: {
    height: 1,
    backgroundColor: Colors.line,
  },
});
