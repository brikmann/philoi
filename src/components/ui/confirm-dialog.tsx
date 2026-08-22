import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';

// THE EMBER CONFIRM (mock 112 §B "Delete confirm"). Replaces Alert.alert() for destructive
// campfire actions.
//
// Alert.alert renders the platform's own dialog — on Android that is a bare grey slab with system
// blue text, which is exactly the screenshot CAMPFIRE_REDESIGN_SPEC flags: the app is a dark ember
// product right up until the moment it asks you to confirm something, and then it looks like a
// different app made by someone else. A confirm is a high-stakes moment; it is the LAST place the
// design language should drop out.
//
// Deliberately not a bottom sheet: a sheet is a menu you can dismiss by reflex, and the whole job
// here is to interrupt. Centred, dimmed, two buttons, destructive one on the right.

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  confirmLabel: string;
  /** Paints the confirm button red. Off for a neutral confirm (leave, discard). */
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  cancelLabel = 'Cancel',
  confirmLabel,
  destructive = true,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        {/* Tap-outside cancels, matching the OS dialog's own affordance — but only when nothing
            is in flight, so a half-finished delete can't be dismissed out from under itself. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} accessibilityLabel="Dismiss" />

        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>

          <View style={styles.buttons}>
            <Pressable style={styles.cancel} onPress={onCancel} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirm, destructive ? styles.confirmDanger : styles.confirmNeutral, busy && styles.busy]}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button">
              <Text style={[styles.confirmLabel, !destructive && styles.confirmLabelNeutral]}>
                {busy ? '…' : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    backgroundColor: 'rgba(6,4,10,0.6)',
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1C1730',
    borderWidth: 1,
    borderColor: '#2A2140',
    borderRadius: 16,
    padding: Spacing.three,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    marginBottom: 6,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: '#C8BCDD',
    marginBottom: Spacing.three,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
  cancel: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#241A2E',
  },
  cancelLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#C8BCDD',
  },
  confirm: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  confirmDanger: {
    backgroundColor: '#C4342B',
  },
  confirmNeutral: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  confirmLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  confirmLabelNeutral: {
    color: Colors.achieverText,
  },
  busy: {
    opacity: 0.7,
  },
});
