import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GymAvatar, GymPostCard, shortTime, type GymPostItem } from '@/components/gym-spark/gym-post-card';
import { PrStoryButton } from '@/components/gym-spark/share/pr-story-button';
import { useGymPostModeration } from '@/components/gym-spark/use-gym-post-moderation';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  addAgoraComment,
  blockAgoraUser,
  deleteAgoraComment,
  fetchAgoraComments,
  fetchAgoraItem,
  reportAgora,
} from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraComment, AgoraItem } from '@/types/database';

// THE GYM SPARK · post detail (mock 403). "‹ Post", the post (no like control), the thread, and a
// composer pinned to the bottom — "Add some chirp…". Comment-only; the comments ARE the loop.
//
// Moderation stays (app-store requirement): ⋯ on the post (Delete / Report / Block via
// useGymPostModeration), long-press on a comment (Report / Block, or Remove on yours / on your post) —
// the same rules and copy as AgoraCommentsSheet.
//
// The PR pill: get_agora_item doesn't return is_pr, so the feed card passes `pr=1`; if the row ever
// carries is_pr itself, the card reads that too.

const MAX = 500;

export function GymPostScreen({ id, type, pr }: { id: string; type: AgoraItem['item_type']; pr: boolean }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [item, setItem] = useState<GymPostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<AgoraComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    fetchAgoraItem(id, type)
      .then((p) => {
        if (live) setItem(p);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    fetchAgoraComments({ id, item_type: type })
      .then((rows) => {
        if (live) setComments(rows);
      })
      .catch(() => {
        if (live) setComments([]);
      });
    return () => {
      live = false;
    };
  }, [id, type]);

  const moderation = useGymPostModeration(() => router.back());
  const openMore = moderation.open;

  function setCount(count: number) {
    setItem((prev) => (prev ? { ...prev, comments: count } : prev));
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addAgoraComment({ id, item_type: type }, body);
      setDraft('');
      // Refetch rather than append: the server stamps ids and times, and the thread is short.
      const rows = await fetchAgoraComments({ id, item_type: type });
      setComments(rows);
      setCount(rows.length);
    } catch (e) {
      Alert.alert('Could not comment', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setSending(false);
    }
  }

  async function reportComment(c: AgoraComment) {
    if (!profile) return;
    try {
      await reportAgora({
        reporterId: profile.id,
        reportedUserId: c.user_id,
        reason: 'Reported from the Agora',
        commentId: c.id,
      });
      setComments((prev) => (prev ?? []).filter((x) => x.id !== c.id));
      Alert.alert('Reported', 'Thanks — we review every report within 24 hours.');
    } catch (e) {
      Alert.alert('Could not report', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function blockCommenter(c: AgoraComment) {
    if (!profile) return;
    try {
      await blockAgoraUser(profile.id, c.user_id);
      setComments((prev) => (prev ?? []).filter((x) => x.user_id !== c.user_id));
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function removeComment(c: AgoraComment) {
    try {
      await deleteAgoraComment(c.id);
      const next = (comments ?? []).filter((x) => x.id !== c.id);
      setComments(next);
      setCount(next.length);
    } catch (e) {
      Alert.alert('Could not remove', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  // Three buttons at most per Alert — Android drops a fourth.
  function reportOrBlock(c: AgoraComment) {
    Alert.alert('Report or block', `${c.display_name}'s comment`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', onPress: () => void reportComment(c) },
      { text: 'Block user', style: 'destructive', onPress: () => void blockCommenter(c) },
    ]);
  }

  function commentOptions(c: AgoraComment) {
    const myPost = item?.user_id === profile?.id;
    if (!c.is_mine && !myPost) {
      reportOrBlock(c);
      return;
    }
    if (!c.is_mine) {
      Alert.alert('Comment options', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Report or block…', onPress: () => reportOrBlock(c) },
        { text: 'Remove', style: 'destructive', onPress: () => void removeComment(c) },
      ]);
      return;
    }
    Alert.alert('Delete your comment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeComment(c) },
    ]);
  }

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={Colors.ink} />
          </Pressable>
          <Text style={styles.title}>Post</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
        ) : !item ? (
          <Text style={styles.empty}>This isn&rsquo;t available.</Text>
        ) : (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}>
            <FlatList
              style={styles.flex}
              data={comments ?? []}
              keyExtractor={(c) => c.id}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View style={styles.postWrap}>
                  <GymPostCard
                    item={item}
                    variant="detail"
                    forcePr={pr}
                    onMore={openMore}
                    // get_agora_item has no is_pr, so the feed's pr=1 param is forwarded.
                    prAccessory={<PrStoryButton item={item} forcePr={pr} />}
                  />
                  <View style={styles.divider} />
                </View>
              }
              ListEmptyComponent={
                comments === null ? (
                  <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
                ) : (
                  <Text style={styles.empty}>No chirps yet — start it.</Text>
                )
              }
              renderItem={({ item: c }) => (
                <Pressable
                  style={styles.comment}
                  onLongPress={() => commentOptions(c)}
                  delayLongPress={400}
                  accessibilityRole="button"
                  accessibilityHint="Long press for options">
                  <GymAvatar userId={c.user_id} name={c.display_name} url={c.avatar_url} size={40} />
                  <View style={styles.cBody}>
                    <Text style={styles.cName} numberOfLines={1}>
                      {c.display_name}
                      <Text style={styles.cTime}>  {shortTime(c.created_at)}</Text>
                    </Text>
                    <Text style={styles.cText}>{c.body}</Text>
                  </View>
                </Pressable>
              )}
            />

            <View style={styles.bar}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={(t) => setDraft(t.slice(0, MAX))}
                placeholder="Add some chirp…"
                placeholderTextColor={Colors.spaceDim}
                multiline
                maxLength={MAX}
                accessibilityLabel="Comment"
              />
              <Pressable
                onPress={() => void send()}
                disabled={!canSend}
                hitSlop={8}
                style={styles.send}
                accessibilityRole="button"
                accessibilityLabel="Send comment">
                {sending ? (
                  <ActivityIndicator size="small" color={Colors.navEmber2} />
                ) : (
                  <Text style={[styles.sendText, !canSend && styles.sendOff]}>Send</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>

      {moderation.sheets}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
  },
  loader: {
    marginTop: Spacing.five,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  postWrap: {
    paddingBottom: Spacing.half,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.spaceLine,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  empty: {
    marginTop: Spacing.five,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.spaceDim,
  },
  comment: {
    flexDirection: 'row',
    gap: Spacing.twelve,
    paddingVertical: 10,
  },
  cBody: {
    flex: 1,
  },
  cName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  cTime: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  cText: {
    marginTop: 2,
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.ink,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
    backgroundColor: Colors.spacePanel,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: Colors.spacePanel2,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  send: {
    minWidth: 44,
    alignItems: 'center',
  },
  sendText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.navEmber2,
  },
  sendOff: {
    opacity: 0.4,
  },
});
