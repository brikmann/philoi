import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CompareStat } from '@/components/versus/send-plan';
import { Colors, Fonts, Radius } from '@/constants/theme';

type CompareStatRowProps = {
  stat: CompareStat;
  flagged: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleFlag: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
};

// One stat in the compare zone (mock 292's `.crow`) with its ⚔ switch: Challenge or Compare only.
//
// The switch only exists for a challengeable stat. A compare-only one says so in the same slot
// rather than showing a dead toggle — a control you can see but never flip reads as broken.
// Reordering is two arrows, the same trade the workout log makes: no drag library in the project,
// and a dozen rows don't justify one.
export function CompareStatRow({ stat, flagged, isFirst, isLast, onToggleFlag, onMove, onRemove }: CompareStatRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.moves}>
        <Pressable onPress={() => onMove(-1)} disabled={isFirst} hitSlop={4} accessibilityLabel={`Move ${stat.label} up`}>
          <Ionicons name="chevron-up" size={13} color={isFirst ? Colors.disabled : Colors.textTertiary} />
        </Pressable>
        <Pressable onPress={() => onMove(1)} disabled={isLast} hitSlop={4} accessibilityLabel={`Move ${stat.label} down`}>
          <Ionicons name="chevron-down" size={13} color={isLast ? Colors.disabled : Colors.textTertiary} />
        </Pressable>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {stat.emoji} {stat.label}
      </Text>

      {stat.challengeable ? (
        <Pressable
          onPress={onToggleFlag}
          style={styles.switchWrap}
          hitSlop={6}
          accessibilityRole="switch"
          accessibilityState={{ checked: flagged }}
          accessibilityLabel={`Challenge on ${stat.label}`}>
          <Text style={[styles.switchLabel, flagged && styles.switchLabelOn]}>{flagged ? '⚔ Challenge' : 'Compare only'}</Text>
          <View style={[styles.track, flagged && styles.trackOn]}>
            <View style={[styles.knob, flagged && styles.knobOn]} />
          </View>
        </Pressable>
      ) : (
        <Text style={styles.compareOnly}>Compare only</Text>
      )}

      <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove ${stat.label}`}>
        <Ionicons name="close" size={14} color={Colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 9,
    marginBottom: 6,
  },
  moves: {
    gap: 1,
  },
  label: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  switchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  switchLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },
  switchLabelOn: {
    color: Colors.danger,
  },
  track: {
    width: 32,
    height: 18,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    justifyContent: 'center',
  },
  trackOn: {
    backgroundColor: Colors.danger,
  },
  knob: {
    width: 13,
    height: 13,
    borderRadius: 7,
    marginLeft: 2.5,
    backgroundColor: Colors.trackAlt,
  },
  knobOn: {
    marginLeft: 16.5,
    backgroundColor: Colors.ink,
  },
  compareOnly: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },
});
