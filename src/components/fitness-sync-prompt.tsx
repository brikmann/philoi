import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

// Official "Connect with Strava" button (developers.strava.com/guidelines — the OAuth entry
// point must use this exact asset, never a generic "Connect" label).
const STRAVA_CONNECT_BUTTON = require('../../assets/strava/connect-button/btn_strava_connect_with_orange_x2.png');

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
      {/* SafeAreaView, not a bare View (punchlist 4F): as a plain Modal on Android this sheet is
          full-screen, so the context header rendered flush under the status bar — the title read
          as overflow text sitting beside the clock rather than the top of a deliberate sheet. */}
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.grab} />

        {/* The challenge this sheet is about. Was a 0.55-opacity "backdrop" pretending to be the
            screen behind the sheet; now a real, legible header block — chip + title + subtitle —
            so the sheet states its own context instead of ghosting it. */}
        <View style={styles.context}>
          <View style={styles.contextChip}>
            <Ionicons name="people" size={11} color={Colors.amber} />
            <Text style={styles.contextChipText}>Group challenge</Text>
          </View>
          <Text style={styles.contextTitle}>{challengeTitle}</Text>
          <Text style={styles.contextSubtitle}>{challengeSubtitle}</Text>
        </View>

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
            ) : source.key === 'strava' && source.key === realSource ? (
              <Image source={STRAVA_CONNECT_BUTTON} style={styles.stravaConnectButton} resizeMode="contain" />
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
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: Colors.card,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  // Context block — a real surface now, inset from the sheet's own background so the challenge
  // it refers to reads as a quoted subject rather than faded chrome.
  context: {
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginBottom: Spacing.four,
  },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  contextChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.amber,
  },
  contextTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    marginTop: Spacing.two,
  },
  contextSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
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
  // Roomier than the old padding:8/margin:8 — the rows were reading as a cramped stack rather
  // than tappable choices (punchlist 4F).
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.cream,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.twelve,
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
  stravaConnectButton: {
    height: 22,
    width: 108,
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
