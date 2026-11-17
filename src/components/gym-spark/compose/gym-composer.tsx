import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

import { AgoraLockInPicker, type AchievementChoice } from '@/components/agora/agora-pickers';
import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { announceAgoraPost } from '@/lib/agora-just-posted';
import { createAgoraPost } from '@/lib/api/agora';
import {
  AGORA_VIDEO_MAX_SECONDS,
  AgoraVideoLimitError,
  formatClipLength,
  prepareAgoraVideo,
  uploadAgoraVideo,
  type PreparedAgoraVideo,
} from '@/lib/api/agora-video';
import { setAgoraPostPr } from '@/lib/api/gym-spark';
import { markSharedPost } from '@/lib/api/shared-post';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { ComposeShareParams } from '@/lib/share-intake';
import { isPostableLink } from '@/lib/share-link';
import type { AgoraAttachInput } from '@/types/database';

// THE GYM SPARK composer (mock 401, CODE_PROMPT_gym_spark.md §2). Photo, caption, two chips, Post.
// The bar is "under 20 seconds": nothing is required beyond the post not being totally empty, and
// there is no audience picker — every spark post is `visibility: 'public'`, which is what puts it in
// every member's gym feed (get_gym_feed reads the global scope, gated by visibility).
//
//   • Attach PR      — a toggle. After the post exists, set_agora_post_pr (0301) flags it. If that
//                      second call fails the post is NOT lost: a quiet note, then close anyway.
//   • Attach session — the same AgoraLockInPicker the full composer uses, attached as the same
//                      `lockin` kind (identity only; the server freezes the snapshot).
//   • Tag gym        — a stub: one tap shows "coming soon", nothing else.
//
// Shared-in content (0294's ?source=share) still prefills: text → caption, a photo → the photo slot,
// a link → a `link` attachment, a clip → the video slot. Rooms / forests stay the full composer's.
//
// VIDEO (0279's pipeline, same as the full composer): one clip ≤ 60s, recorded or picked, compressed
// + postered on-device, PUT to R2 on Post, then sent as `{kind: 'video', key}`. Every spark post is
// public, so a clip still confirms once on Post — a video never goes public silently.

const MAX = 1000;

