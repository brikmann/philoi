import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { SpaceCard, SpaceHeader, SpaceSection, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
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
//
// The copy is unchanged and complete — Play reviews the words; the space-purple pass only groups
// them into labelled cards so "what we read" and "what we never do" can be found at a glance.
export default function HealthConnectRationaleScreen() {
  return (
    // Top edge only: the global footer owns the bottom inset.
    <Screen padded={false} edges={['top']}>
      <SpaceHeader title="Health Connect data use" />

      <ScrollView contentContainerStyle={styles.container}>
        <SpaceCard tone="legend" style={styles.lead}>
          <UiGlyph name="lock" size={16} color={Colors.legend} />
          <Text style={[styles.body, styles.leadText]}>
            Philoi reads step data from Health Connect only to verify progress on a challenge you&apos;ve chosen
            to track automatically — like a group step goal.
          </Text>
        </SpaceCard>

        <SpaceSection>What we read</SpaceSection>
        <SpaceCard>
          <Text style={styles.body}>What we read: your step count, only for the exact time window a challenge covers.</Text>
        </SpaceCard>

        <SpaceSection>What we never do</SpaceSection>
        <SpaceCard>
          <Text style={styles.body}>What we never do: read any other Health Connect data type, write anything back to Health Connect, or export your raw step history.</Text>
        </SpaceCard>

        <SpaceSection>What your campfire sees</SpaceSection>
        <SpaceCard>
          <Text style={styles.body}>
            What your campfire sees: only the same running total everyone already sees for a manually-logged
            challenge — e.g. &quot;8,200 / 10,000 steps.&quot; Nobody sees your Health Connect data itself.
          </Text>
        </SpaceCard>

        <SpaceSection>Your control</SpaceSection>
        <View style={styles.last}>
          <SpaceCard>
            <Text style={styles.body}>
              You can disconnect at any time from Settings → Integrations, or manage Philoi&apos;s access directly
              in Health Connect&apos;s own app settings. Logging progress manually always works, connected or not.
            </Text>
          </SpaceCard>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.twelve,
  },
  leadText: {
    flex: 1,
    color: Colors.ink,
  },
  last: {
    marginBottom: Spacing.two,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.spaceDim,
  },
});
