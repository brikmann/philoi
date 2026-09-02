import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// A dropdown. The app did not have one.
//
// WHAT THIS REPLACES, and why a chip row was the wrong control for it. The personal-goal metric
// picker was TWO horizontally-scrolling chip rows — the headline four, then a "More metrics" link
// that opened a second row underneath it. Noah: "two sliding bars… really weird, should just be a
// dropdown where you select what you're racing/tracking."
//
// He is right, and the reason is that a horizontal scroller hides its own contents. Punchlist 5.4
// already had to fix this row once, when it was a non-wrapping flex row and everything past the
// screen edge was rendered but unreachable — you could not pick Run. Making it scroll fixed the
// unreachable half and left the invisible half: nine options across two rows, of which about three
// are on screen, with no affordance saying the rest exist. A chip row is right for two or three
// peers you can see at once (Daily/Weekly below it), and wrong for a list you have to go looking
// through.
//
// A modal sheet rather than an inline expander: the picker sits mid-form under a keyboard-avoiding
// scroll view, and an inline list would push the whole form around as it opened. The sheet is also
// what lets every option show its own source line at full width, which is the thing the chips had
// to truncate to one word.

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** The quiet second line — "From Health Connect or your watch". */
  detail?: string | null;
  /** Rendered left of the label. The caller owns the glyph vocabulary. */
  icon?: React.ReactNode;
};

type SelectFieldProps<T extends string> = {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Sheet title. Defaults to the field's own placeholder-ish role. */
  title?: string;
  accessibilityLabel?: string;
};

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  title = 'Choose one',
  accessibilityLabel,
}: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <>
      <Pressable
        style={styles.field}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityValue={{ text: selected?.label ?? 'Not set' }}>
        <View style={styles.fieldMain}>
          {selected?.icon ? <View style={styles.fieldIcon}>{selected.icon}</View> : null}
          <View style={styles.fieldText}>
            <Text style={styles.fieldLabel} numberOfLines={1}>
              {selected?.label ?? 'Choose…'}
            </Text>
            {selected?.detail ? (
              <Text style={styles.fieldDetail} numberOfLines={1}>
                {selected.detail}
              </Text>
            ) : null}
          </View>
        </View>
        <Ionicons name="chevron-down" size={18} color={Colors.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        {/* The scrim closes it. A dropdown that can only be dismissed by choosing something is a
            dropdown you cannot back out of. */}
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close">
          {/* Swallows the tap so choosing inside the sheet never reaches the scrim behind it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}>
                    {option.icon ? <View style={styles.rowIcon}>{option.icon}</View> : null}
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{option.label}</Text>
                      {option.detail ? <Text style={styles.rowDetail}>{option.detail}</Text> : null}
                    </View>
                    {active ? <Ionicons name="checkmark" size={18} color={Colors.amber} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  fieldMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
    minWidth: 0,
  },
  fieldIcon: {
    width: 20,
    alignItems: 'center',
  },
  fieldText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  fieldLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  fieldDetail: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,16,0.72)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  sheet: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    // Never taller than most of the screen — the list scrolls inside it rather than running off.
    maxHeight: '76%',
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1,
    color: Colors.muted,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  rowActive: {
    backgroundColor: Colors.selectedBg,
  },
  rowIcon: {
    width: 20,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  rowLabelActive: {
    color: Colors.amber,
  },
  rowDetail: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
  },
});
