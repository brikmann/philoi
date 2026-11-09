import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchRoomGate, rotateRoomCode, setRoomChannels, setRoomPolicy, type RoomGate } from '@/lib/api/rooms';
import { getErrorMessage } from '@/lib/errors';

// MANAGE ROOM — owner + moderators only (0297). Who can join (Open / Code-gated), the room code
// (show, share, rotate), and the chat's channels. Roles are managed on the Members tab. Every
// action is enforced server-side; a member who deep-links here just gets bounced.

export default function ManageRoomScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [gate, setGate] = useState<RoomGate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const g = await fetchRoomGate(id);
      if (!g || (g.my_role !== 'owner' && g.my_role !== 'moderator')) {
        router.back();
        return;
      }
      setGate(g);
    } catch (e) {
      Alert.alert('Room', getErrorMessage(e, 'Could not load this room.'));
      router.back();
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('Room', getErrorMessage(e, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };

  if (!gate) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={Colors.navEmber} style={{ marginTop: Spacing.six }} />
      </SafeAreaView>
    );
  }

  const r = gate.room;
  const isCode = r.join_policy === 'code';

  const switchPolicy = (policy: 'open' | 'code') => {
    if (policy === r.join_policy) return;
    const msg =
      policy === 'code'
        ? 'Only people with the code can join. A fresh code is made now, and any old code stops working.'
        : 'Anyone can join in one tap, and anyone waiting on a request is let in.';
    Alert.alert(policy === 'code' ? 'Make this room code-gated?' : 'Open this room?', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: policy === 'code' ? 'Code-gate it' : 'Open it', onPress: () => void run('policy', () => setRoomPolicy(r.id, policy)) },
    ]);
  };

  const removeChannel = (c: string) =>
    void run(`ch:${c}`, () =>
      setRoomChannels(
        r.id,
        r.channels.filter((x) => x !== c)
      )
    );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Manage room</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Who can join</Text>
        <View style={styles.seg}>
          {(['open', 'code'] as const).map((p) => (
            <Pressable
              key={p}
              style={[styles.segBtn, r.join_policy === p && styles.segOn]}
              onPress={() => switchPolicy(p)}
              disabled={busy === 'policy'}
              accessibilityRole="button"
              accessibilityState={{ selected: r.join_policy === p }}>
              <Text style={[styles.segText, r.join_policy === p && styles.segTextOn]}>{p === 'open' ? 'Open' : 'Code-gated'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          {isCode
            ? 'Hidden from people who aren’t in it, except through its gate. Share the code with people who should be here.'
            : 'Most rooms are open. Code-gate private spaces like course chats.'}
        </Text>

        {gate.code ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Room code</Text>
            <Text style={styles.code}>{gate.code}</Text>
            <View style={styles.row}>
              <Pressable
                style={styles.btn}
                onPress={() => void Share.share({ message: `Join ${r.name} on Philoi with code ${gate.code}` })}
                accessibilityRole="button">
                <Text style={styles.btnText}>Share</Text>
              </Pressable>
              <Pressable
                style={styles.btn}
                disabled={busy === 'rotate'}
                onPress={() =>
                  Alert.alert('New code?', 'The current code stops working right away.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Make a new code', onPress: () => void run('rotate', () => rotateRoomCode(r.id)) },
                  ])
                }
                accessibilityRole="button">
                {busy === 'rotate' ? <ActivityIndicator size="small" color={Colors.ink} /> : <Text style={styles.btnText}>Rotate</Text>}
              </Pressable>
            </View>
          </View>
        ) : null}

        <Text style={styles.section}>Channels</Text>
        <View style={styles.card}>
          {r.channels.map((c) => (
            <View key={c} style={styles.chRow}>
              <Text style={styles.chName}># {c}</Text>
              {c !== 'general' ? (
                <Pressable onPress={() => removeChannel(c)} hitSlop={8} disabled={busy === `ch:${c}`} accessibilityRole="button" accessibilityLabel={`Remove # ${c}`}>
                  <Text style={styles.chRemove}>Remove</Text>
                </Pressable>
              ) : (
                <Text style={styles.chFixed}>always</Text>
              )}
            </View>
          ))}
          <View style={styles.addRow}>
            <TextInput
              value={newChannel}
              onChangeText={setNewChannel}
              placeholder="new-channel"
              placeholderTextColor={Colors.spaceDim}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
              style={styles.input}
            />
            <Pressable
              style={styles.btn}
              disabled={!newChannel.trim() || busy === 'add'}
              onPress={() =>
                void run('add', async () => {
                  await setRoomChannels(r.id, [...r.channels, newChannel]);
                  setNewChannel('');
                })
              }
              accessibilityRole="button">
              <Text style={styles.btnText}>Add</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={styles.link}
          onPress={() => router.push({ pathname: '/group/[groupId]/edit', params: { groupId: r.id } })}
          accessibilityRole="button">
          <Text style={styles.linkText}>Name, emoji & house rules ›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: 10 },
  back: { fontSize: 28, color: Colors.ink, marginTop: -4 },
  title: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },
  scroll: { padding: Spacing.three, gap: 10, paddingBottom: 80 },
  section: { marginTop: Spacing.two, fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  seg: { flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: Colors.spacePanel, borderWidth: 1, borderColor: Colors.spaceLine },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999 },
  segOn: { backgroundColor: Colors.navEmber },
  segText: { fontFamily: Fonts.bodyBold, fontSize: 13.5, color: Colors.muted },
  segTextOn: { color: Colors.onEmber },
  hint: { fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 17, color: Colors.spaceDim },
  card: { padding: 14, gap: 10, borderRadius: 16, backgroundColor: Colors.spacePanel, borderWidth: 1, borderColor: Colors.spaceLine },
  cardLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.spaceDim },
  code: { fontFamily: Fonts.black, fontSize: 30, letterSpacing: 6, color: Colors.gold },
  row: { flexDirection: 'row', gap: 8 },
  btn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: Colors.spacePanel2, borderWidth: 1, borderColor: Colors.spaceLine },
  btnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  chRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chName: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  chRemove: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.danger },
  chFixed: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel2,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  link: { paddingVertical: 14 },
  linkText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.navEmber2 },
});
