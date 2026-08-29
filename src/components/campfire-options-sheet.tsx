import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CampfireBadge } from '@/components/campfire-badge';
import { CampfireBannerPicker } from '@/components/campfire-banner-picker';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCampfireHeat } from '@/hooks/use-campfire-heat';
import { useCampfireRole } from '@/hooks/use-campfire-role';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { deleteGroup, fetchJoinRequests, leaveGroup, setChatMuted } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { CampfirePrivacy, Group } from '@/types/database';

const PRIVACY_LABEL: Record<CampfirePrivacy, string> = {
  open: 'Open',
  gated: 'Gated',
  private: 'Private',
};

type CampfireOptionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  group: Group | null;
  groupId: string;
  chatMuted: boolean;
  onChatMutedChanged: (muted: boolean) => void;
  /** Re-read the group — the banner picker changes a column the header renders from. */
  onGroupChanged: () => void | Promise<void>;
};

type RowConfig = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  badge?: number;
  onPress: () => void;
};

// The campfire's options sheet (mock 110 frame 4, mock 112 §B) — what the header's HAMBURGER opens.
//
// Two things changed with the redesign:
//  · It is reached from the hamburger, not from a blue floating gear. Same sheet, one honest entry.
//  · The manage rows are gated on ROLE (migration 0094), not on `group.owner_id === me`. An admin
//    the owner promoted gets Edit and Join requests; a plain member does not. DELETE stays owner-
//    only and a member sees "Leave campfire" in its place — an admin can run the fire, but only the
//    founder can end it for everyone.
//
// And the destructive confirm is the EMBER dialog, never Alert.alert: on Android the platform
// dialog is a bare grey slab with system-blue text, which is the exact screenshot
// CAMPFIRE_REDESIGN_SPEC flags. See ui/confirm-dialog.tsx.
export function CampfireOptionsSheet({
  visible,
  onClose,
  group,
  groupId,
  chatMuted,
  onChatMutedChanged,
  onGroupChanged,
}: CampfireOptionsSheetProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const leaderboard = useLeaderboard(groupId);
  const { isAdmin, isOwner } = useCampfireRole(groupId);
  const [muting, setMuting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const heatByGroupId = useCampfireHeat();
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Join requests row (PHILOI_UI_SPEC.md §14) — admins only, and only meaningful while gated;
  // list_join_requests() itself refuses non-admins, so this simply doesn't fire for anyone else.
  useEffect(() => {
    if (!visible || !isAdmin || group?.privacy !== 'gated') {
      setPendingCount(0);
      return;
    }
    fetchJoinRequests(groupId)
      .then((requests) => setPendingCount(requests.length))
      .catch(() => {
        // Badge count is flavor, not core — a failed fetch just hides the number.
      });
  }, [visible, isAdmin, group?.privacy, groupId]);

  function go(path: string) {
    onClose();
    router.push(path as Parameters<typeof router.push>[0]);
  }

  async function handleToggleMute() {
    setMuting(true);
    setError(null);
    try {
      await setChatMuted(groupId, !chatMuted);
      onChatMutedChanged(!chatMuted);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not update notifications — try again.'));
    } finally {
      setMuting(false);
    }
  }

  async function handleConfirmLeaveOrDelete() {
    if (!session) return;
    setConfirmBusy(true);
    try {
      if (isOwner) await deleteGroup(groupId);
      else await leaveGroup(groupId, session.user.id);
      setConfirmOpen(false);
      onClose();
      router.replace('/');
    } catch (e) {
      setError(getErrorMessage(e, `Could not ${isOwner ? 'delete' : 'leave'} this campfire.`));
      setConfirmOpen(false);
    } finally {
      setConfirmBusy(false);
    }
  }

  const rows: RowConfig[] = [
    ...(isAdmin
      ? [{ key: 'edit', icon: 'pencil' as const, label: 'Edit campfire', onPress: () => go(`/group/${groupId}/edit`) }]
      : []),
    // The banner affordance mock 164 §3 asks for. OWNER only, not admin: the header flies the
    // owner's cosmetic (see campfire-banner-picker.tsx), so an admin picking one here would be
    // equipping a banner off someone else's account.
    ...(isOwner
      ? [
          {
            key: 'banner',
            icon: 'color-palette' as const,
            label: 'Set banner',
            onPress: () => {
              onClose();
              setBannerOpen(true);
            },
          },
        ]
      : []),
    { key: 'invite', icon: 'person-add', label: 'Invite people', onPress: () => go(`/group/${groupId}/invite`) },
    // Everyone can see who's in and who holds keys; only the owner can change it (gated on the
    // screen and in set_campfire_member_role()).
    { key: 'members', icon: 'people-circle', label: 'Members', onPress: () => go(`/group/${groupId}/members`) },
    {
      key: 'mute',
      icon: chatMuted ? 'notifications-off' : 'notifications-off-outline',
      label: chatMuted ? 'Unmute notifications' : 'Mute notifications',
      onPress: handleToggleMute,
    },
    ...(isAdmin && group?.privacy === 'gated'
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

  const memberCount = leaderboard.rows.length;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
            <View style={styles.grab} />

            <View style={styles.header}>
              {/* The campfire's own badge (mock 168), not the brand flame — every sheet header
                  drew the identical FlameLogo, so the one place you go to delete a campfire gave
                  you no confirmation of WHICH one you had open. */}
              <CampfireBadge emoji={group?.emoji ?? '🔥'} heat={heatByGroupId[groupId] ?? 0} size={38} />
              <View style={styles.headerText}>
                <Text style={styles.name} numberOfLines={1}>
                  {group?.name ?? '…'}
                </Text>
                <Text style={styles.sub}>
                  {group ? PRIVACY_LABEL[group.privacy] : '—'} · {memberCount} {memberCount === 1 ? 'member' : 'members'}
                </Text>
              </View>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {rows.map((row) => (
              <Pressable key={row.key} style={styles.row} onPress={row.onPress} disabled={muting}>
                <View style={styles.rowIcon}>
                  <Ionicons name={row.icon} size={16} color={Colors.soloChipText} />
                </View>
                <Text style={styles.rowLabel}>{row.label}</Text>
                {Boolean(row.badge) && (
                  <View style={styles.rowBadge}>
                    <Text style={styles.rowBadgeLabel}>{row.badge}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
              </Pressable>
            ))}

            <View style={styles.sep} />

            <Pressable style={styles.row} onPress={() => go(`/report?groupId=${groupId}`)}>
              <View style={[styles.rowIcon, styles.rowIconWarn]}>
                <Ionicons name="flag" size={15} color={Colors.amber} />
              </View>
              <Text style={styles.rowLabel}>Report this campfire</Text>
              <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
            </Pressable>

            <Pressable style={styles.row} onPress={() => setConfirmOpen(true)}>
              <View style={[styles.rowIcon, styles.rowIconDanger]}>
                <Ionicons name={isOwner ? 'trash' : 'log-out'} size={15} color={Colors.danger} />
              </View>
              <Text style={[styles.rowLabel, styles.rowLabelDanger]}>
                {isOwner ? 'Delete campfire' : 'Leave campfire'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <CampfireBannerPicker
        visible={bannerOpen}
        onClose={() => setBannerOpen(false)}
        campfireName={group?.name ?? 'Your campfire'}
        groupId={groupId}
        currentBannerId={group?.banner_item_id ?? null}
        onChanged={onGroupChanged}
      />

      <ConfirmDialog
        visible={confirmOpen}
        title={isOwner ? 'Delete campfire' : 'Leave campfire'}
        body={
          isOwner
            ? 'This permanently deletes this campfire for everyone. This cannot be undone.'
            : "You'll stop seeing this campfire's feed and leaderboard."
        }
        confirmLabel={isOwner ? 'Delete' : 'Leave'}
        destructive={isOwner}
        busy={confirmBusy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmLeaveOrDelete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,10,0.55)',
  },
  sheet: {
    backgroundColor: '#161022',
    borderTopWidth: 1,
    borderTopColor: '#2A2140',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: '#33294A',
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 2,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1730',
    marginBottom: Spacing.two,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    lineHeight: 18,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: '#8F83A8',
    marginTop: 1,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    paddingHorizontal: 4,
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: Radius.card,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#1C1430',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconWarn: {
    backgroundColor: Colors.achieverBg,
  },
  rowIconDanger: {
    backgroundColor: 'rgba(255,90,60,0.14)',
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowLabelDanger: {
    color: '#FF8F8F',
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
    backgroundColor: '#1E1730',
    marginVertical: 6,
  },
});
