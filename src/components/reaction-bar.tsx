import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { addReaction, removeReaction } from '@/lib/api/reactions';
import { useAuth } from '@/lib/auth/auth-context';
import type { Reaction } from '@/types/database';

const QUICK_EMOJI = ['🔥', '💪', '👏', '😂', '❤️'];

type ReactionBarProps = {
  checkInId: string;
  reactions: Reaction[];
  onChanged: () => void;
};

export function ReactionBar({ checkInId, reactions, onChanged }: ReactionBarProps) {
  const { session } = useAuth();
  const myId = session?.user.id;

  async function toggle(emoji: string) {
    if (!myId) return;
    const mine = reactions.find((r) => r.emoji === emoji && r.user_id === myId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mine) {
      await removeReaction(checkInId, myId, emoji);
    } else {
      await addReaction(checkInId, myId, emoji);
    }
    onChanged();
  }

  return (
    <View style={styles.row}>
      {QUICK_EMOJI.map((emoji) => {
        const count = reactions.filter((r) => r.emoji === emoji).length;
        const mine = reactions.some((r) => r.emoji === emoji && r.user_id === myId);
        if (count === 0) {
          return (
            <Pressable key={emoji} onPress={() => toggle(emoji)} style={styles.ghostPill}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          );
        }
        return (
          <Pressable key={emoji} onPress={() => toggle(emoji)} style={[styles.pill, mine && styles.pillActive]}>
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
