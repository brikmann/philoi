import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { ForestSheet, SheetRow } from '@/components/forests/forest-bits';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { FOREST_REPORT_REASONS, reportForest } from '@/lib/api/forests';
import { getErrorMessage } from '@/lib/errors';

type Reason = (typeof FOREST_REPORT_REASONS)[number];

// Report a forest itself, not one post in it (0274's moderation_reports.reported_forest_id).
// Five reasons, so a sheet — an Alert would drop two of them on Android.
export function ForestReportSheet({
  forestId,
  visible,
  onClose,
  onReported,
}: {
  forestId: string;
  visible: boolean;
  onClose: () => void;
  onReported: () => void;
}) {
  const [sending, setSending] = useState<Reason | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(reason: Reason) {
    if (sending) return;
    setSending(reason);
    setError(null);
    try {
      await reportForest(forestId, reason);
      onClose();
      onReported();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not send the report.'));
    } finally {
      setSending(null);
    }
  }

  return (
    <ForestSheet visible={visible} onClose={onClose} title="Report this forest">
      <Text style={styles.hint}>What’s wrong with it? A person reviews every report.</Text>
      {FOREST_REPORT_REASONS.map((r) => (
        <SheetRow
          key={r}
          label={r}
          disabled={sending !== null}
          onPress={() => void send(r)}
          right={
            sending === r ? (
              <ActivityIndicator size="small" color={Colors.amber} />
            ) : (
              <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
            )
          }
        />
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SheetRow label="Cancel" onPress={onClose} />
    </ForestSheet>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: Spacing.one,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginTop: Spacing.two,
  },
});
