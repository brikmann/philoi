import { useNetInfo } from '@react-native-community/netinfo';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgoraCommentsSheet } from '@/components/agora/agora-comments-sheet';
import { FeedPage, feedPageMedia } from '@/components/agora/feed-page';
import { HomeTrackerCard } from '@/components/fitness/tracker-prompts';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAgoraFeed } from '@/hooks/use-agora-feed';
import { useFeedChannel } from '@/hooks/use-feed-channel';
import { useFitnessTracking } from '@/hooks/use-fitness-tracking';
import { useMotionActive } from '@/hooks/use-motion-active';
import { usePublicLoadouts, useRefreshPublicLoadoutsOnFocus } from '@/hooks/use-public-loadouts';
import { onAgoraPost } from '@/lib/agora-just-posted';
import { track } from '@/lib/analytics';
import {
  AGORA_SCOPES,
  blockAgoraUser,
  cheerAgoraItem,
  deleteAgoraPost,
  fetchAgoraItem,
  reportAgora,
  setMilestoneInAgora,
} from '@/lib/api/agora';
import { channelKey, parseFeedKey, type FeedChannel, type FeedKey } from '@/lib/api/feed-channels';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatTimeLeft } from '@/lib/format';
import { shortSchoolName } from '@/lib/universities';
import type { AgoraItem } from '@/types/database';

// SOCIAL'S FEED = THE IMMERSIVE AGORA (mock 317 frame 1; it moved from Home to the Social tab in
// mock 320, which draws its Feed · Chats toggle into the `header` slot). The square, full-screen: one post per page, paged
// vertically with a snap, each page's media adapting to the post (feed-page.tsx). Driven by the
// same feed query and channel chips as the classic /agora list — useAgoraFeed + useFeedChannel —
// so a channel picked here is the channel /agora opens on, and the reverse.
//
// Floating over every page: a translucent top bar (wordmark + the globals) and the channel chip
// row. No status strip — your standing moved to the Lock In tab and your Profile (standing-band).
//
// PERFORMANCE. Pages are exactly one viewport tall (getItemLayout, no measuring), the list keeps a
// three-page window, and only the page in view is "active": it alone mounts a video player and runs
// its author's FlarePerimeter. Active also requires the Home tab to be focused and the app to be in
// the foreground (useMotionActive), so a clip stops the moment you switch tabs. On cellular — or any
// connection the OS flags as expensive — clips don't autoplay; they wait for a tap.

type FeedRow =
  | { kind: 'tracker' }
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'post'; item: AgoraItem };

const rowKey = (r: FeedRow) => (r.kind === 'post' ? `${r.item.item_type}:${r.item.id}` : r.kind);

