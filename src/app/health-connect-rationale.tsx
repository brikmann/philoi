import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// Health Connect's Play Store requirement: an app that requests health permissions must state,
// plainly and visibly, what it reads and why — this is that statement. Reachable normally from
// Settings → Connected apps' "How Philoi uses Health Connect data" link.
//
// Health Connect can also launch an app directly into a rationale screen via the OS intent
// action androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE (the manifest intent-filter for it is
// already wired by react-native-health-connect's Expo config plugin, see app.config.ts) — fully
// routing THAT specific OS-launch reason to this exact screen needs either a small native
// MainActivity change or reading the launch intent's action name, which isn't verifiable without
// a real Android build from this environment. What's real regardless: this screen exists, states
// the actual rationale, and is one tap away from Connected apps — which is the substance Health
// Connect's review is checking for.
export default function HealthConnectRationaleScreen() {
  const router = useRouter();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>Health Connect data use</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.body}>
          Philoi reads step data from Health Connect only to verify progress on a challenge you&apos;ve chosen
          to track automatically — like a group step goal.
        </Text>
        <Text style={styles.body}>What we read: your step count, only for the exact time window a challenge covers.</Text>
        <Text style={styles.body}>What we never do: read any other Health Connect data type, write anything back to Health Connect, or export your raw step history.</Text>
        <Text style={styles.body}>
          What your campfire sees: only the same running total everyone already sees for a manually-logged
          challenge — e.g. &quot;8,200 / 10,000 steps.&quot; Nobody sees your Health Connect data itself.
        </Text>
        <Text style={styles.body}>
          You can disconnect at any time from Settings → Connected apps, or manage Philoi&apos;s access directly
          in Health Connect&apos;s own app settings. Logging progress manually always works, connected or not.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.muted,
  },
});
