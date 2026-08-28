import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import {
  categoryPatch,
  CATEGORY_SUBTYPES,
  formatHour,
  isCategoryEnabled,
  isPrefKeyEnabled,
  NOTIFICATION_CATEGORIES,
  resolveNotificationPrefs,
  setMyNotificationPrefs,
  type NotificationCategoryKey,
  type ResolvedNotificationPrefs,
} from '@/lib/notification-prefs';
import { supabase } from '@/lib/supabase';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function NotificationsSettingsScreen() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState(() => resolveNotificationPrefs(profile?.notification_prefs));
  const [showPreviews, setShowPreviews] = useState(profile?.show_message_previews ?? false);
  const [hourPicker, setHourPicker] = useState<'quiet_start' | 'quiet_end' | 'reminder_hour' | null>(null);
  // One category open at a time. An accordion rather than independent disclosures: with five
  // rows and four sub-toggles under the widest one, letting them all sit open turns a settings
  // list into a wall of switches you have to scroll to find the next category in.
  const [expanded, setExpanded] = useState<NotificationCategoryKey | null>(null);

  // Optimistic: apply locally, then persist the whole blob; roll back on error.
  // `undefined` in a patch DELETES the key — that is how a category returns to "use the server's
  // per-type defaults" instead of being pinned on. See categoryPatch.
  function update(patch: Partial<ResolvedNotificationPrefs> & Record<string, boolean | number | undefined>) {
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

        {/* Five spec categories, each an accordion over the push events it actually routes.
            The category writes its `cat_*` key (which gates the new event pipeline) AND every
            legacy key it subsumes — see categoryPatch — so the two systems can never disagree.

            Expanding one shows the per-type switches that are genuinely enforced (the legacy keys
            notify_push maps, migration 0027) and then spells out what else rides on the category
            with no switch of its own. Nesting rather than listing both side by side is what keeps
            it readable: the category is plainly the master, the types plainly the detail.

            Turning any of it off stops the PUSH only. Everything still lands in the bell, which
            is what makes muting safe: you stop being interrupted without losing the record. */}
        <Text style={styles.sectionLabel}>CATEGORIES</Text>
        <View style={styles.group}>
          {NOTIFICATION_CATEGORIES.map((cat) => {
            const prefsRecord = prefs as unknown as Record<string, unknown>;
            const on = isCategoryEnabled(prefsRecord, cat.key);
            const open = expanded === cat.key;
            const subtypes = CATEGORY_SUBTYPES[cat.key];
            // A sub-toggle is only meaningful while its category is letting anything through.
            const subOff = masterOff || !on;
            return (
              <View key={cat.key}>
                <Pressable
                  style={[styles.row, masterOff && styles.rowDisabled]}
                  onPress={() => setExpanded(open ? null : cat.key)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${cat.label}. ${open ? 'Hide' : 'Show'} what this covers`}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{cat.label}</Text>
                    <Text style={styles.rowDescription}>{cat.description}</Text>
                  </View>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color={Colors.textTertiary}
                  />
                  <Toggle
                    value={!masterOff && on}
                    disabled={masterOff}
                    onValueChange={(v) => update(categoryPatch(cat.key, v))}
                  />
                </Pressable>

                {open && (
                  <View style={styles.detail}>
                    {subtypes.map((item) => (
                      <View key={item.key} style={[styles.subRow, subOff && styles.rowDisabled]}>
                        <View style={styles.rowText}>
                          <Text style={styles.subLabel}>{item.label}</Text>
                          <Text style={styles.rowDescription}>{item.description}</Text>
                        </View>
                        <Toggle
                          value={!subOff && isPrefKeyEnabled(prefsRecord, item.key)}
                          disabled={subOff}
                          onValueChange={(v) => update({ [item.key]: v })}
                        />
                      </View>
                    ))}
                    {cat.covers.length > 0 && (
                      <>
                        <Text style={styles.coversLabel}>
                          {subtypes.length > 0 ? 'ALSO INCLUDED' : 'INCLUDED'}
                        </Text>
                        {cat.covers.map((line) => (
                          <View key={line} style={styles.coverRow}>
                            <View style={styles.coverDot} />
                            <Text style={styles.coverText}>{line}</Text>
                          </View>
                        ))}
                        <Text style={styles.coverNote}>
                          {subtypes.length > 0
                            ? 'These follow the category switch — they have no separate control.'
                            : 'These follow the category switch above.'}
                        </Text>
                      </>
                    )}
                  </View>
                )}
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
  // The per-type detail under an expanded category. Inset and a shade darker so it reads as
  // "inside" its category rather than as a sixth category.
  detail: {
    backgroundColor: Colors.cardDark,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.three,
    paddingBottom: Spacing.three,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.twelve,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  subLabel: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.ink,
  },
  coversLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  coverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  coverDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textTertiary,
  },
  coverText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  coverNote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
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
