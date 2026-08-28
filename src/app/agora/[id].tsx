import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AgoraCard } from '@/components/agora/agora-card';
import { AgoraCommentsSheet } from '@/components/agora/agora-comments-sheet';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { usePublicLoadout } from '@/hooks/use-public-loadouts';
import { cheerAgoraItem, fetchAgoraItem } from '@/lib/api/agora';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraItem } from '@/types/database';

// One feed item, standing alone — the permalink an `agora_cheered` / `agora_commented`
// notification opens (both store `/agora/[id]` as their route, see migration 0129). Serves posts
// and milestones alike, since a comment can hang off either.
//
// Same card, same comments sheet as the feed. A notification that opened a differently-shaped
// version of the thing you were told about is how a deep link stops feeling like the same app.

export default function AgoraPostScreen() {
  const router = useRouter();
  const { id, type, comments } = useLocalSearchParams<{
    id: string;
    /** 'post' | 'milestone' — which table the id belongs to. Defaults to a post. */
    type?: string;
    comments?: string;
  }>();

  const [item, setItem] = useState<AgoraItem | null>(null);
  const [loading, setLoading] = useState(true);
  // Opened by default: the two notifications that land here are both about the conversation, so
  // arriving at a closed sheet would mean one extra tap to see the thing you were pinged about.
  const [sheetOpen, setSheetOpen] = useState(comments !== 'false');

  const loadout = usePublicLoadout(item?.user_id);

  useEffect(() => {
    let live = true;
    fetchAgoraItem(id, type === 'milestone' ? 'milestone' : 'post')
      .then((p) => {
        if (live) setItem(p);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, type]);

  const cheer = useCallback(async () => {
    if (!item || item.cheered) return;
    setItem({ ...item, cheered: true, cheers: item.cheers + 1 });
    try {
      const count = await cheerAgoraItem(item);
      setItem((prev) => (prev ? { ...prev, cheers: count } : prev));
    } catch (e) {
      setItem((prev) => (prev ? { ...prev, cheered: false, cheers: item.cheers } : prev));
      Alert.alert('Could not cheer', getErrorMessage(e, 'Something went wrong.'));
    }
  }, [item]);

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.muted} />
          </Pressable>
          <Text style={styles.title}>{type === 'milestone' ? 'Milestone' : 'Post'}</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.coral} style={styles.loader} />
        ) : item ? (
          <ScrollView contentContainerStyle={styles.body}>
            <AgoraCard
              item={item}
              loadout={loadout}
              onCheer={cheer}
              onComment={() => setSheetOpen(true)}
              // No moderation menu on the permalink: the sheet's actions (report, block, remove)
              // all end by taking the card off a LIST, and there is no list here to take it off.
              // The feed is where that belongs.
              onMore={() => setSheetOpen(true)}
            />
          </ScrollView>
        ) : (
          <Text style={styles.empty}>This isn&rsquo;t available.</Text>
        )}
      </SafeAreaView>

      <AgoraCommentsSheet
        item={sheetOpen ? item : null}
        onClose={() => setSheetOpen(false)}
        onCountChange={(_, count) => setItem((prev) => (prev ? { ...prev, comments: count } : prev))}
      />
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  loader: {
    marginTop: Spacing.six,
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
