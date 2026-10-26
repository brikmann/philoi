import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MilestoneShareCard } from '@/components/economy/milestone-share-card';
import { SpaceButton, SpaceEmpty, SpaceHeader, SpaceIconButton, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
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

  // No ScreenBackground in any branch any more: the root paints the space ground, screens stay clear.
  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SpaceHeader title="Milestone" />
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.navEmber} />
        </View>
      </SafeAreaView>
    );
  }

  if (!milestone) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SpaceHeader title="Milestone" />
        <View style={styles.centered}>
          <SpaceEmpty title="This milestone isn’t available." />
        </View>
      </SafeAreaView>
    );
  }

  const chips = effortChips(milestone.effort);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SpaceHeader
          title={isOwn && shared ? 'Posted' : 'Milestone'}
          right={
            isOwn ? (
              <SpaceIconButton onPress={confirmDelete} label="Delete milestone">
                <UiGlyph name="trash" size={16} color={Colors.spaceDim} />
              </SpaceIconButton>
            ) : null
          }
        />

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
            <SpaceButton
              label={sharing ? 'Preparing…' : 'Share'}
              onPress={handleShare}
              disabled={sharing}
              leading={<UiGlyph name="share" size={16} color="#2A0F05" />}
              style={styles.primary}
            />

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
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  posted: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    lineHeight: 18,
  },
  // SpaceCard tone="gold" — a milestone is something earned.
  card: {
    backgroundColor: 'rgba(255,209,102,0.07)',
    borderWidth: 1,
    borderColor: '#5A4A1E',
    borderRadius: 14,
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
    color: Colors.spaceDim,
  },
  headline: {
    fontFamily: Fonts.black,
    fontSize: 19,
    lineHeight: 25,
    color: Colors.ink,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  pill: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.35)',
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  pillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
  receiptCaption: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.spaceDim,
  },
  actions: {
    flexDirection: 'row',
    gap: 9,
  },
  primary: {
    flex: 1,
  },
  // SpaceButton secondary's look, kept a Pressable so the cheered state can light it ember.
  secondary: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 16,
  },
  secondaryOn: {
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.12)',
  },
  secondaryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  secondaryTextOn: {
    color: Colors.navEmber2,
  },
  firewall: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.spaceFaint,
  },
  offscreenCard: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
});
