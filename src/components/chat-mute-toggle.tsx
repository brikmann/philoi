import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { setChatMuted } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';

export function ChatMuteToggle({ groupId, initialMuted }: { groupId: string; initialMuted: boolean }) {
  const [muted, setMuted] = useState(initialMuted);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(value: boolean) {
    setMuted(value);
    setError(null);
    try {
      await setChatMuted(groupId, value);
    } catch (e) {
      setMuted(!value);
      setError(getErrorMessage(e, 'Could not update chat notifications.'));
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.labelColumn}>
        <Text style={styles.label}>Mute chat notifications</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
      <Switch value={muted} onValueChange={handleToggle} trackColor={{ true: Colors.coral, false: Colors.line }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  labelColumn: {
    flex: 1,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
  },
});
