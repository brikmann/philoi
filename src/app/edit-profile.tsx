import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { SpaceButton, SpaceCard, SPACE_GUTTER } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { updateProfile, uploadAvatar } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

export default function EditProfileScreen() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [university, setUniversity] = useState(profile?.university ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url ?? null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePickAvatar() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Philoi needs photo access to update your avatar.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0] || !session) return;

    setUploadingAvatar(true);
    try {
      const url = await uploadAvatar(session.user.id, result.assets[0].uri);
      setAvatarUri(url);
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not upload your photo — try again.'));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile(session.user.id, { handle, university });
      await refreshProfile();
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your profile.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      <Stack.Screen options={{ title: 'Edit profile' }} />

      <Pressable
        onPress={handlePickAvatar}
        style={styles.avatarPicker}
        disabled={uploadingAvatar}
        accessibilityLabel="Change profile photo"
        accessibilityRole="button">
        {/* Gold ring — the avatar is identity, and gold is the identity colour. */}
        <View style={styles.avatarRing}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{profile?.display_name?.charAt(0).toUpperCase() ?? '?'}</Text>
            </View>
          )}
          <View style={styles.avatarBadge}>
            <UiGlyph name="edit" size={13} color="#2A0F05" />
          </View>
        </View>
        <Text style={styles.avatarLabel}>{uploadingAvatar ? 'Uploading…' : 'Change photo'}</Text>
      </Pressable>

      <SpaceCard style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Handle</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g. jordan23"
            value={handle}
            onChangeText={setHandle}
            maxLength={20}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>School (optional)</Text>
          <TextInput
            autoCapitalize="words"
            placeholder="e.g. Wilfrid Laurier University"
            value={university}
            onChangeText={setUniversity}
            maxLength={80}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </SpaceCard>

      <SpaceButton label="Save changes" onPress={handleSave} loading={saving} disabled={uploadingAvatar} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.four,
    paddingTop: Spacing.four,
    paddingHorizontal: SPACE_GUTTER,
  },
  avatarPicker: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatarRing: {
    padding: 3,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  avatarFallback: {
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: Colors.ink,
    fontFamily: Fonts.black,
    fontSize: 32,
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.navEmber,
    borderWidth: 2,
    borderColor: Colors.spaceBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.navEmber2,
    fontSize: 13,
  },
  form: {
    gap: Spacing.three,
  },
  field: {
    gap: 6,
  },
  // SpaceSection's uppercase label, inline over its field.
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
  },
});
