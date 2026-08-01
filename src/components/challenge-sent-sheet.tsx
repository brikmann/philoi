import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { SocialChallengeRaceMetric } from '@/types/database';

type ChallengeSentSheetProps = {
  visible: boolean;
  onClose: () => void;
  opponentName: string;
  raceMetric: SocialChallengeRaceMetric;
  windowHours: number;
  payoutXp: number;
};

function formatWindow(hours: number): string {
  if (hours >= 168) return 'This week';
  if (hours >= 72) return `Next ${hours / 24} days`;
  return `Next ${hours}h`;
}

// design-mocks/55a — replaces a plain native Alert with a clear, on-brand "sent" confirmation:
// a green check, the challenge summary, and an explicit PENDING state (punchlist 3: sending a
// challenge needs a clear confirmation, not a silent bounce back to the previous screen).
export function ChallengeSentSheet({ visible, onClose, opponentName, raceMetric, windowHours, payoutXp }: ChallengeSentSheetProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={30} color={Colors.green} />
          </View>
          <Text style={styles.title}>Challenge sent</Text>
          <Text style={styles.subtitle}>{opponentName} has to accept before it starts. You&apos;ll be notified.</Text>

          <View style={styles.summary}>
            <View style={styles.summaryIcon}>
              <Ionicons name="flash" size={15} color={Colors.achieverText} />
            </View>
            <View style={styles.summaryText}>
              <Text style={styles.summaryTitle}>vs {opponentName} · {raceMetric === 'lockin_time' ? 'Most lock-in time' : 'Most XP'}</Text>
              <Text style={styles.summarySubtitle}>{formatWindow(windowHours)} · winner takes +{payoutXp} XP</Text>
            </View>
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>PENDING</Text>
            </View>
          </View>

          <Pressable onPress={onClose}>
            <PrimaryButton label="Done" onPress={onClose} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,14,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    alignItems: 'center',
  },
  checkCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(61,168,92,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.one,
    lineHeight: 18,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'stretch',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginTop: Spacing.four,
    marginBottom: Spacing.four,
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.selectedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: {
    flex: 1,
  },
  summaryTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  summarySubtitle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  pendingBadge: {
    backgroundColor: 'rgba(242,163,60,0.16)',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  pendingBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.amber,
  },
});
