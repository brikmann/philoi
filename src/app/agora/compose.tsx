import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { AGORA_VIDEO_ENABLED } from '@/constants/feature-flags';
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
import { channelKey, createCampfirePost, fetchMyFeedChannels } from '@/lib/api/feed-channels';
import { createForestPost } from '@/lib/api/forests';
import { fetchProfileIdentity } from '@/lib/api/identity';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraAttachInput, AgoraVisibility } from '@/types/database';
import type { Anthem, FeedChannel } from '@/types/social';

// Mock 162 panel 2 — "The post screen. Write freely (like FB / LinkedIn); the three icons are
// media you attach."
//
// THE ICONS COMBINE. A photo AND a lock-in AND a reward on one post. The first version held a
// single `photoUri` and a single `attach`, and each new pick cleared the other — choosing a reward
// after a photo silently deleted the photo. Independent slots is the whole fix; everything below
// just keeps them apart.
//
// The attachment is still sent as an IDENTITY (kind + ref id or key), never as text.
// `create_agora_post` re-reads the fact from the table that owns it and freezes the snapshot
// server-side, now per item (migration 0140). The label held in state here is only for the chip
// below — nothing typed on this screen can end up being what the card claims.
//
// ONE SHEET, EVERY POST (mock 306 frame 2). Text up top, then the bespoke media row — Photo ·
// Camera · Session · Reward · Anthem — then WHO SEES IT, then Post.
//
// WHO SEES IT (0280, mock 320). One required choice: Friends only (default) · a campfire · a forest ·
// Everyone. It is the post's whole reach — only that audience can read it and only they get the
// notification — and the server derives the post's `audience` from it, so the tag on the card is
// the rule that gated it. A campfire / forest row opens a "which one" sheet (the lane below).
//
// FOREST POSTS (0274). The lane picks the forest; ?forestId= seeds it, so a forest's own "Post"
// opens on that forest. A forest post's reach IS the forest (open, or its members only).
//
// CAMPFIRE POSTS (0277, mock 315). Same idea, one more kind: the lane can be a campfire you're in,
// and the post lands in that campfire's channel on the Feed — its members' curated feed (gym comps,
// clips). ?campfireId= seeds it, so a campfire channel's own composer opens on that campfire. No
// dial there either: a campfire post's reach is its members, full stop.
//
// VIDEO (0279). One clip, ≤ 60s, recorded or picked — the same post, one more slot, not a separate
// flow. It's compressed and given a poster frame on-device the moment it's picked (so Post isn't
// also an encode), uploaded to R2 on Post, then sent as `{kind: 'video', key}` like any other
// attachment. Trimming is the system's: iOS's picker editor trims to 60s; Android has none, so an
// over-long pick is refused with a message instead. Attaching a clip pulls the audience in to
// Friends — a clip reaches further than a photo, so the wider dial is a choice, never the default.
//
// ANTHEM IS TEXT, NOT AN ATTACHMENT. There is no `anthem` attach kind server-side and this pass is
// client-only, so the anthem rides in the body as one closing line ("♪ Title — Artist" + link) —
// what you would type yourself, built from the anthem already on your identity card.

const MAX = 1000;

function anthemLine(a: Anthem): string {
  return `♪ ${a.title}${a.artist ? ` — ${a.artist}` : ''}${a.url ? `\n${a.url}` : ''}`;
}

/**
 * The two non-photo slots. A slot holds at most one thing, and re-picking replaces what is in it.
 *
 * Slots rather than raw attachment kinds because the composer offers two buttons for seven kinds:
 * everything that is not a finished session is "a reward", and a slot per kind would put six more
 * buttons on the row.
 */
type AttachSlot = 'lockin' | 'achievement';

/** Drawn in the order the CARD will draw them (ATTACH_ORDER), so the composer previews the post. */
const SLOT_ORDER: AttachSlot[] = ['lockin', 'achievement'];

const SLOT_ICON: Record<AttachSlot, NavGlyphName> = {
  lockin: 'session',
  achievement: 'reward',
};

