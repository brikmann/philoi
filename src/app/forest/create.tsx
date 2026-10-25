import { useRouter } from 'expo-router';
import { useState } from 'react';
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

import { ScreenBackground } from '@/components/ui/screen-background';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { createForest } from '@/lib/api/forests';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { shortSchoolName } from '@/lib/universities';
import type { ForestVisibility } from '@/types/social';

// CREATE A FOREST (CODE_PROMPT_agora_forests.md §3). "Low friction — a forest is cheap to make,
// unlike a campfire": a name is the only required field. The limits below mirror 0274's checks
// (name 3–40, purpose ≤120, ≤6 tags); the server still enforces them, plus the UGC filter, the
// per-user rate limit and the one-name-per-university rule — and its message is shown verbatim,
// because "you've made too many forests today" is more useful than "something went wrong".

const NAME_MIN = 3;
const NAME_MAX = 40;
const PURPOSE_MAX = 120;
const TAG_MAX = 6;
const TAG_LEN = 24;
const EMOJIS = ['🌲', '🔥', '🏋️', '📚', '🧠', '🏃', '🎓', '⏰', '🎧', '💻'];

export default function CreateForestScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [tagDraft, setTagDraft] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<ForestVisibility>('open');
  const [thisUniOnly, setThisUniOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasUni = Boolean(profile?.university);
  const trimmed = name.trim();
  const canCreate = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX && !busy;

  function addTag() {
    // Lowercased, no '#', no spaces — tags are for search, so "Pre-Med" and "#premed " are one tag.
    const t = tagDraft.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase().slice(0, TAG_LEN);
    setTagDraft('');
    if (!t || tags.includes(t) || tags.length >= TAG_MAX) return;
    setTags((prev) => [...prev, t]);
  }

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createForest({
        name: trimmed,
        purpose,
        emoji,
        tags,
        visibility,
        thisUniOnly: hasUni && thisUniOnly,
      });
      router.replace({ pathname: '/forest/[id]', params: { id } });
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create the forest.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.topTitle}>New forest</Text>
          <Pressable
            onPress={() => void create()}
            disabled={!canCreate}
            style={[styles.createBtn, !canCreate && styles.createBtnOff]}
            accessibilityRole="button"
            accessibilityLabel="Create forest">
            {busy ? (
              <ActivityIndicator size="small" color={Colors.onEmber} />
            ) : (
              <Text style={[styles.createText, !canCreate && styles.createTextOff]}>Create</Text>
            )}
          </Pressable>
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.lede}>Find your forest. Gather at the fire.</Text>

            <View style={styles.preview}>
              <Text style={styles.previewEmoji}>{emoji}</Text>
            </View>
            <View style={styles.emojis}>
              {EMOJIS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => setEmoji(e)}
                  style={[styles.emoji, emoji === e && styles.on]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: emoji === e }}>
                  <Text style={styles.emojiText}>{e}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Powerlifting @ Laurier"
              placeholderTextColor={Colors.textTertiary}
              maxLength={NAME_MAX}
              editable={!busy}
              accessibilityLabel="Forest name"
            />
            <Text style={styles.count}>
              {trimmed.length > 0 && trimmed.length < NAME_MIN ? `At least ${NAME_MIN} characters · ` : ''}
              {trimmed.length}/{NAME_MAX}
            </Text>

            <Text style={styles.label}>PURPOSE</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={purpose}
              onChangeText={setPurpose}
              placeholder="One line on who it’s for"
              placeholderTextColor={Colors.textTertiary}
              maxLength={PURPOSE_MAX}
              multiline
              editable={!busy}
              accessibilityLabel="Forest purpose"
            />
            <Text style={styles.count}>
              {purpose.length}/{PURPOSE_MAX}
            </Text>

            <Text style={styles.label}>TAGS · UP TO {TAG_MAX}</Text>
            {tags.length > 0 ? (
              <View style={styles.tags}>
                {tags.map((t) => (
                  <Pressable
                    key={t}
                    style={styles.tag}
                    onPress={() => setTags((prev) => prev.filter((x) => x !== t))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove tag ${t}`}>
                    <Text style={styles.tagText}>#{t} ×</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {tags.length < TAG_MAX ? (
              <TextInput
                style={styles.input}
                value={tagDraft}
                onChangeText={setTagDraft}
                onSubmitEditing={addTag}
                onBlur={addTag}
                placeholder="powerlifting, 6am, finals…"
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                blurOnSubmit={false}
                editable={!busy}
                accessibilityLabel="Add a tag"
              />
            ) : null}

            <Text style={styles.label}>WHO CAN JOIN</Text>
            <View style={styles.segment}>
              {(
                [
                  { key: 'open', label: 'Open', hint: 'Anyone can join and read' },
                  { key: 'request', label: 'Request to join', hint: 'You approve each member' },
                ] as const
              ).map((v) => {
                const on = visibility === v.key;
                return (
                  <Pressable
                    key={v.key}
                    style={[styles.segOption, on && styles.on]}
                    onPress={() => setVisibility(v.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}>
                    <Text style={[styles.segLabel, on && styles.segLabelOn]}>{v.label}</Text>
                    <Text style={styles.segHint}>{v.hint}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.uniRow, !hasUni && styles.off]}>
              <View style={styles.flex}>
                <Text style={styles.uniTitle}>Only people at my university</Text>
                <Text style={styles.uniSub}>
                  {hasUni
                    ? `Visible to ${shortSchoolName(profile?.university ?? '')} only`
                    : 'Set your university in your profile to use this'}
                </Text>
              </View>
              <Toggle
                value={hasUni && thisUniOnly}
                onValueChange={setThisUniOnly}
                disabled={!hasUni || busy}
                accessibilityLabel="Only people at my university"
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
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
  createBtn: {
    minWidth: 70,
    alignItems: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: Colors.amber,
  },
  createBtnOff: {
    backgroundColor: Colors.disabledSurface,
  },
  createText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.onEmber,
  },
  createTextOff: {
    color: Colors.disabledText,
  },
  scroll: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  lede: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontStyle: 'italic',
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  preview: {
    alignSelf: 'center',
    width: 68,
    height: 68,
    borderRadius: 20,
    marginTop: Spacing.three,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: `${Colors.amber}44`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewEmoji: {
    fontSize: 34,
  },
  emojis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.twelve,
  },
  emoji: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  emojiText: {
    fontSize: 19,
  },
  on: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.amber,
  },
  off: {
    opacity: 0.55,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.textTertiary,
    marginTop: Spacing.four,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 11,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  inputMulti: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  count: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    textAlign: 'right',
    marginTop: 4,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: Spacing.two,
  },
  tag: {
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: Colors.selectedBg,
  },
  tagText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.sky,
  },
  segment: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  segOption: {
    flex: 1,
    borderRadius: 14,
    padding: Spacing.twelve,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  segLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  segLabelOn: {
    color: Colors.ember,
  },
  segHint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 3,
  },
  uniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    marginTop: Spacing.four,
    borderRadius: 14,
    padding: Spacing.twelve,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  uniTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  uniSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.danger,
    marginTop: Spacing.three,
    textAlign: 'center',
  },
});
