import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import {
  categoryPatch,
  formatHour,
  isCategoryEnabled,
  NOTIFICATION_CATEGORIES,
  resolveNotificationPrefs,
  setMyNotificationPrefs,
  type ResolvedNotificationPrefs,
} from '@/lib/notification-prefs';
import { supabase } from '@/lib/supabase';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function NotificationsSettingsScreen() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState(() => resolveNotificationPrefs(profile?.notification_prefs));
  const [showPreviews, setShowPreviews] = useState(profile?.show_message_previews ?? false);
  const [hourPicker, setHourPicker] = useState<'quiet_start' | 'quiet_end' | 'reminder_hour' | null>(null);

  // Optimistic: apply locally, then persist the whole blob; roll back on error.
  function update(patch: Partial<ResolvedNotificationPrefs>) {
    const previous = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setMyNotificationPrefs(next).catch(() => setPrefs(previous));
  }

  async function handleTogglePreviews(value: boolean) {
    setShowPreviews(value);
    try {
      await supabase.from('profiles').update({ show_message_previews: value }).eq('id', profile?.id ?? '');
    } catch {
      setShowPreviews(!value);
    }
  }

  function handlePickHour(hour: number) {
    if (hourPicker) update({ [hourPicker]: hour });
    setHourPicker(null);
  }

  const masterOff = !prefs.master;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.intro}>
          Choose what Philoi pings you about. Your device&apos;s system settings can turn everything off.
        </Text>

        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>All notifications</Text>
              <Text style={styles.rowDescription}>Master switch — off silences every push below</Text>
            </View>
            <Toggle value={prefs.master} onValueChange={(v) => update({ master: v })} />
          </View>
        </View>

        {/* The five spec categories replace the six fine-grained toggles that used to sit here.
            Each one writes its `cat_*` key (which gates the new event pipeline) AND every legacy
            key it subsumes — see categoryPatch — so there is exactly one switch per subject and no
            way for the two systems to end up disagreeing.

            Turning a category off stops the PUSH only. Everything still lands in the bell, which
            is what makes muting safe: you stop being interrupted without losing the record. */}
        <Text style={styles.sectionLabel}>CATEGORIES</Text>
        <View style={styles.group}>
          {NOTIFICATION_CATEGORIES.map((cat) => {
            const on = isCategoryEnabled(prefs as unknown as Record<string, unknown>, cat.key);
            return (
              <View key={cat.key} style={[styles.row, masterOff && styles.rowDisabled]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{cat.label}</Text>
                  <Text style={styles.rowDescription}>{cat.description}</Text>
                </View>
                <Toggle
                  value={!masterOff && on}
                  disabled={masterOff}
                  onValueChange={(v) => update(categoryPatch(cat.key, v))}
                />
              </View>
            );
          })}
        </View>
        <Text style={styles.footnote}>
          Muted categories still show up in your activity feed — you just won&apos;t get a push.
        </Text>

        {/* The spec's daily-reminder time. Reuses the same hour picker as quiet hours rather than
            pulling in a native time-picker dependency for one row. */}
        <Text style={styles.sectionLabel}>DAILY REMINDER</Text>
        <View style={styles.group}>
          <View style={[styles.row, masterOff && styles.rowDisabled]}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Remind me to lock in</Text>
              <Text style={styles.rowDescription}>One nudge a day if you haven&apos;t fed the fire</Text>
            </View>
            <Toggle
              value={!masterOff && prefs.reminder_enabled}
              disabled={masterOff}
              onValueChange={(v) => update({ reminder_enabled: v })}
            />
          </View>
          {prefs.reminder_enabled && !masterOff ? (
            <Pressable style={styles.row} onPress={() => setHourPicker('reminder_hour')}>
              <Text style={styles.rowLabel}>Time</Text>
              <Text style={styles.rowValue}>{formatHour(prefs.reminder_hour)}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>QUIET HOURS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Quiet hours</Text>
              <Text style={styles.rowDescription}>Pause notifications overnight, in your local time</Text>
            </View>
            <Toggle value={prefs.quiet_enabled} onValueChange={(v) => update({ quiet_enabled: v })} />
          </View>
          {prefs.quiet_enabled && (
            <>
              <Pressable style={styles.row} onPress={() => setHourPicker('quiet_start')}>
                <Text style={styles.rowLabel}>Starts</Text>
                <Text style={styles.rowValue}>{formatHour(prefs.quiet_start)}</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </Pressable>
              <Pressable style={styles.row} onPress={() => setHourPicker('quiet_end')}>
                <Text style={styles.rowLabel}>Ends</Text>
                <Text style={styles.rowValue}>{formatHour(prefs.quiet_end)}</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </Pressable>
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>LOCK SCREEN</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Show message previews</Text>
              <Text style={styles.rowDescription}>Show the message text on your lock screen</Text>
            </View>
            <Toggle value={showPreviews} onValueChange={handleTogglePreviews} />
          </View>
        </View>
      </ScrollView>

      {/* Hour picker for the quiet-hours window — no native time picker dependency. */}
      <Modal visible={hourPicker !== null} transparent animationType="fade" onRequestClose={() => setHourPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setHourPicker(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>
              {hourPicker === 'reminder_hour'
                ? 'Daily reminder'
                : hourPicker === 'quiet_end'
                  ? 'Quiet hours end'
                  : 'Quiet hours start'}
            </Text>
            <ScrollView style={styles.hourList}>
              {HOURS.map((hour) => {
                const selected = hourPicker ? prefs[hourPicker] === hour : false;
                return (
                  <Pressable
                    key={hour}
                    style={[styles.hourRow, selected && styles.hourRowSelected]}
                    onPress={() => handlePickHour(hour)}>
                    <Text style={[styles.hourLabel, selected && styles.hourLabelSelected]}>{formatHour(hour)}</Text>
                    {selected && <Ionicons name="checkmark" size={18} color={Colors.coral} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footnote: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textTertiary,
    paddingHorizontal: Spacing.four,
    marginTop: -Spacing.two,
    marginBottom: Spacing.two,
  },
  container: {
    padding: Spacing.four,
  },
  intro: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
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
  group: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    marginBottom: Spacing.four,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  rowDescription: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  rowValue: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  hourList: {
    maxHeight: 320,
  },
  hourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
  },
  hourRowSelected: {
    backgroundColor: Colors.selectedBg,
  },
  hourLabel: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  hourLabelSelected: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ember,
  },
});
