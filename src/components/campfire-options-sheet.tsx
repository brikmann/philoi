
import { PhiloiIcon, type PhiloiIconName } from '@/components/ui/philoi-icon';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CampfireBadge } from '@/components/campfire-badge';
import { CampfireBannerPicker } from '@/components/campfire-banner-picker';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UiGlyph } from '@/components/ui/ui-glyph';
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
  // mock 101 frame 4 draws this sheet with the PHILOI line set, not Ionicons. Same reason
  // philoi-icon.tsx exists at all: a menu reads as a menu only when every row is drawn by the
  // same hand, and this sheet was mixing three families' idea of a stroke weight.
  icon: PhiloiIconName;
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
      ? [{ key: 'edit', icon: 'sliders' as const, label: 'Campfire settings', onPress: () => go(`/group/${groupId}/edit`) }]
      : []),
    // R2 — "Set banner" IS DELIBERATELY GONE FROM HERE.
    //
    // The banner is immutable after creation, the same rule as the emoji in R1: a campfire's
    // identity is what everyone else remembers it by, and a fire that restyles itself weekly has
    // no identity. The choice moved to group/create.tsx's BannerStrip, which is the one moment it
    // is offered.
    //
    // TO PUT IT BACK, this array entry is the whole affordance — the picker component, its state
    // and the setCampfireBanner call below all still exist and still work:
    //
    //   ...(isOwner ? [{ key: 'banner', icon: 'color-palette' as const, label: 'Set banner',
    //                    onPress: () => { onClose(); setBannerOpen(true); } }] : []),
    //
    // NOT ENFORCED SERVER-SIDE, and that is on purpose for this pass. set_campfire_banner stays
    // callable by the owner, so the campfires that already exist — every one of which predates
    // the creation-time picker and therefore has a null banner_item_id — are not permanently
    // stranded on Hearthlight with no route to a banner. Locking the RPC to a first-write-wins
    // rule is a one-line migration when those fires have been dealt with.
    { key: 'invite', icon: 'person-plus', label: 'Invite people', onPress: () => go(`/group/${groupId}/invite`) },
    // Everyone can see who's in and who holds keys; only the owner can change it (gated on the
    // screen and in set_campfire_member_role()).
    { key: 'members', icon: 'members', label: 'Members', onPress: () => go(`/group/${groupId}/members`) },
    {
      key: 'mute',
      icon: chatMuted ? 'bell' : 'bell-off',
      label: chatMuted ? 'Unmute notifications' : 'Mute notifications',
      onPress: handleToggleMute,
    },
    ...(isAdmin && group?.privacy === 'gated'
      ? [
          {
            key: 'join-requests',
            icon: 'members' as const,
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
              <Pressable
                key={row.key}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={row.onPress}
                disabled={muting}>
                <View style={styles.rowIcon}>
                  <PhiloiIcon name={row.icon} size={18} color={Colors.navEmber2} />
                </View>
                <Text style={styles.rowLabel}>{row.label}</Text>
                {Boolean(row.badge) && (
                  <View style={styles.rowBadge}>
                    <Text style={styles.rowBadgeLabel}>{row.badge}</Text>
                  </View>
                )}
                <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
              </Pressable>
            ))}

            <View style={styles.sep} />

            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => go(`/report?groupId=${groupId}`)}>
              <View style={[styles.rowIcon, styles.rowIconWarn]}>
                <PhiloiIcon name="flag" size={18} color={Colors.gold} />
              </View>
              <Text style={styles.rowLabel}>Report this campfire</Text>
              <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.row, styles.rowDanger, pressed && styles.rowPressed]}
              onPress={() => setConfirmOpen(true)}>
              <View style={[styles.rowIcon, styles.rowIconDanger]}>
                <PhiloiIcon name="leave" size={18} color={Colors.danger} />
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

// The space kit's sheet: a spaceBg slab on a spaceLine top edge, its rows SpaceRow's panel
// (14px-family corners, 1px line). Not SpaceRow itself — each row leads with a PhiloiIcon tile and
// can carry a count badge, and the danger row needs its own tinted surface.
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,10,0.6)',
  },
  sheet: {
    backgroundColor: Colors.spaceBg,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spaceLine,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 2,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.spaceLine,
    marginBottom: Spacing.twelve,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.black,
    fontSize: 16,
    lineHeight: 20,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
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
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  rowDanger: {
    backgroundColor: 'rgba(232,106,90,0.08)',
    borderColor: 'rgba(232,106,90,0.32)',
  },
  // SpaceTile's 36px square, at the sheet's 32.
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,122,47,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconWarn: {
    backgroundColor: 'rgba(255,209,102,0.12)',
  },
  rowIconDanger: {
    backgroundColor: 'rgba(232,106,90,0.14)',
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowLabelDanger: {
    color: Colors.danger,
  },
  rowBadge: {
    backgroundColor: Colors.navEmber,
    borderRadius: Radius.pill,
    minWidth: 20,
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rowBadgeLabel: {
    fontFamily: Fonts.black,
    fontSize: 11,
    color: '#2A0F05',
  },
  sep: {
    height: 1,
    backgroundColor: Colors.spaceLine,
    marginTop: 4,
    marginBottom: 10,
  },
});
