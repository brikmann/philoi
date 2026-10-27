import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, IconText } from '@/components/ui/icon';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts } from '@/constants/theme';
import type { TrophyHall } from '@/types/database';

// Mock 325's inline stats and Trophy Hall door — the two small pieces of the one-scroll profile
// that aren't the card, the identity blocks or the Showcase wall.

/**
 * Lifetime hours · streak · relics · PRs, one compact row (no Stats tab any more).
 *
 * Every number comes off the trophy hall's own stats, which the server computes the same way for
 * a visitor as for the owner, except PRs: those rows are owner-only, so `prCount` is null on
 * someone else's profile and the tile isn't drawn rather than claiming a zero.
 */
export function ProfileStatsRow({ hall, prCount }: { hall: TrophyHall | null; prCount: number | null }) {
  if (!hall) return null;
  const seconds = hall.stats.total_seconds;
  // Whole hours once there are any — "312h" is the flex; a first-week profile still reads "45m".
  const lockedIn = seconds >= 3600 ? `${Math.floor(seconds / 3600).toLocaleString()}h` : `${Math.floor(seconds / 60)}m`;
  const relics = hall.relics.filter((r) => !r.in_progress).length;

  return (
    <View style={styles.stats}>
      <Stat value={lockedIn} label="Locked in" />
      <View style={styles.stat}>
        <IconText icon="streak" style={styles.value} iconColor={Colors.emberForward} numberOfLines={1}>
          {hall.stats.current_streak}
        </IconText>
        <Text style={styles.label}>Streak</Text>
      </View>
      <Stat value={String(relics)} label="Relics" tone={Colors.legend} />
      {prCount !== null ? <Stat value={String(prCount)} label="PRs" /> : null}
    </View>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${value} ${label}`}>
      <Text style={[styles.value, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

/** The door to the full hall — relics, medals and the earned titles that left the name line. */
export function TrophyHallLink({ userId }: { userId: string }) {
  const router = useRouter();
  return (
    <Pressable
      style={styles.th}
      onPress={() => router.push({ pathname: '/trophy-hall', params: { userId } })}
      accessibilityRole="button"
      accessibilityLabel="Trophy Hall">
      <View style={styles.thIcon}>
        <Icon name="temple" size={18} color={Colors.gold} />
      </View>
      <View style={styles.thText}>
        <Text style={styles.thTitle}>Trophy Hall</Text>
        <Text style={styles.thSub} numberOfLines={1}>
          Relics, medals &amp; earned titles
        </Text>
      </View>
      <UiGlyph name="forward" size={13} color={Colors.spaceFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  value: {
    fontFamily: Fonts.black,
    fontSize: 16,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 8.5,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: Colors.muted,
    marginTop: 2,
  },
  th: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  thIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thText: {
    flex: 1,
    minWidth: 0,
  },
  thTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  thSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.spaceDim,
    marginTop: 1,
  },
});
