import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { clearGroupReminder, getGroupReminder, setGroupReminder } from '@/lib/notifications';

const PRESET_TIMES = [
  { label: '7:00 AM', hour: 7, minute: 0 },
  { label: '12:00 PM', hour: 12, minute: 0 },
  { label: '6:00 PM', hour: 18, minute: 0 },
  { label: '8:00 PM', hour: 20, minute: 0 },
];

export function ReminderSettings({
  groupId,
  groupName,
  groupEmoji,
}: {
  groupId: string;
  groupName: string;
  groupEmoji: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState(PRESET_TIMES[2]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGroupReminder(groupId).then((existing) => {
      if (existing) {
        setEnabled(true);
        const match = PRESET_TIMES.find((t) => t.hour === existing.hour && t.minute === existing.minute);
        if (match) setTime(match);
      }
    });
  }, [groupId]);

  async function handleToggle(value: boolean) {
    setEnabled(value);
    setError(null);
    try {
      if (value) {
        await setGroupReminder({ groupId, groupName, hour: time.hour, minute: time.minute });
      } else {
        await clearGroupReminder(groupId);
      }
    } catch (e) {
      setEnabled(!value);
      setError(getErrorMessage(e, 'Could not update reminders.'));
    }
  }

  async function handlePickTime(option: (typeof PRESET_TIMES)[number]) {
    setTime(option);
    if (enabled) {
      await setGroupReminder({ groupId, groupName, hour: option.hour, minute: option.minute });
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.labelColumn}>
        <Text style={styles.name}>
          {groupEmoji} {groupName}
        </Text>
        {enabled && (
          <View style={styles.timeRow}>
            {PRESET_TIMES.map((option) => (
              <Pressable key={option.label} onPress={() => handlePickTime(option)}>
                <Text style={[styles.timeChip, option.label === time.label && styles.timeChipActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
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
  timeRow: {
    flexDirection: 'row',
    gap: Spacing.one,
    flexWrap: 'wrap',
  },
  timeChip: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
  },
  timeChipActive: {
    color: '#FFFFFF',
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
  },
});
