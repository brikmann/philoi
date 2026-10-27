import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FriendFace } from '@/components/lockin-cheers/friend-faces';
import { Icon, IconText } from '@/components/ui/icon';
import { Colors, Fonts } from '@/constants/theme';
import { cheerAgoraItem } from '@/lib/api/agora';
import { effortLine, type FriendEffort } from '@/lib/api/home';
import { sendCheer } from '@/lib/api/lockin-cheers';
import { getErrorMessage } from '@/lib/errors';

/**
 * Home §3 — WHAT YOUR PEOPLE ARE DOING (mock 318). A tight "your people right now" strip, not the
 * Social feed: each friend's latest real effort, newest first, never ranked, friends only.
 *
 * One action per row, and only the existing paths:
 *   • live            → 🔥 Cheer = the live lock-in cheer (send_cheer, 0270), once per session;
 *   • shared a post   → 🔥 Cheer = a cheer on that post (cheer_agora_post);
 *   • otherwise, or once cheered → 💬 — the session-scoped lock-in thread while they're live
 *     (onMessageLive opens the cheers sheet), a DM when they aren't.
 */
export function YourPeopleList({
  people,
  unit,
  onMessageLive,
}: {
  people: FriendEffort[];
  unit: 'lb' | 'kg';
  onMessageLive: () => void;
}) {
  const router = useRouter();
  // Optimistic ✓ — the server confirms on the next focus read.
  const [cheered, setCheered] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (people.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>When your friends lock in, hit a PR or post, it shows up here.</Text>
        <Pressable onPress={() => router.push('/add-friend')} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.emptyCta}>Add friends</Text>
        </Pressable>
      </View>
    );
  }

  const cheer = async (p: FriendEffort) => {
    setBusy(p.userId);
    setError(null);
    try {
      if (p.live) {
        // False = already cheered this session of theirs — still a ✓.
        await sendCheer(p.userId, 'lock_in');
      } else if (p.postId) {
        await cheerAgoraItem({ item_type: 'post', id: p.postId });
      }
      setCheered((prev) => new Set(prev).add(p.userId));
    } catch (e) {
      setError(getErrorMessage(e, 'That cheer didn’t send.'));
    } finally {
      setBusy(null);
    }
  };

  const message = (p: FriendEffort) => {
    if (p.live) onMessageLive();
    else router.push({ pathname: '/dm/[friendId]', params: { friendId: p.userId } });
  };

  const total = people[0]?.total ?? people.length;

  return (
    <View style={styles.list}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {people.map((p) => {
        const done = p.iCheered || cheered.has(p.userId);
        const canCheer = !done && (p.live || p.postId !== null);
        const line = effortLine(p, unit);
        return (
          <Pressable
            key={p.userId}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => router.push({ pathname: '/friend-profile', params: { userId: p.userId } })}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}${p.live ? ', locked in now' : ''}. ${line.text}`}>
            <FriendFace name={p.name} avatarUrl={p.avatarUrl} size={36} live={p.live} />
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {p.name}
              </Text>
              {line.icon ? (
                <IconText icon={line.icon} style={styles.line} numberOfLines={1} containerStyle={styles.lineRow}>
                  {line.text}
                </IconText>
              ) : (
                <Text style={styles.line} numberOfLines={1}>
                  {line.text}
                </Text>
              )}
            </View>
            {busy === p.userId ? (
              <ActivityIndicator size="small" color={Colors.navEmber2} style={styles.spinner} />
            ) : canCheer ? (
              <Pressable
                onPress={() => cheer(p)}
                style={styles.act}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Cheer ${p.name}`}>
                <IconText icon="cheer" style={styles.actText}>
                  Cheer
                </IconText>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => message(p)}
                style={styles.ghost}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`${done ? 'Cheered. ' : ''}Message ${p.name}`}>
                <View style={styles.ghostRow}>
                  {done ? <Icon name="check" size={13} color={Colors.muted} /> : null}
                  <Icon name="comment" size={14} color={Colors.muted} />
                </View>
              </Pressable>
            )}
          </Pressable>
        );
      })}
      {total > people.length ? (
        <Pressable onPress={() => router.push('/people')} style={styles.moreRow} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.more}>+{total - people.length} more of your people →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  pressed: {
    opacity: 0.85,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  line: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 1,
  },
  act: {
    backgroundColor: Colors.navEmber,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  actText: {
    fontFamily: Fonts.black,
    fontSize: 11.5,
    color: '#1A1030',
  },
  ghost: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  lineRow: {
    flexShrink: 1,
  },
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  spinner: {
    width: 64,
  },
  moreRow: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  more: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  empty: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    padding: 14,
    alignItems: 'flex-start',
    gap: 8,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.muted,
  },
  emptyCta: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.navEmber2,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.danger,
  },
});
