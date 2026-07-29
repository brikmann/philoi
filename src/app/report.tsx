import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const REASONS = [
  'Spam or misleading',
  'Harassment or bullying',
  'Inappropriate or offensive content',
  'Child safety / CSAE',
  'Other',
] as const;

type Reason = (typeof REASONS)[number];

export default function ReportScreen() {
  const router = useRouter();
  // groupId = reporting the circle itself (maps to reported_group_id). circleId = context only,
  // for a profile report made from inside a specific circle (e.g. the leaderboard) — the other
  // target types (message/check-in) don't need it, snapshot_reported_content() in schema.sql
  // fills circle_id in for those automatically.
  const { checkInId, messageId, userId, groupId, circleId } = useLocalSearchParams<{
    checkInId?: string;
    messageId?: string;
    userId?: string;
    groupId?: string;
    circleId?: string;
  }>();
  const isCircleReport = Boolean(groupId) && !checkInId && !messageId && !userId;
  const [reason, setReason] = useState<Reason | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!reason) return;
    setLoading(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const { error: insertError } = await supabase.from('moderation_reports').insert({
        reporter_id: session.session?.user.id ?? null,
        reported_check_in_id: checkInId ?? null,
        reported_message_id: messageId ?? null,
        reported_user_id: userId ?? null,
        reported_group_id: isCircleReport ? groupId : null,
        circle_id: circleId ?? null,
        reason,
      });
      if (insertError) throw insertError;
      setSubmitted(true);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not submit report — try again.'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <Screen style={styles.container}>
        <Stack.Screen options={{ title: 'Report submitted' }} />
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.successTitle}>Report received</Text>
        <Text style={styles.successBody}>
          Thanks for keeping Philoi safe. We review all reports and take action within 48 hours.
          For urgent child-safety concerns, please also contact{' '}
          <Text style={styles.link}>Cybertip.ca</Text>.
        </Text>
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Report' }} />
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.label}>Why are you reporting this?</Text>
        {REASONS.map((r) => (
          <Pressable
            key={r}
            style={[styles.option, reason === r && styles.optionSelected]}
            onPress={() => setReason(r)}>
            <View style={[styles.radio, reason === r && styles.radioSelected]} />
            <Text style={[styles.optionLabel, r === 'Child safety / CSAE' && styles.csaeLabel]}>{r}</Text>
          </Pressable>
        ))}
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="Submit report" onPress={handleSubmit} loading={loading} disabled={!reason} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  list: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    marginBottom: Spacing.one,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.input,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  optionSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.achieverBg,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  radioSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.coral,
  },
  optionLabel: {
    fontFamily: Fonts.body,
    color: Colors.ink,
    flex: 1,
  },
  csaeLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.coral,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
  successEmoji: {
    fontSize: 48,
  },
  successTitle: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.ink,
  },
  successBody: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  link: {
    color: Colors.coral,
    textDecorationLine: 'underline',
  },
});
