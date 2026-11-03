import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiftStorySheet, type LiftStoryStat } from '@/components/story-sticker/lift-story-sheet';
import { Icon, type IconName } from '@/components/ui/icon';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { AgoraVideoLimitError, formatClipLength, prepareAgoraVideo, type PreparedAgoraVideo } from '@/lib/api/agora-video';
import { fetchExercises } from '@/lib/api/gym';
import { postSharedLift, postSharedPlain, SHARED_LIFT_MAX_SECONDS } from '@/lib/api/shared-post';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { consumeSharedMedia, isSharedVideo, type SharedMedia } from '@/lib/share-intake';
import type { Exercise } from '@/types/database';

// "Share → Philoi" (mock 324, frame 2). A photo or clip shared in from the OS share sheet —
// typically the one just posted to Instagram — becomes an Agora post, and a clip can become a
// challenge. Opened by the share intake (src/lib/share-intake.ts), never from a button in the app:
// the in-app composer is agora/compose.
//
// THE QUESTION is the whole screen: "does it include a PR others can try to match?" Toggle ⚔ and
// name the set — exercise, weight, reps — and the clip is filed as that set's clip, so the post
// lands as a verified, challengeable lift on 0282's existing path (src/lib/api/shared-post.ts).
// Leave it off and it's an ordinary post. Either way it's tagged "↳ from your story".
//
// ⚔ is for clips only, and only weighted lifts — the one shape a head-to-head compares today. A
// ⚔ clip is held to the gym clip's 30s, not the Agora's 60s: it IS a set clip.
//
// WHO SEES IT: Friends only (default) or Everyone. Campfires and forests stay on the in-app
// composer — a shared clip is a square post. A clip never goes public silently (the same rule as
// agora/compose, and the minor-safety default — there is no age gate to tell a minor apart, so it
// holds for everyone): Everyone + a clip asks once, on Post.

const MAX = 1000;
const KG_PER_LB = 0.45359237;

type Unit = 'lb' | 'kg';
type Visibility = 'friends' | 'public';

