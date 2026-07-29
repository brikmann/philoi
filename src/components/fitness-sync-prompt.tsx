import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { fitnessSourcesForChallengeType, getRealFitnessSourceForChallengeType, type FitnessSourceKey } from '@/lib/fitness-sync';
import { connectStrava } from '@/lib/strava';
import { connectWhoop, WHOOP_SCOPE_BY_CHALLENGE_TYPE } from '@/lib/whoop';
import type { ChallengeType } from '@/types/database';

export type SyncSource = {
  key: FitnessSourceKey;
  name: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
};

// Shared with Settings → "Connected apps" (PHILOI_UI_SPEC.md §19) — one source list, one place
// it's defined, so the contextual sheet and the persistent settings entry never drift apart.
export const FITNESS_SYNC_SOURCES: SyncSource[] = [
  { key: 'apple_health', name: 'Apple Health', detail: 'iPhone + Apple Watch', icon: 'logo-apple', iconBg: '#2a2b30', iconColor: Colors.ink },
  { key: 'health_connect', name: 'Health Connect', detail: 'Wear OS · Samsung · Android', icon: 'heart', iconBg: '#1e3329', iconColor: Colors.green },
  { key: 'strava', name: 'Strava', detail: 'Runs + rides', icon: 'bicycle', iconBg: '#3a2118', iconColor: '#FC5200' },
  { key: 'whoop', name: 'Whoop', detail: 'Strain · workouts · sleep', icon: 'pulse', iconBg: '#1d1d21', iconColor: '#E9E9EC' },
];

// The sources this challenge's metric can ACTUALLY be measured by (§17's metric-fit rule — a
// steps challenge never offers Whoop, which has no step count; a strain challenge never offers a
// pedometer), with whichever of them is really wired up leading the list.
export function getOrderedFitnessSources(challengeType: ChallengeType): SyncSource[] {
  const fits = fitnessSourcesForChallengeType(challengeType);
  const realSource = getRealFitnessSourceForChallengeType(challengeType);
  const candidates = FITNESS_SYNC_SOURCES.filter((s) => fits.includes(s.key));
  const lead = candidates.find((s) => s.key === realSource);
  if (!lead) return candidates;
  return [lead, ...candidates.filter((s) => s.key !== realSource)];
}

type FitnessSyncPromptProps = {
  visible: boolean;
  onClose: () => void;
  challengeType: ChallengeType;
  challengeTitle: string;
  challengeSubtitle: string;
  /** Fires once the real source for this challenge type connects successfully, before onClose —
   * lets the caller know the challenge it's about to create (or already has) should get an
   * immediate sync. */
  onSourceConnected?: () => void;
};

// "Track this automatically?" (design-mocks/14, §17) — the sheet only ever lists sources that can
// actually measure THIS challenge's metric (getOrderedFitnessSources, above), so a steps
// challenge never shows Whoop and a strain challenge never shows a pedometer. Of those, which one
// is really wired up depends on the type (getRealFitnessSourceForChallengeType): steps reads the
// platform's own pedometer (Apple Health/Health Connect, src/lib/healthkit.ts /
// health-connect.ts), runs/rides read Strava (src/lib/strava.ts), workouts/strain/sleep read
// Whoop (src/lib/whoop.ts) — the last two cross-platform. A listed source that isn't the real one
// stays an honest "coming soon," never faking a live connection. "I'll log it manually" is always
// available and never blocked on any of this (§18's "never gate participation").
export function FitnessSyncPrompt({ visible, onClose, challengeType, challengeTitle, challengeSubtitle, onSourceConnected }: FitnessSyncPromptProps) {
  const { connect: connectDeviceFitness } = useFitnessConnection();
  const [connecting, setConnecting] = useState<string | null>(null);
  const realSource = getRealFitnessSourceForChallengeType(challengeType);

  async function handleConnect(source: SyncSource) {
    if (source.key !== realSource) {
      Alert.alert(`${source.name} — coming soon`, "We're still building this connection. You can log progress manually for now.");
      return;
    }
    setConnecting(source.key);
    try {
      // Whoop asks for exactly the ONE scope this challenge's metric needs (§17 minimal scopes) —
      // a workout challenge grants read:workout and nothing else, not the whole Whoop account.
      const ok =
        source.key === 'strava'
          ? await connectStrava()
          : source.key === 'whoop'
            ? await connectWhoop([WHOOP_SCOPE_BY_CHALLENGE_TYPE[challengeType]].filter((s): s is string => Boolean(s)))
            : await connectDeviceFitness();
      if (ok) {
        onSourceConnected?.();
        onClose();
      } else {
        Alert.alert('Could not connect', 'That source isn’t available on this device right now — you can log progress manually instead.');
      }
    } finally {
      setConnecting(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.backdrop}>
          <View style={styles.backdropHeader}>
            <Ionicons name="people" size={12} color={Colors.amber} />
            <Text style={styles.backdropHeaderText}>Group challenge</Text>
          </View>
          <Text style={styles.backdropTitle}>{challengeTitle}</Text>
          <Text style={styles.backdropSubtitle}>{challengeSubtitle}</Text>
        </View>

        <View style={styles.grab} />
        <Text style={styles.title}>Track this automatically?</Text>
        <Text style={styles.subtitle}>It can count on its own — or log it yourself.</Text>

        {getOrderedFitnessSources(challengeType).map((source) => (
          <Pressable
            key={source.key}
            style={styles.sourceRow}
            disabled={connecting !== null}
            onPress={() => handleConnect(source)}>
            <View style={[styles.sourceIcon, { backgroundColor: source.iconBg }]}>
              <Ionicons name={source.icon} size={19} color={source.iconColor} />
            </View>
            <View style={styles.sourceInfo}>
              <Text style={styles.sourceName}>{source.name}</Text>
              <Text style={styles.sourceDetail}>{source.detail}</Text>
            </View>
            {connecting === source.key ? (
              <ActivityIndicator size="small" color={Colors.achieverText} />
            ) : (
              <View style={styles.sourceGo}>
                <Text style={styles.sourceGoText}>Connect</Text>
                <Ionicons name="chevron-forward" size={14} color={Colors.achieverText} />
              </View>
            )}
          </Pressable>
        ))}

        <Pressable style={styles.manual} onPress={onClose}>
          <Ionicons name="pencil" size={13} color={Colors.muted} />
          <Text style={styles.manualText}>I&apos;ll log it manually</Text>
        </Pressable>

        <View style={styles.privacy}>
          <Ionicons name="lock-closed" size={13} color={Colors.green} />
          <Text style={styles.privacyText}>
            We only read what this challenge needs — your campfire sees your progress, never your raw activity data.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: Colors.card,
    padding: Spacing.three,
    paddingTop: Spacing.one,
  },
  backdrop: {
    opacity: 0.55,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.two,
  },
  backdropHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  backdropHeaderText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.amber,
  },
  backdropTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
    marginTop: Spacing.one,
  },
  backdropSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cream,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    padding: Spacing.two,
    marginBottom: Spacing.two,
  },
  sourceIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceInfo: {
    flex: 1,
  },
  sourceName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  sourceDetail: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  sourceGo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  sourceGoText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
  },
  manual: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    marginTop: Spacing.one,
  },
  manualText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  privacyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 15,
  },
});
