import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { reportChallengeGrade } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';

// WHERE A GRADE CHALLENGE IS ACTUALLY PLAYED.
//
// Every other metric is observed: you lock in, you lift, you run, and the race scores itself off
// check-ins the app already wrote. A grade is the one thing the app cannot see, so it is the one
// metric that needs somewhere for a human to type — this sheet is that place, and it is why
// report_challenge_grade exists as the only write path into a live challenge's score.
//
// HONOUR-BASED, AND IT SAYS SO. There is no transcript to read and this does not pretend
// otherwise. 0093 refused self-reported grades any currency at all on the grounds that the moment
// a claimed mark pays, claiming becomes the game; 0145 accepts them into a challenge but prices
// the reward down for exactly that reason. The note at the bottom of this sheet is where that
// bargain is made visible to the person typing, rather than being a comment only we can read.
//
// EDITABLE, NOT SUBMITTED. Re-opening it with a mark already in shows that mark and overwrites it
// on save. A one-shot submission would make a typo'd 7 for a 70 permanent, and a grade arrives
// late and gets revised in real life besides — the RPC allows it until the race settles and stops
// allowing it after, which is the only deadline that matters.

export function GradeReportSheet({
  challengeId,
  courseCode,
  target,
  current,
  onClose,
  onReported,
}: {
  challengeId: string;
  courseCode: string | null;
  /** The bar, when there is one. Placement boards rank without a target and pass null. */
  target: number | null;
  /** What this racer has already reported, if anything. */
  current: number | null;
  onClose: () => void;
  onReported: (value: number) => void;
}) {
  const [text, setText] = useState(current != null ? String(Number(current.toFixed(2))) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(text.trim());
  // Blank is not zero. An empty field is "I have not said yet", which is the state the row starts
  // in and is the one thing Save must never write.
  const valid = text.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  const clears = valid && target != null && parsed >= target;

  async function handleSave() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The server's rounded copy, not the typed string — it is what settlement will score.
      const stored = await reportChallengeGrade(challengeId, parsed);
      onReported(stored);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save that grade.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.lift}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{courseCode?.trim() ? `Your mark in ${courseCode.trim()}` : 'Your mark'}</Text>
          {target != null ? (
            <Text style={styles.sub}>The target is {Number(target.toFixed(1))}%.</Text>
          ) : (
            <Text style={styles.sub}>Everyone in the campfire is ranked on what they report.</Text>
          )}

          <View style={styles.fieldRow}>
            <TextInput
              style={styles.field}
              value={text}
              onChangeText={(t) => {
                // Digits and one decimal point. `keyboardType` is a hint the OS is free to ignore
                // — Android's numeric pad still offers a comma in several locales — so the filter
                // is here rather than being trusted to the keyboard.
                setText(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'));
                setError(null);
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="0–100"
              maxLength={6}
              autoFocus
              accessibilityLabel="Your grade, as a percentage"
              onSubmitEditing={handleSave}
              returnKeyType="done"
            />
            <Text style={styles.percent}>%</Text>
          </View>

          {/* Says what the number MEANS before it is saved, so the person is not left working out
              whether 68 cleared a 70 from two numbers on separate lines. */}
          {valid && target != null ? (
            <Text style={[styles.verdict, clears ? styles.verdictOk : styles.verdictShort]}>
              {clears ? `That clears the ${Number(target.toFixed(1))}% target.` : `That is short of ${Number(target.toFixed(1))}%.`}
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button">
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.save, (!valid || busy) && styles.saveOff]}
              onPress={handleSave}
              disabled={!valid || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: !valid || busy }}>
              <Text style={styles.saveLabel}>{busy ? 'Saving…' : current != null ? 'Update' : 'Save'}</Text>
            </Pressable>
          </View>

          <View style={styles.honourRow}>
            <Ionicons name="hand-left-outline" size={13} color={Colors.textTertiary} />
            <Text style={styles.honour}>
              Honour-based — nobody checks a transcript, so these races pay a little less than
              auto-tracked ones.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  lift: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.card * 2,
    borderTopRightRadius: Radius.card * 2,
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.lineStrong,
    marginBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  field: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  percent: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.muted,
  },
  verdict: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
  },
  verdictOk: {
    color: Colors.green,
  },
  verdictShort: {
    color: Colors.muted,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  cancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.input,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  cancelLabel: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.muted,
  },
  save: {
    flex: 1,
    backgroundColor: Colors.coral,
    borderRadius: Radius.input,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  saveOff: {
    backgroundColor: Colors.disabled,
  },
  saveLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  honourRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.two,
  },
  honour: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
});
