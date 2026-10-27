import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AgoraCard } from '@/components/agora/agora-card';
import { AgoraCommentsSheet } from '@/components/agora/agora-comments-sheet';
import { ForestsBrowse } from '@/components/forests/forests-browse';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconText } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAgoraFeed } from '@/hooks/use-agora-feed';
import { usePublicLoadouts, useRefreshPublicLoadoutsOnFocus } from '@/hooks/use-public-loadouts';
import { onAgoraPost } from '@/lib/agora-just-posted';
import { track } from '@/lib/analytics';
import {
  AGORA_SCOPES,
  blockAgoraUser,
  deleteAgoraPost,
  fetchAgoraItem,
  reportAgora,
  setMilestoneInAgora,
} from '@/lib/api/agora';
import { channelKey, fetchMyFeedChannels, parseFeedKey, type FeedChannel, type FeedKey } from '@/lib/api/feed-channels';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatTimeLeft } from '@/lib/format';
import { shortSchoolName } from '@/lib/universities';
import type { AgoraItem, AgoraScope } from '@/types/database';

// THE AGORA (AGORA_SPEC.md, mocks 160 + 162) — the town square.
//
// "An accomplishment isn't just a private notification to a few friends — it gets reach and
// validation in front of a real audience, which is the strongest motivator there is."
//
// KEPT HEALTHY BY CONSTRUCTION, per the spec. There is no downvote, no ratio and — since #259 —
// no like or cheer either: a card is answered with a comment or not at all. There are no scores
// or "you're behind X" lines here either —
// standing is a chip on the AUTHOR, never a comparison drawn against the reader. Leaderboards are
// their own screen precisely so this one can stay a room of people rooting for each other.
//
// FEED · FORESTS (CODE_PROMPT_agora_forests.md). Forests are a tab of the Agora, not a new
// destination: the feed is the commons, a forest is an interest world inside it that funnels into
// campfires. The feed's scope chips belong to the feed tab alone.
//
// CHANNELS (0277, mock 315). After the four scope chips, the same row carries each of your
// campfires and forests as its own channel, liveliest first, then "+ join". A campfire channel is
// what was POSTED to that campfire — gym comps, clips — under a small header (members · its live
// challenge), readable by its members only (server-gated). The last pick is remembered per account.

type AgoraTab = 'feed' | 'forests';
const TABS: { key: AgoraTab; label: string }[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'forests', label: 'Forests' },
];

/**
 * The feed list's one non-post row: the channel header, Home's tracker card, the compose row and
 * the empty/loading state. A row rather than ListEmptyComponent so the compose row is there on an
 * empty channel too.
 */
type FeedSentinel = { sentinel: 'lead' };
type FeedRow = FeedSentinel | AgoraItem;
const LEAD_ROW: FeedSentinel = { sentinel: 'lead' };

const SCOPE_KEYS = new Set<string>(AGORA_SCOPES.map((s) => s.key));
const lastChannelKey = (userId: string) => `philoi_feed_channel_${userId}`;

/** A key that names a scope, or a well-formed campfire/forest channel — anything else is dropped. */
function asFeedKey(raw: string | null | undefined): FeedKey | null {
  if (!raw) return null;
  if (SCOPE_KEYS.has(raw)) return raw as FeedKey;
  return parseFeedKey(raw as FeedKey) ? (raw as FeedKey) : null;
}

function isFeedSentinel(row: FeedRow | undefined): row is FeedSentinel {
  return Boolean(row && 'sentinel' in row);
}

export default function AgoraScreen() {
  return <AgoraFeed />;
}

/**
 * The square itself. `/agora` mounts it as its own screen (back header); Home mounts it embedded,
 * with the global top bar + your-fire strip in place of that header (nav restructure, mock 302).
 *
 * ONLY `top` IS PINNED — on Home, the global bar (Noah, 2026-10-26: nothing else sticks). Everything
 * else is the list header of whichever tab is showing and scrolls away with it: `scrollTop` (Home's
 * fire strip + Flame Pass card), then the Feed · Forests toggle and the scope/channel chips.
 * `feedHeader` comes after them on the Feed tab only, above the compose row — Home's tracker card
 * (mock 314).
 */
