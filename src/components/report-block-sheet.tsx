import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type ReportBlockSheetProps = {
  visible: boolean;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
};

// An on-brand bottom sheet for "report or block" (punchlist 2, §1) — replaces the raw OS
// Alert.alert dialog the leaderboard's ⋯ menu was showing, matching settings.tsx's existing
// backdrop/sheet visual language rather than a third distinct modal style.
export function ReportBlockSheet({ visible, onClose, onReport, onBlock }: ReportBlockSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onReport();
            }}>
            <Ionicons name="flag-outline" size={19} color={Colors.ink} />
            <Text style={styles.rowLabel}>Report</Text>
          </Pressable>
          <Pressable
            style={[styles.row, styles.rowLast]}
            onPress={() => {
              onClose();
              onBlock();
            }}>
            <Ionicons name="ban-outline" size={19} color={Colors.danger} />
            <Text style={[styles.rowLabel, styles.rowLabelDanger]}>Block user</Text>
          </Pressable>
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
  rowLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  rowLabelDanger: {
    color: Colors.danger,
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
