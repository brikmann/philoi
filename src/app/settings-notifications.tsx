import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PushOffBanner } from '@/components/push-off-banner';
import { SettingsGlyph } from '@/components/ui/glyphs-settings';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Screen } from '@/components/ui/screen';
import { SpaceHeader, SpaceSection, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Toggle } from '@/components/ui/toggle';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import {
  categoryPatch,
  CATEGORY_SUBTYPES,
  CATEGORY_TYPE_KEYS,
  formatHour,
  isCategoryEnabled,
  isPrefKeyEnabled,
  isTypeKeyEnabled,
  NOTIFICATION_CATEGORIES,
  resolveNotificationPrefs,
  setMyNotificationPrefs,
  type NotificationCategoryKey,
  type ResolvedNotificationPrefs,
} from '@/lib/notification-prefs';
import { supabase } from '@/lib/supabase';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** The 36px glyph tile that leads a top-level row — SpaceTile's spec. */
function Tile({ children }: { children: ReactNode }) {
  return <View style={styles.tile}>{children}</View>;
}

export default function NotificationsSettingsScreen() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState(() => resolveNotificationPrefs(profile?.notification_prefs));
  const [showPreviews, setShowPreviews] = useState(profile?.show_message_previews ?? false);
  const [hourPicker, setHourPicker] = useState<
    'quiet_start' | 'quiet_end' | 'reminder_hour' | 'placement_hour' | null
  >(null);
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
    // Top edge only: the global footer sits under every screen and owns the bottom inset.
    <Screen padded={false} edges={['top']}>
      <SpaceHeader title="Notifications" />
      <ScrollView contentContainerStyle={styles.container}>
        <PushOffBanner style={{ marginHorizontal: 0 }} />
        <Text style={styles.intro}>
          Choose what Philoi pings you about. Your device&apos;s system settings can turn everything off.
        </Text>

        <View style={styles.group}>
          <View style={styles.row}>
            <Tile>
              <NavGlyph name="bell" size={18} color={Colors.navEmber2} />
            </Tile>
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
        <SpaceSection>Categories</SpaceSection>
        <View style={styles.group}>
          {NOTIFICATION_CATEGORIES.map((cat) => {
            const prefsRecord = prefs as unknown as Record<string, unknown>;
            const on = isCategoryEnabled(prefsRecord, cat.key);
            const open = expanded === cat.key;
            const subtypes = CATEGORY_SUBTYPES[cat.key];
            // 0205 · per-EVENT switches (`type_<event>`), rendered in the same list as the legacy
            // per-type ones. They read identically to the user — one switch per subject — and the
            // only difference is which server gate they write.
            const typeItems = CATEGORY_TYPE_KEYS[cat.key];
            // A sub-toggle is only meaningful while its category is letting anything through.
            const subOff = masterOff || !on;
            return (
              // Each category is its own card and its detail opens INSIDE that card, so an open
              // accordion reads as one thing rather than as rows that happen to sit together.
              <View key={cat.key} style={[styles.card, open && styles.cardOpen]}>
                <Pressable
                  style={[styles.cardRow, masterOff && styles.rowDisabled]}
                  onPress={() => setExpanded(open ? null : cat.key)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${cat.label}. ${open ? 'Hide' : 'Show'} what this covers`}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{cat.label}</Text>
                    <Text style={styles.rowDescription}>{cat.description}</Text>
                  </View>
                  <UiGlyph name={open ? 'up' : 'down'} size={14} color={Colors.spaceFaint} />
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
                    {typeItems.map((item) => (
                      <View key={item.key} style={[styles.subRow, subOff && styles.rowDisabled]}>
                        <View style={styles.rowText}>
                          <Text style={styles.subLabel}>{item.label}</Text>
                          <Text style={styles.rowDescription}>{item.description}</Text>
                        </View>
                        <Toggle
                          value={!subOff && isTypeKeyEnabled(prefsRecord, item.key)}
                          disabled={subOff}
                          onValueChange={(v) => update({ [item.key]: v })}
                        />
                      </View>
                    ))}
                    {cat.covers.length > 0 && (
                      <>
                        <Text style={styles.coversLabel}>
                          {subtypes.length + typeItems.length > 0 ? 'ALSO INCLUDED' : 'INCLUDED'}
                        </Text>
                        {cat.covers.map((line) => (
                          <View key={line} style={styles.coverRow}>
                            <View style={styles.coverDot} />
                            <Text style={styles.coverText}>{line}</Text>
                          </View>
                        ))}
                        <Text style={styles.coverNote}>
                          {subtypes.length + typeItems.length > 0
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
        <SpaceSection>Daily reminder</SpaceSection>
        <View style={styles.group}>
          <View style={[styles.row, masterOff && styles.rowDisabled]}>
            <Tile>
              <SettingsGlyph name="clock" size={18} color={Colors.navEmber2} />
            </Tile>
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
            <Pressable style={styles.row} onPress={() => setHourPicker('reminder_hour')} accessibilityRole="button">
              <Text style={styles.rowLabel}>Time</Text>
              <Text style={styles.rowValue}>{formatHour(prefs.reminder_hour)}</Text>
              <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
            </Pressable>
          ) : null}
        </View>

        {/* 0205 · the nightly placement push. Default ON at 9 PM — the one push that reports where
            the day actually left you on the board. send_daily_placement() reads these two keys and
            compares the hour in this device's timezone, the same one quiet hours uses. */}
        <SpaceSection>Daily placement</SpaceSection>
        <View style={styles.group}>
          <View style={[styles.row, masterOff && styles.rowDisabled]}>
            <Tile>
              <NavGlyph name="trophy" size={18} color={Colors.navEmber2} />
            </Tile>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Where you stand</Text>
              <Text style={styles.rowDescription}>
                Your place on the global board, once a day
              </Text>
            </View>
            <Toggle
              value={!masterOff && prefs.placement_enabled}
              disabled={masterOff}
              onValueChange={(v) => update({ placement_enabled: v })}
            />
          </View>
          {prefs.placement_enabled && !masterOff ? (
            <Pressable style={styles.row} onPress={() => setHourPicker('placement_hour')} accessibilityRole="button">
              <Text style={styles.rowLabel}>Time</Text>
              <Text style={styles.rowValue}>{formatHour(prefs.placement_hour)}</Text>
              <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
            </Pressable>
          ) : null}
        </View>

        <SpaceSection>Quiet hours</SpaceSection>
        <View style={styles.group}>
          <View style={styles.row}>
            <Tile>
              <SettingsGlyph name="moon" size={18} color={Colors.navEmber2} />
            </Tile>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Quiet hours</Text>
              <Text style={styles.rowDescription}>Pause notifications overnight, in your local time</Text>
            </View>
            <Toggle value={prefs.quiet_enabled} onValueChange={(v) => update({ quiet_enabled: v })} />
          </View>
          {prefs.quiet_enabled && (
            <>
              <Pressable style={styles.row} onPress={() => setHourPicker('quiet_start')} accessibilityRole="button">
                <Text style={styles.rowLabel}>Starts</Text>
                <Text style={styles.rowValue}>{formatHour(prefs.quiet_start)}</Text>
                <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
              </Pressable>
              <Pressable style={styles.row} onPress={() => setHourPicker('quiet_end')} accessibilityRole="button">
                <Text style={styles.rowLabel}>Ends</Text>
                <Text style={styles.rowValue}>{formatHour(prefs.quiet_end)}</Text>
                <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
              </Pressable>
            </>
          )}
        </View>

        <SpaceSection>Lock screen</SpaceSection>
        <View style={styles.group}>
          <View style={styles.row}>
            <Tile>
              <UiGlyph name="lock" size={18} color={Colors.navEmber2} />
            </Tile>
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
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetTitle}>
              {hourPicker === 'reminder_hour'
                ? 'Daily reminder'
                : hourPicker === 'placement_hour'
                  ? 'Daily placement'
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
                    {selected && <UiGlyph name="check" size={18} color={Colors.navEmber} />}
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
    color: Colors.spaceFaint,
    marginTop: Spacing.two,
    marginLeft: 2,
  },
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
  },
  intro: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
    marginBottom: Spacing.three,
  },
  // A group is a stack of standalone rows (the SpaceRow treatment), not one card with dividers.
  group: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A category: the same panel as a row, but it owns its open detail too.
  card: {
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    overflow: 'hidden',
  },
  cardOpen: {
    borderColor: '#3A2D5A',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: Spacing.twelve,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  // The per-type detail under an expanded category. Inset and a shade lighter so it reads as
  // "inside" its category rather than as a sixth category.
  detail: {
    backgroundColor: Colors.spacePanel2,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.twelve,
    paddingBottom: Spacing.three,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.twelve,
    borderBottomWidth: 1,
    borderBottomColor: Colors.spaceLine,
  },
  subLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  coversLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: Colors.spaceFaint,
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
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.legend,
  },
  coverText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  coverNote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.spaceFaint,
    marginTop: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowDescription: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.spaceDim,
  },
  rowValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.navEmber2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.spaceLine,
    padding: Spacing.four,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.spaceLine,
    marginBottom: Spacing.two,
  },
  sheetTitle: {
    fontFamily: Fonts.black,
    fontSize: 18,
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
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  hourRowSelected: {
    backgroundColor: 'rgba(255,122,47,0.10)',
    borderColor: Colors.navEmber,
  },
  hourLabel: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  hourLabelSelected: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.navEmber2,
  },
});
