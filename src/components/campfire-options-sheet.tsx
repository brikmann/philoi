import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { fetchCampfireLevel } from '@/lib/api/campfire-level';
import { deleteGroup, fetchJoinRequests, leaveGroup, setChatMuted } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { Group } from '@/types/database';

type CampfireOptionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  group: Group | null;
  groupId: string;
  chatMuted: boolean;
  onChatMutedChanged: (muted: boolean) => void;
};

type RowConfig = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: 'warn' | 'danger';
  badge?: number;
  onPress: () => void;
};

// The campfire's "···" menu, rebuilt as a themed bottom sheet (design-mocks/19) — no native
// AlertDialog anywhere in this flow. "Rename" folds into "Edit campfire" rather than being a
// separate row, matching the mock exactly.
export function CampfireOptionsSheet({ visible, onClose, group, groupId, chatMuted, onChatMutedChanged }: CampfireOptionsSheetProps) {
  const router = useRouter();
  const { session } = useAuth();
  const leaderboard = useLeaderboard(groupId);
  const [level, setLevel] = useState<number | null>(null);
  const [muting, setMuting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const isOwner = Boolean(group && session && group.owner_id === session.user.id);

  useEffect(() => {
    if (!visible) return;
    fetchCampfireLevel(groupId)
      .then((l) => setLevel(l.level))
      .catch(() => {
        // Level is flavor text in this header — a failed fetch just hides the number.
      });
  }, [visible, groupId]);

  // Join requests row (mock 19, PHILOI_UI_SPEC.md §14) — owner-only, and only meaningful
  // while gated; fetchJoinRequests() itself would raise for non-owners, so this simply
  // doesn't fire for anyone else.
  useEffect(() => {
    if (!visible || !isOwner || group?.privacy !== 'gated') {
      setPendingCount(0);
      return;
    }
    fetchJoinRequests(groupId)
      .then((requests) => setPendingCount(requests.length))
      .catch(() => {
        // Badge count is flavor, not core — a failed fetch just hides the number.
      });
  }, [visible, isOwner, group?.privacy, groupId]);

  function go(path: string) {
    onClose();
    router.push(path as Parameters<typeof router.push>[0]);
  }

  async function handleToggleMute() {
    setMuting(true);
    try {
      await setChatMuted(groupId, !chatMuted);
      onChatMutedChanged(!chatMuted);
    } catch (e) {
      Alert.alert('Could not update', getErrorMessage(e, 'Try again.'));
    } finally {
      setMuting(false);
    }
  }

  function handleLeaveOrDelete() {
    onClose();
    Alert.alert(
      isOwner ? 'Delete campfire' : 'Leave campfire',
      isOwner
        ? 'This permanently deletes this Campfire for everyone. This cannot be undone.'
        : "You'll stop seeing this Campfire's chain and leaderboard.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isOwner ? 'Delete' : 'Leave',
          style: 'destructive',
          onPress: async () => {
            if (!session) return;
            try {
              if (isOwner) await deleteGroup(groupId);
              else await leaveGroup(groupId, session.user.id);
              router.replace('/');
            } catch (e) {
              Alert.alert('Something went wrong', getErrorMessage(e, `Could not ${isOwner ? 'delete' : 'leave'} this Campfire.`));
            }
          },
        },
      ]
    );
  }

  const rows: RowConfig[] = [
    { key: 'edit', icon: 'pencil', label: 'Edit campfire', onPress: () => go(`/group/${groupId}/edit`) },
    { key: 'invite', icon: 'person-add', label: 'Invite people', onPress: () => go(`/group/${groupId}/invite`) },
    {
      key: 'mute',
      icon: chatMuted ? 'notifications-off' : 'notifications-off-outline',
      label: chatMuted ? 'Unmute notifications' : 'Mute notifications',
      onPress: handleToggleMute,
    },
    // Owner-only, shown only while gated (PHILOI_UI_SPEC.md §14) — a private/open campfire
    // has no pending requests to review.
    ...(isOwner && group?.privacy === 'gated'
      ? [
          {
            key: 'join-requests',
            icon: 'people' as const,
            label: 'Join requests',
            badge: pendingCount,
            onPress: () => go(`/group/${groupId}/join-requests`),
          },
        ]
      : []),
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.sheet}>
          <View style={styles.grab} />

          <View style={styles.header}>
            <View style={styles.flameTile}>
              <Ionicons name="flame" size={17} color={Colors.amber} />
            </View>
            <View>
              <Text style={styles.name}>{group?.name ?? '…'}</Text>
              <Text style={styles.sub}>
                {level != null ? `Campfire level ${level}` : 'Campfire'} · {leaderboard.rows.length}{' '}
                {leaderboard.rows.length === 1 ? 'member' : 'members'}
              </Text>
            </View>
          </View>

          {rows.map((row) => (
            <Pressable key={row.key} style={styles.row} onPress={row.onPress} disabled={muting}>
              <View style={styles.rowIcon}>
                <Ionicons name={row.icon} size={17} color={Colors.soloChipText} />
              </View>
              <Text style={styles.rowLabel}>{row.label}</Text>
              {Boolean(row.badge) && (
                <View style={styles.rowBadge}>
                  <Text style={styles.rowBadgeLabel}>{row.badge}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          ))}

          <View style={styles.sep} />

          <Pressable style={styles.row} onPress={() => go(`/report?groupId=${groupId}`)}>
            <View style={[styles.rowIcon, styles.rowIconWarn]}>
              <Ionicons name="flag" size={16} color={Colors.amber} />
            </View>
            <Text style={styles.rowLabel}>Report this campfire</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>

          <Pressable style={styles.row} onPress={handleLeaveOrDelete}>
            <View style={[styles.rowIcon, styles.rowIconDanger]}>
              <Ionicons name="log-out" size={16} color={Colors.danger} />
            </View>
            <Text style={[styles.rowLabel, styles.rowLabelDanger]}>{isOwner ? 'Delete campfire' : 'Leave campfire'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: 18,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 4,
    paddingBottom: 12,
  },
  flameTile: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 15,
    lineHeight: 17,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: Radius.card,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconWarn: {
    backgroundColor: Colors.achieverBg,
  },
  rowIconDanger: {
    backgroundColor: Colors.dangerBg,
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowLabelDanger: {
    color: Colors.danger,
  },
  rowBadge: {
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  rowBadgeLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  sep: {
    height: 1,
    backgroundColor: Colors.line,
    marginVertical: 6,
  },
});
