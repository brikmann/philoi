import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { createGoal } from '@/lib/api/goals';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_CADENCE_PRESETS, GOAL_TYPE_META, GOAL_TYPES } from '@/lib/goal-types';
import type { GoalType } from '@/types/database';

export default function CreateGoalScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [type, setType] = useState<GoalType>('gym');
  const [label, setLabel] = useState('');
  const [cadence, setCadence] = useState(GOAL_CADENCE_PRESETS.gym[1]);
  const [customCadence, setCustomCadence] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      await createGoal({
        userId: session.user.id,
        type,
        label: label.trim() || null,
        cadence: cadence.trim(),
      });
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create your goal.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>What are you working on?</Text>
      <View style={styles.row}>
        {GOAL_TYPES.map((option) => (
          <Pressable
            key={option}
            onPress={() => {
              setType(option);
              setCadence(GOAL_CADENCE_PRESETS[option][0]);
              setCustomCadence(false);
            }}
            style={[styles.chip, type === option && styles.chipSelected]}>
            <Text style={[styles.chipText, type === option && styles.chipTextSelected]}>
              {GOAL_TYPE_META[option].emoji} {GOAL_TYPE_META[option].label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Give it a name (optional)</Text>
      <TextInput
        placeholder={type === 'custom' ? 'e.g. Learn guitar' : `e.g. ${GOAL_TYPE_META[type].label}`}
        value={label}
        onChangeText={setLabel}
        maxLength={40}
      />

      <Text style={styles.label}>Cadence</Text>
      <View style={styles.row}>
        {GOAL_CADENCE_PRESETS[type].map((preset) => (
          <Pressable
            key={preset}
            onPress={() => {
              setCadence(preset);
              setCustomCadence(false);
            }}
            style={[styles.chip, !customCadence && cadence === preset && styles.chipSelected]}>
            <Text style={[styles.chipText, !customCadence && cadence === preset && styles.chipTextSelected]}>
              {preset}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => {
            setCustomCadence(true);
            setCadence('');
          }}
          style={[styles.chip, customCadence && styles.chipSelected]}>
          <Text style={[styles.chipText, customCadence && styles.chipTextSelected]}>Custom</Text>
        </Pressable>
      </View>
      {customCadence && (
        <TextInput placeholder="e.g. 2x/week, every other day" value={cadence} onChangeText={setCadence} maxLength={20} />
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton label="Start this goal" onPress={handleCreate} loading={loading} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
    // Was Colors.cream, an opaque flat fill that painted over the deep-purple radial. These
    // screens don't route through <Screen>, so the radial reaches them from the navigator's
    // scene background — an opaque colour here blocks it (Ember reskin sweep).
    backgroundColor: 'transparent',
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
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
});
