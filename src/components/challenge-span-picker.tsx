import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// HOW LONG — the presets plus an arbitrary span (CODE_PROMPT_challenge_v2 B1).
//
// Only 24h / 3d / 1w were offerable, which made the one challenge mock 114 is actually about — a
// semester-long placement race, "Sep 8 -> Dec 12" — impossible to create. `starts_on` / `ends_on`
// have existed on the row since 0096 and `start_challenge` already honours them; nothing was
// sending them.
//
// NO NEW NATIVE DEPENDENCY. The obvious move is @react-native-community/datetimepicker, but it is
// a native module: adding one forces a new dev/preview build before anybody can open this screen,
// and package.json belongs to another agent this wave. This is a screen that already hand-draws
// every other control, and a self-drawn calendar renders in the app's own dark palette rather than
// a system sheet that ignores it.

/**
 * The presets, deduped and ascending. The prompt asks for "1 day / 1 week / 1 month" added to the
 * existing "24h / 3d / 1w" — 24h and 1 day are the same span under two names, so this offers the
 * union rather than two chips that do exactly the same thing.
 */
export const DURATION_OPTIONS: { label: string; hours: number }[] = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  // 30 days, not a calendar month: the same chip would otherwise mean three different spans
  // depending on when it was tapped, and window_hours is what the payout's duration band reads.
  { label: '1 month', hours: 720 },
];

/** The cap. Already well beyond the semester mock 114 asks for, and an open-ended race is one
 *  nobody ever collects on — settlement only fires once ends_at has passed. */
export const MAX_SPAN_DAYS = 366;
const DAY_MS = 86_400_000;

export type ChallengeSpan =
  | { kind: 'preset'; windowHours: number }
  | { kind: 'custom'; startsOn: Date; endsOn: Date };

/**
 * window_hours stays the ONE duration figure everything downstream reads — the payout's duration
 * band (grant_reward's `p_duration_days`), the info row, the card's clock. A custom span resolves
 * to one rather than introducing a second concept every reader would have to learn.
 */
export function spanWindowHours(span: ChallengeSpan): number {
  if (span.kind === 'preset') return span.windowHours;
  return Math.max(1, Math.round((span.endsOn.getTime() - span.startsOn.getTime()) / 3_600_000));
}

/** Null when the span is valid, the reason otherwise. Checked here AND in SQL — the client message
 *  is the helpful one, the server check is the true one. */
export function spanError(span: ChallengeSpan): string | null {
  if (span.kind === 'preset') return null;
  const ms = span.endsOn.getTime() - span.startsOn.getTime();
  if (ms <= 0) return 'The end date has to come after the start.';
  if (ms > MAX_SPAN_DAYS * DAY_MS) return `A challenge can run for at most ${MAX_SPAN_DAYS} days.`;
  return null;
}

