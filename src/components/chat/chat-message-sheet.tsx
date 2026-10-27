import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// LONG-PRESS ON A CHAT MESSAGE (0284 moderation). A sheet, not an Alert: own messages offer Delete,
// anyone else's offer Report and Block — and with Cancel that is a fourth button, which Android's
// Alert drops without a word. Report is a second step on the same sheet, picking the reason the
// report screen uses (verbatim: the alert mail matches on the CSAE string).

const REASONS = [
  'Spam or misleading',
  'Harassment or bullying',
  'Inappropriate or offensive content',
  'Child safety / CSAE',
  'Other',
] as const;

export function ChatMessageSheet({
  visible,
  own,
  onClose,
  onDelete,
  onReport,
  onBlock,
}: {
  visible: boolean;
  /** Mine → Delete. Theirs → Report · Block. */
  own: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onReport: (reason: string) => Promise<void>;
  /** Omitted where blocking isn't offered from a message. */
  onBlock?: () => void;
}) {
  const [step, setStep] = useState<'menu' | 'reasons' | 'sent'>('menu');
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setStep('menu');
    onClose();
  }

  async function run(fn: () => Promise<void>, after: 'close' | 'sent') {
    setBusy(true);
    try {
      await fn();
      if (after === 'sent') setStep('sent');
      else {
        setStep('menu');
        onClose();
      }
    } catch {
      // The caller alerts with the server's own sentence; the sheet just stays put to retry.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {busy ? <ActivityIndicator color={Colors.navEmber} style={styles.busy} /> : null}

          {step === 'menu' ? (
            own ? (
              <Row icon="trash" label="Delete message" danger onPress={() => void run(onDelete, 'close')} />
            ) : (
              <>
                <Row icon="flag" label="Report message" onPress={() => setStep('reasons')} />
                {onBlock ? (
                  <Row
                    icon="shield"
                    label="Block user"
                    danger
                    onPress={() => {
                      setStep('menu');
                      onClose();
                      onBlock();
                    }}
                  />
                ) : null}
              </>
            )
          ) : step === 'reasons' ? (
            <>
              <Text style={styles.heading}>Why are you reporting this?</Text>
              {REASONS.map((r) => (
                <Row key={r} icon="flag" label={r} onPress={() => void run(() => onReport(r), 'sent')} />
              ))}
            </>
          ) : (
            <View style={styles.sent}>
              <Icon name="shield" size={26} color={Colors.navEmber2} />
              <Text style={styles.heading}>Report received</Text>
              <Text style={styles.sentBody}>Our safety team reviews every report within 48 hours.</Text>
            </View>
          )}

          <Pressable style={styles.cancel} onPress={close} accessibilityRole="button">
            <Text style={styles.cancelText}>{step === 'sent' ? 'Done' : 'Cancel'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ icon, label, danger, onPress }: { icon: IconName; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={19} color={danger ? Colors.danger : Colors.ink} />
      <Text style={[styles.rowLabel, danger && styles.rowDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.spaceLine,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  busy: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.four,
  },
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.spaceLine,
  },
  rowLabel: {
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink,
  },
  rowDanger: {
    color: Colors.danger,
  },
  sent: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.three,
  },
  sentBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  cancel: {
    alignItems: 'center',
    paddingTop: Spacing.three,
  },
  cancelText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.spaceDim,
  },
});