export function GymComposer() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<Partial<ComposeShareParams>>();
  const shared = params.source === 'share';
  const sharedIsVideo = Boolean(shared && params.sharedUri && params.sharedMime?.startsWith('video/'));
  const sharedPhoto = shared && params.sharedUri && !sharedIsVideo ? params.sharedUri : null;

  const [body, setBody] = useState(() => (shared ? (params.sharedText ?? '').slice(0, MAX) : ''));
  const [photoUri, setPhotoUri] = useState<string | null>(sharedPhoto);
  const [link, setLink] = useState<string | null>(() =>
    shared && params.sharedUrl && isPostableLink(params.sharedUrl) ? params.sharedUrl : null
  );
  const [isPr, setIsPr] = useState(false);
  const [session, setSession] = useState<AchievementChoice | null>(null);
  const [sessionPicker, setSessionPicker] = useState(false);
  const [tagHint, setTagHint] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The video slot. `preparing` = compress + poster (0…1); `uploading` = the PUT on Post (0…1).
  // videoRun drops a stale prepare when the clip is replaced or removed mid-encode.
  const [video, setVideo] = useState<PreparedAgoraVideo | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const videoRun = useRef(0);
  const sharedVideoRun = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const canPost =
    Boolean(body.trim() || photoUri || session || link || video) && preparing === null && !posting && note === null;

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Philoi needs photo access to attach an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUri(result.assets[0].uri);
  }

  function chooseVideoSource() {
    // Exactly three buttons: Android's Alert silently drops a fourth.
    Alert.alert('Add a video', `Up to ${AGORA_VIDEO_MAX_SECONDS} seconds.`, [
      { text: 'Record', onPress: () => void pickVideo('camera') },
      { text: 'Choose from library', onPress: () => void pickVideo('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickVideo(from: 'camera' | 'library') {
    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        from === 'camera' ? 'Camera access needed' : 'Video access needed',
        from === 'camera'
          ? 'Philoi needs camera access to record a video for your post.'
          : 'Philoi needs library access to attach a video.'
      );
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      videoMaxDuration: AGORA_VIDEO_MAX_SECONDS,
      // iOS: the system editor, which trims to videoMaxDuration. Android ignores it for video.
      allowsEditing: Platform.OS === 'ios',
    };
    const result =
      from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    await prepareVideo(asset.uri, asset.duration);
  }

  async function prepareVideo(uri: string, durationMs?: number | null, fromShare = false): Promise<void> {
    const run = (videoRun.current += 1);
    sharedVideoRun.current = fromShare ? run : null;
    setVideo(null);
    setPreparing(0);
    try {
      const prepared = await prepareAgoraVideo({ uri, durationMs }, (p) => {
        if (run === videoRun.current) setPreparing(p);
      });
      if (run === videoRun.current) setVideo(prepared);
    } catch (e) {
      if (run !== videoRun.current) return;
      Alert.alert(
        e instanceof AgoraVideoLimitError ? 'Video too long' : 'Could not use that video',
        e instanceof AgoraVideoLimitError ? e.message : getErrorMessage(e, 'Try a different clip.')
      );
    } finally {
      if (run === videoRun.current) setPreparing(null);
    }
  }

  function removeVideo() {
    videoRun.current += 1;
    sharedVideoRun.current = null;
    setVideo(null);
    setPreparing(null);
  }

  useEffect(() => {
    if (sharedIsVideo && params.sharedUri) void prepareVideo(params.sharedUri, null, true);
    // Once, on open: the shared clip is the intake, not a live param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseSession(choice: AchievementChoice) {
    setSession(choice);
    setSessionPicker(false);
  }

  function post() {
    if (!canPost || !profile) return;
    // Spark posts are always public, so a clip confirms once — it never goes public silently.
    if (video) {
      Alert.alert('Post this video to the gym feed?', 'Posts here are public — anyone on Philoi can watch it.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Post', onPress: () => void send() },
      ]);
      return;
    }
    void send();
  }

  async function send() {
    if (!profile) return;
    setPosting(true);
    setError(null);
    let postId: string;
    try {
      const attachments: AgoraAttachInput[] = [];
      if (session) attachments.push({ kind: session.kind, ref_id: session.refId, key: session.key });
      if (video) {
        setUploading(0);
        const key = await uploadAgoraVideo(video, setUploading);
        attachments.push({ kind: 'video', ref_id: null, key });
      }
      if (link) attachments.push({ kind: 'link', ref_id: null, key: link });
      postId = await createAgoraPost({ body, photoUri, userId: profile.id, visibility: 'public', attachments });
    } catch (e) {
      setError(getErrorMessage(e, 'Could not post. Try again.'));
      setPosting(false);
      setUploading(null);
      return;
    }
    setUploading(null);
    announceAgoraPost({ id: postId, itemType: 'post' });
    // Best-effort extras: the post exists now, so neither of these may cost it.
    const sharedVideoKept =
      video !== null && sharedVideoRun.current !== null && sharedVideoRun.current === videoRun.current;
    if ((sharedPhoto !== null && photoUri === sharedPhoto) || sharedVideoKept) {
      try {
        await markSharedPost(postId);
      } catch {
        // Only the "from your story" tag is lost.
      }
    }
    if (isPr) {
      try {
        await setAgoraPostPr(postId, true);
      } catch {
        setPosting(false);
        setNote('Posted — the PR tag didn’t stick. You can try again later.');
        closeTimer.current = setTimeout(leave, 1600);
        return;
      }
    }
    setPosting(false);
    leave();
  }

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.topBar}>
          <Pressable onPress={leave} hitSlop={10} accessibilityRole="button" disabled={posting}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.topTitle}>New post</Text>
          <Pressable
            onPress={post}
            disabled={!canPost}
            accessibilityRole="button"
            accessibilityLabel="Post"
            accessibilityState={{ disabled: !canPost, busy: posting }}>
            {canPost || posting ? (
              <LinearGradient
                colors={[Colors.navEmber, Colors.gold]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.postBtn}>
                {posting ? (
                  <ActivityIndicator size="small" color={Colors.onEmber} />
                ) : (
                  <Text style={styles.postBtnText}>Post</Text>
                )}
              </LinearGradient>
            ) : (
              <View style={[styles.postBtn, styles.postBtnOff]}>
                <Text style={[styles.postBtnText, styles.postBtnTextOff]}>Post</Text>
              </View>
            )}
          </Pressable>
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.photoRow}>
              {photoUri ? (
                <View style={styles.tile}>
                  <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <Pressable
                    style={styles.tileClear}
                    onPress={() => setPhotoUri(null)}
                    hitSlop={6}
                    disabled={posting}
                    accessibilityLabel="Remove photo">
                    <Ionicons name="close" size={14} color={Colors.ink} />
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                style={[styles.tile, styles.addTile]}
                onPress={() => void pickPhoto()}
                disabled={posting}
                accessibilityRole="button"
                accessibilityLabel={photoUri ? 'Replace photo' : 'Add a photo'}>
                <Ionicons name="image-outline" size={26} color={Colors.textTertiary} />
                <Text style={styles.addLabel}>{photoUri ? 'Replace' : 'Photo'}</Text>
              </Pressable>

              {video || preparing !== null ? (
                <View style={styles.tile}>
                  {video ? (
                    <Image source={{ uri: video.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, styles.tilePreparing]}>
                      <ActivityIndicator color={Colors.navEmber2} />
                      <Text style={styles.tilePreparingText}>{Math.round((preparing ?? 0) * 100)}%</Text>
                    </View>
                  )}
                  {video ? (
                    <View style={styles.tileLength}>
                      <Ionicons name="play" size={9} color={Colors.ink} />
                      <Text style={styles.tileLengthText}>{formatClipLength(video.durationS)}</Text>
                    </View>
                  ) : null}
                  {posting && uploading !== null ? (
                    <View style={styles.uploadTrack}>
                      <View style={[styles.uploadFill, { width: `${Math.round(uploading * 100)}%` }]} />
                    </View>
                  ) : null}
                  <Pressable
                    style={styles.tileClear}
                    onPress={removeVideo}
                    hitSlop={6}
                    disabled={posting}
                    accessibilityLabel="Remove video">
                    <Ionicons name="close" size={14} color={Colors.ink} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[styles.tile, styles.addTile]}
                  onPress={chooseVideoSource}
                  disabled={posting}
                  accessibilityRole="button"
                  accessibilityLabel="Add a video">
                  <Ionicons name="videocam-outline" size={26} color={Colors.textTertiary} />
                  <Text style={styles.addLabel}>Video</Text>
                </Pressable>
              )}
            </View>

            <TextInput
              style={styles.input}
              value={body}
              onChangeText={(t) => setBody(t.slice(0, MAX))}
              placeholder="What moved today?"
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={MAX}
              editable={!posting}
              accessibilityLabel="Caption"
            />

            <View style={styles.chips}>
              <Chip icon="dumbbell" label="Attach PR" on={isPr} onPress={() => setIsPr((v) => !v)} />
              <Chip
                icon="session"
                label={session ? session.label : 'Attach session'}
                on={Boolean(session)}
                onPress={() => setSessionPicker(true)}
                onClear={session ? () => setSession(null) : undefined}
              />
              <Chip icon="plus" label="Tag gym" on={false} onPress={() => setTagHint(true)} />
              {link ? (
                <Chip icon="photo" label="Shared link" on onPress={() => {}} onClear={() => setLink(null)} />
              ) : null}
            </View>
            {tagHint ? <Text style={styles.hint}>Gym tags are coming soon.</Text> : null}

            <View style={styles.info}>
              <Ionicons name="chatbox-outline" size={20} color={Colors.ink} />
              <Text style={styles.infoTitle} numberOfLines={1}>
                Posting to The gym feed
              </Text>
              <Text style={styles.infoSub} numberOfLines={1}>
                Public to your gym
              </Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {note ? <Text style={styles.hint}>{note}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <AgoraLockInPicker visible={sessionPicker} onClose={() => setSessionPicker(false)} onPick={chooseSession} />
    </ScreenBackground>
  );
}

