import { Ionicons } from '@expo/vector-icons';
import { useId } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, EMBER_GRADIENT, Fonts, Radius, Spacing } from '@/constants/theme';
import type { SocialChallengeRaceMetric } from '@/types/database';

type ChallengeSentSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Back to the form with everything still filled in — the ghost action under Done. */
  onStartAnother?: () => void;
  opponentName: string;
  raceMetric: SocialChallengeRaceMetric;
  windowHours: number;
  payoutXp: number;
};

function formatWindow(hours: number): string {
  if (hours >= 168) return '1 week';
  if (hours >= 72) return `${Math.round(hours / 24)} days`;
  return `${hours}h`;
}

// The paper plane from mock 98's sent screen — filled with the ember gradient, bottom-up.
function PaperPlaneHero({ size = 110 }: { size?: number }) {
  // Gradient ids are global in react-native-svg — see the note in primary-button.tsx.
  const grad = `plane-${useId()}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={EMBER_GRADIENT[0]} />
          <Stop offset="1" stopColor={EMBER_GRADIENT[2]} />
        </LinearGradient>
      </Defs>
      <Path d="M2 12l19-8-6 18-4-7-9-3z" fill={`url(#${grad})`} />
    </Svg>
  );
}

// design-mocks/98 (was 55a) — the confirmation that replaced a plain native Alert (punchlist 3:
// sending a challenge needs a clear "sent" state, not a silent bounce back to the form).
//
// Full-screen on the ember ground rather than a bottom sheet, and with the actions at the BOTTOM:
// as a sheet the primary sat directly under the summary, i.e. near the top of the sheet with dead
// space beneath it, so "Done" read as part of the confirmation copy instead of the thing you do
// after reading it. Confirmation up top, actions on the bottom edge.
export function ChallengeSentSheet({
  visible,
  onClose,
  onStartAnother,
  opponentName,
  raceMetric,
  windowHours,
  payoutXp,
}: ChallengeSentSheetProps) {
  const metricLabel = raceMetric === 'lockin_time' ? 'Most lock-in time' : 'Most XP';

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} transparent={false}>
      <ScreenBackground>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.topSide} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="chevron-back" size={20} color={Colors.muted} />
          </Pressable>
          <Text style={styles.topTitle}>Challenge sent</Text>
          <View style={styles.topSide} />
        </View>

        <View style={styles.body}>
          <PaperPlaneHero />
          <Text style={styles.title}>Sent to {opponentName}</Text>
          <Text style={styles.meta}>
            Head-to-head · {metricLabel} · {formatWindow(windowHours)}
          </Text>
          <Text style={styles.meta}>
            Winner takes <Text style={styles.metaXp}>+{payoutXp} XP</Text>
          </Text>
          <View style={styles.waiting}>
            <Text style={styles.waitingText}>⏳ Waiting for {opponentName} to accept</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={onClose} />
          {onStartAnother && <PrimaryButton label="Start another challenge" variant="ghost" onPress={onStartAnother} />}
        </View>
      </ScreenBackground>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    // The modal covers the status bar, so this row carries its own top inset.
    paddingTop: Spacing.six,
  },
  topSide: {
    width: 24,
    alignItems: 'flex-start',
  },
  topTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
    textAlign: 'center',
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 20,
    color: Colors.muted,
    textAlign: 'center',
  },
  metaXp: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ember,
  },
  waiting: {
    marginTop: Spacing.three,
    backgroundColor: Colors.cream,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  waitingText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  footer: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.five,
  },
});
