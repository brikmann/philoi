import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyLine } from '@/components/discover/kit';
import { PostTile } from '@/components/discover/post-tile';
import { SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchTrendingTopics, searchAgoraPosts, topicTag, type TrendingTopic } from '@/lib/api/discover';
import { fetchAgoraFeed } from '@/lib/api/agora';
import type { AgoraItem } from '@/types/database';

// POSTS BY TOPIC (ShareSpot ss2, mock 357) — swipe by #topic (#running, #finals…), a grid of posts
// on that theme, tap opens the post (353). "All" is the public square, newest first. A topic is a
// word: 0299's search_agora_posts finds it with or without the #, behind the feed's own visibility
// gate. Your own interests lead the chips, then featured ones.

const PAGE = 24;

export default function PostsByTopic() {
  const { topic: initial } = useLocalSearchParams<{ topic?: string }>();
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [topic, setTopic] = useState<string | null>(typeof initial === 'string' && initial ? initial : null);
  const [page, setPage] = useState<{ topic: string | null; items: AgoraItem[]; done: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    fetchTrendingTopics(12)
      .then(setTopics)
      .catch(() => setTopics([]));
  }, []);

  const load = useCallback((t: string | null, before: AgoraItem | null) => {
    const cursor = before ? { created_at: before.created_at, id: before.id } : null;
    return t
      ? searchAgoraPosts(t, cursor, PAGE)
      : fetchAgoraFeed('everyone', cursor, PAGE).then((rows) => rows.filter((r) => r.item_type === 'post'));
  }, []);

  useEffect(() => {
    let live = true;
    load(topic, null)
      .then((items) => live && setPage({ topic, items, done: items.length < PAGE }))
      .catch(() => live && setPage({ topic, items: [], done: true }));
    return () => {
      live = false;
    };
  }, [topic, load]);

  const current = page && page.topic === topic ? page : null;

  const more = async () => {
    if (!current || current.done || loadingMore || current.items.length === 0) return;
    setLoadingMore(true);
    try {
      const next = await load(topic, current.items[current.items.length - 1]);
      setPage((p) => (p && p.topic === topic ? { topic, items: [...p.items, ...next], done: next.length < PAGE } : p));
    } catch {
      setPage((p) => (p ? { ...p, done: true } : p));
    } finally {
      setLoadingMore(false);
    }
  };

  // The ?topic= one leads if it isn't already a chip.
  const chips = topic && !topics.some((t) => t.label.toLowerCase() === topic.toLowerCase()) ? [topic, ...topics.map((t) => t.label)] : topics.map((t) => t.label);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <SpaceHeader title="Posts" subtitle={topic ? topicTag(topic) : 'the square, by topic'} />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[null, ...chips].map((label) => {
            const on = (label ?? null) === topic || (!!label && !!topic && label.toLowerCase() === topic.toLowerCase());
            return (
              <Pressable
                key={label ?? '__all'}
                onPress={() => setTopic(label)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{label ? topicTag(label) : 'All'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!current ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : (
        <FlatList
          data={current.items}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => <PostTile item={item} topic={topic ?? undefined} />}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={Colors.navEmber} style={styles.loader} /> : null}
          ListEmptyComponent={<EmptyLine>{topic ? `No posts about ${topicTag(topic)} yet — be the first.` : 'Nothing in the square yet.'}</EmptyLine>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  chips: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.twelve },
  chip: {
    paddingHorizontal: Spacing.three,
    height: 34,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: { backgroundColor: Colors.navEmber2, borderColor: Colors.navEmber2 },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.muted },
  chipTextOn: { color: Colors.onEmber },
  grid: { paddingHorizontal: Spacing.three, paddingBottom: 120, gap: Spacing.twelve },
  row: { gap: Spacing.twelve },
  loader: { marginTop: Spacing.four },
});
