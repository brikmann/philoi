import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// THE CALENDAR CONSENT (GCAL_INTEGRATION_SPEC.md "Privacy — calendar is sensitive").
//
// What this replaces: Alert.alert(). On Android that renders the platform's own AlertDialog — a
// grey slab with system-blue buttons — which is the same drop-out ConfirmDialog was built to fix
// for destructive campfire actions: the app is a dark ember product right up until it asks you for
// something, and then it looks like a different app made by someone else.
//
// It matters more here than anywhere else in the app. This is the screen where a member decides
// whether to hand Philoi a read-only view of every commitment in their life, and the four promises
// on it are load-bearing — read-only, only the next few weeks, read at write-time and never
// stored, never shared. A consent screen that looks like it belongs to the OS rather than to
// Philoi is asking for trust while looking like it was bolted on.
//
// Deliberately NOT reusing <ConfirmDialog>: that takes a single `body` string, and the promises
// need to be separately legible rather than run together in a paragraph. Same structural idiom
// though — centred, dimmed, interrupting — so the two read as the same family.
//
// ⚠️ THE COPY IS THE CONTRACT. Every line below is a claim the backend actually honours: the
// requested scope is calendar.events.readonly and nothing wider; the coach reads a ~3-week forward
// window at the moment it writes and stores no events; nothing reads those tables except that
// member's own prompt assembly; and Disconnect calls Google's revoke endpoint before deleting the
// row. If any of that ever stops being true, this text has to change with it — do not leave a
// promise on screen that the server no longer keeps.

const LEAD =
  'So Philoi can see your deadlines and free time and coach you around them — the exam on Friday, the two hours you’re free this afternoon.';

const PROMISES = [
  'Read-only. Philoi can never add, move or delete anything.',
  'Only the next few weeks, read when your coach writes to you — never stored.',
  'Never shared with anyone. Not your campfire, not other members.',
];

const FOOTER = 'You can disconnect any time, and that revokes Philoi’s access at Google too.';

type CalendarConsentDialogProps = {
  visible: boolean;
  /** True when re-running the flow on an already-connected row, which is the "switch account"
   * path. Same promises, but the title shouldn't say "connect" to someone already connected. */
  switching?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onContinue: () => void;
};

export function CalendarConsentDialog({
  visible,
  switching = false,
  busy = false,
  onCancel,
  onContinue,
}: CalendarConsentDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <View style={styles.backdrop}>
        {/* Tap-outside dismisses, matching the OS dialog's own affordance — but never while the
            Google handshake is in flight, so a half-finished connect can't be dismissed out from
            under itself. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={busy ? undefined : onCancel}
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
        />

        <View style={styles.dialog} accessibilityViewIsModal>
          {/* Scrolls rather than clipping: three promises plus a lead paragraph at the largest
              accessibility text size is taller than a small phone. */}
          <ScrollView bounces={false} contentContainerStyle={styles.scroll}>
            <View style={styles.mark}>
              <FlameLogo size={26} />
            </View>

            <Text style={styles.title}>{switching ? 'Switch Google account?' : 'Connect Google Calendar?'}</Text>
            <Text style={styles.lead}>{LEAD}</Text>

            <View style={styles.promises}>
              {PROMISES.map((line) => (
                <View key={line} style={styles.promiseRow}>
                  <View style={styles.dot} />
                  <Text style={styles.promise}>{line}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.footer}>{FOOTER}</Text>
          </ScrollView>

          {/* Stacked, not side by side: CONTINUE is the ember primary and deserves the full width,
              and a full-width primary over a quiet text button is the shape the rest of the app
              uses for an opt-in. */}
          <View style={styles.actions}>
            <PrimaryButton label="CONTINUE" onPress={onContinue} loading={busy} />
            <Pressable
              style={styles.notNow}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              hitSlop={6}>
              <Text style={[styles.notNowLabel, busy && styles.notNowDisabled]}>NOT NOW</Text>
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
    backgroundColor: 'rgba(6,4,10,0.68)',
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '86%',
    backgroundColor: Colors.cream,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    // 16 rather than Radius.card's 12, matching <ConfirmDialog> — the two interrupting dialogs
    // should share a silhouette even though they don't share an implementation.
    borderRadius: 16,
    padding: Spacing.three,
  },
  scroll: {
    paddingBottom: Spacing.two,
  },
  mark: {
    width: 44,
    height: 44,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    marginBottom: Spacing.three,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  lead: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.muted,
  },
  promises: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.three,
    gap: 10,
    marginTop: Spacing.three,
  },
  promiseRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.ember,
    // Sits on the first line's optical centre rather than its top.
    marginTop: 7,
  },
  promise: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.ink,
  },
  footer: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
  },
  actions: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  notNow: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: Spacing.three,
  },
  notNowLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 0.6,
    color: Colors.muted,
  },
  notNowDisabled: {
    color: Colors.disabledText,
  },
});