export default function AgoraImportScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  // undefined = still reading the share; null = nothing was waiting.
  const [media, setMedia] = useState<SharedMedia | null | undefined>(undefined);
  const [video, setVideo] = useState<PreparedAgoraVideo | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('friends');
  const [challenge, setChallenge] = useState(false);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<Unit>('lb');
  const [reps, setReps] = useState('1');
  const [exercisePicker, setExercisePicker] = useState(false);

  const [posting, setPosting] = useState<'plain' | 'lift' | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  // After a ⚔ post: the "Add to Instagram Story" offer (frame 1), closing the loop both ways.
  const [story, setStory] = useState<LiftStoryStat | null>(null);
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    let alive = true;
    (async () => {
      const shared = await consumeSharedMedia();
      if (!alive) return;
      setMedia(shared);
      if (!shared || !isSharedVideo(shared)) return;
      setPreparing(0);
      try {
        const prepared = await prepareAgoraVideo({ uri: shared.uri }, (p) => alive && setPreparing(p));
        if (alive) setVideo(prepared);
      } catch (e) {
        if (alive) {
          setPrepError(e instanceof AgoraVideoLimitError ? e.message : getErrorMessage(e, 'Try a different clip.'));
        }
      } finally {
        if (alive) setPreparing(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isVideo = Boolean(media && isSharedVideo(media));
  const tooLongForLift = Boolean(video && video.durationS > SHARED_LIFT_MAX_SECONDS + 0.5);
  const weightN = Number(weight.replace(',', '.'));
  const repsN = Math.round(Number(reps));
  const liftReady = Boolean(exercise) && weightN > 0 && repsN >= 1 && repsN <= 100;
  const mediaReady = isVideo ? Boolean(video) : Boolean(media);
  const busy = posting !== null;

  function confirmAudience(go: () => void) {
    if (isVideo && visibility === 'public') {
      Alert.alert('Post this video publicly?', 'Anyone on Philoi will be able to watch it. Friends only keeps it to the people you added.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Friends only', onPress: () => setVisibility('friends') },
        { text: 'Post publicly', style: 'destructive', onPress: go },
      ]);
      return;
    }
    go();
  }

  async function postPlain() {
    if (!profile || !media || !mediaReady || busy) return;
    setPosting('plain');
    try {
      const common = { userId: profile.id, body: body.trim(), audience: { kind: 'square' as const, visibility } };
      if (video) await postSharedPlain({ ...common, video }, setUploading);
      else await postSharedPlain({ ...common, photoUri: media.uri });
      router.back();
    } catch (e) {
      Alert.alert('Could not post', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setPosting(null);
      setUploading(null);
    }
  }

  async function postLift() {
    if (!profile || !video || !exercise || !liftReady || busy) return;
    if (tooLongForLift) {
      Alert.alert('Trim it to 30 seconds', `A challenge clip is a set clip — up to ${SHARED_LIFT_MAX_SECONDS}s. You can still post it as is.`);
      return;
    }
    const weightLb = unit === 'kg' ? Math.round((weightN / KG_PER_LB) * 10) / 10 : weightN;
    setPosting('lift');
    try {
      const { isPr } = await postSharedLift(
        {
          userId: profile.id,
          body: body.trim(),
          audience: { kind: 'square', visibility },
          video,
          lift: { exerciseId: exercise.id, weightLb, reps: repsN },
        },
        setUploading
      );
      setStory({ exercise: exercise.name, weight: weightLb, reps: repsN, isPr, handle: profile.handle });
    } catch (e) {
      Alert.alert('Could not post', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setPosting(null);
      setUploading(null);
    }
  }

  if (media === null) {
    return (
      <ScreenBackground>
        <SafeAreaView style={[styles.safeArea, styles.center]}>
          <Text style={styles.emptyTitle}>Nothing to share</Text>
          <Text style={styles.emptyBody}>Share a photo or a video to Philoi from your share sheet to post it here.</Text>
          <Pressable onPress={() => router.back()} style={styles.ghostBtn} accessibilityRole="button">
            <Text style={styles.ghostBtnText}>Close</Text>
          </Pressable>
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.grab} />
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" disabled={busy}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.topTitle}>Your Agora</Text>
          <View style={styles.topSpacer} />
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <MediaPreview media={media} video={video} preparing={preparing} error={prepError} uploading={uploading} />

            <TextInput
              style={styles.input}
              value={body}
              onChangeText={(t) => setBody(t.slice(0, MAX))}
              placeholder="Say something about it…"
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={MAX}
              accessibilityLabel="Post text"
            />

            {isVideo ? (
              <View style={styles.question}>
                <Text style={styles.questionTitle}>Posting this to the Agora 🔥</Text>
                <Text style={styles.questionSub}>Does it include a fitness PR others can try to match?</Text>
                <View style={styles.toggle}>
                  <Text style={styles.toggleLabel}>⚔ Make it a challenge</Text>
                  <Switch
                    value={challenge}
                    onValueChange={setChallenge}
                    disabled={busy}
                    trackColor={{ true: Colors.navEmber, false: Colors.spaceLine }}
                    thumbColor="#FFFFFF"
                    accessibilityLabel="Make it a challenge"
                  />
                </View>
                {challenge ? (
                  <>
                    <Pressable
                      style={styles.field}
                      onPress={() => setExercisePicker(true)}
                      accessibilityRole="button"
                      accessibilityLabel={exercise ? `Exercise, ${exercise.name}` : 'Pick the exercise'}>
                      <Text style={[styles.fieldText, !exercise && styles.fieldPlaceholder]} numberOfLines={1}>
                        {exercise?.name ?? 'Exercise — e.g. Deadlift'}
                      </Text>
                      <Ionicons name="chevron-down" size={14} color={Colors.textTertiary} />
                    </Pressable>
                    <View style={styles.statRow}>
                      <TextInput
                        style={[styles.field, styles.statInput]}
                        value={weight}
                        onChangeText={(t) => setWeight(t.replace(/[^0-9.,]/g, '').slice(0, 6))}
                        placeholder="405"
                        placeholderTextColor={Colors.textTertiary}
                        keyboardType="decimal-pad"
                        accessibilityLabel="Weight"
                      />
                      <Pressable
                        style={[styles.field, styles.unit]}
                        onPress={() => setUnit((u) => (u === 'lb' ? 'kg' : 'lb'))}
                        accessibilityRole="button"
                        accessibilityLabel={`Unit ${unit}, tap to switch`}>
                        <Text style={styles.unitText}>{unit}</Text>
                      </Pressable>
                      <TextInput
                        style={[styles.field, styles.repsInput]}
                        value={reps}
                        onChangeText={(t) => setReps(t.replace(/[^0-9]/g, '').slice(0, 3))}
                        placeholder="1"
                        placeholderTextColor={Colors.textTertiary}
                        keyboardType="number-pad"
                        accessibilityLabel="Reps"
                      />
                      <Text style={styles.repsLabel}>reps</Text>
                    </View>
                    <Text style={styles.questionNote}>
                      {tooLongForLift
                        ? `This clip is ${formatClipLength(video?.durationS ?? 0)} — a challenge clip can be up to ${SHARED_LIFT_MAX_SECONDS}s.`
                        : 'The clip is the proof: it plays on the post, friends can ⚔ to beat it, and anyone can dispute it.'}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.whoLabel}>WHO SEES IT</Text>
            <AudienceOption
              icon="friends"
              label="Friends only"
              sub="just the people you added"
              on={visibility === 'friends'}
              onPress={() => setVisibility('friends')}
            />
            <AudienceOption
              icon="everyone"
              label="Everyone"
              sub="public on Philoi"
              on={visibility === 'public'}
              onPress={() => setVisibility('public')}
            />
            <Text style={styles.note}>Comment-only · no likes. Tagged “from your story”.</Text>
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.foot}>
          {isVideo && challenge ? (
            <>
              <Pressable
                style={[styles.ghostBtn, (!mediaReady || busy) && styles.btnOff]}
                onPress={() => confirmAudience(() => void postPlain())}
                disabled={!mediaReady || busy}
                accessibilityRole="button">
                {posting === 'plain' ? <ActivityIndicator color={Colors.muted} /> : <Text style={styles.ghostBtnText}>Just post it</Text>}
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, (!mediaReady || !liftReady || busy) && styles.btnOff]}
                onPress={() => confirmAudience(() => void postLift())}
                disabled={!mediaReady || !liftReady || busy}
                accessibilityRole="button">
                {posting === 'lift' ? (
                  <ActivityIndicator color={Colors.onEmber} />
                ) : (
                  <Text style={styles.primaryBtnText}>Post with ⚔</Text>
                )}
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.primaryBtn, (!mediaReady || busy) && styles.btnOff]}
              onPress={() => confirmAudience(() => void postPlain())}
              disabled={!mediaReady || busy}
              accessibilityRole="button">
              {posting ? <ActivityIndicator color={Colors.onEmber} /> : <Text style={styles.primaryBtnText}>Post it</Text>}
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      <ExercisePicker
        visible={exercisePicker}
        onClose={() => setExercisePicker(false)}
        onPick={(e) => {
          setExercise(e);
          setExercisePicker(false);
        }}
      />
      <LiftStorySheet
        visible={story !== null}
        stat={story}
        onClose={() => {
          setStory(null);
          router.back();
        }}
      />
    </ScreenBackground>
  );
}

function MediaPreview({
  media,
  video,
  preparing,
  error,
  uploading,
}: {
  media: SharedMedia | undefined;
  video: PreparedAgoraVideo | null;
  preparing: number | null;
  error: string | null;
  uploading: number | null;
}) {
  if (!media) {
    return (
      <View style={[styles.preview, styles.previewCenter]}>
        <ActivityIndicator color={Colors.navEmber2} />
      </View>
    );
  }
  if (!isSharedVideo(media)) {
    return <Image source={{ uri: media.uri }} style={styles.preview} contentFit="cover" />;
  }
  if (error) {
    return (
      <View style={[styles.preview, styles.previewCenter]}>
        <Text style={styles.previewText}>{error}</Text>
      </View>
    );
  }
  if (!video) {
    return (
      <View style={[styles.preview, styles.previewCenter]}>
        <ActivityIndicator color={Colors.navEmber2} />
        <Text style={styles.previewText}>Preparing video… {Math.round((preparing ?? 0) * 100)}%</Text>
      </View>
    );
  }
  return (
    <View>
      <Image source={{ uri: video.posterUri }} style={styles.preview} contentFit="cover" />
      <View style={styles.length}>
        <Ionicons name="play" size={10} color={Colors.ink} />
        <Text style={styles.lengthText}>{formatClipLength(video.durationS)}</Text>
      </View>
      {uploading !== null ? (
        <View style={styles.uploadTrack}>
          <View style={[styles.uploadFill, { width: `${Math.round(uploading * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

/** Weighted lifts only — what a verified_lift head-to-head compares. Built-ins and your own customs. */
function ExercisePicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (e: Exercise) => void }) {
  const [all, setAll] = useState<Exercise[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible || all !== null) return;
    fetchExercises()
      .then((rows) => setAll(rows.filter((e) => (e.unit ?? 'weight') === 'weight')))
      .catch(() => setAll([]));
  }, [visible, all]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (all ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return q ? rows.filter((e) => e.name.toLowerCase().includes(q)) : rows;
  }, [all, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Which lift?</Text>
          <TextInput
            style={styles.field}
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises"
            placeholderTextColor={Colors.textTertiary}
            autoCorrect={false}
            accessibilityLabel="Search exercises"
          />
          {all === null ? (
            <ActivityIndicator color={Colors.textTertiary} style={styles.sheetLoader} />
          ) : (
            <FlatList
              style={styles.sheetList}
              data={shown}
              keyExtractor={(e) => e.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.sheetEmpty}>No weighted lift by that name.</Text>}
              renderItem={({ item }) => (
                <Pressable style={styles.sheetRow} onPress={() => onPick(item)} accessibilityRole="button">
                  <Text style={styles.sheetRowText}>{item.name}</Text>
                  {item.muscle_group ? <Text style={styles.sheetRowSub}>{item.muscle_group}</Text> : null}
                </Pressable>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** agora/compose's WHO SEES IT row (mock 320's `.aopt`), the two square choices only. */
function AudienceOption({ icon, label, sub, on, onPress }: { icon: IconName; label: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.aopt, on && styles.aoptOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${label}, ${sub}`}>
      <Icon name={icon} size={19} color={Colors.ink} />
      <View style={styles.flex}>
        <Text style={styles.aoptName}>{label}</Text>
        <Text style={styles.aoptSub}>{sub}</Text>
      </View>
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

const GREEN = '#39D98A';

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four, gap: Spacing.two },
  emptyTitle: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 19, color: Colors.muted, textAlign: 'center', marginBottom: Spacing.two },
  grab: { alignSelf: 'center', width: 38, height: 4, borderRadius: 3, backgroundColor: '#3A2F55', marginTop: Spacing.two },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
  },
  cancel: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.muted, minWidth: 50 },
  topTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  topSpacer: { minWidth: 50 },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five },
  preview: { height: 200, borderRadius: Radius.card, backgroundColor: Colors.spacePanel },
  previewCenter: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  previewText: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.muted, textAlign: 'center' },
  length: {
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
  lengthText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.ink },
  uploadTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(6,5,10,0.6)' },
  uploadFill: { height: 4, backgroundColor: Colors.navEmber },
  input: {
    minHeight: 64,
    marginTop: Spacing.twelve,
    padding: Spacing.twelve,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.ink,
    textAlignVertical: 'top',
  },
  question: {
    marginTop: Spacing.twelve,
    padding: Spacing.twelve,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#3A2D18',
    backgroundColor: 'rgba(255,122,47,0.08)',
  },
  questionTitle: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  questionSub: { fontFamily: Fonts.body, fontSize: 11.5, lineHeight: 16, color: Colors.muted, marginTop: 4 },
  questionNote: { fontFamily: Fonts.body, fontSize: 10.5, lineHeight: 15, color: Colors.textTertiary, marginTop: Spacing.two },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel2,
  },
  toggleLabel: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  fieldText: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  fieldPlaceholder: { color: Colors.textTertiary },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statInput: { flex: 1 },
  unit: { minWidth: 44, justifyContent: 'center' },
  unitText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.muted },
  repsInput: { width: 54, textAlign: 'center' },
  repsLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.muted, marginTop: 9 },
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
  aoptOn: { borderColor: GREEN, backgroundColor: 'rgba(57,217,138,0.08)' },
  aoptName: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  aoptSub: { fontFamily: Fonts.body, fontSize: 10.5, color: Colors.textTertiary, marginTop: 1 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: GREEN },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  note: { textAlign: 'center', fontFamily: Fonts.body, fontSize: 10, color: Colors.spaceFaint, marginTop: Spacing.three },
  foot: { flexDirection: 'row', gap: 9, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: Colors.navEmber,
  },
  primaryBtnText: { fontFamily: Fonts.black, fontSize: 14.5, color: Colors.onEmber },
  ghostBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
  },
  ghostBtnText: { fontFamily: Fonts.bodyBold, fontSize: 14.5, color: Colors.muted },
  btnOff: { opacity: 0.45 },
  scrim: { flex: 1, backgroundColor: 'rgba(5,3,14,0.6)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: '#140E26',
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
  },
  sheetTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  sheetLoader: { marginVertical: Spacing.four },
  sheetList: { flexGrow: 0, marginTop: Spacing.two },
  sheetEmpty: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary, marginTop: Spacing.twelve },
  sheetRow: {
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.spaceLine,
  },
  sheetRowText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  sheetRowSub: { fontFamily: Fonts.body, fontSize: 10.5, color: Colors.textTertiary, marginTop: 2 },
});