export function AgoraFeed({
  embedded = false,
  top,
  scrollTop,
  feedHeader,
  requestedChannel,
  onRequestedChannelSeen,
}: {
  embedded?: boolean;
  top?: ReactNode;
  scrollTop?: ReactNode;
  feedHeader?: ReactNode;
  /** Open on this channel ("campfire:<id>") — a campfire screen's posts button, via Home's params. */
  requestedChannel?: string;
  /** Called once a requested channel has been applied, so the caller can clear its param. */
  onRequestedChannelSeen?: () => void;
}) {
  const router = useRouter();
  const { profile } = useAuth();
  const [tab, setTab] = useState<AgoraTab>('feed');
  // A scope, or one campfire/forest channel (0277). The name stays `scope`: the hook and the empty
  // state treat both the same way.
  const [scope, setScope] = useState<FeedKey>('all');
  const [channels, setChannels] = useState<FeedChannel[] | null>(null);
  const channel = channels?.find((c) => channelKey(c) === scope) ?? null;
  const {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    refresh,
    loadMore,
    patchItem,
    removeItem,
    prependItem,
  } = useAgoraFeed(scope);

  // Your post, the moment the composer closes (mock 306 frame 3): fetched by id and put on top,
  // highlighted, while the compose row stays where it was.
  const [freshId, setFreshId] = useState<string | null>(null);
  useEffect(
    () =>
      onAgoraPost(({ id, itemType, channel: postedTo }) => {
        // Only on top of the list it belongs in: a campfire post over Friends (or a square post
        // over a campfire channel) would be a post the next refresh takes away.
        const showing = parseFeedKey(scope) ? scope : null;
        if ((postedTo ?? null) !== showing) return;
        setTab('feed');
        fetchAgoraItem(id, itemType)
          .then((item) => {
            if (!item) return;
            prependItem(item);
            setFreshId(item.id);
          })
          .catch(() => {
            // It posted; the next refresh shows it. Not worth an alert over a working post.
          });
      }),
    [prependItem, scope]
  );

  // Your channels — on focus, so a campfire joined (or left) elsewhere is right when you come back.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      fetchMyFeedChannels()
        .then((rows) => {
          if (live) setChannels(rows);
        })
        .catch(() => {
          // The scopes still work; the row just carries no channels this time.
          if (live) setChannels((prev) => prev ?? []);
        });
      return () => {
        live = false;
      };
    }, [])
  );

  // The last channel you were on, per account. Read once; written by changeScope.
  const userId = profile?.id ?? null;
  const restored = useRef(false);
  useEffect(() => {
    if (!userId || restored.current) return;
    restored.current = true;
    AsyncStorage.getItem(lastChannelKey(userId))
      .then((raw) => {
        const key = asFeedKey(raw);
        // A request (a campfire's posts button) outranks the remembered pick.
        if (key && !requestedChannel) setScope(key);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per account; the request has its own effect
  }, [userId]);

  // A remembered or requested channel you're no longer in (left the campfire) falls back to Friends.
  useEffect(() => {
    if (channels && parseFeedKey(scope) && !channel) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciling against the server's list
      setScope('all');
    }
  }, [channels, channel, scope]);

  // A campfire screen's "posts" button: open on that channel, then let the caller clear the param.
  useEffect(() => {
    const key = asFeedKey(requestedChannel);
    if (!key) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- driven by a route param, applied once
    setTab('feed');
    setScope(key);
    onRequestedChannelSeen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callback is a fresh closure each render
  }, [requestedChannel]);

  const [commentsFor, setCommentsFor] = useState<AgoraItem | null>(null);
  const [moreFor, setMoreFor] = useState<AgoraItem | null>(null);
  // The item the branded confirm is asking about, and whether its removal is in flight.
  const [removeFor, setRemoveFor] = useState<AgoraItem | null>(null);
  const [removing, setRemoving] = useState(false);

  // One batched read for the whole page's authors — the halo and card every row wears. Per-row
  // fetching would be twenty round trips a page, which is the exact thing usePublicLoadouts exists
  // to avoid.
  const authorIds = useMemo(() => items.map((i) => i.user_id), [items]);
  const loadouts = usePublicLoadouts(authorIds);
  // And re-read them when you come back to the square, so an author who re-equipped since you last
  // looked isn't frozen in the gear they wore when their post first loaded.
  useRefreshPublicLoadoutsOnFocus(authorIds);

  useEffect(() => {
    track('agora_viewed', {});
  }, []);

  function changeScope(next: FeedKey) {
    if (next === scope) return;
    setScope(next);
    // The channel id is not tracked — only which kind of thing was picked.
    track('agora_scope_changed', { scope: parseFeedKey(next)?.kind ?? next });
    if (userId) AsyncStorage.setItem(lastChannelKey(userId), next).catch(() => {});
  }

  const handleMore = useCallback(
    (item: AgoraItem) => {
      // Your own post gets Delete; someone else's gets the report/block sheet. Offering "report"
      // on your own card is noise, and offering "delete" on someone else's is a lie.
      //
      // THE CONFIRM IS OURS, NOT THE OS'S. This used to be Alert.alert, which on Android draws a
      // bare grey slab with system-blue text — the square is an ember product right up until the
      // moment it asks whether you meant to delete something, and then it looks like a different
      // app. Same ConfirmDialog the campfire's destructive actions already use.
      if (item.user_id === profile?.id) {
        setRemoveFor(item);
        return;
      }
      setMoreFor(item);
    },
    [profile?.id]
  );

  async function confirmRemove() {
    if (!removeFor || removing) return;
    const item = removeFor;
    setRemoving(true);
    try {
      if (item.item_type === 'post') await deleteAgoraPost(item.id);
      // A milestone is not the Agora's to delete — it lives on the author's Journal and in their
      // friends' bells. Taking it out of the square is the narrower action, and the one this
      // control means.
      else await setMilestoneInAgora(item.id, false);
      removeItem(item.id);
      setRemoveFor(null);
    } catch (e) {
      // The dialog closes before the alert so the two are never stacked on each other, and the
      // card stays in the feed — nothing was removed.
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
      // Hidden immediately, not just queued: a reader who reports something should stop seeing it
      // now, not whenever a human gets to the queue.
      removeItem(target.id);
      Alert.alert('Reported', 'Thanks — we’ll take a look. You won’t see this post again.');
    } catch (e) {
      Alert.alert('Could not report', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  /** The University chip reads "Laurier", not "University" — your own school, named. */
  function scopeLabel(key: AgoraScope, label: string) {
    return key === 'university' && profile?.university ? shortSchoolName(profile.university) : label;
  }

  // The switcher — Feed · Forests and the scope/channel chips. Part of the scrolling header, never
  // pinned (see the doc comment).
  const chrome = (
    <View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'feed' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filters}>
          {AGORA_SCOPES.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => changeScope(s.key)}
              style={[styles.filter, scope === s.key && styles.filterOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === s.key }}>
              <Text
                style={[styles.filterText, scope === s.key && styles.filterTextOn]}
                numberOfLines={1}>
                {scopeLabel(s.key, s.label)}
              </Text>
            </Pressable>
          ))}
          {/* 0277 · your campfires and forests, each its own channel, then a way to find more. */}
          {(channels ?? []).map((c) => {
            const key = channelKey(c);
            const on = scope === key;
            return (
              <Pressable
                key={key}
                onPress={() => changeScope(key)}
                style={[styles.filter, on && styles.filterOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${c.name}, ${c.kind}`}>
                <Text style={[styles.filterText, on && styles.filterTextOn]} numberOfLines={1}>
                  {c.emoji} {c.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => router.push('/campfires')}
            style={[styles.filter, styles.filterJoin]}
            accessibilityRole="button"
            accessibilityLabel="Join a campfire">
            <Text style={styles.filterJoinText}>+ join</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </View>
  );
  // Bled back out to full width: the list's gutter is the posts', the chrome has its own.
  const scrollHeader = (
    <View style={styles.chromeBleed}>
      {scrollTop}
      {chrome}
    </View>
  );

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {embedded ? (
          top
        ) : (
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={22} color={Colors.muted} />
            </Pressable>
            <View style={styles.headerText}>
              <Text style={styles.title}>The Agora</Text>
              <Text style={styles.subtitle}>where students gather, as did the Greeks</Text>
            </View>
          </View>
        )}

        {tab === 'forests' ? (
          <ForestsBrowse
            header={
              <>
                {scrollTop}
                {chrome}
              </>
            }
          />
        ) : (
          <>
            <FlatList<FeedRow>
              data={[LEAD_ROW, ...items]}
              keyExtractor={(r) => (isFeedSentinel(r) ? r.sentinel : `${r.item_type}:${r.id}`)}
              contentContainerStyle={styles.list}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />
              }
              onEndReached={loadMore}
              onEndReachedThreshold={0.6}
              ItemSeparatorComponent={({ leadingItem }: { leadingItem: FeedRow }) =>
                isFeedSentinel(leadingItem) ? null : <View style={styles.postSep} />
              }
              ListHeaderComponent={scrollHeader}
              ListFooterComponent={
                loadingMore ? <ActivityIndicator color={Colors.textTertiary} style={styles.footer} /> : null
              }
              renderItem={({ item: row }) => {
                if (isFeedSentinel(row)) {
                  return (
                <>
                  {channel ? <ChannelHeader channel={channel} /> : null}
                  {feedHeader}
                  {/*
                    The compose row (mock 306): one tap anywhere opens the one sheet. The two icons
                    preview what it attaches; they are not separate doors — a door per icon would be
                    the separate-flows design the mock retired.
                  */}
                  <Pressable
                    style={styles.composer}
                    onPress={() => {
                      track('agora_composer_opened', {});
                      // In a channel, the composer opens on that channel's lane.
                      router.push(
                        channel?.kind === 'campfire'
                          ? { pathname: '/agora/compose', params: { campfireId: channel.id, campfireName: channel.name } }
                          : channel?.kind === 'forest'
                            ? { pathname: '/agora/compose', params: { forestId: channel.id, forestName: channel.name } }
                            : '/agora/compose'
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Write a post">
                    {profile?.avatar_url ? (
                      <Image source={{ uri: profile.avatar_url }} style={styles.composerAvatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.composerAvatar, styles.composerAvatarFallback]} />
                    )}
                    <Text style={styles.composerHint} numberOfLines={1}>
                      {channel ? `Post to ${channel.name}…` : 'Share something…'}
                    </Text>
                    <NavGlyph name="photo" size={19} color={Colors.spaceDim} />
                    <NavGlyph name="session" size={19} color={Colors.spaceDim} />
                  </Pressable>
                  {/* The list is never empty now (the two rows above are in it), so the empty
                      state rides here instead of in ListEmptyComponent. */}
                  {items.length === 0 ? (
                    loading ? (
                      <ActivityIndicator color={Colors.coral} style={styles.loader} />
                    ) : (
                      <EmptyScope
                        scope={scope}
                        channelName={channel?.name ?? null}
                        error={error}
                        hasUniversity={Boolean(profile?.university)}
                      />
                    )
                  ) : null}
                </>
                  );
                }
                const item = row;
                const card = (
                  <AgoraCard
                    item={item}
                    loadout={loadouts[item.user_id] ?? {}}
                    onComment={setCommentsFor}
                    onMore={handleMore}
                  />
                );
                return item.id === freshId ? <View style={styles.fresh}>{card}</View> : card;
              }}
            />

          </>
        )}
      </SafeAreaView>

      <AgoraCommentsSheet
        item={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCountChange={(id, count) => patchItem(id, { comments: count })}
      />

      <ReportBlockSheet
        visible={moreFor !== null}
        onClose={() => setMoreFor(null)}
        onReport={handleReport}
        onBlock={handleBlock}
      />

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
    </ScreenBackground>
  );
}

/**
 * An empty square says WHY it is empty and what widens it. "Nothing here" on the Friends filter of
 * a new account is the single most likely first impression of this screen, and left bare it reads
 * as a broken feature rather than as a filter set too narrow.
 */
function EmptyScope({
  scope,
  channelName,
  error,
  hasUniversity,
}: {
  scope: FeedKey;
  channelName: string | null;
  error: string | null;
  hasUniversity: boolean;
}) {
  if (error) return <Text style={styles.empty}>{error}</Text>;
  if (parseFeedKey(scope)) {
    return <Text style={styles.empty}>Nothing posted to {channelName ?? 'this channel'} yet. Post the first one.</Text>;
  }

  const copy =
    scope === 'all'
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

  return <Text style={styles.empty}>{copy}</Text>;
}

/**
 * A channel's header (mock 315): name · members · its live challenge. Tapping it opens the campfire
 * (or forest) itself — the channel is the curated feed, the campfire is the room.
 */
function ChannelHeader({ channel }: { channel: FeedChannel }) {
  const router = useRouter();
  const members = `${channel.member_count} ${channel.member_count === 1 ? 'member' : 'members'}`;
  const challenge = channel.challenge_id
    ? `${channel.challenge_name ?? 'Live challenge'}${channel.challenge_ends_at ? ` · ${formatTimeLeft(channel.challenge_ends_at)}` : ''}`
    : null;
  const meta = [members, challenge].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={styles.channelHeader}
      onPress={() =>
        channel.kind === 'campfire'
          ? router.push(`/group/${channel.id}`)
          : router.push({ pathname: '/forest/[id]', params: { id: channel.id } } as never)
      }
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}, ${meta}. Open the ${channel.kind}`}>
      <Text style={styles.channelName} numberOfLines={1}>
        {channel.emoji} {channel.name}
      </Text>
      <View style={styles.channelMetaRow}>
        <Text style={styles.channelMeta} numberOfLines={1}>
          {challenge ? `${members} · ` : members}
        </Text>
        {challenge ? (
          <IconText icon="challenge" style={[styles.channelMeta, styles.channelMetaShrink]} numberOfLines={1} containerStyle={styles.channelMetaShrink}>
            {challenge}
          </IconText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Mock 315's `.chhdr` — an ember wash on a warm hairline, above the composer.
  channelHeader: {
    marginBottom: Spacing.twelve,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4a3718',
    backgroundColor: 'rgba(255,122,47,0.10)',
  },
  channelName: {
    fontFamily: Fonts.black,
    fontSize: 14,
    color: Colors.ink,
  },
  channelMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  channelMetaShrink: {
    flexShrink: 1,
  },
  channelMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  // "+ join": a quiet outline, never mistaken for a selected chip.
  filterJoin: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
  },
  filterJoinText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    fontStyle: 'italic',
    color: Colors.textTertiary,
    marginTop: 2,
  },
  // A two-way segmented control — the mock's "Feed · Forests" — above the feed's own scope chips.
  tabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginTop: Spacing.twelve,
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  tabOn: {
    backgroundColor: Colors.selectedBg,
  },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  tabTextOn: {
    color: Colors.ember,
  },
  // The row SIZES TO ITS PILLS AND SCROLLS — it does not shrink to fit the screen. A horizontal
  // ScrollView carries flexGrow/flexShrink 1 of its own, so left alone it both eats leftover
  // vertical space in this column and lets the content container be measured at exactly the
  // viewport width, which squeezed "Wilfrid Laurier" down to "Wilfrid Lauri". flexGrow:0 here,
  // flexShrink:0 on every pill and label, and the labels come back whole.
  filterBar: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filters: {
    gap: 6,
    alignItems: 'center',
    flexGrow: 0,
    paddingLeft: Spacing.three,
    // A little more on the trailing edge so the last pill clears the screen when scrolled to the end.
    paddingRight: Spacing.three + 8,
    paddingVertical: Spacing.twelve,
  },
  filter: {
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexShrink: 0,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  filterOn: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  filterText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    flexShrink: 0,
    color: Colors.muted,
  },
  filterTextOn: {
    color: Colors.onEmber,
  },
  chromeBleed: {
    marginHorizontal: -Spacing.three,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: 96,
  },
  // Breathing room between consecutive posts — the feed rendered them flush before, so two cards
  // read as one. Between-items only (FlatList separator); the composer header keeps its own spacing.
  postSep: {
    height: Spacing.three,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
    marginBottom: Spacing.twelve,
  },
  composerAvatar: {
    width: 29,
    height: 29,
    borderRadius: 15,
  },
  composerAvatarFallback: {
    backgroundColor: Colors.disabled,
  },
  composerHint: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
  },
  loader: {
    marginTop: Spacing.five,
  },
  footer: {
    marginVertical: Spacing.four,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.six,
  },
  // Your just-posted card (mock 306 frame 3): an ember edge and a faint ember wash.
  fresh: {
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#4A3718',
    backgroundColor: 'rgba(255,122,47,0.06)',
  },
});
