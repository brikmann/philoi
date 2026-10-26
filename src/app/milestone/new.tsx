import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsGlyph } from '@/components/ui/glyphs-settings';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceButton, SpaceHeader, SpaceIconButton, SPACE_GUTTER } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { UiGlyph } from '@/components/ui/ui-glyph';
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
    // A modal: no ScreenBackground of its own (the root paints the ground), and a close ✕ in the
    // header's right slot rather than a back chevron, because this sheet dismisses, it doesn't pop.
    <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SpaceHeader
          title="New Milestone"
          back={false}
          right={
            <SpaceIconButton onPress={() => router.back()} label="Close">
              <UiGlyph name="close" size={16} color={Colors.ink} />
            </SpaceIconButton>
          }
        />

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
                  <View style={styles.headTitleRow}>
                    <NavGlyph name="flame" size={13} color={Colors.navEmber2} />
                    <Text style={styles.receiptsTitle}>BACKED BY YOUR EFFORT</Text>
                  </View>
                  <Toggle value={attachEffort} onValueChange={setAttachEffort} />
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
                  <View style={styles.headTitleRow}>
                    <NavGlyph name="book" size={14} color={Colors.legend} />
                    <Text style={styles.pinTitle}>Pin to my Journal</Text>
                  </View>
                  <Toggle value={pinned} onValueChange={setPinned} />
                </View>
                <Text style={styles.receiptsSub}>
                  Keep it on your profile&rsquo;s Journal so it lives on. Off = share card only, nothing posted.
                </Text>
              </View>
            </View>

            {/* Stated to the user, not just enforced in SQL — the firewall is a promise about what
                Philoi rewards, and it only works as a promise if people can read it. */}
            <View style={styles.firewall}>
              <SettingsGlyph name="shield" size={14} color={Colors.green} />
              <Text style={styles.firewallText}>
                Milestones are just for sharing — they <Text style={styles.firewallStrong}>don&rsquo;t</Text> affect
                XP, embers, or rank. Philoi rewards the effort; this celebrates what it produced.
              </Text>
            </View>

            <SpaceButton
              label={saving ? 'Posting…' : 'Share milestone'}
              onPress={post}
              disabled={!headline.trim() || saving}
              style={styles.post}
            />
          </ScrollView>
        </KeyboardAvoidingView>
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
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  field: {
    marginTop: Spacing.three,
  },
  // SpaceSection's label.
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: Colors.spaceFaint,
    marginBottom: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  // SpaceChip's look (kept a local Pressable for its per-chip accessibility state).
  chip: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipOn: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  chipTextOn: {
    color: Colors.navEmber2,
  },
  // SpaceCard tone="ember" — the Philoi twist, on by default.
  receipts: {
    backgroundColor: 'rgba(255,122,47,0.08)',
    borderWidth: 1,
    borderColor: Colors.navEmber,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  receiptsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  receiptsTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.3,
    color: Colors.navEmber2,
  },
  receiptChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 9,
  },
  receiptChip: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
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
    fontSize: 10.5,
    color: Colors.spaceDim,
    marginTop: 8,
    lineHeight: 15,
  },
  vis: {
    flexDirection: 'row',
    gap: 7,
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
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.12)',
  },
  visText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  visTextOn: {
    color: Colors.navEmber2,
  },
  pin: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  pinTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  // SpaceCard tone="legend" — a promise, not an action.
  firewall: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: Spacing.three,
    backgroundColor: 'rgba(185,139,255,0.08)',
    borderWidth: 1,
    borderColor: '#3A2D5A',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  firewallText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.spaceDim,
  },
  firewallStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  post: {
    marginTop: Spacing.four,
  },
});
