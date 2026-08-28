import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { attachmentView } from '@/lib/agora-attachment';
import {
  addAgoraComment,
  blockAgoraUser,
  deleteAgoraComment,
  fetchAgoraComments,
} from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import type { AgoraComment, AgoraItem } from '@/types/database';

// Mock 162 panel 6 — "Bubble → comments pull up from the bottom. Kept as-is — simple, does the job."
//
// The spec's "gather and talk" half. One sheet over both feed row types: the RPCs underneath take
// a post id OR a milestone id, and `commentParent` in lib/api/agora picks which.

const MAX = 500;

type Props = {
  item: AgoraItem | null;
  onClose: () => void;
  /** Reports the live count back so the card's bubble updates without refetching the page. */
  onCountChange: (itemId: string, count: number) => void;
};

/**
 * The sheet is a thin shell; every bit of the thread's state lives in <Thread>, KEYED BY ITEM.
 *
 * That split is load-bearing. The state a thread holds — its comments, a half-typed draft — is
 * only ever valid for one item, and the obvious alternative (clearing it from an effect when
 * `item` changes) is a synchronous setState inside an effect body: the cascading-render pattern
 * the lint rule catches, and the shape of the bug that once froze the gym lock-in. A `key` hands
 * the resetting to React, which does it correctly and for free.
 */
export function AgoraCommentsSheet({ item, onClose, onCountChange }: Props) {
  const itemKey = item ? `${item.item_type}:${item.id}` : null;

  return (
    <Modal
      visible={item !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close comments" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Cheers &amp; comments</Text>
          {item ? <Thread key={itemKey} item={item} onCountChange={onCountChange} /> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Thread({
  item,
  onCountChange,
}: {
  item: AgoraItem;
  onCountChange: (itemId: string, count: number) => void;
}) {
  const { profile } = useAuth();
  const [comments, setComments] = useState<AgoraComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const itemId = item.id;
  const itemType = item.item_type;

  useEffect(() => {
    let live = true;
    fetchAgoraComments({ id: itemId, item_type: itemType })
      .then((rows) => {
        if (!live) return;
        setComments(rows);
        onCountChange(itemId, rows.length);
      })
      .catch(() => {
        // The sheet still shows the post header and the composer. An error banner over an empty
        // thread tells the reader nothing they can act on.
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // Mount-only by construction — the component is keyed on the item, so a different item is a
    // different Thread. onCountChange is a parent callback that would otherwise refire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, itemType]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addAgoraComment(item, body);
      setDraft('');
      // Refetch rather than append locally: the server is what stamps ids and times, and the
      // thread is short enough that one round trip is cheaper than reconciling an optimistic row.
      const rows = await fetchAgoraComments(item);
      setComments(rows);
      onCountChange(itemId, rows.length);
    } catch (e) {
      Alert.alert('Could not comment', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setSending(false);
    }
  }

  function confirmRemove(comment: AgoraComment) {
    const mine = comment.is_mine;
    const isMyItem = item.user_id === profile?.id;

    if (!mine && !isMyItem) {
      // Not yours, and not on your post — the action available to you is to stop seeing them.
      Alert.alert('Block this person?', `You won't see ${comment.display_name} anywhere on Philoi.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (!profile) return;
            try {
              await blockAgoraUser(profile.id, comment.user_id);
              setComments((prev) => prev.filter((c) => c.user_id !== comment.user_id));
            } catch (e) {
              Alert.alert('Could not block', getErrorMessage(e, 'Something went wrong.'));
            }
          },
        },
      ]);
      return;
    }

    Alert.alert(mine ? 'Delete your comment?' : 'Remove this comment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAgoraComment(comment.id);
            setComments((prev) => {
              const next = prev.filter((c) => c.id !== comment.id);
              onCountChange(itemId, next.length);
              return next;
            });
          } catch (e) {
            Alert.alert('Could not remove', getErrorMessage(e, 'Something went wrong.'));
          }
        },
      },
    ]);
  }

  const attachment = attachmentView(item.attach_kind, item.attach_snapshot);

  return (
    <>
      <View style={styles.postMini}>
        <Text style={styles.postMiniText} numberOfLines={1}>
          {attachment
            ? `${item.display_name} — ${attachment.title}`
            : (item.body ?? `${item.display_name}'s post`)}
        </Text>
        <View style={styles.postMiniMeta}>
          <Ionicons name="flame" size={11} color={Colors.amber} />
          <Text style={styles.postMiniCount}>{item.cheers} cheers</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.coral} style={styles.loader} />
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>No comments yet — say something encouraging.</Text>
          }
          renderItem={({ item: c }) => (
            <Pressable
              style={styles.comment}
              onLongPress={() => confirmRemove(c)}
              delayLongPress={400}
              accessibilityRole="button"
              accessibilityHint="Long press for options">
              {c.avatar_url ? (
                <Image source={{ uri: c.avatar_url }} style={styles.cAvatar} contentFit="cover" />
              ) : (
                <View style={[styles.cAvatar, styles.cAvatarFallback]}>
                  <Text style={styles.cInitial}>{c.display_name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.cBody}>
                <Text style={styles.cName}>
                  {c.display_name}
                  {c.handle ? <Text style={styles.cHandle}> @{c.handle}</Text> : null}
                </Text>
                <Text style={styles.cText}>{c.body}</Text>
                <Text style={styles.cTime}>{formatRelativeTime(c.created_at)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <View style={styles.bar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={(t) => setDraft(t.slice(0, MAX))}
          placeholder="Add a comment…"
          placeholderTextColor={Colors.textTertiary}
          multiline
          maxLength={MAX}
          accessibilityLabel="Comment"
        />
        <Pressable
          style={[styles.send, (!draft.trim() || sending) && styles.sendOff]}
          onPress={send}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send comment">
          {sending ? (
            <ActivityIndicator size="small" color={Colors.onEmber} />
          ) : (
            <Ionicons name="arrow-up" size={16} color={Colors.onEmber} />
          )}
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6,5,10,0.6)',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '78%',
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: Colors.lineStrong,
    paddingBottom: Spacing.four,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: Spacing.two,
    marginBottom: 10,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    paddingHorizontal: Spacing.four,
  },
  postMini: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.twelve,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  postMiniText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  postMiniMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  postMiniCount: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  loader: {
    marginTop: Spacing.five,
  },
  list: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.five,
  },
  comment: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingVertical: 10,
  },
  cAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  cAvatarFallback: {
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cInitial: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ink,
  },
  cBody: {
    flex: 1,
  },
  cName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ink,
  },
  cHandle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  cText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.ink,
    marginTop: 2,
  },
  cTime: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    marginTop: 3,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: 22,
    paddingLeft: Spacing.twelve,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
    paddingVertical: Spacing.two,
  },
  send: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendOff: {
    backgroundColor: Colors.disabledSurface,
  },
});
