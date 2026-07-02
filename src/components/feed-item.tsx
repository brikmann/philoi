import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ReactionBar } from '@/components/reaction-bar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { FeedCheckIn } from '@/lib/api/check-ins';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/supabase';

function formatRelativeTime(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type FeedItemProps = {
  item: FeedCheckIn;
  onReactionChanged: () => void;
};

export function FeedItem({ item, onReactionChanged }: FeedItemProps) {
  const router = useRouter();
  const { session } = useAuth();
  const isOwnPost = item.user_id === session?.user.id;

  function handleMore() {
    const options = isOwnPost
      ? [{ text: 'Cancel', style: 'cancel' as const }]
      : [
          { text: 'Report', onPress: () => router.push(`/report?checkInId=${item.id}&userId=${item.user_id}`) },
          {
            text: 'Block user',
            style: 'destructive' as const,
            onPress: async () => {
              if (!session) return;
              await supabase.from('blocked_users').insert({ blocker_id: session.user.id, blocked_id: item.user_id });
              onReactionChanged();
              Alert.alert('User blocked', "You won't see their posts anymore.");
            },
          },
          { text: 'Cancel', style: 'cancel' as const },
        ];
    Alert.alert(isOwnPost ? 'Options' : 'Report or block', '', options);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name}>{item.profiles.display_name}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.time}>{formatRelativeTime(item.created_at)}</Text>
          <Pressable
            onPress={handleMore}
            hitSlop={12}
            style={styles.moreButton}
            accessibilityLabel={isOwnPost ? 'Post options' : 'Report or block'}
            accessibilityRole="button">
            <Text style={styles.more}>···</Text>
          </Pressable>
        </View>
      </View>

      {item.signedPhotoUrl && <Image source={{ uri: item.signedPhotoUrl }} style={styles.photo} />}

      {item.caption && <Text style={styles.caption}>{item.caption}</Text>}

      <ReactionBar checkInId={item.id} reactions={item.reactions} onChanged={onReactionChanged} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  moreButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: {
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    fontSize: 16,
    letterSpacing: 1,
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.input,
    backgroundColor: Colors.line,
  },
  caption: {
    fontFamily: Fonts.body,
    color: Colors.ink,
    paddingHorizontal: Spacing.two,
  },
});
