import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { postCheckIn } from '@/lib/api/check-ins';
import { useAuth } from '@/lib/auth/auth-context';

export default function CheckInScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const celebrateScale = useSharedValue(0);
  const celebrateStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebrateScale.value }],
  }));

  async function pickFrom(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Philoi needs that permission to post a check-in photo.');
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setError(null);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // eslint-disable-next-line react-hooks/immutability -- mutating .value is the documented Reanimated API
      celebrateScale.value = withSequence(withSpring(1.2), withSpring(1));
      setTimeout(() => router.replace(`/group/${groupId}`), 1100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post your check-in.');
    } finally {
      setLoading(false);
    }
  }

  if (posted) {
    return (
      <Screen dark style={styles.celebrateContainer}>
        <Animated.Text style={[styles.celebrateEmoji, celebrateStyle]}>🔥</Animated.Text>
        <Text style={styles.celebrateText}>Logged. Your circle saw that.</Text>
        <Text style={styles.celebrateSubtext}>Streak +1</Text>
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
        <View style={styles.pickerRow}>
          <Pressable style={styles.pickerOption} onPress={() => pickFrom('camera')}>
            <Text style={styles.pickerEmoji}>📸</Text>
            <Text style={styles.pickerLabel}>Take a photo</Text>
          </Pressable>
          <Pressable style={styles.pickerOption} onPress={() => pickFrom('library')}>
            <Text style={styles.pickerEmoji}>🖼️</Text>
            <Text style={styles.pickerLabel}>Choose from library</Text>
          </Pressable>
        </View>
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
  pickerRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  pickerOption: {
    flex: 1,
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
    fontSize: 32,
  },
  pickerLabel: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
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
});
