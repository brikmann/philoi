import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchCampfireLevel, type CampfireLevel } from '@/lib/api/campfire-level';
import { ProgressBar } from '@/components/ui/progress-bar';

type CampfireLevelBadgeProps = {
  groupId: string;
};

// Shared group XP (PHILOI_UI_SPEC.md §6, design-mocks/03's `.hex`/`.bar`) — a rotated-square
// badge (distinct from the pointy-top hexagon used for personal rank, so the two visually
// never get confused) + an XP bar toward the next campfire level.
export function CampfireLevelBadge({ groupId }: CampfireLevelBadgeProps) {
  const [level, setLevel] = useState<CampfireLevel | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchCampfireLevel(groupId)
      .then((l) => {
        if (mounted) setLevel(l);
      })
      .catch(() => {
        // A missing/failed campfire-level fetch just hides the badge — not core data.
      });
    return () => {
      mounted = false;
    };
  }, [groupId]);

  if (!level) return null;

  const progress = level.xp_for_next_level > 0 ? Math.max(0, Math.min(1, level.xp_into_level / level.xp_for_next_level)) : 1;

  return (
    <View style={styles.row}>
      <View style={styles.hex}>
        <Text style={styles.hexNumeral}>{level.level}</Text>
      </View>
      <View style={styles.bar}>
        <View style={styles.barTop}>
          <Text style={styles.barLabel}>Campfire level {level.level}</Text>
          <Text style={styles.barXp}>
            <Text style={styles.barXpBold}>{Math.round(level.xp_into_level).toLocaleString()}</Text> /{' '}
            {Math.round(level.xp_for_next_level).toLocaleString()} XP
          </Text>
        </View>
        <ProgressBar ratio={progress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  hex: {
    width: 34,
    height: 34,
    backgroundColor: Colors.achieverBg,
    borderWidth: 1.5,
    borderColor: Colors.amber,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  hexNumeral: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.achieverText,
    transform: [{ rotate: '-45deg' }],
  },
  bar: {
    flex: 1,
  },
  barTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  barLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  barXp: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  barXpBold: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
});
