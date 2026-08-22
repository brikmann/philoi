import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCampfireRole } from '@/hooks/use-campfire-role';
import { useGroup } from '@/hooks/use-group';
import { fetchCampfireMembers, setCampfireMemberRole } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { CampfireMember } from '@/types/database';

// MEMBERS & ROLES — where the campfire's keys are handed out (migration 0094).
//
// Not in a mock, and said so in the handoff: mock 112's options sheet notes only "admin-only items
// gated in Phase 2". But the role model landed in Phase 1 because the challenge subsystem needs
// isAdmin to gate on, and a role nobody can grant is a role that does not exist. This is the
// smallest screen that makes it real — the roster, who holds what, and an owner-only promote.
//
// OWNER-ONLY, and enforced in set_campfire_member_role() rather than only hidden here. An admin
// who could mint admins is an admin who cannot be removed.
const ROLE_LABEL: Record<CampfireMember['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export default function CampfireMembersScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { group } = useGroup(groupId);
  const { isOwner } = useCampfireRole(groupId);
  const [members, setMembers] = useState<CampfireMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<CampfireMember | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setMembers(await fetchCampfireMembers(groupId));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the members.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  async function applyRoleChange() {
    if (!pending) return;
    const next = pending.role === 'admin' ? 'member' : 'admin';
    setBusy(true);
    try {
      await setCampfireMemberRole(groupId, pending.user_id, next);
      setPending(null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not change that role.'));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const admins = members.filter((m) => m.role !== 'member').length;

  return (
    <Screen padded={false} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.title}>Members</Text>
      </View>
      <Text style={styles.sub} numberOfLines={1}>
        {group?.name ?? '…'} · {members.length} {members.length === 1 ? 'member' : 'members'} · {admins} with keys
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView contentContainerStyle={styles.list}>
        {members.map((m) => {
          // The owner's own row is never actionable — a campfire always has exactly one owner, and
          // transferring it is a different act than promoting someone.
          const canChange = isOwner && m.role !== 'owner';
          return (
            <View key={m.user_id} style={styles.row}>
              <View style={styles.avatar}>
                {m.avatar_url ? (
                  <Image source={{ uri: m.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarInitial}>{m.display_name.charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>
                  {m.display_name}
                </Text>
                {m.handle && <Text style={styles.handle}>@{m.handle}</Text>}
              </View>

              <View style={[styles.roleChip, m.role !== 'member' && styles.roleChipKeys]}>
                <Text style={[styles.roleLabel, m.role !== 'member' && styles.roleLabelKeys]}>{ROLE_LABEL[m.role]}</Text>
              </View>

              {canChange && (
                <Pressable
                  style={styles.action}
                  onPress={() => setPending(m)}
                  accessibilityLabel={m.role === 'admin' ? `Remove ${m.display_name} as admin` : `Make ${m.display_name} an admin`}>
                  <Ionicons
                    name={m.role === 'admin' ? 'remove-circle-outline' : 'add-circle-outline'}
                    size={19}
                    color={m.role === 'admin' ? Colors.danger : Colors.amber}
                  />
                </Pressable>
              )}
            </View>
          );
        })}

        {!loading && members.length === 0 && <Text style={styles.empty}>Nobody here yet.</Text>}

        {isOwner && (
          <Text style={styles.footnote}>
            Admins can edit the campfire, approve join requests and run challenges. Only you can delete
            the campfire or change who's an admin.
          </Text>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={pending != null}
        title={pending?.role === 'admin' ? 'Remove admin' : 'Make admin'}
        body={
          pending?.role === 'admin'
            ? `${pending.display_name} will go back to being a regular member — no editing, no approving joins, no starting challenges.`
            : `${pending?.display_name ?? 'They'} will be able to edit this campfire, approve join requests and start challenges. They won't be able to delete it.`
        }
        confirmLabel={pending?.role === 'admin' ? 'Remove' : 'Make admin'}
        destructive={pending?.role === 'admin'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={applyRoleChange}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 15,
    paddingBottom: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginBottom: Spacing.two,
  },
  list: {
    gap: 8,
    paddingBottom: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#141020',
    borderWidth: 1,
    borderColor: '#221A34',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    backgroundColor: '#1C1430',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.achieverText,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  roleChip: {
    borderRadius: Radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: Colors.disabled,
  },
  roleChipKeys: {
    backgroundColor: Colors.achieverBg,
  },
  roleLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.muted,
  },
  roleLabelKeys: {
    color: Colors.achieverText,
  },
  action: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  footnote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    paddingHorizontal: 4,
    paddingTop: Spacing.two,
  },
});
