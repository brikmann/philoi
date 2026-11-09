import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bannerFor } from '@/components/discover/kit';
import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { topicTag } from '@/lib/api/discover';
import { agoraPhotoUrl } from '@/lib/api/agora';
import type { AgoraItem } from '@/types/database';

/**
 * A post as a discovery tile (mocks 349 / 357). Real art first: the post's photo, else a tagged
 * game/song/film/book's artwork from ss3's resolver (an `art` attachment carries the source CDN's
 * image), else the words on the author's banner colour. Tap → the post (353).
 */
export function PostTile({ item, topic, wide = false }: { item: AgoraItem; topic?: string; wide?: boolean }) {
  const router = useRouter();
  const photo = agoraPhotoUrl(item.photo_path);
  const art = item.attachments?.find((a) => a.kind === 'art')?.snapshot.art_url ?? null;
  const image = photo ?? art;
  const [a, b] = bannerFor(item.user_id);
  const open = () => router.push({ pathname: '/agora/[id]', params: { id: item.id, type: 'post' } } as never);
  const label = `${item.display_name}${topic ? ` · ${topicTag(topic)}` : ''}`;

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.tile, wide ? styles.wide : styles.grid, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Post by ${item.display_name}${item.body ? `: ${item.body}` : ''}`}>
      <View style={[styles.media, wide && styles.mediaWide]}>
        {image ? (
          <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.textArt]}>
            <Text style={styles.textArtBody} numberOfLines={wide ? 3 : 5}>
              {item.body ?? '…'}
            </Text>
          </LinearGradient>
        )}
      </View>
      <View style={styles.meta}>
        <MatchAvatar name={item.display_name} avatarUrl={item.avatar_url} size={22} />
        <View style={styles.flex}>
          <Text style={styles.author} numberOfLines={1}>
            {label}
          </Text>
          {image && item.body ? (
            <Text style={styles.body} numberOfLines={wide ? 2 : 1}>
              {item.body}
            </Text>
          ) : null}
        </View>
        {item.comments > 0 ? (
          <View style={styles.comments}>
            <Icon name="comment" size={12} color={Colors.spaceDim} />
            <Text style={styles.commentsText}>{item.comments}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  tile: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  grid: { flex: 1 },
  wide: { alignSelf: 'stretch' },
  media: { aspectRatio: 1, backgroundColor: Colors.spacePanel2 },
  mediaWide: { aspectRatio: 2.2 },
  textArt: { padding: Spacing.twelve, justifyContent: 'flex-end' },
  textArtBody: { fontFamily: Fonts.bodyBold, fontSize: 15, lineHeight: 20, color: Colors.ink },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two + 2 },
  author: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ink },
  body: { marginTop: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim },
  comments: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  commentsText: { fontFamily: Fonts.body, fontSize: 11, color: Colors.spaceDim },
});
