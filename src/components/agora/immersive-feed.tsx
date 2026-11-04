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
import { ReelChallengeSheet } from '@/components/agora/reel-challenge-sheet';
import { HomeTrackerCard } from '@/components/fitness/tracker-prompts';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
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
  addAgoraComment,
  blockAgoraUser,
  cheerAgoraItem,
  deleteAgoraPost,
  fetchAgoraItem,
  reportAgora,
  setMilestoneInAgora,
} from '@/lib/api/agora';
import { channelKey, parseFeedKey, type FeedChannel, type FeedKey } from '@/lib/api/feed-channels';
import type { VerifiedLift } from '@/lib/api/reel-challenge';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraItem } from '@/types/database';

// SOCIAL'S FEED = THE IMMERSIVE AGORA (mock 317 frame 1; it moved from Home to the Social tab in
// mock 320; mock 326 cleared its chrome). The square, full-screen: one post per page, paged
// vertically with a snap, each page's media adapting to the post (feed-page.tsx). Driven by the
// same feed query and remembered channel as the classic /agora list — useAgoraFeed + useFeedChannel —
// so a channel picked here is the channel /agora opens on, and the reverse.
//
// Floating over every page (mock 326): ONE slim translucent bar — the small wordmark, the Friends ·
// Everyone tabs (mock 331: the tab itself is Discover), and post · chats · search — plus each page's
// own rail. No global icon cluster, no room header (it lives in the chat thread), no status strip.
//
// ROOMS STAY REACHABLE (forest-post fix, 2026-10-27). Friends and Everyone carry no room posts by
// design (0280), so with only the two tabs a post made to a campfire or forest had nowhere to be
// seen. Under the bar, for anyone in a room: one slim row — All (friends + your rooms) · each
// campfire · each forest. A channel selector, not a header: one line of small translucent chips.
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
  onOpenChats,
  onBack,
}: {
  requestedChannel?: string;
  onRequestedChannelSeen?: () => void;
  /** The top bar's 💬 — Social's Chats pane. */
  onOpenChats: () => void;
  /** Phase 8.3 · Discover lands on Find your people; this takes the feed back there. */
  onBack?: () => void;
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
        if (postedTo && postedTo !== room && scope !== 'all') {
          // A room post made from Friends or Everyone belongs in neither, so it used to land nowhere
          // you could see — read as a post that never went out. Go to its room instead: the channel
          // refetches, and the post is on top of it.
          changeScope(postedTo as FeedKey);
          return;
        }
        if (!postedTo && room !== null) return;
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
    [prependItem, scope, changeScope, firstPostIndex, size.height]
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
      patchItem(item.id, { cheered: true, cheers: item.cheers + 1 });
      cheerAgoraItem(item)
        .then((cheers) => patchItem(item.id, { cheers }))
        .catch((e) => {
          patchItem(item.id, { cheered: false, cheers: item.cheers });
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

  // ── ⚔ and "leave a nice one" (mock 319) ──
  const [challengeFor, setChallengeFor] = useState<{ item: AgoraItem; lift: VerifiedLift } | null>(null);
  // Bumped after a send so the pages re-read their lift and ⚔ reads "sent".
  const [liftVersion, setLiftVersion] = useState(0);
  const onChallenge = useCallback((item: AgoraItem, lift: VerifiedLift) => {
    track('reel_challenge_opened', { already_sent: lift.my_challenge_id != null });
    setChallengeFor({ item, lift });
  }, []);
  const onLiftChallengeSent = useCallback(() => setLiftVersion((v) => v + 1), []);

  const onNiceComment = useCallback(
    async (item: AgoraItem, text: string) => {
      try {
        await addAgoraComment(item, text);
        patchItem(item.id, { comments: item.comments + 1 });
        return true;
      } catch (e) {
        Alert.alert('Could not comment', getErrorMessage(e, 'Something went wrong.'));
        return false;
      }
    },
    [patchItem]
  );

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
                  onChallenge={onChallenge}
                  onNiceComment={onNiceComment}
                  liftVersion={liftVersion}
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

      {/* ── The floating chrome (mock 326): ONE slim translucent bar, nothing else over the page ── */}
      <View
        style={[styles.chrome, { paddingTop: insets.top }]}
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setChromeHeight((prev) => (prev === h ? prev : h));
        }}>
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(7,4,16,0.6)', 'transparent']}
          style={StyleSheet.absoluteFill}
        />
        <FeedTopBar
          scope={scope}
          onPick={changeScope}
          onCompose={compose}
          onChats={onOpenChats}
          onSearch={() => router.push('/search')}
          onBack={onBack}
        />
        {/* Your rooms, one slim row (only if you're in one). No room header (mock 326 — that
            belongs in the chat thread): the lit chip says which room this is; a tab leaves it. */}
        {channels?.length ? <ChannelRow scope={scope} channels={channels} onPick={changeScope} /> : null}
      </View>

      <AgoraCommentsSheet
        item={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCountChange={(id, count) => patchItem(id, { comments: count })}
      />
      <ReelChallengeSheet target={challengeFor} onClose={() => setChallengeFor(null)} onSent={onLiftChallengeSent} />
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
 * Mock 326's `.top`: the small wordmark · Friends | Everyone · and the few ways off the feed (post,
 * chats, search) as quiet translucent circles. In a room channel neither tab is lit — either one
 * leaves the room.
 */
function FeedTopBar({
  scope,
  onPick,
  onCompose,
  onChats,
  onSearch,
  onBack,
}: {
  scope: FeedKey;
  onPick: (key: FeedKey) => void;
  onCompose: () => void;
  onChats: () => void;
  onSearch: () => void;
  onBack?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={styles.mark} accessibilityRole="button" accessibilityLabel="Back to Find your people">
          <Icon name="back" size={14} color={Colors.ink} />
          <Text style={styles.markText}>People</Text>
        </Pressable>
      ) : (
        <View style={styles.mark}>
          <NavGlyph name="flame" size={14} color={Colors.navEmber} />
          <Text style={styles.markText}>philoi</Text>
        </View>
      )}
      <View style={styles.tabs} accessibilityRole="tablist">
        {AGORA_SCOPES.map((s) => {
          const on = scope === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => onPick(s.key)}
              hitSlop={4}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              {on ? (
                <LinearGradient
                  colors={[Colors.navEmber, Colors.navEmber2, Colors.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.tab}>
                  <Text style={[styles.tabText, styles.tabTextOn]}>{s.label}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.tab}>
                  <Text style={styles.tabText}>{s.label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.topActions}>
        <TopButton label="Write a post" onPress={onCompose}>
          <Icon name="plus" size={14} color={Colors.ink} />
        </TopButton>
        <TopButton label="Chats" onPress={onChats}>
          <Icon name="chat" size={14} color={Colors.ink} />
        </TopButton>
        <TopButton label="Search" onPress={onSearch}>
          <NavGlyph name="search" size={14} color={Colors.ink} />
        </TopButton>
      </View>
    </View>
  );
}

function TopButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.topBtn} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </Pressable>
  );
}

