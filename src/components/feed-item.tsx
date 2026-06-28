import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ReactionBar } from '@/components/reaction-bar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { FeedCheckIn } from '@/lib/api/check-ins';

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
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name}>{item.profiles.display_name}</Text>
        <Text style={styles.time}>{formatRelativeTime(item.created_at)}</Text>
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
    paddingHorizontal: Spacing.two,
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
