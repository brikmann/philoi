import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchCampfireMembers } from '@/lib/api/groups';
import { removeRoomMember, setRoomMemberRole, type RoomRole } from '@/lib/api/rooms';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { CampfireMember } from '@/types/database';

// Room → Members (mock 375). Owner first, then moderators, then everyone. The owner and moderators
// get a row action sheet: Make moderator / Remove moderator / Remove from room. The server is the
// authority (0297's set_room_member_role / remove_room_member); this only hides actions a role can't
// take, so a refused one is a stale screen, never a permissions hole. A Modal sheet, not Alert:
// Android's Alert caps at three buttons and silently drops Cancel.

const LABEL: Record<string, string> = { owner: 'Owner', admin: 'Mod', member: '' };

export function RoomMembers({
  roomId,
  myRole,
  onChanged,
}: {
  roomId: string;
  myRole: RoomRole | null;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const [members, setMembers] = useState<CampfireMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CampfireMember | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await fetchCampfireMembers(roomId);
      setError(null);
      setMembers(rows);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load members.'));
      setMembers([]);
    }
  }, [roomId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const canManage = (m: CampfireMember) => {
    if (m.user_id === me || m.role === 'owner') return false;
    if (myRole === 'owner') return true;
    return myRole === 'moderator' && m.role === 'member';
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setSheet(null);
      await load();
      onChanged?.();
    } catch (e) {
      Alert.alert('Room', getErrorMessage(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  if (members === null) return <ActivityIndicator color={Colors.navEmber} style={{ marginTop: Spacing.four }} />;

  return (
    <View style={styles.list}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {members.map((m) => (
        <Pressable
          key={m.user_id}
          style={styles.row}
          onPress={() => router.push({ pathname: '/friend-profile', params: { userId: m.user_id } })}
          onLongPress={() => canManage(m) && setSheet(m)}
          accessibilityRole="button">
          {m.avatar_url ? (
            <Image source={{ uri: m.avatar_url }} style={styles.avatar} />
          ) : (
            <Avatar label={(m.display_name || '?').slice(0, 2).toUpperCase()} size={38} />
          )}
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {m.display_name}
            </Text>
            {m.handle ? <Text style={styles.handle}>@{m.handle.replace(/^@+/, '')}</Text> : null}
          </View>
          {LABEL[m.role] ? (
            <View style={[styles.rolePill, m.role === 'owner' && styles.ownerPill]}>
              <Text style={styles.roleText}>{LABEL[m.role]}</Text>
            </View>
          ) : null}
          {canManage(m) ? (
            <Pressable onPress={() => setSheet(m)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Manage ${m.display_name}`}>
              <Text style={styles.kebab}>⋯</Text>
            </Pressable>
          ) : null}
        </Pressable>
      ))}

      <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.scrim} onPress={() => !busy && setSheet(null)}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>{sheet?.display_name}</Text>
            {busy ? <ActivityIndicator color={Colors.navEmber} style={{ marginVertical: 12 }} /> : null}
            {sheet?.role === 'member' ? (
              <SheetRow label="Make moderator" onPress={() => void act(() => setRoomMemberRole(roomId, sheet.user_id, 'moderator'))} />
            ) : null}
            {sheet?.role === 'admin' && myRole === 'owner' ? (
              <SheetRow label="Remove moderator" onPress={() => void act(() => setRoomMemberRole(roomId, sheet.user_id, 'member'))} />
            ) : null}
            {sheet ? (
              <SheetRow label="Remove from room" danger onPress={() => void act(() => removeRoomMember(roomId, sheet.user_id))} />
            ) : null}
            <SheetRow label="Cancel" onPress={() => setSheet(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SheetRow({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.sheetRow} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.sheetRowText, danger && { color: Colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: 6 },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  text: { flex: 1 },
  name: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink },
  handle: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.spaceDim },
  rolePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: Colors.spacePanel2 },
  ownerPill: { backgroundColor: '#3A2412' },
  roleText: { fontFamily: Fonts.bodyBold, fontSize: 10.5, color: Colors.navEmber2 },
  kebab: { fontSize: 20, color: Colors.spaceDim, paddingHorizontal: 4 },
  scrim: { flex: 1, backgroundColor: Colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.spacePanel, padding: Spacing.three, paddingBottom: Spacing.five, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 4 },
  sheetTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink, marginBottom: 6 },
  sheetRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.spaceLine },
  sheetRowText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
});