export function ImmersiveFeed({
  requestedChannel,
  onRequestedChannelSeen,
  header,
  title,
}: {
  requestedChannel?: string;
  onRequestedChannelSeen?: () => void;
  /** The top bar's title; omitted = the wordmark. */
  title?: string;
  /** Drawn in the floating chrome between the top bar and the chips — Social's Feed · Chats toggle. */
  header?: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { scope, changeScope, channels, channel } = useFeedChannel({ requestedChannel, onRequestedChannelSeen });
  const { items, loading, refreshing, error, refresh, loadMore, patchItem, removeItem, prependItem } = useAgoraFeed(scope);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [chromeHeight, setChromeHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Reels rule: once you unmute one clip, the next one plays with sound too.
  const [muted, setMuted] = useState(true);
  const focused = useMotionActive();
  const net = useNetInfo();
  const autoplay = net.type !== 'cellular' && net.details?.isConnectionExpensive !== true;

  // Mock 314 still holds: until a tracker is connected (or the card dismissed), Home is where
  // fitness tracking gets found — now as the feed's first page rather than a card above it.
  const tracking = useFitnessTracking();
  const showTracker = !tracking.loading && !tracking.trackingOn && !tracking.homeDismissed;

  const rows = useMemo<FeedRow[]>(() => {
    const lead: FeedRow[] = showTracker ? [{ kind: 'tracker' }] : [];
    if (items.length === 0) return [...lead, { kind: loading ? 'loading' : 'empty' }];
    // A room's channel feed doesn't carry the audience (0280 only added it to get_agora_feed) —
    // the channel IS the audience, so the tag is stamped from it rather than misread as public.
    const stamp = (item: AgoraItem): AgoraItem =>
      channel && !item.audience
        ? { ...item, audience: channel.kind, audience_ref_id: channel.id, audience_name: channel.name, audience_emoji: channel.emoji }
        : item;
    return [...lead, ...items.map((item) => ({ kind: 'post' as const, item: stamp(item) }))];
  }, [items, loading, showTracker, channel]);
  const firstPostIndex = showTracker ? 1 : 0;

  // One batched read for every author on the loaded pages (see agora/index.tsx).
  const authorIds = useMemo(() => items.map((i) => i.user_id), [items]);
  const loadouts = usePublicLoadouts(authorIds);
  useRefreshPublicLoadoutsOnFocus(authorIds);

  const listRef = useRef<FlatList<FeedRow>>(null);

  useEffect(() => {
    track('agora_viewed', {});
  }, []);

  // A new channel is a new feed: back to its first page. The list is keyed by scope, so its scroll
  // position resets with it — this resets which page counts as in view to match.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the list remount on a scope change
    setActiveIndex(0);
  }, [scope]);

  // Your post, the moment the composer closes (mock 306 frame 3): fetched, put on top, paged to.
  useEffect(
    () =>
      onAgoraPost(({ id, itemType, channel: postedTo }) => {
        // Only on top of a list it belongs in. A room post belongs in its room's channel and in All
        // (0280: All carries your rooms); a square post in any scope — except Everyone, which only
        // carries posts made for everyone.
        const room = parseFeedKey(scope) ? scope : null;
        if (postedTo ? !(postedTo === room || scope === 'all') : room !== null) return;
        fetchAgoraItem(id, itemType)
          .then((item) => {
            if (!item) return;
            if (scope === 'everyone' && item.audience && item.audience !== 'everyone') return;
            prependItem(item);
            requestAnimationFrame(() =>
              listRef.current?.scrollToOffset({ offset: firstPostIndex * size.height, animated: true })
            );
          })
          .catch(() => {
            // It posted; the next refresh shows it.
          });
      }),
    [prependItem, scope, firstPostIndex, size.height]
  );

  // Which page is in view. Held in lazy state, so it is created once: FlatList rejects a changing
  // onViewableItemsChanged (and reading a ref's .current during render breaks the compiler's rules).
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<FeedRow>[] }) => {
    const top = viewableItems.find((v) => v.isViewable);
    if (top?.index == null) return;
    setActiveIndex(top.index);
    const row = top.item;
    if (row.kind === 'post') track('feed_page_viewed', { media: feedPageMedia(row.item), item_type: row.item.item_type });
  });
  const [viewability] = useState({ itemVisiblePercentThreshold: 60 });

  // ── the rail and the "…" ──
  const [commentsFor, setCommentsFor] = useState<AgoraItem | null>(null);
  const [moreFor, setMoreFor] = useState<AgoraItem | null>(null);
  const [removeFor, setRemoveFor] = useState<AgoraItem | null>(null);
  const [removing, setRemoving] = useState(false);

  const onMore = useCallback(
    (item: AgoraItem) => {
      // Your own post gets Delete; someone else's the report/block sheet (agora/index.tsx).
      if (item.user_id === profile?.id) setRemoveFor(item);
      else setMoreFor(item);
    },
    [profile?.id]
  );

  const onCheer = useCallback(
    (item: AgoraItem) => {
      if (item.cheered || item.user_id === profile?.id) return;
      // Optimistic: the ring lights on the tap. cheer_agora_post is idempotent, so a retry is safe.
      patchItem(item.id, { cheered: true });
      cheerAgoraItem(item)
        .then((cheers) => patchItem(item.id, { cheers }))
        .catch((e) => {
          patchItem(item.id, { cheered: false });
          Alert.alert('Could not cheer', getErrorMessage(e, 'Something went wrong.'));
        });
    },
    [patchItem, profile?.id]
  );

  const onShare = useCallback((item: AgoraItem) => {
    track('agora_shared', { item_type: item.item_type });
    const said = item.body?.trim();
    Share.share({
      message: said
        ? `${item.display_name} on Philoi: “${said.length > 180 ? `${said.slice(0, 177)}…` : said}”`
        : `${item.display_name} posted on Philoi — come lock in with us.`,
    }).catch(() => {
      // Dismissed or unavailable — nothing to tell anyone.
    });
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  async function confirmRemove() {
    if (!removeFor || removing) return;
    const item = removeFor;
    setRemoving(true);
    try {
      if (item.item_type === 'post') await deleteAgoraPost(item.id);
      else await setMilestoneInAgora(item.id, false);
      removeItem(item.id);
      setRemoveFor(null);
    } catch (e) {
      setRemoveFor(null);
      Alert.alert('Could not remove', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setRemoving(false);
    }
  }

  async function handleBlock() {
    if (!moreFor || !profile) return;
    const target = moreFor;
    try {
      await blockAgoraUser(profile.id, target.user_id);
      removeItem(target.id);
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function handleReport() {
    if (!moreFor || !profile) return;
    const target = moreFor;
    try {
      await reportAgora({
        reporterId: profile.id,
        reportedUserId: target.user_id,
        reason: 'Reported from the Agora',
        postId: target.item_type === 'post' ? target.id : null,
      });
      removeItem(target.id);
      Alert.alert('Reported', 'Thanks — we’ll take a look. You won’t see this post again.');
    } catch (e) {
      Alert.alert('Could not report', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  function compose() {
    track('agora_composer_opened', {});
    // In a channel, the composer opens on that channel's lane.
    router.push(
      channel?.kind === 'campfire'
        ? { pathname: '/agora/compose', params: { campfireId: channel.id, campfireName: channel.name } }
        : channel?.kind === 'forest'
          ? { pathname: '/agora/compose', params: { forestId: channel.id, forestName: channel.name } }
          : '/agora/compose'
    );
  }

  const { width, height } = size;
  const pageTop = chromeHeight;

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }}>
      {height > 0 ? (
        <FlatList<FeedRow>
          // Keyed by channel: a new channel starts at its own first page, not at your old offset.
          key={scope}
          ref={listRef}
          data={rows}
          keyExtractor={rowKey}
          renderItem={({ item: row, index }) => {
            if (row.kind === 'post') {
              return (
                <FeedPage
                  item={row.item}
                  loadout={loadouts[row.item.user_id] ?? {}}
                  width={width}
                  height={height}
                  topInset={pageTop}
                  active={focused && index === activeIndex}
                  near={Math.abs(index - activeIndex) === 1}
                  autoplay={autoplay}
                  muted={muted}
                  mine={row.item.user_id === profile?.id}
                  onToggleMute={toggleMute}
                  onComment={setCommentsFor}
                  onCheer={onCheer}
                  onShare={onShare}
                  onMore={onMore}
                />
              );
            }
            return (
              <View style={[styles.utilityPage, { width, height, paddingTop: pageTop }]}>
                {row.kind === 'tracker' ? (
                  <View style={styles.trackerWrap}>
                    <HomeTrackerCard />
                    <Text style={styles.swipeHint}>Swipe up for the feed</Text>
                  </View>
                ) : row.kind === 'loading' ? (
                  <ActivityIndicator color={Colors.navEmber} />
                ) : (
                  <EmptyChannel
                    scope={scope}
                    channelName={channel?.name ?? null}
                    error={error}
                    hasUniversity={Boolean(profile?.university)}
                    onCompose={compose}
                  />
                )}
              </View>
            );
          }}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews={Platform.OS === 'android'}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewability}
          onEndReached={loadMore}
          onEndReachedThreshold={2}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} progressViewOffset={pageTop} />
          }
        />
      ) : null}

      {/* ── The floating chrome ── */}
      <View
        style={styles.chrome}
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setChromeHeight((prev) => (prev === h ? prev : h));
        }}>
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(11,7,24,0.92)', 'rgba(11,7,24,0.55)', 'transparent']}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ paddingTop: insets.top }}>
          <AppTopBar title={title} />
        </View>
        {header}
        <ChannelChips
          scope={scope}
          channels={channels}
          university={profile?.university ?? null}
          onPick={changeScope}
          onCompose={compose}
        />
        {channel ? <ChannelLine channel={channel} /> : null}
      </View>

      <AgoraCommentsSheet
        item={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCountChange={(id, count) => patchItem(id, { comments: count })}
      />
      <ReportBlockSheet visible={moreFor !== null} onClose={() => setMoreFor(null)} onReport={handleReport} onBlock={handleBlock} />
      <ConfirmDialog
        visible={removeFor !== null}
        title={removeFor?.item_type === 'post' ? 'Delete this post?' : 'Take this out of the Agora?'}
        body={
          removeFor?.item_type === 'post'
            ? 'It disappears from the Agora for everyone.'
            : 'It stays on your Journal — it just stops showing in the square.'
        }
        confirmLabel={removeFor?.item_type === 'post' ? 'Delete' : 'Remove'}
        busy={removing}
        onCancel={() => setRemoveFor(null)}
        onConfirm={() => void confirmRemove()}
      />
    </View>
  );
}

