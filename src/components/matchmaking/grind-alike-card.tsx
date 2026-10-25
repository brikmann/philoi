import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SHOW_ALIKE_SCORE } from '@/components/matchmaking/config';
import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { ReasonChips } from '@/components/matchmaking/reason-chips';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { GrindAlike } from '@/types/social';

type GrindAlikeCardProps = {
  match: GrindAlike;
  onOpen: () => void;
  onMore: () => void;
};

// One person on the shelf (mock 299, phone 1). The reasons are the loud part; the score sits in
// the corner in muted grey with no colour, no medal and no position — it says how alike, never
// how good.
export function GrindAlikeCard({ match, onOpen, onMore }: GrindAlikeCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${match.display_name}, why you two match`}>
      <View style={styles.top}>
        <MatchAvatar name={match.display_name} avatarUrl={match.avatar_url} live={match.live} />
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {match.display_name}
          </Text>
          {match.career_goal ? (
            <Text style={styles.goal} numberOfLines={1}>
              {match.career_goal}
            </Text>
          ) : null}
          {match.live ? <Text style={styles.live}>● locked in now</Text> : null}
        </View>
        {SHOW_ALIKE_SCORE ? <Text style={styles.score}>{Math.round(match.score)} alike</Text> : null}
        <Pressable onPress={onMore} hitSlop={10} accessibilityLabel={`More options for ${match.display_name}`}>
          <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textTertiary} />
        </Pressable>
      </View>
      <ReasonChips reasons={match.reasons} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 16,
    padding: 13,
    marginBottom: 11,
  },
  pressed: {
    opacity: 0.85,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  goal: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.amber,
    marginTop: 1,
  },
  live: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.green,
    marginTop: 2,
  },
  score: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginRight: Spacing.one,
  },
});
