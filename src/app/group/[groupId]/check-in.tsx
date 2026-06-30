import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Share, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { postCheckIn } from '@/lib/api/check-ins';
import { fetchGroup, fetchInviteLink } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { useSparkSound } from '@/lib/sound';

export default function CheckInScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const celebrateScale = useSharedValue(0);
  const celebrateStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebrateScale.value }],
  }));
  const playSpark = useSparkSound();

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
      await postCheckIn({ groupId, userId: session.user.id, photoUri, caption });
      setPosted(true);
      playSpark();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    return (
      <Screen dark style={styles.celebrateContainer}>
        <Animated.Text style={[styles.celebrateEmoji, celebrateStyle]}>🔥</Animated.Text>
        <Text style={styles.celebrateText}>Logged. Your circle saw that.</Text>
        <Text style={styles.celebrateSubtext}>Streak +1</Text>

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