/**
 * The chip row (mock 315/317): ＋ Post, the four scopes, your campfires and forests, then the ways to
 * find more. Translucent pills, so the page behind still reads through them.
 */
function ChannelChips({
  scope,
  channels,
  university,
  onPick,
  onCompose,
}: {
  scope: FeedKey;
  channels: FeedChannel[] | null;
  university: string | null;
  onPick: (key: FeedKey) => void;
  onCompose: () => void;
}) {
  const router = useRouter();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipBar}
      contentContainerStyle={styles.chips}>
      <Pressable onPress={onCompose} accessibilityRole="button" accessibilityLabel="Write a post">
        <LinearGradient colors={[Colors.navEmber, Colors.navEmber2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.postChip}>
          <Text style={styles.postChipText}>＋ Post</Text>
        </LinearGradient>
      </Pressable>
      {AGORA_SCOPES.map((s) => (
        <Chip
          key={s.key}
          label={s.key === 'university' && university ? shortSchoolName(university) : s.label}
          on={scope === s.key}
          onPress={() => onPick(s.key)}
        />
      ))}
      {(channels ?? []).map((c) => {
        const key = channelKey(c);
        return (
          <Chip
            key={key}
            label={`${c.emoji} ${c.name}`}
            on={scope === key}
            onPress={() => onPick(key)}
            a11y={`${c.name}, ${c.kind}`}
          />
        );
      })}
      <Chip label="+ join" dashed onPress={() => router.push('/campfires')} a11y="Join a campfire" />
      <Chip label="🌲 Forests" dashed onPress={() => router.push('/forests')} a11y="Browse forests" />
    </ScrollView>
  );
}

