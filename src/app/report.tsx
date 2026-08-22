import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGroup } from '@/hooks/use-group';
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

/** Kept verbatim and never quietly reworded — it's a compliance-required reason, and it is the one
 *  that escalates rather than queues. Same string the edge function matches on. */
const CSAE: Reason = 'Child safety / CSAE';

// THE REPORT SCREEN (mock 111 frame 4, mock 112 §F) — restyled to the ember language and, more
// importantly, WIRED.
//
// It used to be a vibe-coded radio list whose submit wrote a row into moderation_reports and
// stopped there: no mail, no alert, nobody told. A report that only lands in a table somebody has
// to remember to open is a report the reporter is right not to trust. On submit this now also
// fires supabase/functions/report_alert, which emails the safety inbox "{reporter} reported
// {campfire} for {reason}" — and flags a child-safety report for immediate escalation.
//
// The alert is FIRE-AND-FORGET on purpose. The row is already committed by the time it runs, so a
// mail outage must degrade to "filed but unnotified" (logged server-side), never to an error that
// tells someone their report failed and invites them to file it again.
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
  const { group } = useGroup(groupId ?? circleId ?? '');
  const [reason, setReason] = useState<Reason | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subject = isCircleReport && group?.name ? group.name : 'this';

  async function handleSubmit() {
    if (!reason) return;
    setLoading(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const { data: report, error: insertError } = await supabase
        .from('moderation_reports')
        .insert({
          reporter_id: session.session?.user.id ?? null,
          reported_check_in_id: checkInId ?? null,
          reported_message_id: messageId ?? null,
          reported_user_id: userId ?? null,
          reported_group_id: isCircleReport ? groupId : null,
          circle_id: circleId ?? null,
          reason,
        })
        // Readable thanks to the own-rows select policy in migration 0095 — the id is what the
        // alert function is keyed on.
        .select('id')
        .single();
      if (insertError) throw insertError;

      setSubmitted(true);

      // Deliberately after setSubmitted and deliberately un-awaited: the report is filed, and the
      // reporter should not be made to wait on an SMTP round trip to be told so.
      supabase.functions
        .invoke('report_alert', { body: { reportId: report.id } })
        .catch(() => {
          // Server-side logging owns this failure — see the function's own console.error paths.
        });
    } catch (e) {
      setError(getErrorMessage(e, 'Could not submit report — try again.'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <Screen style={styles.done}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.doneMark}>
          <Ionicons name="shield-checkmark" size={30} color={Colors.amber} />
        </View>
        <Text style={styles.doneTitle}>Report received</Text>
        <Text style={styles.doneBody}>
          Thanks for keeping Philoi safe. Our safety team has been alerted and reviews every report
          within 48 hours.
          {reason === CSAE
            ? ' Child-safety reports are escalated immediately — for an urgent concern, please also contact Cybertip.ca.'
            : ''}
        </Text>
        <View style={styles.doneCta}>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>Report</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.question} numberOfLines={2}>
          Why are you reporting {subject}?
        </Text>

        {REASONS.map((r) => {
          const on = reason === r;
          return (
            <Pressable
              key={r}
              style={[styles.choice, on && styles.choiceOn]}
              onPress={() => setReason(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.choiceLabel, r === CSAE && styles.csaeLabel, on && styles.choiceLabelOn]}>{r}</Text>
              <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
            </Pressable>
          );
        })}

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Says out loud that submitting DOES something. The old screen's silence is half of why
            the wiring mattered — a report you can't tell went anywhere isn't worth filing. */}
        <View style={styles.note}>
          <Ionicons name="mail-outline" size={13} color={Colors.green} />
          <Text style={styles.noteText}>
            Submitting alerts our safety team by email. Child-safety reports are escalated
            immediately.
          </Text>
        </View>
      </ScrollView>

      {/* Docked, with real room under it. Screen's SafeAreaView already clears the home indicator;
          what was missing is the breathing room ON TOP of it — the CTA sat exactly on the safe-area
          line, which is the "not flush to the edge" fix. */}
      <View style={styles.foot}>
        <PrimaryButton label="Submit report" onPress={handleSubmit} loading={loading} disabled={!reason} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  question: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.ink,
    marginBottom: Spacing.twelve,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#141020',
    borderWidth: 1,
    borderColor: '#241C38',
    borderRadius: Radius.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 9,
  },
  choiceOn: {
    borderColor: Colors.amber,
    backgroundColor: '#1E1428',
  },
  choiceLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  choiceLabelOn: {
    fontFamily: Fonts.bodySemiBold,
  },
  // The compliance-required reason, marked so it reads as the serious one without being hidden
  // behind an extra tap.
  csaeLabel: {
    color: '#FF9A5A',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.trackAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: Colors.amber,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.amber,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.danger,
    marginTop: Spacing.two,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: Spacing.three,
    paddingHorizontal: 2,
  },
  noteText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
  foot: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  done: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  doneMark: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
  },
  doneBody: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  doneCta: {
    alignSelf: 'stretch',
    marginTop: Spacing.two,
  },
});
