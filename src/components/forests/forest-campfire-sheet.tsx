import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ForestSheet } from '@/components/forests/forest-bits';
import { SpaceButton, SpaceChip } from '@/components/ui/space-kit';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { createCampfireInForest } from '@/lib/api/forests';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_TYPE_META, goalTypeForChoice } from '@/lib/goal-types';
import type { GoalType, Group } from '@/types/database';

// "+ Start a campfire in this forest" — the funnel's last step. An ordinary campfire (same owner
// row, same join code) pre-linked to the forest, so challenges and dares run in it exactly as now.
//
// The same four themes group/create offers, derived through goalTypeForChoice so this list can't
// name a type the taxonomy has retired. Cadence is the same constant placeholder group/create
// writes ('flexible'): campfires stopped enforcing frequency, the column is only NOT NULL.

const CADENCE = 'flexible';
const THEMES: GoalType[] = ['custom', goalTypeForChoice('study'), goalTypeForChoice('fitness', 'strength'), goalTypeForChoice('fitness', 'cardio')];
const EMOJIS = ['🔥', '🏋️', '📚', '🏃', '🧠', '⚡'];

export function ForestCampfireSheet({
  forestId,
  visible,
  onClose,
  onCreated,
}: {
  forestId: string;
  visible: boolean;
  onClose: () => void;
  onCreated: (group: Group) => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [goalType, setGoalType] = useState<GoalType>('custom');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = name.trim().length >= 2 && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const group = await createCampfireInForest({ forestId, name, emoji, goalType, cadence: CADENCE });
      setName('');
      onCreated(group);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not start the campfire.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ForestSheet visible={visible} onClose={busy ? () => {} : onClose} title="Start a campfire here">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.hint}>Forest members see its join code and can step straight in.</Text>

        <Text style={styles.label}>NAME</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="The Anvil"
          placeholderTextColor={Colors.spaceFaint}
          maxLength={40}
          editable={!busy}
          accessibilityLabel="Campfire name"
        />

        <Text style={styles.label}>EMOJI</Text>
        <View style={styles.chips}>
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => setEmoji(e)}
              style={[styles.emoji, emoji === e && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: emoji === e }}>
              <Text style={styles.emojiText}>{e}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>WHAT YOU’LL LOCK IN ON</Text>
        <View style={styles.chips}>
          {THEMES.map((t) => (
            <SpaceChip
              key={t}
              label={t === 'custom' ? 'Anything' : GOAL_TYPE_META[t].label}
              selected={goalType === t}
              onPress={() => setGoalType(t)}
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* canCreate already folds in !busy, so `disabled` covers the in-flight state too. */}
        <SpaceButton label="Start campfire" onPress={() => void create()} disabled={!canCreate} loading={busy} style={styles.cta} />
      </KeyboardAvoidingView>
    </ForestSheet>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: Colors.spaceFaint,
    marginTop: Spacing.three,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  emoji: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  emojiText: {
    fontSize: 19,
  },
  chipOn: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginTop: Spacing.twelve,
  },
  cta: {
    marginTop: Spacing.three,
  },
});
