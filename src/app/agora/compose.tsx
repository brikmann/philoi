import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AgoraAchievementPicker,
  AgoraLockInPicker,
  type AchievementChoice,
} from '@/components/agora/agora-pickers';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { AGORA_VISIBILITIES, createAgoraPost } from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { shortSchoolName } from '@/lib/universities';
import type { AgoraVisibility } from '@/types/database';

// Mock 162 panel 2 — "The post screen. Write freely (like FB / LinkedIn); the three icons are
// media you attach."
//
// The attachment is sent as an IDENTITY (kind + ref id or key), never as text. `create_agora_post`
// re-reads the fact from the table that owns it and freezes the snapshot server-side. The label
// held in state here is only for the chip below — nothing typed on this screen can end up being
// what the card claims.

const MAX = 1000;

export default function AgoraComposeScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  const [body, setBody] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [attach, setAttach] = useState<AchievementChoice | null>(null);
  const [picker, setPicker] = useState<'achievement' | 'lockin' | null>(null);
  const [posting, setPosting] = useState(false);

  // Campus is the sensible default audience (see migration 0128), but it resolves to NOBODY for an
  // account with no university set — can_see_agora needs a non-null match on both sides. Rather
  // than let someone post into a void, the picker disables it and this opens on Global instead.
  const hasCampus = Boolean(profile?.university);
  const [visibility, setVisibility] = useState<AgoraVisibility>(hasCampus ? 'campus' : 'public');

  const canPost = Boolean(body.trim() || photoUri || attach) && !posting;

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Philoi needs photo access to attach an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUri(result.assets[0].uri);
  }

  async function post() {
    if (!canPost || !profile) return;
    setPosting(true);
    try {
      await createAgoraPost({
        body,
        photoUri,
        userId: profile.id,
        visibility,
        attach: attach ? { kind: attach.kind, refId: attach.refId, key: attach.key } : null,
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not post', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setPosting(false);
    }
  }

  function choose(choice: AchievementChoice) {
    setAttach(choice);
    setPicker(null);
    // One attachment per post. A card that stacked a relic, a lock-in and a photo is a collage,
    // not the single clear claim the feed is built to carry.
    setPhotoUri(null);
  }

  const audience = AGORA_VISIBILITIES.find((v) => v.key === visibility);

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.topTitle}>New post</Text>
          <Pressable
            onPress={post}
            disabled={!canPost}
            style={[styles.postBtn, !canPost && styles.postBtnOff]}
            accessibilityRole="button"
            accessibilityLabel="Post">
            {posting ? (
              <ActivityIndicator size="small" color={Colors.onEmber} />
            ) : (
              <Text style={[styles.postBtnText, !canPost && styles.postBtnTextOff]}>Post</Text>
            )}
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.identity}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>
                    {(profile?.display_name ?? '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.identityText}>
                <Text style={styles.name}>{profile?.display_name ?? 'You'}</Text>
                <View style={styles.audienceRow}>
                  {AGORA_VISIBILITIES.map((v) => {
                    const disabled = v.key === 'campus' && !hasCampus;
                    const on = visibility === v.key;
                    return (
                      <Pressable
                        key={v.key}
                        disabled={disabled}
                        onPress={() => setVisibility(v.key)}
                        style={[styles.aud, on && styles.audOn, disabled && styles.audOff]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled }}>
                        <Text style={[styles.audText, on && styles.audTextOn]}>
                          {v.key === 'campus' && profile?.university
                            ? shortSchoolName(profile.university)
                            : v.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.audienceHint}>
                  {hasCampus || visibility !== 'public'
                    ? (audience?.hint ?? '')
                    : 'Set your university in your profile to post to your campus.'}
                </Text>
              </View>
            </View>

            <TextInput
              style={styles.input}
              value={body}
              onChangeText={(t) => setBody(t.slice(0, MAX))}
              placeholder="Share a win, a thought, what you're locking in on…"
              placeholderTextColor={Colors.textTertiary}
              multiline
              autoFocus
              maxLength={MAX}
              accessibilityLabel="Post text"
            />

            {photoUri ? (
              <View style={styles.preview}>
                <Image source={{ uri: photoUri }} style={styles.previewImage} contentFit="cover" />
                <Pressable
                  style={styles.previewClear}
                  onPress={() => setPhotoUri(null)}
                  accessibilityLabel="Remove photo">
                  <Ionicons name="close" size={15} color={Colors.ink} />
                </Pressable>
              </View>
            ) : null}

            {attach ? (
              <View style={styles.attachChip}>
                <Ionicons name="trophy-outline" size={15} color={Colors.amber} />
                <Text style={styles.attachChipText} numberOfLines={1}>
                  {attach.label}
                </Text>
                <Pressable onPress={() => setAttach(null)} hitSlop={8} accessibilityLabel="Remove attachment">
                  <Ionicons name="close" size={15} color={Colors.textTertiary} />
                </Pressable>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.attachBar}>
            <Text style={styles.attachLabel}>Add to your post</Text>
            <View style={styles.attachRow}>
              <AttachButton
                icon="image-outline"
                label="Photo"
                // Mutually exclusive with an achievement, same reason `choose` clears the photo.
                onPress={() => {
                  setAttach(null);
                  void pickPhoto();
                }}
              />
              <AttachButton
                icon="trophy-outline"
                label="Achievement"
                onPress={() => setPicker('achievement')}
              />
              <AttachButton
                icon="lock-closed-outline"
                label="Lock-in"
                onPress={() => setPicker('lockin')}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <AgoraAchievementPicker
        visible={picker === 'achievement'}
        onClose={() => setPicker(null)}
        onPick={choose}
      />
      <AgoraLockInPicker visible={picker === 'lockin'} onClose={() => setPicker(null)} onPick={choose} />
    </ScreenBackground>
  );
}

function AttachButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.attachBtn} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={21} color={Colors.amber} />
      <Text style={styles.attachBtnLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  cancel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  topTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  postBtn: {
    minWidth: 62,
    alignItems: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: Colors.amber,
  },
  postBtnOff: {
    backgroundColor: Colors.disabledSurface,
  },
  postBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.onEmber,
  },
  postBtnTextOff: {
    color: Colors.disabledText,
  },
  scroll: {
    padding: Spacing.three,
    paddingBottom: Spacing.five,
  },
  identity: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFallback: {
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  identityText: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  audienceRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 5,
  },
  aud: {
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  audOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.amber,
  },
  audOff: {
    opacity: 0.4,
  },
  audText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.muted,
  },
  audTextOn: {
    color: Colors.ember,
  },
  audienceHint: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  input: {
    minHeight: 130,
    marginTop: Spacing.three,
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.ink,
    textAlignVertical: 'top',
  },
  preview: {
    marginTop: Spacing.two,
  },
  previewImage: {
    height: 200,
    borderRadius: Radius.card,
    backgroundColor: Colors.disabled,
  },
  previewClear: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(6,5,10,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 7,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  attachChipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  attachBar: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    paddingHorizontal: Spacing.twelve,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.three,
  },
  attachLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.textTertiary,
    paddingHorizontal: 6,
    paddingBottom: Spacing.two,
  },
  attachRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  attachBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    borderRadius: 13,
    paddingVertical: 11,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  attachBtnLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.ink,
  },
});
