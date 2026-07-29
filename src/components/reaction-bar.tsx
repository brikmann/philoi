import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { addReaction, removeReaction } from '@/lib/api/reactions';
import { useAuth } from '@/lib/auth/auth-context';
import { fireLightTap } from '@/lib/reward-feedback';
import type { Reaction } from '@/types/database';

const QUICK_EMOJI = ['🔥', '💪', '👏', '😂', '❤️'];

type ReactionBarProps = {
  checkInId: string;
  reactions: Reaction[];
  onChanged: () => void;
  // A permanent 5-emoji row on every card gets noisy in a dense chat chain — compact mode
  // (design-mocks/06's `.react`: a single "🔥 4" tally pill) shows just the total and only
  // expands into the full picker row on tap (lock-in-event-card.tsx).
  compact?: boolean;
};

export function ReactionBar({ checkInId, reactions, onChanged, compact }: ReactionBarProps) {
  const { session } = useAuth();
  const myId = session?.user.id;
  const [expanded, setExpanded] = useState(false);

  async function toggle(emoji: string) {
    if (!myId) return;
    const mine = reactions.find((r) => r.emoji === emoji && r.user_id === myId);
    fireLightTap();
    if (mine) {
      await removeReaction(checkInId, myId, emoji);
    } else {
      await addReaction(checkInId, myId, emoji);
    }
    onChanged();
  }

  if (compact && !expanded) {
    const total = reactions.length;
    const iMine = reactions.some((r) => r.user_id === myId);
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        style={[styles.tallyPill, iMine && styles.tallyPillActive]}
        accessibilityLabel={total > 0 ? `${total} reactions, tap to react` : 'Add a reaction'}
        accessibilityRole="button">
        <Ionicons name="flame" size={12} color={total > 0 ? Colors.achieverText : Colors.textTertiary} />
        {total > 0 && <Text style={styles.tallyCount}>{total}</Text>}
      </Pressable>
    );
  }

  return (
    <View style={styles.row}>
      {QUICK_EMOJI.map((emoji) => {
        const count = reactions.filter((r) => r.emoji === emoji).length;
        const mine = reactions.some((r) => r.emoji === emoji && r.user_id === myId);
        const label = `React ${emoji}${mine ? ', tap to remove' : ''}`;
        if (count === 0) {
          return (
            <Pressable
              key={emoji}
              onPress={() => toggle(emoji)}
              style={styles.ghostPill}
              accessibilityLabel={label}
              accessibilityRole="button">
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          );
        }
        return (
          <Pressable
            key={emoji}
            onPress={() => toggle(emoji)}
            style={[styles.pill, mine && styles.pillActive]}
            accessibilityLabel={`${label}, ${count} ${count === 1 ? 'reaction' : 'reactions'}`}
            accessibilityRole="button">
            <Text style={styles.emoji}>{emoji}</Text>
            <Text style={[styles.count, mine && styles.countActive]}>{count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  tallyPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 7,
    backgroundColor: Colors.disabled,
    marginTop: 6,
  },
  tallyPillActive: {
    backgroundColor: Colors.achieverBg,
  },
  tallyCount: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
    backgroundColor: Colors.line,
  },
  pillActive: {
    backgroundColor: Colors.achieverBg,
  },
  ghostPill: {
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
    opacity: 0.5,
  },
  emoji: {
    fontSize: 14,
  },
  count: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ink,
  },
  countActive: {
    color: Colors.achieverText,
  },
});
