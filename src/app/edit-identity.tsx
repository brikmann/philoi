import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import { SettingsGlyph } from '@/components/ui/glyphs-settings';
import { SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchProfileIdentity, setMyIdentity } from '@/lib/api/identity';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { IdentityPatch, IdentityVisibility } from '@/types/social';

// Mock 283's "Edit identity" — every field on one screen, all optional, behind one visibility dial.
// The limits mirror 0272's own checks so the counter stops you before the server has to; the
// server still runs its UGC filter on every string and its message is shown verbatim, because it
// is written to be read ("Keep it under 60 characters.").
//
// SAVE SENDS EVERY FIELD. set_my_identity is a patch, but this screen IS the whole identity, so a
// field you emptied has to be sent as a clear rather than left out. That is also why Save waits
// on the load: saving a form that never got its values would wipe whatever was there.

const MAX_CAREER = 60;
const MAX_LINE = 80;
const MAX_TAG = 24;
const MAX_TAGS = 8;
// The only links 0272 keeps — anything else is silently dropped server-side, so say so up front.
const ANTHEM_URL = /^https:\/\/(open\.spotify\.com|music\.apple\.com)\//;

const VISIBILITY: { key: IdentityVisibility; label: string }[] = [
  { key: 'friends', label: 'Friends' },
  { key: 'campus', label: 'Campus' },
  { key: 'public', label: 'Public' },
];

type LoadState = 'loading' | 'ready' | 'failed';

