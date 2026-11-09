import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchMyFriends } from '@/lib/api/friends';
import { fetchRoomGate, joinRoom, joinRoomMessage, RoomsNotLiveError, type RoomGate, type RoomPerson } from '@/lib/api/rooms';
import { getErrorMessage } from '@/lib/errors';

// ROOM CODE-GATE (ShareSpot mock 384). A code room (join_policy 'code', 0297) — course chats like
// "KP344 @ Laurier" — asks for its 6-character code. The DEFAULT state is not an admin wall: "Don't
// have the code? Message the owner or a moderator", listing the people who run it. Gating is
// community-run. Most rooms are open; this screen is the rare case.
//
// Message → a DM if you're already friends (DMs are friends-only server-side, 0206). Otherwise it
// opens their Campfire, where you can add them and then message.

const LEN = 6;

export default function RoomCodeGateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [gate, setGate] = useState<RoomGate | null | undefined>(undefined);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    fetchRoomGate(id)
      .then((g) => {
        if (!live) return;
        if (g?.is_member) {
          router.replace({ pathname: '/room/[id]', params: { id } });
          return;
        }
        setGate(g);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof RoomsNotLiveError) router.replace('/join');
        else {
          setMessage(getErrorMessage(e, 'Could not open this room.'));
          setGate(null);
        }
      });
    fetchMyFriends()
      .then((f) => live && setFriendIds(new Set(f.map((x) => x.friend_id))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, router]);

  const submit = async (value: string) => {
    if (!id || value.length !== LEN || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await joinRoom(id, value);
      if (res.status === 'joined' || res.status === 'already_member') {
        router.replace({ pathname: '/room/[id]', params: { id } });
        return;
      }
      setMessage(joinRoomMessage(res) ?? 'That code did not work.');
      setCode('');
      input.current?.focus();
    } catch (e) {
      setMessage(getErrorMessage(e, 'Could not check that code.'));
    } finally {
      setBusy(false);
    }
  };

  const onChange = (t: string) => {
    const v = t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LEN);
    setCode(v);
    if (v.length === LEN) void submit(v);
  };

  const messagePerson = (p: RoomPerson) => {
    if (friendIds.has(p.user_id)) router.push({ pathname: '/dm/[friendId]', params: { friendId: p.user_id } });
    else router.push({ pathname: '/friend-profile', params: { userId: p.user_id } });
  };

  if (gate === undefined) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={Colors.navEmber} style={{ marginTop: Spacing.six }} />
      </SafeAreaView>
    );
  }

  const people = gate ? [gate.owner, ...gate.moderators].filter((p): p is RoomPerson => Boolean(p)) : [];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {gate?.room.name ?? 'Room'}
          </Text>
          <View style={{ width: 20 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {gate ? (
            <>
              <View style={styles.crest}>
                <Text style={styles.crestText}>{gate.room.emoji || '📚'}</Text>
              </View>
              <Text style={styles.name}>{gate.room.name}</Text>
              <Text style={styles.meta}>Private room · {gate.room.member_count} members · code required</Text>
            </>
          ) : (
            <Text style={styles.name}>Enter a room code</Text>
          )}

          <Text style={styles.prompt}>Enter the 6-character room code</Text>
          <Pressable style={styles.boxes} onPress={() => input.current?.focus()} accessibilityLabel="Room code">
            {Array.from({ length: LEN }).map((_, i) => (
              <View key={i} style={[styles.box, i === code.length && styles.boxActive]}>
                <Text style={styles.boxText}>{code[i] ?? ''}</Text>
              </View>
            ))}
          </Pressable>
          <TextInput
            ref={input}
            value={code}
            onChangeText={onChange}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={LEN}
            style={styles.hidden}
            accessibilityLabel="Room code"
          />
          {busy ? <ActivityIndicator color={Colors.navEmber} /> : null}
          {message ? <Text style={styles.error}>{message}</Text> : null}

          {people.length > 0 ? (
            <View style={styles.helpCard}>
              <Text style={styles.helpTitle}>Don’t have the code?</Text>
              <Text style={styles.helpBody}>This room is run by its members. Message the owner or a moderator to be let in.</Text>
              {people.map((p) => (
                <View key={p.user_id} style={styles.person}>
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.avatar} />
                  ) : (
                    <Avatar label={(p.display_name || '?').slice(0, 2).toUpperCase()} size={34} />
                  )}
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{p.display_name ?? 'Someone'}</Text>
                    <Text style={styles.personRole}>{p.role === 'owner' ? 'Owner' : 'Mod'}</Text>
                  </View>
                  <Pressable style={styles.msgBtn} onPress={() => messagePerson(p)} accessibilityRole="button" accessibilityLabel={`Message ${p.display_name}`}>
                    <Text style={styles.msgText}>Message</Text>
                  </Pressable>
                </View>
              ))}
              {gate?.owner ? (
                <Pressable style={styles.primary} onPress={() => messagePerson(gate.owner!)} accessibilityRole="button">
                  <Text style={styles.primaryText}>Message the owner</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.note}>Most rooms are open — code-gating is for private spaces like course chats.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: 10 },
  back: { fontSize: 28, color: Colors.ink, marginTop: -4 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  scroll: { alignItems: 'center', paddingHorizontal: Spacing.four, paddingBottom: Spacing.five, gap: 10 },
  crest: {
    marginTop: Spacing.three,
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestText: { fontSize: 36 },
  name: { fontFamily: Fonts.black, fontSize: 22, color: Colors.ink, textAlign: 'center' },
  meta: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.spaceDim },
  prompt: { marginTop: Spacing.three, fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.muted },
  boxes: { flexDirection: 'row', gap: 8 },
  box: {
    width: 44,
    height: 54,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1.5,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: Colors.navEmber },
  boxText: { fontFamily: Fonts.black, fontSize: 22, color: Colors.ink },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  error: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.danger, textAlign: 'center' },
  helpCard: {
    alignSelf: 'stretch',
    marginTop: Spacing.three,
    padding: 14,
    gap: 10,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  helpTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  helpBody: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 18, color: Colors.muted },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  personText: { flex: 1 },
  personName: { fontFamily: Fonts.bodyBold, fontSize: 13.5, color: Colors.ink },
  personRole: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.navEmber2 },
  msgBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: Colors.spaceLine },
  msgText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.ink },
  primary: { marginTop: 4, alignItems: 'center', paddingVertical: 12, borderRadius: 999, backgroundColor: Colors.navEmber },
  primaryText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.onEmber },
  note: { marginTop: Spacing.three, fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim, textAlign: 'center' },
});
