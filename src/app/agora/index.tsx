import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAgoraFeed } from '@/hooks/use-agora-feed';
import { usePublicLoadouts } from '@/hooks/use-public-loadouts';
import { track } from '@/lib/analytics';
import {
  AGORA_SCOPES,
  blockAgoraUser,
  cheerAgoraItem,
  deleteAgoraPost,
  reportAgora,
  setMilestoneInAgora,
} from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { shortSchoolName } from '@/lib/universities';
import type { AgoraItem, AgoraScope } from '@/types/database';

// THE AGORA (AGORA_SPEC.md, mocks 160 + 162) — the town square.
//
// "An accomplishment isn't just a private notification to a few friends — it gets reach and
// validation in front of a real audience, which is the strongest motivator there is."
//
// KEPT HEALTHY BY CONSTRUCTION, per the spec. There is no downvote and no ratio: the only quick
// reaction on a card is a cheer. There are no scores or "you're behind X" lines here either —
// standing is a chip on the AUTHOR, never a comparison drawn against the reader. Leaderboards are
// their own screen precisely so this one can stay a room of people rooting for each other.

export default function AgoraScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [scope, setScope] = useState<AgoraScope>('friends');
  const { items, loading, refreshing, loadingMore, error, refresh, loadMore, patchItem, removeItem } =
    useAgoraFeed(scope);

  const [commentsFor, setCommentsFor] = useState<AgoraItem | null>(null);
  const [moreFor, setMoreFor] = useState<AgoraItem | null>(null);

  // One batched read for the whole page's authors — the halo and card every row wears. Per-row
  // fetching would be twenty round trips a page, which is the exact thing usePublicLoadouts exists
  // to avoid.
  const loadouts = usePublicLoadouts(useMemo(() => items.map((i) => i.user_id), [items]));

  useEffect(() => {
    track('agora_viewed', {});
  }, []);

  function changeScope(next: AgoraScope) {
    if (next === scope) return;
    setScope(next);
    track('agora_scope_changed', { scope: next });
  }

  const handleCheer = useCallback(
    async (item: AgoraItem) => {
      if (item.cheered) return;
      // Optimistic: a cheer is cosmetic and reverting one is honest. Waiting on the round trip
      // makes the single most-tapped control in the app feel broken on a slow connection.
      patchItem(item.id, { cheered: true, cheers: item.cheers + 1 });
      try {
        const count = await cheerAgoraItem(item);
        patchItem(item.id, { cheers: count });
      } catch (e) {
        patchItem(item.id, { cheered: false, cheers: item.cheers });
        Alert.alert('Could not cheer', getErrorMessage(e, 'Something went wrong.'));
      }
    },
    [patchItem]
  );

  const handleMore = useCallback(
    (item: AgoraItem) => {
      // Your own post gets Delete; someone else's gets the report/block sheet. Offering "report"
      // on your own card is noise, and offering "delete" on someone else's is a lie.
      if (item.user_id === profile?.id) {
        const isPost = item.item_type === 'post';
        Alert.alert(
          isPost ? 'Delete this post?' : 'Take this out of the Agora?',
          isPost
            ? 'It disappears from the Agora for everyone.'
            : 'It stays on your Journal — it just stops showing in the square.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: isPost ? 'Delete' : 'Remove',
              style: 'destructive',
              onPress: async () => {
                try {
                  if (isPost) await deleteAgoraPost(item.id);
                  // A milestone is not the Agora's to delete — it lives on the author's Journal and
                  // in their friends' bells. Taking it out of the square is the narrower action,
                  // and the one this control means.
                  else await setMilestoneInAgora(item.id, false);
                  removeItem(item.id);
                } catch (e) {
                  Alert.alert('Could not remove', getErrorMessage(e, 'Something went wrong.'));
                }
              },
            },
          ]
        );
        return;
      }
      setMoreFor(item);
    },
    [profile?.id, removeItem]
  );

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

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.muted} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>The Agora</Text>
            <Text style={styles.subtitle}>where students gather, as did the Greeks</Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          {AGORA_SCOPES.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => changeScope(s.key)}
              style={[styles.filter, scope === s.key && styles.filterOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === s.key }}>
              <Text style={[styles.filterText, scope === s.key && styles.filterTextOn]}>
                {scopeLabel(s.key, s.label)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <FlatList
          data={items}
          keyExtractor={(i) => `${i.item_type}:${i.id}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ItemSeparatorComponent={() => <View style={styles.postSep} />}
          ListHeaderComponent={
            <Pressable
              style={styles.composer}
              onPress={() => {
                track('agora_composer_opened', {});
                router.push('/agora/compose');
              }}
              accessibilityRole="button"
              accessibilityLabel="Write a post">
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.composerAvatar} contentFit="cover" />
              ) : (
                <View style={[styles.composerAvatar, styles.composerAvatarFallback]} />
              )}
              <Text style={styles.composerHint}>Share a win, a photo, a thought…</Text>
              <Ionicons name="create-outline" size={16} color={Colors.amber} />
            </Pressable>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={Colors.coral} style={styles.loader} />
            ) : (
              <EmptyScope scope={scope} error={error} hasUniversity={Boolean(profile?.university)} />
            )
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={Colors.textTertiary} style={styles.footer} /> : null
          }
          renderItem={({ item }) => (
            <AgoraCard
              item={item}
              loadout={loadouts[item.user_id] ?? {}}
              onCheer={handleCheer}
              onComment={setCommentsFor}
              onMore={handleMore}
            />
          )}
        />

        <Pressable
          style={styles.fab}
          onPress={() => {
            track('agora_composer_opened', {});
            router.push('/agora/compose');
          }}
          accessibilityRole="button"
          accessibilityLabel="New post">
          <Ionicons name="create" size={22} color={Colors.onEmber} />
        </Pressable>
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
  error,
  hasUniversity,
}: {
  scope: AgoraScope;
  error: string | null;
  hasUniversity: boolean;
}) {
  if (error) return <Text style={styles.empty}>{error}</Text>;

  const copy =
    scope === 'friends'
      ? 'Quiet in here. Add some friends, or widen the filter to your campus.'
      : scope === 'campfires'
        ? 'Nobody in your campfires has posted yet. Be the first.'
        : scope === 'university'
          ? hasUniversity
            ? 'Nothing from your campus yet. Post something and start it off.'
            : 'Set your university in your profile to see your campus here.'
          : 'The square is quiet. Post something.';

  return <Text style={styles.empty}>{copy}</Text>;
}

const styles = StyleSheet.create({
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
  filters: {
    gap: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
  },
  filter: {
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    color: Colors.muted,
  },
  filterTextOn: {
    color: Colors.onEmber,
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
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: 14,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
    marginBottom: Spacing.two,
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
  fab: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.four,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
