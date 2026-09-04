import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProofClip } from '@/components/economy/proof-clip';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { fetchMyFriends, type Friend } from '@/lib/api/friends';
import { claimGoalComplete } from '@/lib/api/vouch';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FRAME B — "Who saw you do it?" (mock 176, CODE_PROMPT_honor_vouch.md §3)
//
// The second half of both paths out of frame A: with a clip attached, or without one. Either way
// what actually moves the band is the same thing — two friends who say yes inside 48 hours.
//
// WHY THE CAP IS TWO AND THE SCREEN SAYS SO WHEN YOU PICK ONE. The threshold is two DISTINCT
// counting vouches; picking one person cannot reach it on its own. Offering a third would imply it
// helps (it does not — two is the bar, and the same-pair and per-giver caps decide which of the
// answers count), and silently accepting one would let someone send an ask that arithmetically
// cannot succeed. So the cap is two and the button tells you when you are one short of a threshold
// rather than one short of a limit.
//
// 🔒 SUBMITTING IS THE POINT OF NO RETURN, and it is the only one. claim_goal_complete stamps
// claimed_at, and its own guard refuses a second claim on the same goal — so the confirm below is
// not decoration. Everything after this is other people's to decide.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const NEEDED = 2;

export default function VouchAskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ goalId: string; label?: string; tier?: string; proofPath?: string }>();
  const goalId = params.goalId;
  const label = params.label?.trim() || 'your goal';
  const proofPath = params.proofPath || null;

  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMyFriends()
      .then(setFriends)
      .catch(() => setFriends([]));
  }, []);

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : prev.length >= NEEDED ? prev : [...prev, id]
    );

  const send = async () => {
    setBusy(true);
    try {
      const res = await claimGoalComplete({ goalId, proofPath, voucherIds: picked });
      if (res.state === 'pending_vouch') {
        // Straight to frame C, and REPLACE rather than push: the picker is spent — a back-swipe
        // onto it would offer to send an ask that claim_goal_complete would now refuse.
        router.replace({ pathname: '/goal/pending/[goalId]', params: { goalId } });
      } else {
        // Nobody reachable was asked, so the server settled it at the honour band in that call.
        Alert.alert('Logged', 'Settled at the unverified tier — one band down.');
        router.back();
      }
    } catch (e) {
      Alert.alert('That did not go through', getErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const cta =
    picked.length === 0
      ? 'Pick someone who saw it'
      : `Send to ${picked.length} ${picked.length === 1 ? 'friend' : 'friends'}`;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Ask for a vouch', headerShown: true }} />

      <FlatList
        data={friends ?? []}
        keyExtractor={(f) => f.friend_id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.head}>
            <Text style={styles.title}>Who saw you do it?</Text>
            <Text style={styles.sub}>
              {/* Entities do not decode inside a template literal, so the curly quotes are literal. */}
              Pick {NEEDED} — they&apos;ll confirm you {label === 'your goal' ? 'did it' : `did “${label}”`}.
            </Text>
            {proofPath ? (
              <ProofClip path={proofPath} label={params.label ?? null} claimedAt={new Date().toISOString()} showCaption={false} />
            ) : null}
            {proofPath ? <Text style={styles.clipNote}>They&apos;ll see this clip with the ask.</Text> : null}
          </View>
        }
        renderItem={({ item }) => {
          const on = picked.includes(item.friend_id);
          const full = !on && picked.length >= NEEDED;
          return (
            <Pressable
              onPress={() => toggle(item.friend_id)}
              disabled={full || busy}
              style={[styles.row, on && styles.rowOn, full && styles.rowOff]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: full }}
              accessibilityLabel={item.display_name}>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.avatar} contentFit="cover" />
              ) : (
                <Avatar label={item.display_name} size={38} />
              )}
              <Text style={styles.name} numberOfLines={1}>
                {item.display_name}
              </Text>
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <Ionicons name="checkmark" size={13} color={Colors.onEmber} /> : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          friends == null ? (
            <ActivityIndicator style={styles.loading} color={Colors.amber} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={26} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>
                No friends to ask yet. Add someone first, or go back and claim it unverified.
              </Text>
            </View>
          )
        }
      />

      <View style={styles.footer}>
        {/* Said before the send, not after: one friend is a real choice, it just cannot reach the
            bar on its own, and someone should know that while they can still add a second. */}
        {picked.length === 1 ? (
          <Text style={styles.warn}>
            One vouch won&apos;t reach the full crate on its own — {NEEDED} are needed. You keep the unverified
            tier either way.
          </Text>
        ) : null}
        <PrimaryButton label={cta} onPress={send} loading={busy} disabled={busy || picked.length === 0} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four },
  head: { alignItems: 'center', gap: 4, paddingTop: Spacing.three, paddingBottom: Spacing.three },
  title: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink, textAlign: 'center' },
  sub: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted, textAlign: 'center' },
  clipNote: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 13,
    padding: 10,
    marginBottom: 9,
  },
  rowOn: { borderColor: '#A06CD5', backgroundColor: 'rgba(160,108,213,0.12)' },
  rowOff: { opacity: 0.4 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.disabled },
  name: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 13.5, color: Colors.ink },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: '#A06CD5', borderColor: '#A06CD5' },
  loading: { marginTop: Spacing.six },
  empty: { alignItems: 'center', gap: 9, paddingTop: Spacing.six, paddingHorizontal: Spacing.four },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  warn: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
