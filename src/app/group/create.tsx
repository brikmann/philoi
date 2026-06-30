import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { createGroup, fetchInviteLink } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import { markOnboardingDone } from '@/lib/onboarding';
import type { GoalType } from '@/types/database';

const EMOJI_OPTIONS = ['🔥', '🏋️', '🏃', '📚', '🧘', '🎯'];
const GOAL_TYPES: { value: GoalType; label: string }[] = [
  { value: 'gym', label: 'Gym' },
  { value: 'run', label: 'Run' },
  { value: 'study', label: 'Study' },
  { value: 'custom', label: 'Custom' },
];

// Cadence presets adapt to the goal — "study" is framed in hours, not session counts.
const CADENCE_PRESETS: Record<GoalType, string[]> = {
  gym: ['3x/week', '4x/week', '5x/week', 'Daily'],
  run: ['3x/week', '4x/week', '5x/week', 'Daily'],
  study: ['5 hrs/week', '10 hrs/week', '15 hrs/week', '20 hrs/week'],
  custom: ['3x/week', '4x/week', 'Daily', 'Weekly'],
};

export default function CreateGroupScreen() {
  const router = useRouter();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const isOnboarding = onboarding === 'true';
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI_OPTIONS[0]);
  const [goalType, setGoalType] = useState<GoalType>('gym');
  const [cadence, setCadence] = useState(CADENCE_PRESETS.gym[1]);
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ groupId: string; deepLink: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give your circle a name.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const group = await createGroup({
        name: name.trim(),
        emoji,
        goalType,
        cadence: cadence.trim(),
        isPublic,
      });
      const link = await fetchInviteLink(group.id, group.join_code);
      setInvite({ groupId: group.id, deepLink: link.deepLink });
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create your circle.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!invite) return;
    await Clipboard.setStringAsync(invite.deepLink);
    setCopied(true);
    track('invite_sent', { group_id: invite.groupId, source: 'create' });
  }

  if (invite) {
    return (
      <ScrollView contentContainerStyle={styles.successContainer}>
        <Text style={styles.successEmoji}>🔥</Text>
        <Text style={styles.successTitle}>Your circle is lit</Text>
        <Text style={styles.successBody}>Pull your people in — Philoi works better together.</Text>

        <Card style={styles.linkCard}>
          <Text style={styles.linkText}>{invite.deepLink}</Text>
        </Card>

        <SecondaryButton label={copied ? 'Copied!' : 'Copy invite link'} onPress={handleCopy} />

        <PrimaryButton
          label={isOnboarding ? 'Take my first photo' : 'Go to my circle'}
          onPress={async () => {
            await markOnboardingDone();
            router.replace(isOnboarding ? `/group/${invite.groupId}/check-in` : `/group/${invite.groupId}`);
          }}
        />

        {isOnboarding && (
          <Text
            style={styles.skipLink}
            onPress={async () => {
              await markOnboardingDone();
              router.replace(`/group/${invite.groupId}`);
            }}>
            I&apos;ll check in later
          </Text>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {isOnboarding && (
        <Text style={styles.onboardingIntro}>
          Pick a goal and name your circle — you can invite friends right after.
        </Text>
      )}

      <Text style={styles.label}>Circle name</Text>
      <TextInput placeholder="e.g. Morning Lifters" value={name} onChangeText={setName} maxLength={40} />

      <Text style={styles.label}>Pick an emoji</Text>
      <View style={styles.row}>
        {EMOJI_OPTIONS.map((option) => (
          <Pressable
            key={option}
            onPress={() => setEmoji(option)}
            style={[styles.emojiOption, emoji === option && styles.emojiSelected]}>
            <Text style={styles.emojiText}>{option}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Goal type</Text>
      <View style={styles.row}>
        {GOAL_TYPES.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => {
              setGoalType(option.value);
              setCadence(CADENCE_PRESETS[option.value][0]);
            }}
            style={[styles.chip, goalType === option.value && styles.chipSelected]}>
            <Text style={[styles.chipText, goalType === option.value && styles.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Cadence</Text>
      <View style={styles.row}>
        {CADENCE_PRESETS[goalType].map((preset) => (
          <Pressable
            key={preset}
            onPress={() => setCadence(preset)}
            style={[styles.chip, cadence === preset && styles.chipSelected]}>
            <Text style={[styles.chipText, cadence === preset && styles.chipTextSelected]}>{preset}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput placeholder="Or type a custom cadence" value={cadence} onChangeText={setCadence} maxLength={20} />

      <View style={styles.discoverRow}>
        <View style={styles.discoverText}>
          <Text style={styles.label}>Make discoverable</Text>
          <Text style={styles.discoverHint}>
            Others with the same goal (especially at your school) can find and join without a code.
          </Text>
        </View>
        <Switch
          value={isPublic}
          onValueChange={setIsPublic}
          trackColor={{ true: Colors.coral, false: Colors.line }}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton label="Build my circle" onPress={handleCreate} loading={loading} />

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
    backgroundColor: Colors.cream,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    marginTop: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  emojiOption: {
    width: 48,
    height: 48,
    borderRadius: Radius.input,
    borderWidth: 2,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.achieverBg,
  },
  emojiText: {
    fontSize: 22,
  },
  chip: {
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  chipSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.coral,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  onboardingIntro: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.muted,
    marginBottom: Spacing.two,
  },
  skipLink: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: Spacing.two,
  },
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  discoverText: {
    flex: 1,
    gap: Spacing.half,
  },
  discoverHint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
  successContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
    backgroundColor: Colors.cream,
  },
  successEmoji: {
    fontSize: 48,
  },
  successTitle: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.ink,
  },
  successBody: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
  },
  linkCard: {
    width: '100%',
  },
  linkText: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.plum,
    textAlign: 'center',
  },
});