export default function EditIdentityScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const myId = profile?.id ?? null;

  const [load, setLoad] = useState<LoadState>('loading');
  const [career, setCareer] = useState('');
  const [toward, setToward] = useState('');
  const [workingOn, setWorkingOn] = useState('');
  const [anthemTitle, setAnthemTitle] = useState('');
  const [anthemArtist, setAnthemArtist] = useState('');
  const [anthemUrl, setAnthemUrl] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [visibility, setVisibility] = useState<IdentityVisibility>('friends');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the async callbacks set state, so the mount effect below never sets state synchronously.
  const loadIdentity = useCallback(() => {
    if (!myId) return;
    fetchProfileIdentity(myId)
      .then((row) => {
        setCareer(row?.career_goal ?? '');
        setToward(row?.working_toward ?? '');
        setWorkingOn(row?.working_on ?? '');
        setAnthemTitle(row?.anthem?.title ?? '');
        setAnthemArtist(row?.anthem?.artist ?? '');
        setAnthemUrl(row?.anthem?.url ?? '');
        setInterests(row?.interests ?? []);
        setVisibility(row?.visibility ?? 'friends');
        setLoad('ready');
      })
      .catch(() => setLoad('failed'));
  }, [myId]);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  function addTag() {
    const tag = tagDraft.trim().toLowerCase();
    if (!tag) return;
    // The server lowercases and dedupes too; doing it here keeps the chips honest about what saves.
    if (!interests.includes(tag) && interests.length < MAX_TAGS) setInterests([...interests, tag]);
    setTagDraft('');
  }

  async function handleSave() {
    if (saving || load !== 'ready') return;
    const url = anthemUrl.trim();
    if (url && !ANTHEM_URL.test(url)) {
      setError('Anthem links have to be a Spotify or Apple Music link (https://open.spotify.com/… or https://music.apple.com/…).');
      return;
    }
    const title = anthemTitle.trim();
    const patch: IdentityPatch = {
      career_goal: career.trim() || null,
      working_toward: toward.trim() || null,
      working_on: workingOn.trim() || null,
      anthem: title ? { title, artist: anthemArtist.trim() || null, url: url || null } : null,
      interests,
      visibility,
    };
    setSaving(true);
    setError(null);
    try {
      await setMyIdentity(patch);
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your identity — try again.'));
    } finally {
      setSaving(false);
    }
  }

  const canSave = load === 'ready' && !saving;

  return (
    // Top edge only: the global footer sits under every screen and owns the bottom inset.
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <SpaceHeader
        title="Your identity"
        right={
          // Mock 283's ember "Save" pill, in the header's right slot.
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={8}
            style={[styles.save, !canSave && styles.saveOff]}
            accessibilityRole="button"
            accessibilityLabel="Save identity">
            {saving ? (
              <ActivityIndicator size="small" color="#2A0F05" />
            ) : (
              <Text style={[styles.saveText, !canSave && styles.saveTextOff]}>Save</Text>
            )}
          </Pressable>
        }
      />

      {load === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.navEmber} />
        </View>
      ) : load === 'failed' ? (
        // Not a blank form: saving a form that never loaded would clear whatever is stored.
        <View style={styles.centered}>
          <Text style={styles.failText}>Couldn&apos;t load your identity right now.</Text>
          <Pressable
            onPress={() => {
              setLoad('loading');
              loadIdentity();
            }}
            hitSlop={8}
            accessibilityRole="button">
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <Text style={styles.k}>What you wanna be</Text>
              <TextInput
                style={[styles.input, styles.inputCareer]}
                value={career}
                onChangeText={setCareer}
                placeholder="what are you locking in for?"
                placeholderTextColor={Colors.textTertiary}
                maxLength={MAX_CAREER}
              />
              <Text style={styles.count}>
                {career.length}/{MAX_CAREER}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.k}>Working toward</Text>
              <TextInput
                style={styles.input}
                value={toward}
                onChangeText={setToward}
                placeholder="first 100kg bench · by December"
                placeholderTextColor={Colors.textTertiary}
                maxLength={MAX_LINE}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.k}>Working on</Text>
              <TextInput
                style={styles.input}
                value={workingOn}
                onChangeText={setWorkingOn}
                placeholder="strength block · orgo midterm · 5k pace"
                placeholderTextColor={Colors.textTertiary}
                maxLength={MAX_LINE}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.k}>Lock-in anthem</Text>
              <View style={styles.anthemRow}>
                <View style={styles.art}>
                  <SettingsGlyph name="music" size={16} color={Colors.ink} />
                </View>
                <View style={styles.flex}>
                  <TextInput
                    style={styles.input}
                    value={anthemTitle}
                    onChangeText={setAnthemTitle}
                    placeholder="Song title"
                    placeholderTextColor={Colors.textTertiary}
                    maxLength={MAX_LINE}
                  />
                  <TextInput
                    style={[styles.input, styles.inputSub]}
                    value={anthemArtist}
                    onChangeText={setAnthemArtist}
                    placeholder="Artist"
                    placeholderTextColor={Colors.textTertiary}
                    maxLength={MAX_LINE}
                  />
                </View>
              </View>
              <TextInput
                style={[styles.input, styles.inputSub]}
                value={anthemUrl}
                onChangeText={setAnthemUrl}
                placeholder="Spotify or Apple Music link (optional)"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={300}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.k}>
                Interests · {interests.length}/{MAX_TAGS}
              </Text>
              <View style={styles.tags}>
                {interests.map((t) => (
                  <Pressable
                    key={t}
                    style={styles.tag}
                    onPress={() => setInterests(interests.filter((x) => x !== t))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${t}`}>
                    <Text style={styles.tagText}>{t}</Text>
                    <UiGlyph name="close" size={11} color={Colors.spaceDim} />
                  </Pressable>
                ))}
              </View>
              {interests.length < MAX_TAGS ? (
                <View style={styles.tagAdd}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={tagDraft}
                    onChangeText={setTagDraft}
                    onSubmitEditing={addTag}
                    placeholder="powerlifting, anatomy…"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="none"
                    returnKeyType="done"
                    blurOnSubmit={false}
                    maxLength={MAX_TAG}
                  />
                  <Pressable
                    onPress={addTag}
                    disabled={!tagDraft.trim()}
                    hitSlop={8}
                    style={styles.addChip}
                    accessibilityRole="button"
                    accessibilityLabel="Add interest">
                    <Text style={[styles.addChipText, !tagDraft.trim() && styles.saveTextOff]}>+ add</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {/* The Agora's own three-way dial (0272 reuses can_see_milestone_for). Friends by default —
                privacy-first, and what mock 283 shows. Streak always shows; rank follows its own dial. */}
            <Text style={styles.visLabel}>All optional · visible to</Text>
            <View style={styles.vis}>
              {VISIBILITY.map((v) => {
                const on = visibility === v.key;
                return (
                  <Pressable
                    key={v.key}
                    style={[styles.visOpt, on && styles.visOptOn]}
                    onPress={() => setVisibility(v.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}>
                    <Text style={[styles.visText, on && styles.visTextOn]}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  flex: {
    flex: 1,
  },
  // Mock 283's ember "Save" pill in the header.
  save: {
    minWidth: 58,
    alignItems: 'center',
    backgroundColor: Colors.navEmber,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  saveOff: {
    backgroundColor: Colors.spacePanel2,
  },
  saveText: {
    fontFamily: Fonts.black,
    fontSize: 13,
    color: '#2A0F05',
  },
  saveTextOff: {
    color: Colors.spaceFaint,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  failText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  retry: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.navEmber2,
  },
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
    gap: 8,
  },
  card: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    padding: 13,
  },
  // SpaceSection's label, inside the card.
  k: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
  },
  // Bare inputs inside the card, like the mock's values — the card is the field.
  input: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    paddingVertical: 6,
    paddingHorizontal: 0,
    letterSpacing: 0,
  },
  // The headline field reads in the same gold it will wear under your name.
  inputCareer: {
    color: Colors.gold,
    fontFamily: Fonts.bodyBold,
  },
  inputSub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    paddingTop: 0,
  },
  count: {
    alignSelf: 'flex-end',
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.spaceFaint,
  },
  anthemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 4,
  },
  art: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#14A44A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 7,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  tagText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.legend,
  },
  tagAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 4,
  },
  addChip: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderWidth: 1,
    borderColor: Colors.navEmber,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  addChipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.navEmber2,
  },
  visLabel: {
    textAlign: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: Spacing.twelve,
  },
  vis: {
    flexDirection: 'row',
    gap: 6,
  },
  visOpt: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 10,
  },
  visOptOn: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  visText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  visTextOn: {
    color: Colors.navEmber2,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
    marginTop: Spacing.two,
  },
});