function Chip({
  icon,
  label,
  on,
  onPress,
  onClear,
}: {
  icon: NavGlyphName;
  label: string;
  on: boolean;
  onPress: () => void;
  onClear?: () => void;
}) {
  const inner = (
    <>
      <NavGlyph name={icon} size={15} color={on ? Colors.onEmber : Colors.navEmber2} />
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
      {onClear ? (
        <Pressable onPress={onClear} hitSlop={8} accessibilityLabel={`Remove ${label}`}>
          <Ionicons name="close" size={14} color={on ? Colors.onEmber : Colors.textTertiary} />
        </Pressable>
      ) : null}
    </>
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}>
      {on ? (
        <LinearGradient
          colors={[Colors.navEmber, Colors.gold]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.chip, styles.chipOn]}>
          {inner}
        </LinearGradient>
      ) : (
        <View style={styles.chip}>{inner}</View>
      )}
    </Pressable>
  );
}

const TILE = 104;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
  },
  cancel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.muted,
  },
  topTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  postBtn: {
    minWidth: 70,
    alignItems: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  postBtnOff: {
    backgroundColor: Colors.disabledSurface,
  },
  postBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.onEmber,
  },
  postBtnTextOff: {
    color: Colors.disabledText,
  },
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  photoRow: {
    flexDirection: 'row',
    gap: Spacing.twelve,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel,
  },
  addTile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.spaceLine,
  },
  addLabel: {
    marginTop: 4,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  tilePreparing: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tilePreparingText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  tileLength: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(6,5,10,0.65)',
  },
  tileLengthText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.ink,
  },
  uploadTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(6,5,10,0.5)',
  },
  uploadFill: {
    height: 4,
    backgroundColor: Colors.navEmber2,
  },
  tileClear: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,5,10,0.65)',
  },
  input: {
    minHeight: 96,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
    paddingHorizontal: Spacing.twelve,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.twelve,
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.ink,
    textAlignVertical: 'top',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: {
    borderColor: 'transparent',
  },
  chipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  chipTextOn: {
    color: Colors.onEmber,
  },
  hint: {
    marginTop: -Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  infoTitle: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  infoSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  error: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.coral,
  },
});