function Chip({
  label,
  on = false,
  dashed = false,
  onPress,
  a11y,
}: {
  label: string;
  on?: boolean;
  dashed?: boolean;
  onPress: () => void;
  a11y?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn, dashed && styles.chipDashed]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={a11y}>
      <Text style={[styles.chipText, on && styles.chipTextOn, dashed && styles.chipDashedText]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A channel's one-line header — members · its live challenge — opening the campfire or forest. */
function ChannelLine({ channel }: { channel: FeedChannel }) {
  const router = useRouter();
  const meta = [
    `${channel.member_count} ${channel.member_count === 1 ? 'member' : 'members'}`,
    channel.challenge_id
      ? `⚔ ${channel.challenge_name ?? 'Live challenge'}${channel.challenge_ends_at ? ` · ${formatTimeLeft(channel.challenge_ends_at)}` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      style={styles.channelLine}
      onPress={() =>
        channel.kind === 'campfire'
          ? router.push(`/group/${channel.id}`)
          : router.push({ pathname: '/forest/[id]', params: { id: channel.id } } as never)
      }
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}, ${meta}. Open the ${channel.kind}`}>
      <Text style={styles.channelMeta} numberOfLines={1}>
        {meta} ›
      </Text>
    </Pressable>
  );
}

/** Why a channel is empty and what widens it — the copy AgoraFeed's EmptyScope uses. */
function EmptyChannel({
  scope,
  channelName,
  error,
  hasUniversity,
  onCompose,
}: {
  scope: FeedKey;
  channelName: string | null;
  error: string | null;
  hasUniversity: boolean;
  onCompose: () => void;
}) {
  const copy = error
    ? error
    : parseFeedKey(scope)
      ? `Nothing posted to ${channelName ?? 'this channel'} yet. Post the first one.`
      : scope === 'all'
        ? 'Nothing from your friends or your rooms yet. Add friends, join a campfire, or post the first one.'
        : scope === 'friends'
        ? 'Quiet in here. Add some friends, or check Everyone.'
        : scope === 'campfires'
          ? 'Nobody in your campfires has posted yet. Be the first.'
          : scope === 'university'
            ? hasUniversity
              ? 'Nothing from your campus yet. Post something and start it off.'
              : 'Set your university in your profile to see your campus here.'
            : 'The square is quiet. Post something.';
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{copy}</Text>
      {!error ? (
        <Pressable onPress={onCompose} accessibilityRole="button">
          <LinearGradient colors={[Colors.navEmber, Colors.navEmber2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.emptyCta}>
            <Text style={styles.emptyCtaText}>Write a post</Text>
          </LinearGradient>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.spaceBg,
  },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: Spacing.two,
  },
  chipBar: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chips: {
    gap: 6,
    alignItems: 'center',
    paddingLeft: Spacing.three,
    paddingRight: Spacing.three + 8,
    paddingVertical: Spacing.one,
  },
  // Mock 317's `.ch` — a translucent pill, the page reading through it.
  chip: {
    flexShrink: 0,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(26,18,48,0.8)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: {
    backgroundColor: Colors.navEmber,
    borderColor: Colors.navEmber,
  },
  chipDashed: {
    backgroundColor: 'rgba(26,18,48,0.55)',
    borderStyle: 'dashed',
  },
  chipText: {
    flexShrink: 0,
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
  },
  chipTextOn: {
    color: Colors.onEmber,
  },
  chipDashedText: {
    color: Colors.navEmber2,
  },
  postChip: {
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  postChipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.onEmber,
  },
  channelLine: {
    alignSelf: 'flex-start',
    marginLeft: Spacing.three,
    marginTop: 2,
  },
  channelMeta: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
  utilityPage: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.spaceBg,
  },
  trackerWrap: {
    alignSelf: 'stretch',
    gap: Spacing.three,
  },
  swipeHint: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  emptyCta: {
    borderRadius: Radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  emptyCtaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.onEmber,
  },
});