export function ChallengeSpanPicker({
  value,
  onChange,
}: {
  value: ChallengeSpan;
  onChange: (span: ChallengeSpan) => void;
}) {
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const custom = value.kind === 'custom' ? value : null;
  const start = custom?.startsOn ?? startOfDay(new Date());
  const end = custom?.endsOn ?? endOfDay(new Date(startOfDay(new Date()).getTime() + 7 * DAY_MS));
  const error = spanError(value);

  return (
    <>
      <View style={styles.pillsRow}>
        {DURATION_OPTIONS.map((option) => {
          const selected = value.kind === 'preset' && value.windowHours === option.hours;
          return (
            <Pressable
              key={option.hours}
              onPress={() => onChange({ kind: 'preset', windowHours: option.hours })}
              style={[styles.pill, selected && styles.pillSelected]}>
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => onChange({ kind: 'custom', startsOn: start, endsOn: end })}
          style={[styles.pill, custom != null && styles.pillSelected]}>
          <Ionicons name="calendar-outline" size={12} color={custom != null ? Colors.twilight900 : Colors.muted} />
          <Text style={[styles.pillText, custom != null && styles.pillTextSelected]}>Custom</Text>
        </Pressable>
      </View>

      {custom ? (
        <>
          <View style={styles.rangeRow}>
            <DateField label="STARTS" date={custom.startsOn} onPress={() => setPicking('start')} />
            <Ionicons name="arrow-forward" size={14} color={Colors.textTertiary} />
            <DateField label="ENDS" date={custom.endsOn} onPress={() => setPicking('end')} />
          </View>
          <Text style={error ? styles.rangeError : styles.rangeHint}>
            {error ??
              `${Math.max(1, Math.round((custom.endsOn.getTime() - custom.startsOn.getTime()) / DAY_MS))} days`}
          </Text>
        </>
      ) : null}

      <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(null)} accessibilityLabel="Close date picker">
          {/* The sheet swallows the backdrop's dismiss — tapping a day must not also close it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <CalendarMonth
              selected={picking === 'end' ? end : start}
              onSelect={(day) => {
                if (picking === 'start') {
                  // Drag the end along rather than leaving an invalid range on screen: a start
                  // pushed past the end is a correction in progress, not a mistake to scold.
                  const nextEnd = day.getTime() >= end.getTime() ? endOfDay(new Date(day.getTime() + 7 * DAY_MS)) : end;
                  onChange({ kind: 'custom', startsOn: day, endsOn: nextEnd });
                } else {
                  onChange({ kind: 'custom', startsOn: start, endsOn: endOfDay(day) });
                }
                setPicking(null);
              }}
            />
            <PrimaryButton label="Done" onPress={() => setPicking(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function DateField({ label, date, onPress }: { label: string; date: Date; onPress: () => void }) {
  return (
    <Pressable
      style={styles.dateField}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label.toLowerCase()} ${formatDay(date)}`}>
      <Text style={styles.dateFieldLabel}>{label}</Text>
      <Text style={styles.dateFieldValue}>{formatDay(date)}</Text>
    </Pressable>
  );
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function CalendarMonth({ selected, onSelect }: { selected: Date; onSelect: (day: Date) => void }) {
  const [cursor, setCursor] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  // Leading blanks pad the first row to the correct weekday — a 7-wide grid with no offset would
  // draw every month as if it started on Sunday.
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const pad: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
    return pad.concat(
      Array.from({ length: days }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))
    );
  }, [cursor]);

  const today = startOfDay(new Date());

  return (
    <View>
      <View style={styles.calHeader}>
        <Pressable onPress={() => setCursor(addMonths(cursor, -1))} hitSlop={10} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={18} color={Colors.muted} />
        </Pressable>
        <Text style={styles.calTitle}>
          {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => setCursor(addMonths(cursor, 1))} hitSlop={10} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
        </Pressable>
      </View>

      <View style={styles.calGrid}>
        {WEEKDAYS.map((d, i) => (
          <Text key={`wd${i}`} style={styles.calWeekday}>
            {d}
          </Text>
        ))}
        {cells.map((day, i) => {
          if (!day) return <View key={`pad${i}`} style={styles.calCell} />;
          const isSelected = sameDay(day, selected);
          // A race cannot be run in the past — settlement would fire on the very next sweep with a
          // window that had already closed.
          const disabled = day.getTime() < today.getTime();
          return (
            <Pressable
              key={day.toISOString()}
              onPress={() => onSelect(startOfDay(day))}
              disabled={disabled}
              style={styles.calCell}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled }}>
              <Text
                style={[
                  styles.calDay,
                  sameDay(day, today) && styles.calDayToday,
                  disabled && styles.calDayDisabled,
                  isSelected && styles.calDaySelected,
                ]}>
                {day.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** An end DATE means the END of that day — picking Dec 12 and having the race die at 00:00 on
 *  Dec 12 would silently cost a full day of it. */
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  pillSelected: { backgroundColor: Colors.amber, borderColor: 'transparent' },
  pillText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '700', color: Colors.muted },
  pillTextSelected: { color: Colors.twilight900 },

  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  dateField: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  dateFieldLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: Colors.textTertiary,
  },
  dateFieldValue: { fontFamily: Fonts.body, fontSize: 15, fontWeight: '700', color: Colors.ink, marginTop: 2 },
  rangeHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary, marginTop: Spacing.two },
  rangeError: { fontFamily: Fonts.body, fontSize: 12, color: Colors.coral, marginTop: Spacing.two },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.four },
  sheet: {
    backgroundColor: Colors.twilight900,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.four,
    gap: Spacing.three,
  },

  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calTitle: { fontFamily: Fonts.body, fontSize: 15, fontWeight: '800', color: Colors.ink },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: Spacing.three },
  calWeekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textTertiary,
    marginBottom: 6,
  },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDay: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.ink,
    width: 30,
    height: 30,
    borderRadius: 15,
    textAlign: 'center',
    lineHeight: 30,
    overflow: 'hidden',
  },
  calDayDisabled: { color: Colors.trackAlt },
  calDayToday: { color: Colors.amber },
  calDaySelected: { backgroundColor: Colors.amber, color: Colors.twilight900, fontWeight: '800' },
});
