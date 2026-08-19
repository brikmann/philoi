import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrivacySelector } from '@/components/privacy-selector';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
import { updateCampfireHouseRules, updateCampfirePrivacy, updateGroup } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import { RANK_TIER_LABEL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { CampfirePrivacy, GoalType, RankTierName } from '@/types/database';

// Same lightweight theme set as group/create.tsx — kept in sync there rather than shared,
// since duplicating a 4-line array is cheaper than a shared-module indirection for two files.
const THEME_OPTIONS: { value: GoalType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'custom', icon: 'flame' },
  { value: 'study', icon: GOAL_TYPE_ICON.study },
  { value: 'gym', icon: GOAL_TYPE_ICON.gym },
  { value: 'run', icon: GOAL_TYPE_ICON.run },
];

function themeEmoji(type: GoalType): string {
  return type === 'custom' ? '🔥' : GOAL_TYPE_META[type].emoji;
}

// The join gate's choices (design-mocks/94). Deliberately NOT the full ten-tier ladder — a gate is a
// filter on strangers, and past Diamond there is nobody left to filter. Null is the first option
// because "anyone" is the honest default for a campfire that hasn't decided.
const GATE_OPTIONS: (RankTierName | null)[] = [null, 'bronze', 'silver', 'gold', 'platinum', 'diamond'];

// design-mocks/10's create form, pre-filled — same stage/field/icon-tile styling. Privacy
// (PHILOI_UI_SPEC.md §14: "editable by the owner in campfire settings / Edit campfire at any
// point") is the one setting from create that's also editable here; class/course fields
// aren't (course-tagging a campfire after the fact isn't part of this pass).
export default function EditGroupScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { group, refetch } = useGroup(groupId);
  const [name, setName] = useState('');
  const [goalType, setGoalType] = useState<GoalType>('custom');
  const [privacy, setPrivacy] = useState<CampfirePrivacy>('open');
  const [minJoinTier, setMinJoinTier] = useState<RankTierName | null>(null);
  const [houseRule, setHouseRule] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setGoalType(group.goal_type);
    setPrivacy(group.privacy);
    setMinJoinTier(group.min_join_tier);
    setHouseRule(group.house_rule ?? '');
  }, [group]);

  async function handleSave() {
    if (!name.trim()) {
      setError('Give your campfire a name.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await updateGroup(groupId, { name: name.trim(), emoji: themeEmoji(goalType) });
      if (group && privacy !== group.privacy) {
        await updateCampfirePrivacy(groupId, privacy);
      }
      // Owner-only RPC — a member editing here would already have been stopped by the update above,
      // but the house rules carry their own check server-side either way.
      if (group && (minJoinTier !== group.min_join_tier || houseRule.trim() !== (group.house_rule ?? ''))) {
        await updateCampfireHouseRules(groupId, { minJoinTier, houseRule: houseRule.trim() || null });
      }
      await refetch();
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not update your campfire.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.title}>Edit campfire</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.lbl}>Name</Text>
          <View style={styles.field}>
            <View style={styles.fieldIcon}>
              <Ionicons name={THEME_OPTIONS.find((t) => t.value === goalType)?.icon ?? 'flame'} size={15} color={Colors.amber} />
            </View>
            <TextInput style={styles.fieldInput} placeholder="e.g. Morning Lifters" value={name} onChangeText={setName} maxLength={40} />
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
                  <Ionicons name={option.icon} size={16} color={on ? Colors.amber : Colors.muted} />
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.lbl}>Who can join</Text>
          <PrivacySelector value={privacy} onChange={setPrivacy} />

          {/* The join gate (mock 94's chip). Applies to people finding you through discovery — an
              invite code still gets someone in, because that is a member vouching in person. */}
          <Text style={styles.lbl}>Minimum rank to join</Text>
          <View style={styles.gateRow}>
            {GATE_OPTIONS.map((tier) => {
              const on = minJoinTier === tier;
              const metal = tier ? RANK_TIER_METAL[tier] : null;
              return (
                <Pressable
                  key={tier ?? 'any'}
                  onPress={() => setMinJoinTier(tier)}
                  style={[styles.gatePill, on && styles.gatePillOn, on && metal ? { borderColor: metal.outer } : null]}>
                  <Text style={[styles.gateLabel, on ? { color: metal?.text ?? Colors.achieverText } : null]}>
                    {tier ? `${RANK_TIER_LABEL[tier]}+` : 'Anyone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.lbl}>House rule</Text>
          <View style={styles.field}>
            <View style={styles.fieldIcon}>
              <Ionicons name="flame" size={15} color={Colors.amber} />
            </View>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. 2h/day minimum, six days a week"
              value={houseRule}
              onChangeText={setHouseRule}
              maxLength={160}
              multiline
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <Pressable style={styles.saveBtn} onPress={handleSave} disabled={loading}>
          <Ionicons name="checkmark" size={17} color={Colors.ink} />
          <Text style={styles.saveLabel}>{loading ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 15,
    paddingTop: 16,
    paddingBottom: 14,
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
    paddingBottom: 16,
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
  gateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  gatePill: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  gatePillOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  gateLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: 8,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.coral,
    borderRadius: 14,
    padding: 14,
  },
  saveLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
});