/**
 * Under the bar: All (your friends + every room you're in, 0280) · your campfires · your forests.
 * Campfires first, then forests — the order the composer's lane picker lists them in.
 */
function ChannelRow({
  scope,
  channels,
  onPick,
}: {
  scope: FeedKey;
  channels: FeedChannel[];
  onPick: (key: FeedKey) => void;
}) {
  const rooms = [...channels.filter((c) => c.kind === 'campfire'), ...channels.filter((c) => c.kind === 'forest')];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.channelBar}
      contentContainerStyle={styles.channelRow}
      accessibilityRole="tablist">
      <ChannelChip label="All" on={scope === 'all'} onPress={() => onPick('all')} a11y="All: your friends and your rooms" />
      {rooms.map((c) => {
        const key = channelKey(c);
        return (
          <ChannelChip
            key={key}
            label={c.name}
            emoji={c.emoji}
            icon={c.kind}
            on={scope === key}
            onPress={() => onPick(key)}
            a11y={`${c.kind === 'forest' ? 'Forest' : 'Campfire'}: ${c.name}`}
          />
        );
      })}
    </ScrollView>
  );
}

function ChannelChip({
  label,
  emoji,
  icon,
  on,
  onPress,
  a11y,
}: {
  label: string;
  emoji?: string | null;
  icon?: 'campfire' | 'forest';
  on: boolean;
  onPress: () => void;
  a11y: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={[styles.channelChip, on && styles.channelChipOn]}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={a11y}>
      {/* A room's emoji is its creator's pick — content, so it stays an emoji. */}
      {emoji ? (
        <Text style={styles.channelChipText}>{emoji}</Text>
      ) : icon ? (
        <Icon name={icon} size={12} color={on ? Colors.navEmber : Colors.navEmber2} />
      ) : null}
      <Text style={[styles.channelChipText, on && styles.channelChipTextOn]} numberOfLines={1}>
        {label}
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
  // Mock 326's `.top`: wordmark · tabs · buttons on one row, the page reading through.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  markText: {
    fontFamily: Fonts.black,
    fontSize: 16,
    letterSpacing: -0.5,
    color: Colors.ink,
  },
  tabs: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(10,7,22,0.5)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  tab: {
    borderRadius: Radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  tabTextOn: {
    color: Colors.onEmber,
  },
  topActions: {
    flexDirection: 'row',
    gap: 5,
  },
  topBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,7,22,0.5)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  channelBar: {
    flexGrow: 0,
    marginTop: 6,
  },
  channelRow: {
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: Spacing.three,
  },
  channelChip: {
    maxWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(10,7,22,0.5)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  channelChipOn: {
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(10,7,22,0.75)',
  },
  channelChipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
  },
  channelChipTextOn: {
    color: Colors.ink,
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
