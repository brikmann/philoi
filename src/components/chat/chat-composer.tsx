import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AgoraAchievementPicker, AgoraLockInPicker, type AchievementChoice } from '@/components/agora/agora-pickers';
import { EmberFill } from '@/components/ui/ember-fill';
import { Icon, type IconName } from '@/components/ui/icon';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  CHAT_MAX_ATTACHMENTS,
  chatSend,
  discardChatUploads,
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
// beside it, which opens the same media row the Agora post composer has: Photo · Camera · Session
// · Reward · Anthem. Session and Reward are the Agora's OWN pickers (agora-pickers.tsx), not copies,
// so what you can share to a friend is exactly what you can share to the square.
//
// What's NOT on the row, deliberately:
//   · Video — 0284 refuses it ("This build can't send that yet") until the 0279 clip path is live.
//   · File / Notes — the bucket takes PDFs and docs, but this binary has no document picker
//     (expo-document-picker is a native module and isn't installed), and OTA can't add one. Files
//     sent from a later build still RENDER here (chat-attachments.tsx draws the chip).
//
// `rich` is the 0284 switch. Without it this is the old composer — text only, sent through the
// caller's legacy `onSendText` — and the clip isn't drawn at all, so nothing offers a send the
// server can't take.

type Staged =
  | { id: string; kind: 'image'; uri: string; width?: number }
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

  const left = CHAT_MAX_ATTACHMENTS - staged.length;
  const canSend = Boolean(roomId) && !sending && (draft.trim().length > 0 || (rich && staged.length > 0));

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

  /** One session, one reward — the Agora's slots. Re-picking a slot replaces it. */
  function choose(choice: AchievementChoice) {
    setPicker(null);
    // agora-pickers can list a posted clip as an achievement; 0284 refuses video, so it isn't offered.
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
      setSending(false);
      return;
    }
    // Outside the try ON PURPOSE: once chat_send has returned, the message (and its media) is real.
    // A refetch that then fails must not route through the catch above and delete what was sent.
    setStaged([]);
    setTrayOpen(false);
    setSending(false);
    await Promise.resolve(onSent()).catch(() => {});
  }

  const hasLockin = staged.some((s) => s.kind === 'share' && s.slot === 'lockin');
  const hasReward = staged.some((s) => s.kind === 'share' && s.slot === 'achievement');
  const hasAnthem = staged.some((s) => s.kind === 'anthem');
  const hasPhoto = staged.some((s) => s.kind === 'image');

  return (
    <View style={[styles.shelf, { paddingBottom: Spacing.two + bottomInset }]}>
      {rich && staged.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.staged}>
          {staged.map((s) =>
            s.kind === 'image' ? (
              <View key={s.id} style={styles.thumb}>
                <Image source={{ uri: s.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <RemoveDot label="Remove photo" onPress={() => remove(s.id)} disabled={sending} />
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
        <View style={styles.tray}>
          <TrayButton icon="photo" label="Photo" on={hasPhoto} disabled={left <= 0} onPress={() => void pickPhotos()} />
          <TrayButton icon="camera" label="Camera" on={false} disabled={left <= 0} onPress={() => void takePhoto()} />
          <TrayButton icon="session" label="Session" on={hasLockin} onPress={() => setPicker('lockin')} />
          <TrayButton icon="reward" label="Reward" on={hasReward} onPress={() => setPicker('achievement')} />
          <TrayButton icon="music" label="Anthem" on={hasAnthem} onPress={() => void toggleAnthem()} />
        </View>
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
  tray: {
    flexDirection: 'row',
    gap: 6,
  },
  trayBtn: {
    flex: 1,
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
