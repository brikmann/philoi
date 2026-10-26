import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { announceAgoraPost } from '@/lib/agora-just-posted';
import { AGORA_VISIBILITIES, createAgoraPost } from '@/lib/api/agora';
import { createForestPost, fetchForests } from '@/lib/api/forests';
import { fetchProfileIdentity } from '@/lib/api/identity';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { shortSchoolName } from '@/lib/universities';
import type { AgoraVisibility } from '@/types/database';
import type { Anthem, ForestSummary } from '@/types/social';

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
// Camera · Session · Reward · Anthem — then the Feed / Forest lane, then Post.
//
// FOREST POSTS (0274). The lane picks the forest; ?forestId= seeds it, so a forest's own "Post"
// opens on that forest. The audience dial is hidden on a forest lane: a forest post's reach IS the
// forest (open, or its members only), so a dial there would be a promise the server doesn't keep.
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

type Lane = { id: string; name: string };

export default function AgoraComposeScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ forestId?: string; forestName?: string }>();

  // Null = the square.
  const [lane, setLane] = useState<Lane | null>(
    params.forestId ? { id: params.forestId, name: params.forestName || 'this forest' } : null
  );
  const [lanePicker, setLanePicker] = useState(false);
  const [myForests, setMyForests] = useState<ForestSummary[] | null>(null);

  const [body, setBody] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // Independent, keyed by slot. Nothing in this file writes one of these while reading another —
  // that coupling is exactly what made the media types trample each other.
  const [attached, setAttached] = useState<Partial<Record<AttachSlot, AchievementChoice>>>({});
  const [picker, setPicker] = useState<AttachSlot | null>(null);
  const [anthem, setAnthem] = useState<Anthem | null>(null);
  const [withAnthem, setWithAnthem] = useState(false);
  const [posting, setPosting] = useState(false);

  // Campus is the sensible default audience (see migration 0128), but it resolves to NOBODY for an
  // account with no university set — can_see_agora needs a non-null match on both sides. Rather
  // than let someone post into a void, the picker disables it and this opens on Global instead.
  const hasCampus = Boolean(profile?.university);
  const [visibility, setVisibility] = useState<AgoraVisibility>(hasCampus ? 'campus' : 'public');

  const chosen = SLOT_ORDER.map((slot) => ({ slot, choice: attached[slot] })).filter(
    (c): c is { slot: AttachSlot; choice: AchievementChoice } => Boolean(c.choice)
  );

  const canPost = Boolean(body.trim() || photoUri || chosen.length || withAnthem) && !posting;

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

  function openLanePicker() {
    setLanePicker(true);
    if (myForests !== null) return;
    fetchForests('active')
      .then((rows) => setMyForests(rows.filter((f) => f.my_status === 'active')))
      .catch(() => setMyForests([]));
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
    setPosting(true);
    try {
      const attachments = chosen.map(({ choice }) => ({
        kind: choice.kind,
        ref_id: choice.refId,
        key: choice.key,
      }));
      // The anthem line goes last and the typed text gives way to it, so the post still fits 1000.
      const typed = body.trim();
      const tail = withAnthem && anthem ? anthemLine(anthem) : '';
      const text = tail
        ? `${typed.slice(0, Math.max(0, MAX - tail.length - 2))}${typed ? '\n\n' : ''}${tail}`
        : body;
      if (lane) {
        await createForestPost({ forestId: lane.id, userId: profile.id, body: text, photoUri, attachments });
      } else {
        const id = await createAgoraPost({ body: text, photoUri, userId: profile.id, visibility, attachments });
        // The feed under this modal puts it on top, highlighted (mock 306 frame 3). A forest post
        // never reaches the square, so only this branch announces.
        announceAgoraPost({ id, itemType: 'post' });
      }
      router.back();
    } catch (e) {
      Alert.alert('Could not post', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setPosting(false);
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

  function chooseLane(next: Lane | null) {
    setLane(next);
    setLanePicker(false);
  }

  const audience = AGORA_VISIBILITIES.find((v) => v.key === visibility);

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
            </View>

            {/*
              The media row. Each button owns one slot and touches nothing else. A filled slot
              stays tappable and REPLACES what is in it rather than offering a second one — "at
              most one of each", expressed as the only thing the button is able to do. Photo and
              Camera are two ways to fill the same photo slot.
            */}
            <View style={styles.media}>
              <AttachButton icon="photo" label="Photo" on={Boolean(photoUri)} onPress={() => void pickPhoto()} />
              <AttachButton icon="camera" label="Camera" on={false} onPress={() => void takePhoto()} />
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

            <View style={styles.laneRow}>
              <Text style={styles.laneLabel}>Posting to</Text>
              <Pressable
                style={styles.lanePill}
                onPress={openLanePicker}
                accessibilityRole="button"
                accessibilityLabel={`Posting to ${lane ? lane.name : 'the feed'}. Change`}>
                <Text style={styles.lanePillText} numberOfLines={1}>
                  {lane ? lane.name : 'Feed'}
                </Text>
                <Ionicons name="chevron-down" size={12} color={Colors.legend} />
              </Pressable>
            </View>

            {lane ? (
              <Text style={styles.audienceHint}>Seen by everyone who can open this forest</Text>
            ) : (
              <>
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
              </>
            )}

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
            <Text style={styles.laneSheetTitle}>Post to</Text>
            <LaneOption label="Feed" sub="The square" on={!lane} onPress={() => chooseLane(null)} />
            {myForests === null ? (
              <ActivityIndicator color={Colors.textTertiary} style={styles.laneLoader} />
            ) : myForests.length === 0 ? (
              <Text style={styles.laneEmpty}>Join a forest from Agora → Forests to post into it.</Text>
            ) : (
              <ScrollView style={styles.laneList}>
                {myForests.map((f) => (
                  <LaneOption
                    key={f.id}
                    label={`${f.emoji} ${f.name}`}
                    sub={`Forest · ${f.member_count} members`}
                    on={lane?.id === f.id}
                    onPress={() => chooseLane({ id: f.id, name: f.name })}
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
  laneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  laneLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  lanePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(185,139,255,0.1)',
    borderWidth: 1,
    borderColor: '#3A2D4A',
  },
  lanePillText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.legend,
  },
  audienceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.twelve,
  },
  aud: {
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  audOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.navEmber,
  },
  audOff: {
    opacity: 0.4,
  },
  audText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.muted,
  },
  audTextOn: {
    color: Colors.navEmber2,
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
