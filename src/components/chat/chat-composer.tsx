import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AgoraAchievementPicker, AgoraLockInPicker, type AchievementChoice } from '@/components/agora/agora-pickers';
import { formatBytes } from '@/components/chat/chat-attachments';
import { EmberFill } from '@/components/ui/ember-fill';
import { Icon, type IconName } from '@/components/ui/icon';
import { TextInput } from '@/components/ui/text-input';
import { AGORA_VIDEO_ENABLED, CHAT_VIDEO_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  AGORA_VIDEO_MAX_SECONDS,
  AgoraVideoLimitError,
  formatClipLength,
  prepareAgoraVideo,
  uploadAgoraVideo,
  type PreparedAgoraVideo,
} from '@/lib/api/agora-video';
import {
  CHAT_FILE_PICKER_TYPES,
  CHAT_MAX_ATTACHMENTS,
  CHAT_MEDIA_MAX_BYTES,
  chatFileType,
  chatSend,
  discardChatUploads,
  uploadChatFile,
  uploadChatImage,
  type ChatAttachInput,
  type ChatAttachKind,
  type ChatScope,
} from '@/lib/api/chat';
import { fetchProfileIdentity } from '@/lib/api/identity';
import { getErrorMessage } from '@/lib/errors';
import type { Anthem } from '@/types/social';

// THE CHAT COMPOSER — the Agora composer's attach row, sending into a thread (0284, mock 306).
//
// The campfire's pill-on-a-shelf input stays exactly as the DM had it; what's new is the clip
// beside it, which opens the same media row the Agora post composer has: Photo · Camera · Video ·
// File · Session · Reward · Anthem. Session and Reward are the Agora's OWN pickers
// (agora-pickers.tsx), not copies, so what you can share to a friend is exactly what you can share
// to the square.
//
//   · File — expo-document-picker, a native module first compiled into the build cut with this
//     file. It is required lazily inside the button, so a dev client from before it still opens
//     the composer and just says it can't attach files yet, rather than failing to load the screen.
//     What it may pick is chat-media's own allowed list (chat.ts · CHAT_FILE_TYPES).
//   · Video — the Agora's clip path, unchanged (prepareAgoraVideo → uploadAgoraVideo), sent as
//     `{kind: 'video', key}`. One per message. Behind CHAT_VIDEO_ENABLED + AGORA_VIDEO_ENABLED:
//     until both are true the button isn't drawn, because the server half isn't deployed.
//
// `rich` is the 0284 switch. Without it this is the old composer — text only, sent through the
// caller's legacy `onSendText` — and the clip isn't drawn at all, so nothing offers a send the
// server can't take.

type Staged =
  | { id: string; kind: 'image'; uri: string; width?: number }
  | { id: string; kind: 'file'; uri: string; name: string; bytes: number | null; type: { ext: string; mime: string } }
  | { id: string; kind: 'video'; video: PreparedAgoraVideo }
  | { id: string; kind: 'share'; slot: 'lockin' | 'achievement'; choice: AchievementChoice }
  | { id: string; kind: 'anthem'; anthem: Anthem };

