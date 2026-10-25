import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

export type SheetOption<T extends string> = { value: T; label: string; sub?: string };

type OptionSheetProps<T extends string> = {
  visible: boolean;
  title: string;
  options: SheetOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
};

// A Modal sheet for the multi-option pickers, not an Alert: Android's Alert caps at three buttons
// and silently drops the rest (Cancel first). Same backdrop/sheet look as ReportBlockSheet.
export function OptionSheet<T extends string>({ visible, title, options, selected, onSelect, onClose }: OptionSheetProps<T>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{title}</Text>
          {options.map((o, i) => {
            const on = o.value === selected;
            return (
              <Pressable
                key={o.value}
                style={[styles.row, i === options.length - 1 && styles.rowLast]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onClose();
                  if (!on) onSelect(o.value);
                }}>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{o.label}</Text>
                  {o.sub ? <Text style={styles.rowSub}>{o.sub}</Text> : null}
                </View>
                {on ? <Ionicons name="checkmark" size={19} color={Colors.amber} /> : null}
              </Pressable>
            );
          })}
          <Pressable style={styles.cancelRow} onPress={onClose}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.muted,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  rowLabelOn: {
    color: Colors.amber,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  cancelRow: {
    marginTop: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.button,
  },
  cancelLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.muted,
  },
});
