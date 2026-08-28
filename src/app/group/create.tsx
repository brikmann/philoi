import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrivacySelector } from '@/components/privacy-selector';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { FlameLogo } from '@/components/ui/flame-logo';
import { DisciplineIcon, type DisciplineIconName } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { createGroup, setMyHelperFlag } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';
import { markOnboardingDone } from '@/lib/onboarding';
import type { CampfirePrivacy, GoalType } from '@/types/database';

// No rigid cadence enforced (PHILOI_UI_SPEC.md §12/§14 — frequency rigidity was deliberately
// dropped from the lock-in loop, and that extends to campfires too). The column is still
// NOT NULL server-side, so a constant placeholder goes in — it's never shown or asked about.
const DEFAULT_CADENCE = 'flexible';

// The circle-level "theme" is a small, lightweight enum purely for discovery matching — not
// the full personal GoalType set. "Custom" doubles as the general/default option (the flame
// tile, matching design-mocks/10's default-selected icon) rather than reusing its lock-in-
// picker icon ('add'), since here it represents "this campfire," not "something uncategorized."
const THEME_OPTIONS: { value: GoalType; icon: DisciplineIconName }[] = [
  { value: 'custom', icon: 'flame' },
  { value: 'study', icon: GOAL_TYPE_GLYPH.study },
  { value: 'gym', icon: GOAL_TYPE_GLYPH.gym },
  { value: 'run', icon: GOAL_TYPE_GLYPH.run },
];

function themeEmoji(type: GoalType): string {
  return type === 'custom' ? '🔥' : GOAL_TYPE_META[type].emoji;
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.tog}>
      <View style={styles.togIcon}>
        <Ionicons name={icon} size={16} color={Colors.amber} />
      </View>
      <View style={styles.togText}>
        <Text style={styles.togTitle}>{title}</Text>
        <Text style={styles.togSubtitle}>{subtitle}</Text>
      </View>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}

export default function CreateGroupScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const isOnboarding = onboarding === 'true';
  const [name, setName] = useState('');
  const [goalType, setGoalType] = useState<GoalType>('custom');
  const [privacy, setPrivacy] = useState<CampfirePrivacy>('open');
  const [isClass, setIsClass] = useState(false);
  const [courseCode, setCourseCode] = useState('');
  const [isHelper, setIsHelper] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "For a class?" defaults Discoverable on (PHILOI_UI_SPEC.md §14: "default on for class
  // campfires so classmates can find + join by course") — set directly in the toggle's own
  // handler below, not derived via an effect, so flipping it on is a single state update.
  function handleToggleClass(next: boolean) {
    setIsClass(next);
    if (next) setPrivacy((p) => (p === 'private' ? 'open' : p));
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give your campfire a name.');
      return;
    }
    if (isClass && !courseCode.trim()) {
      setError('Add a course code for your class campfire.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const group = await createGroup({
        name: name.trim(),
        emoji: themeEmoji(goalType),
        goalType,
        cadence: DEFAULT_CADENCE,
        privacy,
        courseCode: isClass ? courseCode.trim() : null,
        school: isClass ? (profile?.university ?? null) : null,
      });

      if (isClass && isHelper) {
        await setMyHelperFlag(group.id, true).catch(() => {
          // Non-critical — the campfire is already created; the helper badge can be set later from settings.
        });
      }

      await markOnboardingDone();
      router.replace(
        isOnboarding ? `/lock-in?type=${goalType}&circleId=${group.id}` : `/group/${group.id}/invite`
      );
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create your campfire.'));
      setLoading(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.title}>Start a campfire</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {isOnboarding && (
            <Text style={styles.onboardingIntro}>Name your campfire — you can invite friends right after.</Text>
          )}

          <Text style={styles.lbl}>Name</Text>
          <View style={styles.field}>
            <View style={styles.fieldIcon}>
              <DisciplineIcon name={THEME_OPTIONS.find((t) => t.value === goalType)?.icon ?? 'flame'} size={15} color={Colors.amber} />
            </View>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. Morning Lifters"
              value={name}
              onChangeText={setName}
              maxLength={40}
            />
          </View>

          <View style={styles.emrow}>
            {THEME_OPTIONS.map((option) => {
              const on = goalType === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setGoalType(option.value)}
                  style={[styles.iconTile, on && styles.iconTileOn]}
                  accessibilityLabel={GOAL_TYPE_META[option.value].label}>
                  <DisciplineIcon name={option.icon} size={16} color={on ? Colors.amber : Colors.muted} />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.divider} />

          <ToggleRow
            icon="school"
            title="For a class?"
            subtitle="Make it a course study-hall"
            value={isClass}
            onValueChange={handleToggleClass}
          />

          {isClass && (
            <>
              <View style={styles.nest}>
                <Text style={styles.lbl}>Course</Text>
                <View style={styles.field}>
                  <TextInput
                    style={styles.fieldInputNoIcon}
                    placeholder="e.g. CP164 · Data Structures"
                    value={courseCode}
                    onChangeText={setCourseCode}
                    maxLength={60}
                  />
                </View>
                {profile?.university && (
                  <View style={styles.chip}>
                    <Ionicons name="location" size={11} color={Colors.soloChipText} />
                    <Text style={styles.chipText}>{profile.university}</Text>
                  </View>
                )}
              </View>

              <ToggleRow
                icon="ribbon"
                title="I can help with this class"
                subtitle="Flags you as someone who's aced it"
                value={isHelper}
                onValueChange={setIsHelper}
              />
            </>
          )}

          <Text style={styles.lbl}>Who can join</Text>
          <PrivacySelector value={privacy} onChange={setPrivacy} />

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <Pressable style={styles.createBtn} onPress={handleCreate} disabled={loading}>
          <FlameLogo size={17} />
          <Text style={styles.createLabel}>{loading ? 'Lighting…' : 'Light the campfire'}</Text>
        </Pressable>

        {isOnboarding && (
          <Text
            style={styles.skipLink}
            onPress={async () => {
              await markOnboardingDone();
              router.replace('/');
            }}>
            Skip for now
          </Text>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 15,
    paddingTop: 16,
    // "Light the campfire" was flush against the safe-area line — this is the gap above it.
    paddingBottom: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
  },
  form: {
    paddingBottom: Spacing.three,
  },
  onboardingIntro: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    marginBottom: Spacing.two,
  },
  lbl: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 12,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  fieldIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13,
    color: Colors.ink,
  },
  fieldInputNoIcon: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13,
    color: Colors.ink,
  },
  emrow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTileOn: {
    backgroundColor: Colors.achieverBg,
    borderWidth: 1.5,
    borderColor: Colors.coral,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.line,
    marginTop: 16,
    marginBottom: 4,
  },
  tog: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
  },
  togIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  togText: {
    flex: 1,
  },
  togTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  togSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  nest: {
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
    marginVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.soloChipText,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.coral,
    borderRadius: 14,
    padding: 14,
  },
  createLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  skipLink: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: Spacing.two,
  },
});
