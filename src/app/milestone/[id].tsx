import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MilestoneShareCard } from '@/components/economy/milestone-share-card';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useShareRank } from '@/hooks/use-share-rank';
import { track } from '@/lib/analytics';
import { cheerMilestone, deleteMilestone, effortChips, fetchMilestone } from '@/lib/api/milestones';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { shareCardImage } from '@/lib/share-card';
import type { MilestoneDetail } from '@/types/database';

// §8 — one milestone: the share surface the composer lands on, and the permalink a cheer
// notification opens.
//
// 🔒 No economy. Cheering pays out nothing to either side, and posting paid out nothing to begin
// with. The only currency on this screen is other people seeing it.

export default function MilestoneScreen() {
  const router = useRouter();
  const { id, shared } = useLocalSearchParams<{ id: string; shared?: string }>();
  const { profile } = useAuth();
  const shareRank = useShareRank();
  const cardRef = useRef<View>(null);

  const [milestone, setMilestone] = useState<MilestoneDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let current = true;
    fetchMilestone(id)
      .then((m) => {
        if (current) setMilestone(m);
      })
      .catch(() => {})
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [id]);

  const isOwn = !!milestone && milestone.user_id === profile?.id;

  async function handleShare() {
    setSharing(true);
    try {
      await shareCardImage(cardRef, 'Share your milestone');
      track('milestone_shared', { kind: milestone?.kind ?? null });
    } finally {
      setSharing(false);
    }
  }

  async function handleCheer() {
    if (!milestone || milestone.cheered) return;
    try {
      const count = await cheerMilestone(milestone.id);
      setMilestone({ ...milestone, cheered: true, cheers: count });
    } catch (e) {
      Alert.alert('Could not cheer', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  function confirmDelete() {
    if (!milestone) return;
    Alert.alert('Delete milestone?', 'It disappears from your Journal and from anyone who saw it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMilestone(milestone.id);
          router.back();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <ScreenBackground>
        <SafeAreaView edges={['top']} style={[styles.safeArea, styles.centered]}>
          <ActivityIndicator color={Colors.coral} />
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  if (!milestone) {
    return (
      <ScreenBackground>
        <SafeAreaView edges={['top']} style={[styles.safeArea, styles.centered]}>
          <Text style={styles.empty}>This milestone isn&rsquo;t available.</Text>
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  const chips = effortChips(milestone.effort);

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.muted} />
          </Pressable>
          <Text style={styles.title}>{isOwn && shared ? 'Posted' : 'Milestone'}</Text>
          {isOwn ? (
            <Pressable onPress={confirmDelete} hitSlop={8} accessibilityLabel="Delete milestone">
              <Ionicons name="trash-outline" size={19} color={Colors.textTertiary} />
            </Pressable>
          ) : (
            <View style={styles.topSpacer} />
          )}
        </View>

        <ScrollView contentContainerStyle={styles.container}>
          {isOwn && shared ? (
            <Text style={styles.posted}>
              {milestone.pinned
                ? 'Pinned to your Journal. Share it anywhere you like.'
                : 'Not posted to your Journal — this card is yours to share.'}
            </Text>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.who}>
              {isOwn ? 'You' : milestone.display_name}
              {milestone.handle ? <Text style={styles.handle}> @{milestone.handle}</Text> : null}
            </Text>
            <Text style={styles.headline}>{milestone.headline}</Text>
            {milestone.note ? <Text style={styles.note}>{milestone.note}</Text> : null}

            {chips.length > 0 ? (
              <>
                <View style={styles.pills}>
                  {chips.map((c) => (
                    <View key={c.key} style={styles.pill}>
                      <Text style={styles.pillText}>{c.label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.receiptCaption}>↑ the work behind it</Text>
              </>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Pressable
              style={styles.primary}
              onPress={handleShare}
              disabled={sharing}
              accessibilityRole="button">
              <Ionicons name="share-outline" size={16} color={Colors.onEmber} />
              <Text style={styles.primaryText}>{sharing ? 'Preparing…' : 'Share'}</Text>
            </Pressable>

            {/* Cheering your own post is not a thing — the server would reject the notification
                anyway, and a lit button that does nothing is worse than no button. */}
            {!isOwn ? (
              <Pressable
                style={[styles.secondary, milestone.cheered && styles.secondaryOn]}
                onPress={handleCheer}
                disabled={milestone.cheered}
                accessibilityRole="button">
                <Text style={[styles.secondaryText, milestone.cheered && styles.secondaryTextOn]}>
                  {milestone.cheered ? '🔥 Cheered' : '🔥 Cheer'}
                  {milestone.cheers > 0 ? ` · ${milestone.cheers}` : ''}
                </Text>
              </Pressable>
            ) : milestone.cheers > 0 ? (
              <View style={styles.secondary}>
                <Text style={styles.secondaryText}>
                  🔥 {milestone.cheers} {milestone.cheers === 1 ? 'cheer' : 'cheers'}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.firewall}>
            Milestones don&rsquo;t affect XP, embers or rank. Philoi rewards the effort; this celebrates
            what it produced.
          </Text>
        </ScrollView>

        <View style={styles.offscreenCard} pointerEvents="none">
          <MilestoneShareCard
            ref={cardRef}
            headline={milestone.headline}
            note={milestone.note}
            effort={milestone.effort}
            handle={isOwn ? profile?.handle ?? null : milestone.handle}
            tier={isOwn ? shareRank.tier : undefined}
            division={isOwn ? shareRank.division : undefined}
          />
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.muted,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  topSpacer: {
    width: 19,
  },
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  posted: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 18,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 6,
  },
  who: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    color: Colors.textTertiary,
  },
  headline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    lineHeight: 25,
    color: Colors.ink,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  pill: {
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  pillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ember,
  },
  receiptCaption: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.soloChipText,
  },
  actions: {
    flexDirection: 'row',
    gap: 9,
  },
  primary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.amber,
    borderRadius: Radius.button,
    paddingVertical: 13,
  },
  primaryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.onEmber,
  },
  secondary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.button,
    paddingVertical: 13,
  },
  secondaryOn: {
    borderColor: Colors.amber,
    backgroundColor: Colors.selectedBg,
  },
  secondaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  secondaryTextOn: {
    color: Colors.ember,
  },
  firewall: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Colors.textTertiary,
  },
  offscreenCard: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
});
