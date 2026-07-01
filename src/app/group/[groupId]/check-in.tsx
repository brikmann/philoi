import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, Share, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';

import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { postCheckIn, type CheckInPhase } from '@/lib/api/check-ins';
import { fetchGroup, fetchInviteLink, fetchMyStreak } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { RewardTier } from '@/lib/sound';

// Round, meaningful streak lengths — anything else is just a regular "Spark" check-in.
const BLOOM_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

export default function CheckInScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<CheckInPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [tier, setTier] = useState<RewardTier>('spark');
  const [newStreak, setNewStreak] = useState(1);

  const celebrateScale = useSharedValue(0);
  const celebrateStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebrateScale.value }],
  }));
  const rewardBurstRef = useRef<RewardBurstHandle>(null);

  // <RewardBurst> only mounts once `posted` flips true (it's in the conditional branch
  // below), so firing it has to wait for that mount — calling ref.fire() right after
  // setPosted(true) in handlePost would hit a still-null ref, since state updates aren't
  // synchronous. Effects run after commit, so by here the ref is guaranteed to be set.
  useEffect(() => {
    if (posted) rewardBurstRef.current?.fire();
  }, [posted]);

  // Camera-only, deliberately — a library photo isn't proof you showed up today.
  async function takePhoto() {
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Philoi needs camera access to post a check-in photo.');
        return;
      }

      console.log('[check-in] launching camera...');
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      console.log('[check-in] camera result:', {
        canceled: result.canceled,
        assetCount: result.canceled ? 0 : result.assets.length,
      });

      if (result.canceled) return;
      if (!result.assets[0]) {
        setError('No photo came back from the camera — try again.');
        return;
      }
      setPhotoUri(result.assets[0].uri);
    } catch (e) {
      console.error('[check-in] camera failed:', e);
      setError(getErrorMessage(e, 'Could not open the camera.'));
    }
  }

  async function handlePost() {
    if (!photoUri || !session) {
      setError('Add a photo — proof, not claims.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const before = await fetchMyStreak(groupId, session.user.id).catch(() => ({
        current_streak: 0,
        longest_streak: 0,
      }));

      await postCheckIn({ groupId, userId: session.user.id, photoUri, caption, onPhaseChange: setPhase });

      // recompute_streak() already ran server-side by the time the insert above resolves
      // (same DB transaction) — re-fetch to see the post-check-in streak.
      const after = await fetchMyStreak(groupId, session.user.id).catch(() => ({
        current_streak: before.current_streak + 1,
        longest_streak: before.longest_streak,
      }));

      const resolvedTier: RewardTier =
        after.longest_streak > before.longest_streak
          ? 'surge'
          : BLOOM_MILESTONES.includes(after.current_streak)
            ? 'bloom'
            : 'spark';

      setTier(resolvedTier);
      setNewStreak(after.current_streak);
      setPosted(true);
      // eslint-disable-next-line react-hooks/immutability -- mutating .value is the documented Reanimated API
      celebrateScale.value = withSequence(withSpring(1.2), withSpring(1));

      // Highest-converting moment to grow the circle — no auto-dismiss timer here, the
      // user picks "Invite" or "Done" themselves.
      const group = await fetchGroup(groupId);
      const link = await fetchInviteLink(group.id, group.join_code);
      setInviteLink(link.deepLink);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not post your check-in.'));
    } finally {
      setLoading(false);
      setPhase(null);
    }
  }

  async function handleShareInvite() {
    if (!inviteLink) return;
    setSharing(true);
    try {
      track('invite_sent', { group_id: groupId, source: 'post_check_in' });
      await Share.share({ message: `I just locked in on Philoi 🔥 Join my circle and keep me honest: ${inviteLink}` });
    } finally {
      setSharing(false);
    }
  }

  if (posted) {
    const subtext =
      tier === 'surge'
        ? `New personal record — ${newStreak}-day streak 🎉`
        : tier === 'bloom'
          ? `${newStreak}-day streak milestone 🔥`
          : `Streak: ${newStreak}`;

    return (
      <Screen dark style={styles.celebrateContainer}>
        <RewardBurst ref={rewardBurstRef} tier={tier} />
        <Animated.Text style={[styles.celebrateEmoji, celebrateStyle]}>🔥</Animated.Text>
        <Text style={styles.celebrateText}>Logged. Your circle saw that.</Text>
        <Text style={styles.celebrateSubtext}>{subtext}</Text>

        <Text style={styles.inviteNudge}>Who&apos;s keeping you honest? Add them.</Text>
        <PrimaryButton label="Invite a friend" onPress={handleShareInvite} loading={sharing} disabled={!inviteLink} />
        <SecondaryButton label="Done" onPress={() => router.replace(`/group/${groupId}`)} onDark />
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      {photoUri ? (
        <Pressable onPress={() => setPhotoUri(null)}>
          <Image source={{ uri: photoUri }} style={styles.preview} />
        </Pressable>
      ) : (
        <Pressable style={styles.pickerOption} onPress={takePhoto}>
          <Text style={styles.pickerEmoji}>📸</Text>
          <Text style={styles.pickerLabel}>Take a photo</Text>
          <Text style={styles.pickerHint}>Proof, not claims — camera only.</Text>
        </Pressable>
      )}

      <TextInput
        placeholder="Add a caption (optional)"
        value={caption}
        onChangeText={setCaption}
        maxLength={140}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {phase && (
        <Text style={styles.uploadStatus}>{phase === 'uploading' ? 'Uploading photo…' : 'Locking in…'}</Text>
      )}

      <PrimaryButton label="Lock in" onPress={handlePost} loading={loading} disabled={!photoUri} />
      <SecondaryButton label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  pickerOption: {
    aspectRatio: 1,
    borderRadius: Radius.card,
    borderWidth: 2,
    borderColor: Colors.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  pickerEmoji: {
    fontSize: 40,
  },
  pickerLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    color: Colors.ink,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
  },
  pickerHint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.card,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
  uploadStatus: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textAlign: 'center',
    fontSize: 13,
  },
  celebrateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  celebrateEmoji: {
    fontSize: 72,
  },
  celebrateText: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.cream,
  },
  celebrateSubtext: {
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 16,
    color: Colors.ember,
  },
  inviteNudge: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.cream,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});
