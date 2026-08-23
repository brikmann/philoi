import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EquippedFlameSvg } from '@/components/flame-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { setCoachConsent } from '@/lib/api/coach';

// The consent gate.
//
// Cindy's whole value is that she reads everything — and that is exactly why she cannot be on by
// default. This screen says plainly what goes to the model and what does not, because
// CINDY_SPEC's "reads a lot of personal data → server-side, consented, privacy-minded" is only
// real if the user was actually told before the first call, not after.
//
// The three lines below are load-bearing claims, each true by construction elsewhere in the
// feature — if any of them ever stops being true, this copy is the thing that has become a lie.

const READS = [
  'Your ranks, XP, sessions and streaks',
  'Your goals, challenges and standings',
  'Your cosmetics, milestones and notifications',
  'Your Google Calendar, only if you connect it',
];

const NEVER = [
  "Anyone else's private data — only ever your own",
  'Your messages with other people',
  'Anything shared with other users, ever',
];

export function CindyConsent({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await setCoachConsent(true);
      onDone();
    } catch (e) {
      Alert.alert('Could not turn Cindy on', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <EquippedFlameSvg width={76} height={92} />
          <Text style={styles.title}>Meet Cindy</Text>
          <Text style={styles.sub}>
            Your flame, with a voice. She knows your whole app — so she can tell you exactly how far Hero
            is, what&apos;s left to unlock, and when you&apos;ve genuinely earned a night off.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What she reads</Text>
          {READS.map((line) => (
            <View key={line} style={styles.row}>
              <Ionicons name="checkmark" size={14} color={Colors.amber} />
              <Text style={styles.rowText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What she never touches</Text>
          {NEVER.map((line) => (
            <View key={line} style={styles.row}>
              <Ionicons name="close" size={14} color={Colors.textTertiary} />
              <Text style={styles.rowText}>{line}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.fine}>
          Your data is sent to an AI model on our servers to write her replies — it&apos;s never used to
          train anything, and never shown to another user. Cindy can start sessions and post milestones for
          you, but she asks first, and she can never give you XP, embers or rank. Turn her off any time in
          Settings.
        </Text>

        <PrimaryButton label={busy ? 'Turning her on…' : 'Turn Cindy on'} onPress={accept} disabled={busy} />
        <Text style={styles.skip} onPress={() => router.back()}>
          Not now
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three, paddingBottom: Spacing.five },
  hero: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.four },
  title: { fontFamily: Fonts.bodyBold, fontSize: 22, color: Colors.ink },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.muted,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.input,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardTitle: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink, marginBottom: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  rowText: { fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18, color: Colors.muted, flex: 1 },
  fine: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: Colors.textTertiary,
    paddingHorizontal: Spacing.two,
  },
  skip: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.twelve,
  },
});
