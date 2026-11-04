import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FriendFace } from '@/components/lockin-cheers/friend-faces';
import { Colors, Fonts } from '@/constants/theme';
import type { PeopleWin } from '@/lib/api/home';
import { formatRelativeTime } from '@/lib/format';

/**
 * PULSE · WHAT YOUR PEOPLE ARE BUILDING (mock 334). Wins from your friends and your clubs, newest
 * first, one line each — who, what, when — read off the Agora's 'all' channel (fetchPeopleWins).
 * Comment-only like the rest of the square: a tap opens the post, where the comments are. No like
 * count, no ordering beyond time, no rank (standing-only posts are dropped upstream).
 */
export function PeopleWinsList({ wins }: { wins: PeopleWin[] }) {
  const router = useRouter();
  if (wins.length === 0) {
    return (
      <View style={[styles.row, styles.empty]}>
        <Text style={styles.emptyText}>When your friends or clubs share a session, a PR or a milestone, it lands here.</Text>
      </View>
    );
  }
  return (
    <View>
      {wins.map((w) => (
        <Pressable
          key={`${w.itemType}:${w.id}`}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/agora/[id]', params: { id: w.id, type: w.itemType } })}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <FriendFace name={w.name} avatarUrl={w.avatarUrl} size={36} />
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {w.title}
            </Text>
            {w.sub || w.room ? (
              <Text style={styles.sub} numberOfLines={1}>
                {[w.room, w.sub].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <Text style={styles.at}>{formatRelativeTime(w.at).replace(' ago', '')}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.65)',
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  pressed: {
    opacity: 0.85,
  },
  empty: {
    paddingVertical: 14,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  text: {
    flex: 1,
    marginLeft: 11,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  at: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.spaceFaint,
    marginLeft: 8,
  },
});
