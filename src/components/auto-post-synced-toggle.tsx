import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { setMyAutoPostSynced } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';

// Per-campfire consent to auto-post a synced workout (PHILOI_UI_SPEC.md §17b) — publishing on
// the user's behalf, so this is opt-in, default off, and scoped to exactly the one campfire it's
// toggled for. Only shown when at least one device-fitness source is connected (see
// settings.tsx) — otherwise there's nothing that would ever trigger it.
export function AutoPostSyncedToggle({
  groupId,
  groupName,
  groupEmoji,
  initialEnabled,
}: {
  groupId: string;
  groupName: string;
  groupEmoji: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(value: boolean) {
    const previous = enabled;
    setEnabled(value);
    setError(null);
    try {
      await setMyAutoPostSynced(groupId, value);
    } catch (e) {
      setEnabled(previous);
      setError(getErrorMessage(e, 'Could not update this campfire.'));
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.labelColumn}>
        <Text style={styles.name}>
          {groupEmoji} {groupName}
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
      <Toggle value={enabled} onValueChange={handleToggle} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  labelColumn: {
    flex: 1,
    gap: Spacing.one,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
  },
});
