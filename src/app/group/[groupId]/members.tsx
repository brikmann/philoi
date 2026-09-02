import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TextInput } from '@/components/ui/text-input';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCampfireRole } from '@/hooks/use-campfire-role';
import { useGroup } from '@/hooks/use-group';
import { fetchCampfireMembers, setCampfireMemberRole } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
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
  const [query, setQuery] = useState('');
  const { session } = useAuth();

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

  function openProfile(userId: string) {
    // Your own row goes to your own profile, everyone else's to theirs — the same split every
    // other roster in the app makes (the campfire board, the global leaderboards, an Agora card).
    if (userId === session?.user.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId } });
  }

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

  // Name OR handle, case-insensitive — people search for whichever of the two they remember.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.display_name.toLowerCase().includes(q) || (m.handle ?? '').toLowerCase().includes(q)
    );
  }, [members, query]);

  return (
    <Screen padded={false} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.title}>Members</Text>
      </View>
      {/* §6: "· N with keys" is gone. Every row already carries its own role chip, so the count
          was restating in aggregate what the list says per person — and "keys" is internal
          vocabulary that means nothing to a member reading it for the first time. */}
      <Text style={styles.sub} numberOfLines={1}>
        {group?.name ?? '…'} · {members.length} {members.length === 1 ? 'member' : 'members'}
      </Text>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={15} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search members"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView contentContainerStyle={styles.list}>
        {visible.map((m) => {
          // The owner's own row is never actionable — a campfire always has exactly one owner, and
          // transferring it is a different act than promoting someone.
          const canChange = isOwner && m.role !== 'owner';
          return (
            // §6 · THE ROW OPENS THE PERSON. This is where people meet each other — you scroll a
            // campfire's roster, see a name you have been racing, and want to add them. The
            // add-friend action lives on the profile, so the row's job is to get you there.
            //
            // The admin toggle at the end keeps its own Pressable and therefore wins the touch:
            // nested Pressables deliver to the innermost, so promoting someone does not also
            // navigate away from the screen you promoted them on.
            <Pressable
              key={m.user_id}
              style={styles.row}
              onPress={() => openProfile(m.user_id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${m.display_name}'s profile`}>
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
            </Pressable>
          );
        })}

        {!loading && members.length === 0 && <Text style={styles.empty}>Nobody here yet.</Text>}
        {!loading && members.length > 0 && visible.length === 0 && (
          <Text style={styles.empty}>Nobody matches “{query.trim()}”.</Text>
        )}

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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginTop: 12,
    marginHorizontal: 2,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13.5,
    color: Colors.ink,
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
