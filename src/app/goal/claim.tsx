import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScopedRewardTease } from '@/components/cindy/scoped-reward-tease';
import { Screen } from '@/components/ui/screen';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { campfirePhotoUrl } from '@/lib/api/messages';
import { claimGoalComplete, pickAndUploadProof } from '@/lib/api/vouch';
import { fetchMyFriends, type Friend } from '@/lib/api/friends';
import type { DifficultyTier } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// "DID YOU LAND IT?" — the honour path's only input screen (CODE_PROMPT §B, migration 0164).
//
// This is one of the two screens in the whole loop that was never mocked, so the shape is argued
// rather than transcribed:
//
// THE STAKES ARE ON THE SCREEN, NOT IN A HELP ARTICLE. A described feat pays one band down unless
// it is proven, and a user who discovers that AFTER claiming has been surprised by a rule that was
// working exactly as designed. So the trade is stated in the same view as the buttons, in the
// concrete terms of this goal's own tier — "unverified pays The Furnace instead of the Vessel of
// Hestia" is a real sentence a person can act on; "verification affects rewards" is not.
//
// TWO ROUTES OUT, AND A THIRD THAT IS NOT A TRAP. Proof and vouches both reach the full band.
// Claiming with neither is offered plainly rather than hidden behind a scare — it settles at the
// honour band, which is what the goal has been worth since it was scoped, and pretending otherwise
// would make the screen feel like a toll booth. The button says what it pays.
//
// 🔒 NOTHING HERE DECIDES ANYTHING. The level, the completion and the payout are all
// claim_goal_complete's; this screen carries an intent and at most a file path.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export default function GoalClaimScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ goalId: string; label?: string; tier?: string }>();
  const goalId = params.goalId;
  const tier = (params.tier as DifficultyTier | undefined) ?? null;

  const [friends, setFriends] = useState<Friend[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchMyFriends()
      .then(setFriends)
      .catch(() => {
        // The vouch route degrades to "no friends to ask" rather than breaking the claim.
      });
  }, []);

  const addProof = async () => {
    if (!session) return;
    setUploading(true);
    try {
      const path = await pickAndUploadProof(session.user.id);
      if (path) {
        setProofPath(path);
        // The PUBLIC URL, not the storage key. `path` is what the RPC wants (it checks the
        // own-id prefix); an <Image> given a bare bucket key renders nothing at all.
        setProofPreview(campfirePhotoUrl(path));
      }
    } catch (e) {
      Alert.alert('Could not attach that', getErrorMessage(e, 'The upload did not go through.'));
    } finally {
      setUploading(false);
    }
  };

  const toggleFriend = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : prev.length >= 2 ? prev : [...prev, id]));

  const submit = async () => {
    setBusy(true);
    try {
      const res = await claimGoalComplete({ goalId, proofPath, voucherIds: picked });
      // Three outcomes, three different things worth saying. A generic "done" would hide the one
      // that matters most — that a pending claim has not paid yet and is waiting on someone.
      if (res.state === 'pending_vouch') {
        Alert.alert(
          'Asked',
          `${res.asked} ${res.asked === 1 ? 'friend has' : 'friends have'} 48 hours to confirm it. Your reward goes up the moment two do.`
        );
      } else if (res.level === 'vouched') {
        Alert.alert('Logged with proof', 'That one pays its full tier.');
      } else {
        Alert.alert('Logged', 'Settled at the unverified tier — one band down.');
      }
      router.back();
    } catch (e) {
      Alert.alert('That did not go through', getErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  // The button says what it will actually do, because the three paths pay differently and the
  // difference is the entire point of the screen.
  const verb = proofPath
    ? 'Log it with proof'
    : picked.length > 0
      ? `Ask ${picked.length} ${picked.length === 1 ? 'friend' : 'friends'} to vouch`
      : 'Log it unverified';

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Mark complete', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>DID YOU LAND IT?</Text>
        <Text style={styles.goal}>{params.label ?? 'Your goal'}</Text>

        {/* The server's own figure for this tier — the same component the create-time tease uses,
            so what the reward screen later shows is the number they were promised here. */}
        {tier ? <ScopedRewardTease tier={tier} rationale={null} /> : null}

        {/* ── proof ── */}
        <Text style={styles.section}>Add proof</Text>
        <Text style={styles.hint}>A photo or a clip. Nobody reviews it — it just means there is something to point at.</Text>
        {proofPreview ? (
          <View style={styles.proofRow}>
            <Image source={{ uri: proofPreview }} style={styles.proofThumb} contentFit="cover" />
            <Text style={styles.proofOk}>Attached — this pays the full tier</Text>
            <Pressable onPress={() => { setProofPath(null); setProofPreview(null); }} accessibilityLabel="Remove proof">
              <Ionicons name="close-circle" size={20} color={Colors.textTertiary} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.proofBtn} onPress={addProof} disabled={uploading} accessibilityRole="button">
            {uploading ? (
              <ActivityIndicator size="small" color={Colors.amber} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={17} color={Colors.amber} />
                <Text style={styles.proofBtnLabel}>Attach a photo or clip</Text>
              </>
            )}
          </Pressable>
        )}

        {/* ── or vouches ── */}
        <Text style={styles.section}>…or ask friends to vouch</Text>
        <Text style={styles.hint}>Two friends confirming unlocks the same full tier. They have 48 hours.</Text>
        {friends.length === 0 ? (
          <Text style={styles.empty}>No friends to ask yet.</Text>
        ) : (
          <View style={styles.friendWrap}>
            {friends.map((f) => {
              const on = picked.includes(f.friend_id);
              // Capped at two because two is the threshold: offering a third implies it helps.
              const full = !on && picked.length >= 2;
              return (
                <Pressable
                  key={f.friend_id}
                  onPress={() => toggleFriend(f.friend_id)}
                  disabled={full}
                  style={[styles.friend, on && styles.friendOn, full && styles.friendOff]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}>
                  <Text style={[styles.friendName, on && styles.friendNameOn]} numberOfLines={1}>
                    {f.display_name}
                  </Text>
                  {on && <Ionicons name="checkmark" size={13} color={Colors.onEmber} />}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* The rule, in this goal's own terms, next to the button that applies it. */}
        <View style={styles.stakes}>
          <Ionicons name="information-circle-outline" size={15} color={Colors.textTertiary} />
          <Text style={styles.stakesText}>
            Proof or a friend&apos;s vouch unlocks the full crate. No proof pays one tier down — and it can never
            go below that, whatever anyone says.
          </Text>
        </View>

        <PrimaryButton label={verb} onPress={submit} loading={busy} disabled={busy || uploading} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.six },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: Colors.textTertiary,
  },
  goal: { fontFamily: Fonts.bodyBold, fontSize: 22, color: Colors.ink, marginBottom: Spacing.two },
  section: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink, marginTop: Spacing.three },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, lineHeight: 17 },
  empty: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary, paddingVertical: Spacing.two },
  proofBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.amber,
    backgroundColor: 'rgba(242,163,60,0.07)',
    marginTop: Spacing.two,
  },
  proofBtnLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.amber },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: Spacing.two,
    padding: 8,
    borderRadius: Radius.card,
    backgroundColor: Colors.cardDark,
  },
  proofThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.3)' },
  proofOk: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.green },
  friendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: Spacing.two },
  friend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.cardDark,
  },
  friendOn: { backgroundColor: Colors.coral, borderColor: Colors.coral },
  friendOff: { opacity: 0.35 },
  friendName: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink, maxWidth: 140 },
  friendNameOn: { fontFamily: Fonts.bodySemiBold, color: Colors.onEmber },
  stakes: {
    flexDirection: 'row',
    gap: 8,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  stakesText: { flex: 1, fontFamily: Fonts.body, fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary },
});
