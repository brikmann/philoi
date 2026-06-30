import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { setMyGoalTarget } from '@/lib/api/groups';

type MyGoalTargetProps = {
  groupId: string;
  current: string | null;
  onSaved: () => void;
};

export function MyGoalTarget({ groupId, current, onSaved }: MyGoalTargetProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await setMyGoalTarget(groupId, value.trim() || null);
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Pressable
        onPress={() => {
          setValue(current ?? '');
          setEditing(true);
        }}
        style={styles.row}>
        <Text style={styles.label}>🎯 My target</Text>
        <Text style={styles.value}>{current ?? 'Set a target — e.g. "A in CHEM101"'}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.editContainer}>
      <TextInput placeholder="e.g. A in CHEM101" value={value} onChangeText={setValue} maxLength={60} autoFocus />
      <View style={styles.editActions}>
        <Pressable onPress={() => setEditing(false)} style={styles.actionButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={handleSave} disabled={saving} style={styles.actionButton}>
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.input,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.achieverText,
  },
  value: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  editContainer: {
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.three,
  },
  actionButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  cancelText: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.muted,
  },
  saveText: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.coral,
  },
});
