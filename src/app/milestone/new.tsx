import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ui/screen-background';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import {
  MILESTONE_KINDS,
  VISIBILITY_OPTIONS,
  createMilestone,
  effortChips,
  fetchMyEffort,
} from '@/lib/api/milestones';
import { getErrorMessage } from '@/lib/errors';
import type { EffortKey, MilestoneEffort, MilestoneKind, MilestoneVisibility } from '@/types/database';

// §8 / mock Frame 5a — the Milestone composer.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🔒 THIS SCREEN GRANTS NOTHING. No reward screen follows it, no ember animation, no rank bump.
// It posts a content row and shows a share card. If a future change wants a payout here, that is a
// change to the product's premise, not to this file.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Reached from the "＋ Milestone" button in the Journal header on your own profile — milestones ARE
// user-authored journal entries, so that is the single natural home for the entry point.

export default function NewMilestoneScreen() {
  const router = useRouter();

  const [kind, setKind] = useState<MilestoneKind>('grade');
  const [headline, setHeadline] = useState('');
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<MilestoneVisibility>('friends');
  const [pinned, setPinned] = useState(true);
  const [attachEffort, setAttachEffort] = useState(true);
  const [effort, setEffort] = useState<MilestoneEffort>({});
  const [dropped, setDropped] = useState<Set<EffortKey>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    track('milestone_composer_opened', {});
  }, []);

  useEffect(() => {
    let current = true;
    fetchMyEffort()
      .then((e) => {
        if (current) setEffort(e);
      })
      .catch(() => {
        // No receipts is a fine state — the milestone posts without them.
      });
    return () => {
      current = false;
    };
  }, []);

  const chips = effortChips(effort);
  const keptKeys = attachEffort ? chips.map((c) => c.key).filter((k) => !dropped.has(k)) : [];

  function toggleChip(key: EffortKey) {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function post() {
    if (!headline.trim()) return;
    setSaving(true);
    try {
      const id = await createMilestone({
        kind,
        headline: headline.trim(),
        note: note.trim() || null,
        visibility,
        effortKeys: keptKeys,
        pinned,
      });
      // Straight to the card — the composer's job ends at "posted", and the share IS the point of
      // a milestone. replace() so Back from the card returns to the profile, not to a filled-in
      // composer that would post a second copy.
      router.replace({ pathname: '/milestone/[id]', params: { id, shared: '1' } });
    } catch (e) {
      Alert.alert('Could not post', getErrorMessage(e, 'Something went wrong posting your milestone.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={Colors.muted} />
          </Pressable>
          <Text style={styles.title}>New Milestone</Text>
          <View style={styles.topSpacer} />
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={styles.field}>
              <Text style={styles.label}>TYPE</Text>
              <View style={styles.chips}>
                {MILESTONE_KINDS.map((k) => (
                  <Pressable
                    key={k.key}
                    style={[styles.chip, kind === k.key && styles.chipOn]}
                    onPress={() => setKind(k.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: kind === k.key }}>
                    <Text style={[styles.chipText, kind === k.key && styles.chipTextOn]}>{k.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>HEADLINE</Text>
              <TextInput
                value={headline}
                onChangeText={setHeadline}
                placeholder="85% on the Orgo II midterm"
                maxLength={90}
                autoFocus
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>NOTE · optional</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="hardest exam of the term. the 4:30 mornings were worth it."
                maxLength={280}
                multiline
              />
            </View>

            {/* The Philoi twist, on by default: the outcome shown THROUGH the effort behind it. */}
            <View style={styles.field}>
              <View style={styles.receipts}>
                <View style={styles.receiptsHead}>
                  <Text style={styles.receiptsTitle}>⚡ BACKED BY YOUR EFFORT</Text>
                  <Switch
                    value={attachEffort}
                    onValueChange={setAttachEffort}
                    trackColor={{ true: Colors.amber, false: Colors.trackAlt }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                {attachEffort && chips.length > 0 ? (
                  <>
                    <View style={styles.receiptChips}>
                      {chips.map((c) => (
                        <Pressable
                          key={c.key}
                          onPress={() => toggleChip(c.key)}
                          style={[styles.receiptChip, dropped.has(c.key) && styles.receiptChipOff]}
                          accessibilityRole="button"
                          accessibilityLabel={`${c.label}, ${dropped.has(c.key) ? 'trimmed' : 'attached'}`}>
                          <Text style={[styles.receiptChipText, dropped.has(c.key) && styles.receiptChipTextOff]}>
                            {c.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.receiptsSub}>
                      Auto-pulled from your sessions this month · tap a stat to trim
                    </Text>
                  </>
                ) : (
                  <Text style={styles.receiptsSub}>
                    {attachEffort
                      ? 'No sessions in the last month yet — your milestone will post on its own.'
                      : 'Your milestone will post without the effort behind it.'}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>WHO CAN SEE IT</Text>
              <View style={styles.vis}>
                {VISIBILITY_OPTIONS.map((v) => (
                  <Pressable
                    key={v.key}
                    style={[styles.visOpt, visibility === v.key && styles.visOptOn]}
                    onPress={() => setVisibility(v.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: visibility === v.key }}>
                    <Text style={[styles.visText, visibility === v.key && styles.visTextOn]}>{v.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <View style={styles.pin}>
                <View style={styles.receiptsHead}>
                  <Text style={styles.pinTitle}>📓 Pin to my Journal</Text>
                  <Switch
                    value={pinned}
                    onValueChange={setPinned}
                    trackColor={{ true: Colors.amber, false: Colors.trackAlt }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                <Text style={styles.receiptsSub}>
                  Keep it on your profile&rsquo;s Journal so it lives on. Off = share card only, nothing posted.
                </Text>
              </View>
            </View>

            {/* Stated to the user, not just enforced in SQL — the firewall is a promise about what
                Philoi rewards, and it only works as a promise if people can read it. */}
            <View style={styles.firewall}>
              <Ionicons name="shield-checkmark-outline" size={14} color={Colors.green} />
              <Text style={styles.firewallText}>
                Milestones are just for sharing — they <Text style={styles.firewallStrong}>don&rsquo;t</Text> affect
                XP, embers, or rank. Philoi rewards the effort; this celebrates what it produced.
              </Text>
            </View>

            <Pressable
              style={[styles.post, (!headline.trim() || saving) && styles.postDisabled]}
              onPress={post}
              disabled={!headline.trim() || saving}
              accessibilityRole="button">
              <Text style={[styles.postText, (!headline.trim() || saving) && styles.postTextDisabled]}>
                {saving ? 'Posting…' : 'Share milestone'}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
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
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  topSpacer: {
    width: 22,
  },
  container: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  field: {
    marginTop: Spacing.three,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.muted,
    marginBottom: 7,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipOn: {
    backgroundColor: Colors.amber,
    borderColor: 'transparent',
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  chipTextOn: {
    color: Colors.onEmber,
  },
  receipts: {
    backgroundColor: 'rgba(242,163,60,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.30)',
    borderRadius: Radius.card,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  receiptsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  receiptsTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.3,
    color: Colors.amber,
  },
  receiptChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 9,
  },
  receiptChip: {
    backgroundColor: 'rgba(20,16,32,0.6)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  // Trimmed rather than removed: the stat stays on screen so the choice is reversible in one tap.
  receiptChipOff: {
    opacity: 0.4,
  },
  receiptChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink,
  },
  receiptChipTextOff: {
    textDecorationLine: 'line-through',
  },
  receiptsSub: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.muted,
    marginTop: 8,
    lineHeight: 14,
  },
  vis: {
    flexDirection: 'row',
    gap: 7,
  },
  visOpt: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.card,
    paddingVertical: 9,
  },
  visOptOn: {
    borderColor: Colors.amber,
    backgroundColor: Colors.selectedBg,
  },
  visText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  visTextOn: {
    color: Colors.ink,
  },
  pin: {
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  pinTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.ink,
  },
  firewall: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: Spacing.three,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  firewallText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Colors.muted,
  },
  firewallStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  post: {
    marginTop: Spacing.four,
    backgroundColor: Colors.amber,
    borderRadius: Radius.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  postDisabled: {
    backgroundColor: Colors.disabledSurface,
    borderWidth: 1,
    borderColor: Colors.disabledBorder,
  },
  postText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.onEmber,
  },
  postTextDisabled: {
    color: Colors.disabledText,
  },
});
