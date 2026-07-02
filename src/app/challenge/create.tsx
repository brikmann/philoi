import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyGroups } from '@/hooks/use-my-groups';
import { createChallenge } from '@/lib/api/challenges';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/lib/auth/auth-context';
import type { ChallengePeriod, ChallengeType } from '@/types/database';

const TYPE_OPTIONS: { value: ChallengeType; label: string; unit: string }[] = [
  { value: 'steps', label: '👟 Steps', unit: 'steps' },
  { value: 'gym_visits', label: '🏋️ Gym visits', unit: 'visits' },
  { value: 'study_hours', label: '📚 Study hours', unit: 'hours' },
  { value: 'custom', label: '🎯 Custom', unit: '' },
];

const PERIOD_OPTIONS: { value: ChallengePeriod; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'day', label: 'Today' },
];

export default function CreateChallengeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { groups } = useMyGroups();
  const [type, setType] = useState<ChallengeType>('steps');
  const [target, setTarget] = useState('10000');
  const [unit, setUnit] = useState('steps');
  const [customLabel, setCustomLabel] = useState('');
  const [period, setPeriod] = useState<ChallengePeriod>('week');
  const [circleId, setCircleId] = useState<string | null>(groups[0]?.id ?? null);
  const [shareWithCircle, setShareWithCircle] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Circles load async (useMyGroups' useFocusEffect fires after mount) — pick a default once
  // they arrive, but only if the user hasn't already picked one themselves.
  useEffect(() => {
    if (!circleId && groups.length > 0) setCircleId(groups[0].id);
  }, [groups, circleId]);

  function handlePickType(option: (typeof TYPE_OPTIONS)[number]) {
    setType(option.value);
    if (option.value !== 'custom') {
      setUnit(option.unit);
      setTarget(option.value === 'steps' ? '10000' : option.value === 'gym_visits' ? '4' : '10');
    } else {
      setUnit('');
      setTarget('');
    }
  }

  async function handleCreate() {
    if (!session) return;
    const targetNum = Number(target);
    if (!targetNum || targetNum <= 0) {
      setError('Enter a target greater than 0.');
      return;
    }
    if (!unit.trim()) {
      setError('Give it a unit — e.g. "reps", "pages".');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createChallenge({
        userId: session.user.id,
        circleId: shareWithCircle ? circleId : null,
        type,
        label: type === 'custom' ? customLabel.trim() || null : null,
        target: targetNum,
        unit: unit.trim(),
        period,
        visibility: shareWithCircle && circleId ? 'circle' : 'private',
      });
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create your challenge.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Goal type</Text>
      <View style={styles.row}>
        {TYPE_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => handlePickType(option)}
            style={[styles.chip, type === option.value && styles.chipSelected]}>
            <Text style={[styles.chipText, type === option.value && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {type === 'custom' && (
        <>
          <Text style={styles.label}>What are you tracking?</Text>
          <TextInput
            placeholder="e.g. Cold plunges"
            value={customLabel}
            onChangeText={setCustomLabel}
            maxLength={40}
          />
        </>
      )}

      <Text style={styles.label}>Target</Text>
      <View style={styles.targetRow}>
        <TextInput
          style={styles.targetInput}
          placeholder="e.g. 10000"
          keyboardType="numeric"
          value={target}
          onChangeText={setTarget}
        />
        <TextInput
          style={styles.unitInput}
          placeholder="unit"
          value={unit}
          onChangeText={setUnit}
          editable={type === 'custom'}
        />
      </View>

      <Text style={styles.label}>Window</Text>
      <View style={styles.row}>
        {PERIOD_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setPeriod(option.value)}
            style={[styles.chip, period === option.value && styles.chipSelected]}>
            <Text style={[styles.chipText, period === option.value && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.shareRow}>
        <View style={styles.shareText}>
          <Text style={styles.label}>Share with a circle</Text>
          <Text style={styles.shareHint}>
            Your progress shows up to that circle and feeds a challenge leaderboard — that's the pressure that keeps
            you honest.
          </Text>
        </View>
        <Toggle value={shareWithCircle} onValueChange={setShareWithCircle} />
      </View>

      {shareWithCircle && (
        <View style={styles.row}>
          {groups.length === 0 ? (
            <Text style={styles.shareHint}>Join or start a circle first to share a challenge.</Text>
          ) : (
            groups.map((group) => (
              <Pressable
                key={group.id}
                onPress={() => setCircleId(group.id)}
                style={[styles.chip, circleId === group.id && styles.chipSelected]}>
                <Text style={[styles.chipText, circleId === group.id && styles.chipTextSelected]}>
                  {group.emoji} {group.name}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton label="Start challenge" onPress={handleCreate} loading={saving} />
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
  targetRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  targetInput: {
    flex: 2,
  },
  unitInput: {
    flex: 1,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  shareText: {
    flex: 1,
    gap: Spacing.half,
  },
  shareHint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
});