function slotOf(choice: AchievementChoice): AttachSlot {
  return choice.kind === 'lockin' ? 'lockin' : 'achievement';
}

type Lane = { kind: 'forest' | 'campfire'; id: string; name: string; emoji?: string };

export default function AgoraComposeScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ forestId?: string; forestName?: string; campfireId?: string; campfireName?: string }>();

  // Null = the square.
  const [lane, setLane] = useState<Lane | null>(
    params.campfireId
      ? { kind: 'campfire', id: params.campfireId, name: params.campfireName || 'this campfire' }
      : params.forestId
        ? { kind: 'forest', id: params.forestId, name: params.forestName || 'this forest' }
        : null
  );
  const [lanePicker, setLanePicker] = useState(false);
  // Your campfires, then your forests — the same list the Feed's channel row draws.
  const [myChannels, setMyChannels] = useState<FeedChannel[] | null>(null);

  const [body, setBody] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // Independent, keyed by slot. Nothing in this file writes one of these while reading another —
  // that coupling is exactly what made the media types trample each other.
  const [attached, setAttached] = useState<Partial<Record<AttachSlot, AchievementChoice>>>({});
  const [picker, setPicker] = useState<AttachSlot | null>(null);
  const [anthem, setAnthem] = useState<Anthem | null>(null);
  const [withAnthem, setWithAnthem] = useState(false);
  const [posting, setPosting] = useState(false);
  // The video slot. `preparing` is compress + poster (0…1); `uploading` is the PUT on Post (0…1).
  const [video, setVideo] = useState<PreparedAgoraVideo | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  // Bumped on every pick/remove, so a slow compress that finishes after you removed or replaced
  // the clip doesn't land in the slot anyway.
  const videoRun = useRef(0);

  // WHO SEES IT (0280, mock 320). With no lane, the post is for your friends or for everyone — the
  // only two square audiences the picker offers (legacy 'campus' posts keep theirs, but it isn't
  // offered). Friends is the default: reach is something you widen on purpose.
  const [visibility, setVisibility] = useState<Extract<AgoraVisibility, 'friends' | 'public'>>('friends');
  // Which kind of room the "pick which" sheet is listing.
  const [laneKind, setLaneKind] = useState<Lane['kind']>('campfire');

  const chosen = SLOT_ORDER.map((slot) => ({ slot, choice: attached[slot] })).filter(
    (c): c is { slot: AttachSlot; choice: AchievementChoice } => Boolean(c.choice)
  );

  const canPost =
    Boolean(body.trim() || photoUri || chosen.length || withAnthem || video) && !posting && preparing === null;

  useEffect(() => {
    if (!profile?.id) return;
    let alive = true;
    fetchProfileIdentity(profile.id)
      .then((row) => {
        if (alive) setAnthem(row?.anthem?.title ? row.anthem : null);
      })
      .catch(() => {
        // The Anthem button then offers to set one — the same as having none.
      });
    return () => {
      alive = false;
    };
  }, [profile?.id]);

  function openLanePicker(kind: Lane['kind']) {
    setLaneKind(kind);
    setLanePicker(true);
    if (myChannels !== null) return;
    fetchMyFeedChannels()
      .then((rows) => setMyChannels([...rows.filter((c) => c.kind === 'campfire'), ...rows.filter((c) => c.kind === 'forest')]))
      .catch(() => setMyChannels([]));
  }

  function chooseSquare(next: 'friends' | 'public') {
    setLane(null);
    setVisibility(next);
  }

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

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Philoi needs camera access to take a photo for your post.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
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

    const run = (videoRun.current += 1);
    setVideo(null);
    setPreparing(0);
    // A clip reaches further than a photo: start it at Friends. Widening is one tap, and a choice.
    if (!lane) setVisibility('friends');
    try {
      const prepared = await prepareAgoraVideo({ uri: asset.uri, durationMs: asset.duration }, (p) => {
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
    setVideo(null);
    setPreparing(null);
  }

  function toggleAnthem() {
    if (withAnthem) {
      setWithAnthem(false);
      return;
    }
    if (anthem) {
      setWithAnthem(true);
      return;
    }
    Alert.alert('No anthem yet', 'Pick your grind song on your identity card, then share it from here.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Set my anthem', onPress: () => router.push('/edit-identity') },
    ]);
  }

  async function post() {
    if (!canPost || !profile) return;
    // A clip never goes public silently (the video prompt's minor-safety rule; there is no age gate
    // to tell a minor apart, so it holds for everyone): Everyone + a video asks once, on Post.
    if (video && !lane && visibility === 'public') {
      Alert.alert('Post this video publicly?', 'Anyone on Philoi will be able to watch it. Friends only keeps it to the people you added.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Friends only', onPress: () => setVisibility('friends') },
        { text: 'Post publicly', style: 'destructive', onPress: () => void send() },
      ]);
      return;
    }
    await send();
  }

  async function send() {
    if (!profile) return;
    setPosting(true);
    try {
      const attachments: AgoraAttachInput[] = chosen.map(({ choice }) => ({
        kind: choice.kind,
        ref_id: choice.refId,
        key: choice.key,
      }));
      if (video) {
        setUploading(0);
        const key = await uploadAgoraVideo(video, setUploading);
        attachments.push({ kind: 'video', ref_id: null, key });
      }
      // The anthem line goes last and the typed text gives way to it, so the post still fits 1000.
      const typed = body.trim();
      const tail = withAnthem && anthem ? anthemLine(anthem) : '';
      const text = tail
        ? `${typed.slice(0, Math.max(0, MAX - tail.length - 2))}${typed ? '\n\n' : ''}${tail}`
        : body;
      if (lane?.kind === 'campfire') {
        const id = await createCampfirePost({ campfireId: lane.id, userId: profile.id, body: text, photoUri, attachments });
        // Lands on top only if the feed underneath is showing this campfire's channel.
        announceAgoraPost({ id, itemType: 'post', channel: channelKey({ kind: 'campfire', id: lane.id }) });
      } else if (lane) {
        const id = await createForestPost({ forestId: lane.id, userId: profile.id, body: text, photoUri, attachments });
        // On top in that forest's channel, or in All (0280: All carries your rooms).
        announceAgoraPost({ id, itemType: 'post', channel: channelKey({ kind: 'forest', id: lane.id }) });
      } else {
        const id = await createAgoraPost({ body: text, photoUri, userId: profile.id, visibility, attachments });
        // The feed under this modal puts it on top, highlighted (mock 306 frame 3).
        announceAgoraPost({ id, itemType: 'post' });
      }
      router.back();
    } catch (e) {
      Alert.alert('Could not post', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setPosting(false);
      setUploading(null);
    }
  }

  function choose(choice: AchievementChoice) {
    // Clears NOTHING else. Picking a reward used to delete the photo you had just attached, on the
    // theory that a stacked card was a collage rather than one clear claim — but mock 162 scoped
    // these as combinable, and the rule cost people media they had already chosen without ever
    // saying so. Re-picking a slot replaces that slot and only that slot.
    setAttached((prev) => ({ ...prev, [slotOf(choice)]: choice }));
    setPicker(null);
  }

  function clearSlot(slot: AttachSlot) {
    setAttached((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  function chooseLane(next: Lane) {
    setLane(next);
    setLanePicker(false);
  }

  // The reassurance line under the picker, naming whoever was chosen.
  const promise = lane
    ? lane.kind === 'campfire'
      ? `Only ${lane.name}’s members see this & get the notification.`
      : `Only people in ${lane.name} see this & its members get the notification.`
    : visibility === 'friends'
      ? 'Only your friends see this & get the notification.'
      : 'Anyone on Philoi can see this. Nobody gets a notification — it’s there for whoever looks.';

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.grab} />
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>
            New post
          </Text>
          <Pressable
            onPress={post}
            disabled={!canPost}
            style={[styles.postBtn, !canPost && styles.postBtnOff]}
            accessibilityRole="button"
            accessibilityLabel="Post">
            {posting && uploading !== null ? (
              <Text style={styles.postBtnText}>{Math.round(uploading * 100)}%</Text>
            ) : posting ? (
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
            <View style={styles.area}>
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

              {chosen.map(({ slot, choice }) => (
                <AttachedChip
                  key={slot}
                  icon={SLOT_ICON[slot]}
                  label={choice.label}
                  onRemove={() => clearSlot(slot)}
                />
              ))}

              {withAnthem && anthem ? (
                <AttachedChip
                  icon="anthem"
                  label={`${anthem.title}${anthem.artist ? ` — ${anthem.artist}` : ''}`}
                  onRemove={() => setWithAnthem(false)}
                />
              ) : null}

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

              {video || preparing !== null ? (
                <View style={styles.preview}>
                  {video ? (
                    <Image source={{ uri: video.posterUri }} style={styles.previewImage} contentFit="cover" />
                  ) : (
                    <View style={[styles.previewImage, styles.previewPreparing]}>
                      <ActivityIndicator color={Colors.navEmber2} />
                      <Text style={styles.previewPreparingText}>
                        Preparing video… {Math.round((preparing ?? 0) * 100)}%
                      </Text>
                    </View>
                  )}
                  {video ? (
                    <View style={styles.previewLength}>
                      <Ionicons name="play" size={10} color={Colors.ink} />
                      <Text style={styles.previewLengthText}>{formatClipLength(video.durationS)}</Text>
                    </View>
                  ) : null}
                  {posting && uploading !== null ? (
                    <View style={styles.uploadTrack}>
                      <View style={[styles.uploadFill, { width: `${Math.round(uploading * 100)}%` }]} />
                    </View>
                  ) : null}
                  <Pressable
                    style={styles.previewClear}
                    onPress={removeVideo}
                    disabled={posting}
                    accessibilityLabel="Remove video">
                    <Ionicons name="close" size={15} color={Colors.ink} />
                  </Pressable>
                </View>
              ) : null}
            </View>

            {/*
              The media row. Each button owns one slot and touches nothing else. A filled slot
              stays tappable and REPLACES what is in it rather than offering a second one — "at
              most one of each", expressed as the only thing the button is able to do. Photo and
              Camera are two ways to fill the same photo slot; Video holds one clip beside them.
            */}
            <View style={styles.media}>
              <AttachButton icon="photo" label="Photo" on={Boolean(photoUri)} onPress={() => void pickPhoto()} />
              <AttachButton icon="camera" label="Camera" on={false} onPress={() => void takePhoto()} />
              {AGORA_VIDEO_ENABLED ? (
                <AttachButton
                  icon="video"
                  label="Video"
                  on={Boolean(video) || preparing !== null}
                  onPress={chooseVideoSource}
                />
              ) : null}
              <AttachButton
                icon="session"
                label="Session"
                on={Boolean(attached.lockin)}
                onPress={() => setPicker('lockin')}
              />
              <AttachButton
                icon="reward"
                label="Reward"
                on={Boolean(attached.achievement)}
                onPress={() => setPicker('achievement')}
              />
              <AttachButton icon="anthem" label="Anthem" on={withAnthem} onPress={toggleAnthem} />
            </View>

            {/*
              WHO SEES IT (mock 320) — required, one choice, Friends by default. Only the chosen
              audience can read the post and only they are notified; nothing ranks it afterwards.
              A campfire / forest row opens the "pick which" sheet; once picked it names the room.
            */}
            <Text style={styles.whoLabel}>WHO SEES IT</Text>
            <AudienceOption
              icon="👥"
              label="Friends only"
              sub="just the people you added"
              on={!lane && visibility === 'friends'}
              onPress={() => chooseSquare('friends')}
            />
            <AudienceOption
              icon={lane?.kind === 'campfire' ? (lane.emoji ?? '🔥') : '🔥'}
              label={lane?.kind === 'campfire' ? lane.name : 'A campfire'}
              sub={lane?.kind === 'campfire' ? 'the campfire’s members · change' : 'pick which'}
              on={lane?.kind === 'campfire'}
              onPress={() => openLanePicker('campfire')}
              chevron
            />
            <AudienceOption
              icon={lane?.kind === 'forest' ? (lane.emoji ?? '🌲') : '🌲'}
              label={lane?.kind === 'forest' ? lane.name : 'A forest'}
              sub={lane?.kind === 'forest' ? 'everyone in the forest · change' : 'pick which'}
              on={lane?.kind === 'forest'}
              onPress={() => openLanePicker('forest')}
              chevron
            />
            <AudienceOption
              icon="🌐"
              label="Everyone"
              sub="public on Philoi"
              on={!lane && visibility === 'public'}
              onPress={() => chooseSquare('public')}
            />
            <Text style={styles.promise}>
              ✓ {promise} No algorithm — people only see what they chose.
            </Text>
            {(video || preparing !== null) && !lane && visibility === 'friends' ? (
              <Text style={styles.audienceHint}>Videos start at Friends. Widening it is your call.</Text>
            ) : null}

            <Text style={styles.note}>Comment-only · no likes.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <AgoraAchievementPicker
        visible={picker === 'achievement'}
        onClose={() => setPicker(null)}
        onPick={choose}
      />
      <AgoraLockInPicker visible={picker === 'lockin'} onClose={() => setPicker(null)} onPick={choose} />

      <Modal
        visible={lanePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setLanePicker(false)}>
        <Pressable style={styles.scrim} onPress={() => setLanePicker(false)} accessibilityLabel="Close">
          {/* Swallows taps so a press inside the sheet doesn't fall through to the scrim. */}
          <Pressable style={styles.laneSheet} onPress={() => {}}>
            <Text style={styles.laneSheetTitle}>{laneKind === 'campfire' ? 'Which campfire?' : 'Which forest?'}</Text>
            {myChannels === null ? (
              <ActivityIndicator color={Colors.textTertiary} style={styles.laneLoader} />
            ) : !myChannels.some((c) => c.kind === laneKind) ? (
              <Text style={styles.laneEmpty}>
                {laneKind === 'campfire'
                  ? 'Join a campfire to post into it.'
                  : 'Join a forest from Social → 🌲 Forests to post into it.'}
              </Text>
            ) : (
              <ScrollView style={styles.laneList}>
                {myChannels
                  .filter((c) => c.kind === laneKind)
                  .map((c) => (
                    <LaneOption
                      key={`${c.kind}:${c.id}`}
                      label={`${c.emoji} ${c.name}`}
                      sub={`${c.member_count} members`}
                      on={lane?.kind === c.kind && lane.id === c.id}
                      onPress={() => chooseLane({ kind: c.kind, id: c.id, name: c.name, emoji: c.emoji })}
                    />
                  ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

function AttachedChip({ icon, label, onRemove }: { icon: NavGlyphName; label: string; onRemove: () => void }) {
  return (
    <View style={styles.attachChip}>
      <NavGlyph name={icon} size={15} color={Colors.navEmber2} />
      <Text style={styles.attachChipText} numberOfLines={1}>
        {label}
      </Text>
      <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove ${label}`}>
        <Ionicons name="close" size={15} color={Colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function AttachButton({
  icon,
  label,
  on,
  onPress,
}: {
  icon: NavGlyphName;
  label: string;
  /** This slot is filled. Tapping swaps what is in it; the chip above is what removes it. */
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.attachBtn, on && styles.attachBtnOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      accessibilityHint={on ? `Replace the ${label.toLowerCase()} on this post` : undefined}>
      <NavGlyph name={icon} size={22} color={on ? Colors.navEmber : Colors.navEmber2} />
      <Text style={[styles.attachBtnLabel, on && styles.attachBtnLabelOn]} numberOfLines={1}>
        {label}
      </Text>
      {on ? (
        <View style={styles.attachBtnCheck}>
          <Ionicons name="checkmark" size={10} color={Colors.onEmber} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** One WHO SEES IT radio row (mock 320's `.aopt`): green border + filled dot when chosen. */
function AudienceOption({
  icon,
  label,
  sub,
  on,
  onPress,
  chevron = false,
}: {
  icon: string;
  label: string;
  sub: string;
  on: boolean;
  onPress: () => void;
  /** Opens a "pick which" sheet rather than choosing outright. */
  chevron?: boolean;
}) {
  return (
    <Pressable
      style={[styles.aopt, on && styles.aoptOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${label}, ${sub}`}>
      <Text style={styles.aoptIcon}>{icon}</Text>
      <View style={styles.flex}>
        <Text style={styles.aoptName} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.aoptSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {chevron && !on ? <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} /> : null}
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

function LaneOption({ label, sub, on, onPress }: { label: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.laneOption, on && styles.laneOptionOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}>
      <View style={styles.flex}>
        <Text style={styles.laneOptionText} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.laneOptionSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {on ? <Ionicons name="checkmark" size={16} color={Colors.navEmber2} /> : null}
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
  grab: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#3A2F55',
    marginTop: Spacing.two,
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
    fontSize: 13,
    color: Colors.muted,
  },
  topTitle: {
    flexShrink: 1,
    marginHorizontal: Spacing.two,
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  postBtn: {
    minWidth: 66,
    alignItems: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 7,
    backgroundColor: Colors.navEmber,
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
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  area: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.card,
    padding: Spacing.twelve,
  },
  input: {
    minHeight: 110,
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.ink,
    textAlignVertical: 'top',
    letterSpacing: 0,
  },
  preview: {
    marginTop: Spacing.two,
  },
  previewImage: {
    height: 200,
    borderRadius: Radius.card,
    backgroundColor: Colors.disabled,
  },
  previewPreparing: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  previewPreparingText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  previewLength: {
    position: 'absolute',
    bottom: Spacing.two,
    left: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(6,5,10,0.65)',
  },
  previewLengthText: {
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
    backgroundColor: 'rgba(6,5,10,0.6)',
  },
  uploadFill: {
    height: 4,
    backgroundColor: Colors.navEmber,
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
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  attachChipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  media: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.twelve,
  },
  attachBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 2,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  attachBtnOn: {
    backgroundColor: 'rgba(255,122,47,0.1)',
    borderColor: '#4A3718',
  },
  attachBtnLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.muted,
  },
  attachBtnLabelOn: {
    color: Colors.navEmber2,
  },
  attachBtnCheck: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // WHO SEES IT — mock 320's `.sk` / `.aopt` / `.noalgo`.
  whoLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.4,
    color: Colors.spaceFaint,
    marginTop: Spacing.three,
    marginBottom: 7,
    marginHorizontal: 2,
  },
  aopt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 11,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
    marginBottom: 7,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  aoptOn: {
    borderColor: '#39D98A',
    backgroundColor: 'rgba(57,217,138,0.08)',
  },
  aoptIcon: {
    fontSize: 17,
  },
  aoptName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  aoptSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: '#39D98A',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#39D98A',
  },
  promise: {
    textAlign: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    lineHeight: 16,
    color: '#39D98A',
    marginTop: Spacing.one,
  },
  audienceHint: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 6,
  },
  note: {
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.spaceFaint,
    marginTop: Spacing.four,
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(5,3,14,0.6)',
    justifyContent: 'flex-end',
  },
  laneSheet: {
    maxHeight: '70%',
    backgroundColor: '#140E26',
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
  },
  laneSheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    marginBottom: Spacing.twelve,
  },
  laneList: {
    flexGrow: 0,
  },
  laneLoader: {
    marginVertical: Spacing.four,
  },
  laneEmpty: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textTertiary,
    marginTop: Spacing.twelve,
  },
  laneOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
    marginBottom: 6,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  laneOptionOn: {
    borderColor: '#4A3718',
    backgroundColor: 'rgba(255,122,47,0.08)',
  },
  laneOptionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  laneOptionSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
});
