import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DEFAULT_HEIGHT_CM, HeightRuler, formatFeetInches } from '@/components/onboarding/height-ruler';
import {
  DEFAULT_WEIGHT_KG,
  WeightRuler,
  formatWeight,
  type WeightUnit,
} from '@/components/onboarding/weight-ruler';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { setMyHeightCm, setMyWeightKg } from '@/lib/api/relics';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

// Settings → Body. The editable home for the two numbers onboarding asks for, and the reason
// asking for them is defensible at all: a bodyweight is not a fact about a person, it is a
// measurement that goes stale over a season, and DIFFICULTY_SCOPING.md is explicit that the user
// must be able to change it whenever they like.
//
// WHY THIS SCREEN EXISTS AT ALL RATHER THAN TWO SETTINGS ROWS. Height shipped in 0119 and its
// onboarding step in a later pass, and neither ever gave Settings a way to correct it — so a
// mistyped height was permanent. Weight would have inherited exactly that, and a weight you
// cannot change is worse than one we never collected, because Cindy would keep scoring load goals
// against a number the user has since disowned.
//
// BOTH RULERS ARE THE ONBOARDING COMPONENTS, unmodified. A second, subtly different weight picker
// in Settings is how the two drift until they disagree about what 160 lb is.

export default function BodyMetricsScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();

  // `numeric` server-side, so PostgREST can hand either back as a string. Coerced once, here,
  // rather than inside the pickers — the same rule setup-handle.tsx follows.
  const savedHeight = Number(profile?.height_cm);
  const savedWeight = Number(profile?.weight_kg);
  const hasSavedHeight = Number.isFinite(savedHeight) && savedHeight > 0;
  const hasSavedWeight = Number.isFinite(savedWeight) && savedWeight > 0;

  const [heightCm, setHeightCm] = useState(hasSavedHeight ? Math.round(savedHeight) : DEFAULT_HEIGHT_CM);
  const [weightKg, setWeightKg] = useState(hasSavedWeight ? savedWeight : DEFAULT_WEIGHT_KG);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(profile?.weight_unit ?? 'lb');

  // Which rulers the user has actually moved. An untouched picker sitting on its default is not a
  // measurement, and Save must not turn "I never set a height" into a claim about this person's
  // body just because they came in to change their weight. Same contract as onboarding's skip.
  const [heightTouched, setHeightTouched] = useState(false);
  const [weightTouched, setWeightTouched] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = heightTouched || weightTouched;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Only the rulers that moved are written. Two RPCs rather than one because they are two
      // independent facts with two different fallbacks — a stride estimate and a scoping
      // denominator — and nothing is gained by coupling them.
      if (heightTouched) await setMyHeightCm(heightCm);
      if (weightTouched) await setMyWeightKg(weightKg, weightUnit);
      await refreshProfile();
      router.back();
    } catch (e) {
      // NOT swallowed, unlike onboarding's. There the write was optional and the account was the
      // point; here changing the number IS the whole point of the screen, so a silent failure
      // would send someone away believing they had corrected a weight they had not.
      setError(getErrorMessage(e, 'Could not save — try again.'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Forget the stored weight.
   *
   * A real, supported destination rather than a courtesy: null weight is the state Cindy's prompt
   * is written to handle (ask once, or fall back to the demographic anchors), so someone who
   * decides they would rather not have a bodyweight on file loses fairness on load goals and
   * nothing else. Height has no equivalent because its fallback — a 0.75 m adult-average stride —
   * is applied silently either way.
   */
  async function handleClearWeight() {
    setSaving(true);
    setError(null);
    try {
      await setMyWeightKg(null, weightUnit);
      await refreshProfile();
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not clear your weight — try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Body' }} />

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.blurb}>
          Both are optional and private. Height turns your steps into kilometres; weight lets Cindy
          score a lift against your own bodyweight instead of the raw number.
        </Text>

        <Text style={styles.sectionLabel}>HEIGHT</Text>
        <View style={styles.card}>
          <HeightRuler
            value={heightCm}
            onChange={(cm) => {
              setHeightCm(cm);
              setHeightTouched(true);
            }}
          />
          <Text style={styles.meta}>
            {hasSavedHeight
              ? `Saved: ${Math.round(savedHeight)} cm · ${formatFeetInches(Math.round(savedHeight))}`
              : 'Not set — we use an average stride'}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>WEIGHT</Text>
        <View style={styles.card}>
          <WeightRuler
            value={weightKg}
            unit={weightUnit}
            onUnitChange={setWeightUnit}
            onChange={(kg, source) => {
              setWeightKg(kg);
              // A unit switch moves the value to keep it on a tick; only a scroll is an edit.
              if (source === 'scroll') setWeightTouched(true);
            }}
          />
          <Text style={styles.meta}>
            {hasSavedWeight
              ? `Saved: ${formatWeight(savedWeight, weightUnit)} ${weightUnit}`
              : 'Not set — Cindy will ask, or score off average anchors'}
          </Text>
        </View>

        {/* The same promise onboarding makes, repeated where the number can be changed — the two
            places a user weighs up whether to tell us are the only two places it is worth saying. */}
        <View style={styles.privacy}>
          <Ionicons name="lock-closed" size={13} color={Colors.muted} />
          <Text style={styles.privacyText}>
            Never shown on your profile, and never used to hand out rewards — a personal record
            still pays nothing. It only makes your goals scale to you.
          </Text>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <PrimaryButton label="Save" loading={saving} disabled={!dirty} onPress={handleSave} />

        {hasSavedWeight && (
          <Pressable
            onPress={handleClearWeight}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.clear}
            disabled={saving}>
            <Text style={styles.clearText}>Forget my weight</Text>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 15,
    paddingBottom: 32,
    gap: Spacing.two,
  },
  blurb: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    marginBottom: Spacing.four,
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: Spacing.two,
    marginLeft: 2,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.four,
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.input,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: Spacing.four,
  },
  privacyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 14,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginBottom: Spacing.two,
  },
  clear: {
    alignSelf: 'center',
    paddingVertical: Spacing.twelve,
  },
  clearText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
});
