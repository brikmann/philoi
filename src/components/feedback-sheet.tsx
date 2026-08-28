import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';

// Feedback & Contact (FEATURE_feedback_and_domain.md §1) — the in-app way to reach a human,
// opened from Settings → Help & feedback.
//
// This composes a mailto: and hands off to the mail client. That is the spec's v1 on purpose:
// there is no feedback table and no edge function behind this, and a form that silently POSTs
// into a void is worse than no form. Handing the draft to their own mail app also means the user
// keeps a copy, can attach a screenshot, and gets a reply thread that actually works — none of
// which a fire-and-forget textarea gives them.
//
// If a backend lands later the swap is one function: try the network, fall back to this.

export const CONTACT_EMAIL = 'info@philoi.app';

type FeedbackCategory = 'Bug report' | 'Feature request' | 'General feedback';

const CATEGORIES: { value: FeedbackCategory; icon: keyof typeof Ionicons.glyphMap; hint: string }[] = [
  { value: 'Bug report', icon: 'bug', hint: 'What happened, and what you expected instead' },
  { value: 'Feature request', icon: 'bulb', hint: 'What you wish Philoi did' },
  { value: 'General feedback', icon: 'chatbubble-ellipses', hint: 'Anything else on your mind' },
];

/**
 * The device/build lines appended under the message.
 *
 * Kept short, visible to the user before they send (it is their mail draft — they can delete it),
 * and deliberately free of anything identifying beyond the handle they chose: no user id, no
 * device id, no location. A bug report with no version number is close to unactionable, which is
 * the only reason any of this is here.
 */
function diagnosticsBlock(handle: string | null): string {
  const version = Constants.expoConfig?.version ?? 'unknown';
  const lines = ['', '', '— sent from Philoi —', `Version: ${version}`, `Platform: ${Platform.OS} ${Platform.Version}`];
  if (handle) lines.push(`Handle: @${handle}`);
  return lines.join('\n');
}

export function FeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const [category, setCategory] = useState<FeedbackCategory>('Bug report');
  const [message, setMessage] = useState('');

  const active = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];
  const canSend = message.trim().length > 0;

  function reset() {
    setMessage('');
    setCategory('Bug report');
  }

  function handleClose() {
    onClose();
    reset();
  }

  async function handleSend() {
    const subject = `[${category}] Philoi`;
    const body = message.trim() + diagnosticsBlock(profile?.handle ?? null);
    const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
      handleClose();
    } catch {
      // No mail client configured is a real state on a fresh Android device. Don't strand them
      // behind a dead button — hand over the address they can send to by hand.
      Alert.alert('No mail app found', `Email us at ${CONTACT_EMAIL} and we'll pick it up from there.`);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Send feedback</Text>
          <Text style={styles.subtitle}>
            This opens your mail app with the message ready to send to {CONTACT_EMAIL}.
          </Text>

          <View style={styles.chips}>
            {CATEGORIES.map((option) => {
              const selected = option.value === category;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setCategory(option.value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}>
                  <Ionicons name={option.icon} size={14} color={selected ? Colors.ember : Colors.muted} />
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.value}</Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={active.hint}
              multiline
              textAlignVertical="top"
              style={styles.input}
            />
          </ScrollView>

          <Text style={styles.note}>
            Your app version and platform are added at the bottom so we can reproduce it. Nothing else
            about you is attached.
          </Text>

          <Pressable
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            disabled={!canSend}
            onPress={handleSend}
            accessibilityRole="button">
            <Text style={[styles.sendText, !canSend && styles.sendTextDisabled]}>Open in mail</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={handleClose} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
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
    padding: Spacing.four,
    paddingBottom: Spacing.five,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.twelve,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  chipSelected: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.amber,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  chipTextSelected: {
    color: Colors.ember,
  },
  input: {
    minHeight: 132,
    fontSize: 14,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
  sendButton: {
    marginTop: Spacing.three,
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: Colors.disabledSurface,
  },
  sendText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  sendTextDisabled: {
    color: Colors.disabledText,
  },
  cancelButton: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
  },
});