export function ChatComposer({
  scope,
  roomId,
  userId,
  rich,
  placeholder,
  leading,
  bottomInset,
  onSendText,
  onSent,
}: {
  scope: ChatScope;
  /** The DM thread id / forest id. Null while it resolves — the composer stays dark. */
  roomId: string | null;
  userId: string | null | undefined;
  /** The server has 0284. */
  rich: boolean;
  placeholder: string;
  /** Drawn left of the field — the DM's one-tap challenge. */
  leading?: ReactNode;
  /** The shelf runs to the bottom edge; this is the safe-area inset it pads by. */
  bottomInset: number;
  /** The pre-0284 send (dm_send). Required wherever `rich` can be false. */
  onSendText?: (body: string) => Promise<void>;
  /** After a send landed — the caller refetches so the bubble shows even if the socket is asleep. */
  onSent: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [staged, setStaged] = useState<Staged[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const [picker, setPicker] = useState<'lockin' | 'achievement' | null>(null);
  const [sending, setSending] = useState(false);
  // The clip slot, as compose.tsx has it: `preparing` is compress + poster (0…1), `uploading` the
  // PUT during a send (0…1). `videoRun` lets a removed or replaced clip's late finish be ignored.
  const [preparing, setPreparing] = useState<number | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const videoRun = useRef(0);

  const videoOn = rich && CHAT_VIDEO_ENABLED && AGORA_VIDEO_ENABLED;
  const left = CHAT_MAX_ATTACHMENTS - staged.length;
  // Not while a clip is still encoding: a send then would quietly leave the video behind.
  const canSend =
    Boolean(roomId) && !sending && preparing === null && (draft.trim().length > 0 || (rich && staged.length > 0));

  function stage(next: Staged[]) {
    setStaged((prev) => [...prev, ...next].slice(0, CHAT_MAX_ATTACHMENTS));
  }

  function remove(id: string) {
    setStaged((prev) => prev.filter((s) => s.id !== id));
  }

  async function pickPhotos() {
    if (left <= 0) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Philoi needs photo access to send an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: left,
      quality: 0.8,
    });
    if (result.canceled) return;
    stage(result.assets.map((a) => ({ id: Crypto.randomUUID(), kind: 'image' as const, uri: a.uri, width: a.width })));
  }

  async function takePhoto() {
    if (left <= 0) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Philoi needs camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    stage([{ id: Crypto.randomUUID(), kind: 'image', uri: a.uri, width: a.width }]);
  }

  async function pickFiles() {
    if (left <= 0) return;
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import, see the header
      DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');
    } catch {
      Alert.alert('Update Philoi to send files', 'This version of the app can’t attach files yet.');
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      // Android files a .md under application/octet-stream more often than not, and a filter
      // without it hides every one of them. The extension check below is the real rule either way.
      type: Platform.OS === 'android' ? [...CHAT_FILE_PICKER_TYPES, 'application/octet-stream'] : CHAT_FILE_PICKER_TYPES,
      multiple: true,
      // The upload reads the bytes straight back through expo-file-system, which needs the copy.
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const next: Staged[] = [];
    const refused: string[] = [];
    const tooBig: string[] = [];
    for (const a of result.assets.slice(0, left)) {
      const type = chatFileType(a.name, a.mimeType);
      if (!type) refused.push(a.name);
      else if (a.size && a.size > CHAT_MEDIA_MAX_BYTES) tooBig.push(a.name);
      else next.push({ id: Crypto.randomUUID(), kind: 'file', uri: a.uri, name: a.name, bytes: a.size ?? null, type });
    }
    stage(next);
    // Refused HERE, by name, before a byte moves — the bucket would refuse them too, but halfway
    // through a send and as one opaque error for the whole message.
    if (refused.length > 0) {
      Alert.alert(
        refused.length === 1 ? 'Can’t send that file' : 'Can’t send some of those',
        `${refused.join(', ')} — chats take PDFs, Word (.docx), text and Markdown notes, and images.`
      );
    } else if (tooBig.length > 0) {
      Alert.alert('File too large', `${tooBig.join(', ')} — files can be up to 20 MB.`);
    }
  }

  function chooseVideoSource() {
    // Exactly three buttons: Android's Alert silently drops a fourth.
    Alert.alert('Send a video', `Up to ${AGORA_VIDEO_MAX_SECONDS} seconds.`, [
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
          ? 'Philoi needs camera access to record a video.'
          : 'Philoi needs library access to send a video.'
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

    // One clip per message: a new pick replaces the staged one.
    const run = (videoRun.current += 1);
    setStaged((prev) => prev.filter((s) => s.kind !== 'video'));
    setPreparing(0);
    try {
      const video = await prepareAgoraVideo({ uri: asset.uri, durationMs: asset.duration }, (p) => {
        if (run === videoRun.current) setPreparing(p);
      });
      if (run === videoRun.current) stage([{ id: Crypto.randomUUID(), kind: 'video', video }]);
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

  /** Drops the staged clip AND abandons one still encoding — its late finish is then ignored. */
  function removeVideo() {
    videoRun.current += 1;
    setPreparing(null);
    setStaged((prev) => prev.filter((s) => s.kind !== 'video'));
  }

  /** One session, one reward — the Agora's slots. Re-picking a slot replaces it. */
  function choose(choice: AchievementChoice) {
    setPicker(null);
    // agora-pickers can list a posted clip as an achievement. Not offered: a chat 'video' is an
    // upload key from agora-video-upload-url, not a reference to someone's post — the Video button
    // is how a clip gets into a chat.
    if (choice.kind === 'video') return;
    const slot = choice.kind === 'lockin' ? 'lockin' : 'achievement';
    setStaged((prev) => [
      ...prev.filter((s) => !(s.kind === 'share' && s.slot === slot)),
      { id: Crypto.randomUUID(), kind: 'share', slot, choice },
    ]);
  }

  async function toggleAnthem() {
    if (staged.some((s) => s.kind === 'anthem')) {
      setStaged((prev) => prev.filter((s) => s.kind !== 'anthem'));
      return;
    }
    if (!userId) return;
    const row = await fetchProfileIdentity(userId).catch(() => null);
    const anthem = row?.anthem?.title ? row.anthem : null;
    if (!anthem) {
      Alert.alert('No anthem yet', 'Pick your grind song on your identity card, then share it from here.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Set my anthem', onPress: () => router.push('/edit-identity') },
      ]);
      return;
    }
    stage([{ id: Crypto.randomUUID(), kind: 'anthem', anthem }]);
  }

  async function send() {
    const body = draft.trim();
    if (!roomId || !canSend) return;

    // ── pre-0284: exactly the old send ──
    if (!rich) {
      if (!body || !onSendText) return;
      setSending(true);
      setDraft('');
      try {
        await onSendText(body);
      } catch (e) {
        // Put the text BACK in the box. A send that failed and also ate what you typed is the
        // version of this bug people actually complain about.
        setDraft(body);
        Alert.alert('Could not send', getErrorMessage(e, 'Try again.'));
        setSending(false);
        return;
      }
      setSending(false);
      await Promise.resolve(onSent()).catch(() => {});
      return;
    }

    setSending(true);
    setDraft('');
    const uploaded: string[] = [];
    try {
      const inputs: ChatAttachInput[] = [];
      // Sequential, not parallel: a phone on campus Wi-Fi pushing four 1600px JPEGs at once is
      // four half-finished uploads when it drops, and the order is the order you picked them in.
      for (const s of staged) {
        if (s.kind === 'image') {
          if (!userId) throw new Error('Sign in again to send photos.');
          const up = await uploadChatImage(scope, roomId, userId, s.uri, s.width);
          uploaded.push(up.key);
          inputs.push({ kind: 'image', ref_id: null, key: up.key, meta: { width: up.width, height: up.height } });
        } else if (s.kind === 'file') {
          if (!userId) throw new Error('Sign in again to send files.');
          const key = await uploadChatFile(scope, roomId, userId, s.uri, s.type);
          uploaded.push(key);
          // The name is the one cosmetic the server keeps from us; mime and size it reads off storage.
          inputs.push({ kind: 'file', ref_id: null, key, meta: { name: s.name } });
        } else if (s.kind === 'video') {
          // Into R2 through agora-video-upload-url, exactly as an Agora clip. NOT pushed to
          // `uploaded`: that list is chat-media's, and an orphaned clip is 0279's hourly sweep's.
          setUploading(0);
          const key = await uploadAgoraVideo(s.video, setUploading);
          inputs.push({ kind: 'video', ref_id: null, key });
        } else if (s.kind === 'share') {
          inputs.push({ kind: s.choice.kind as ChatAttachKind, ref_id: s.choice.refId, key: s.choice.key });
        } else {
          // The server freezes the anthem from your identity card; nothing of it travels from here.
          inputs.push({ kind: 'anthem', ref_id: null, key: null });
        }
      }
      await chatSend(scope, roomId, body, inputs);
    } catch (e) {
      setDraft(body);
      // The send didn't land, so its uploads are orphans — and a retry uploads them afresh.
      void discardChatUploads(uploaded);
      Alert.alert('Could not send', getErrorMessage(e, 'Try again.'));
      setUploading(null);
      setSending(false);
      return;
    }
    // Outside the try ON PURPOSE: once chat_send has returned, the message (and its media) is real.
    // A refetch that then fails must not route through the catch above and delete what was sent.
    setStaged([]);
    setTrayOpen(false);
    setUploading(null);
    setSending(false);
    await Promise.resolve(onSent()).catch(() => {});
  }

  const hasLockin = staged.some((s) => s.kind === 'share' && s.slot === 'lockin');
  const hasReward = staged.some((s) => s.kind === 'share' && s.slot === 'achievement');
  const hasAnthem = staged.some((s) => s.kind === 'anthem');
  const hasPhoto = staged.some((s) => s.kind === 'image');
  const hasFile = staged.some((s) => s.kind === 'file');
  const hasVideo = staged.some((s) => s.kind === 'video') || preparing !== null;

  return (
    <View style={[styles.shelf, { paddingBottom: Spacing.two + bottomInset }]}>
      {rich && (staged.length > 0 || preparing !== null) ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.staged}>
          {preparing !== null ? (
            <View style={[styles.thumb, styles.thumbPreparing]}>
              <ActivityIndicator size="small" color={Colors.navEmber2} />
              <Text style={styles.thumbPreparingText}>{Math.round(preparing * 100)}%</Text>
              <RemoveDot label="Cancel video" onPress={removeVideo} />
            </View>
          ) : null}
          {staged.map((s) =>
            s.kind === 'image' ? (
              <View key={s.id} style={styles.thumb}>
                <Image source={{ uri: s.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <RemoveDot label="Remove photo" onPress={() => remove(s.id)} disabled={sending} />
              </View>
            ) : s.kind === 'video' ? (
              <View key={s.id} style={styles.thumb}>
                <Image source={{ uri: s.video.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={styles.thumbLength} pointerEvents="none">
                  <Icon name="play" size={9} color={Colors.ink} />
                  <Text style={styles.thumbLengthText}>{formatClipLength(s.video.durationS)}</Text>
                </View>
                {sending && uploading !== null ? (
                  <View style={styles.uploadTrack} pointerEvents="none">
                    <View style={[styles.uploadFill, { width: `${Math.round(uploading * 100)}%` }]} />
                  </View>
                ) : null}
                <RemoveDot label="Remove video" onPress={removeVideo} disabled={sending} />
              </View>
            ) : s.kind === 'file' ? (
              <View key={s.id} style={styles.stagedChip}>
                <Icon name="notes" size={15} color={Colors.navEmber2} />
                <Text style={styles.stagedChipText} numberOfLines={1}>
                  {s.name}
                </Text>
                {s.bytes ? <Text style={styles.stagedChipSub}>{formatBytes(s.bytes)}</Text> : null}
                <Pressable onPress={() => remove(s.id)} disabled={sending} hitSlop={8} accessibilityLabel={`Remove ${s.name}`}>
                  <Icon name="close" size={14} color={Colors.spaceDim} />
                </Pressable>
              </View>
            ) : (
              <View key={s.id} style={styles.stagedChip}>
                <Icon
                  name={s.kind === 'anthem' ? 'music' : s.slot === 'lockin' ? 'session' : 'reward'}
                  size={15}
                  color={Colors.navEmber2}
                />
                <Text style={styles.stagedChipText} numberOfLines={1}>
                  {s.kind === 'anthem'
                    ? `${s.anthem.title}${s.anthem.artist ? ` — ${s.anthem.artist}` : ''}`
                    : s.choice.label}
                </Text>
                <Pressable onPress={() => remove(s.id)} disabled={sending} hitSlop={8} accessibilityLabel="Remove">
                  <Icon name="close" size={14} color={Colors.spaceDim} />
                </Pressable>
              </View>
            )
          )}
        </ScrollView>
      ) : null}

      {rich && trayOpen ? (
        // Scrolls rather than squeezes: seven buttons at flex:1 on a small phone cut "Session" to
        // "Sess…". With room to spare they still stretch to fill the row (flexGrow on each).
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray}>
          <TrayButton icon="photo" label="Photo" on={hasPhoto} disabled={left <= 0} onPress={() => void pickPhotos()} />
          <TrayButton icon="camera" label="Camera" on={false} disabled={left <= 0} onPress={() => void takePhoto()} />
          {videoOn ? (
            <TrayButton
              icon="video"
              label="Video"
              on={hasVideo}
              disabled={sending || (left <= 0 && !hasVideo)}
              onPress={chooseVideoSource}
            />
          ) : null}
          <TrayButton icon="notes" label="File" on={hasFile} disabled={left <= 0} onPress={() => void pickFiles()} />
          <TrayButton icon="session" label="Session" on={hasLockin} onPress={() => setPicker('lockin')} />
          <TrayButton icon="reward" label="Reward" on={hasReward} onPress={() => setPicker('achievement')} />
          <TrayButton icon="music" label="Anthem" on={hasAnthem} onPress={() => void toggleAnthem()} />
        </ScrollView>
      ) : null}

      <View style={styles.inputRow}>
        {leading}
        {rich ? (
          <Pressable
            onPress={() => setTrayOpen((v) => !v)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={trayOpen ? 'Hide attachments' : 'Attach'}
            accessibilityState={{ expanded: trayOpen }}
            style={[styles.round, styles.roundQuiet, trayOpen && styles.roundOn]}>
            <Icon name={trayOpen ? 'close' : 'clip'} size={18} color={trayOpen ? Colors.navEmber : Colors.ink} />
          </Pressable>
        ) : null}
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          value={draft}
          onChangeText={setDraft}
          maxLength={2000}
          multiline
        />
        <Pressable onPress={() => void send()} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Send">
          {sending ? (
            <View style={[styles.round, styles.roundQuiet]}>
              <ActivityIndicator size="small" color={Colors.navEmber2} />
            </View>
          ) : canSend ? (
            <EmberFill style={styles.round} radius={20} direction="diagonal">
              <Icon name="send" size={17} color={Colors.onEmber} />
            </EmberFill>
          ) : (
            <View style={[styles.round, styles.roundQuiet]}>
              <Icon name="send" size={17} color={Colors.spaceFaint} />
            </View>
          )}
        </Pressable>
      </View>

      {rich ? (
        <>
          <AgoraLockInPicker visible={picker === 'lockin'} onClose={() => setPicker(null)} onPick={choose} />
          <AgoraAchievementPicker visible={picker === 'achievement'} onClose={() => setPicker(null)} onPick={choose} />
        </>
      ) : null}
    </View>
  );
}

function TrayButton({
  icon,
  label,
  on,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.trayBtn, on && styles.trayBtnOn, disabled && styles.trayBtnOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled }}>
      <Icon name={icon} size={22} color={on ? Colors.navEmber : Colors.navEmber2} />
      <Text style={[styles.trayLabel, on && styles.trayLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function RemoveDot({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={styles.removeDot} onPress={onPress} disabled={disabled} hitSlop={6} accessibilityLabel={label}>
      <Icon name="close" size={12} color={Colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A translucent shelf rather than a hairline over an opaque bar, so the page's radial carries on
  // behind it — the DM's own shelf, lifted out so the forest room wears the same one.
  shelf: {
    paddingHorizontal: 14,
    paddingTop: Spacing.two,
    gap: Spacing.two,
    backgroundColor: Colors.scrim,
  },
  staged: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel2,
  },
  removeDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  stagedChipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  stagedChipSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  thumbPreparing: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  thumbPreparingText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.spaceDim,
  },
  thumbLength: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  thumbLengthText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.ink,
  },
  uploadTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  uploadFill: {
    height: 3,
    backgroundColor: Colors.navEmber,
  },
  tray: {
    flexGrow: 1,
    flexDirection: 'row',
    gap: 6,
  },
  trayBtn: {
    flexGrow: 1,
    minWidth: 60,
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  trayBtnOn: {
    borderColor: Colors.navEmber,
  },
  trayBtnOff: {
    opacity: 0.4,
  },
  trayLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  trayLabelOn: {
    color: Colors.navEmber2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundQuiet: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  roundOn: {
    borderColor: Colors.navEmber,
  },
});
