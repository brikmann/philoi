import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LockInShareCard } from '@/components/lock-in-share-card';
import { PhotoViewer } from '@/components/photo-viewer';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchLockInDetail, type LockInDetail } from '@/lib/api/check-ins';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { shareCardImage } from '@/lib/share-card';

function formatLockInDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today, ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

// design-mocks/54a — the detail screen behind a tap on any recent lock-in on Home (punchlist
// 3): goal, duration, XP, date, photos, PRs, and which campfire it posted to, plus a share flow
// (54b) that reuses the same off-screen-card-capture technique as the fire/rank-up share cards.
export default function LockInDetailScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { checkInId } = useLocalSearchParams<{ checkInId: string }>();
  const [detail, setDetail] = useState<LockInDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);

  useEffect(() => {
    if (!checkInId) return;
    let cancelled = false;
    fetchLockInDetail(checkInId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [checkInId]);

  async function handleShare() {
    setSharing(true);
    try {
      await shareCardImage(cardRef, 'Share your lock-in');
    } finally {
      setSharing(false);
    }
  }

  if (loading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Colors.coral} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen style={styles.centered}>
        <Text style={styles.emptyText}>This lock-in isn’t available.</Text>
      </Screen>
    );
  }

  const prCount = detail.workoutSets.filter((s) => s.is_pr).length;
  const topSet = [...detail.workoutSets].sort((a, b) => Number(b.is_pr) - Number(a.is_pr))[0] ?? null;
  const streakDays = profile?.current_streak ?? 0;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-down" size={22} color={Colors.muted} />
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.gicon}>
            <Text style={styles.giconEmoji}>{GOAL_TYPE_META[detail.goal_type].emoji}</Text>
          </View>
          <Text style={styles.gname}>{detail.goal_detail || GOAL_TYPE_META[detail.goal_type].label}</Text>
          <Text style={styles.gdate}>
            {GOAL_TYPE_META[detail.goal_type].label} · {formatLockInDate(detail.created_at)}
            {detail.circleName ? ` · ${detail.circleName}` : ''}
          </Text>
        </View>

        <View style={styles.bigStats}>
          <View style={styles.bigStat}>
            <Text style={styles.bigStatValue}>{formatDurationClock(detail.duration_seconds ?? 0)}</Text>
            <Text style={styles.bigStatLabel}>DURATION</Text>
          </View>
          <View style={styles.bigStat}>
            <Text style={[styles.bigStatValue, styles.amber]}>+{detail.xp_earned}</Text>
            <Text style={styles.bigStatLabel}>XP EARNED</Text>
          </View>
          <View style={styles.bigStat}>
            <Text style={styles.bigStatValue}>{prCount}</Text>
            <Text style={styles.bigStatLabel}>PRs</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Details</Text>
        <View style={styles.detailsCard}>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Streak</Text>
            <Text style={styles.rowValue}>🔥 {streakDays} days · kept alive</Text>
          </View>
          {topSet && (
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowKey}>Top set</Text>
              <View style={styles.rowValueInline}>
                <Text style={styles.rowValue}>
                  {topSet.exercise} {topSet.sets} × {topSet.reps}
                  {topSet.weight != null ? ` @ ${topSet.weight}` : ''}
                </Text>
                {topSet.is_pr && (
                  <View style={styles.prBadge}>
                    <Text style={styles.prBadgeText}>🔥 PR</Text>
                  </View>
                )}
              </View>
            </View>
          )}
          {detail.circleName && (
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowKey}>Posted to</Text>
              <Text style={styles.rowValue}>{detail.circleName}</Text>
            </View>
          )}
        </View>

        {detail.signedPhotoUrls.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Photos</Text>
            <View style={styles.photoGrid}>
              {detail.signedPhotoUrls.map((uri) => (
                <Pressable key={uri} onPress={() => setViewerUri(uri)}>
                  <Image source={{ uri }} style={styles.photo} contentFit="cover" transition={150} />
                </Pressable>
              ))}
            </View>
          </>
        )}

        <View style={styles.shareRow}>
          <View style={styles.shareBtn}>
            <PrimaryButton label="Share" onPress={handleShare} loading={sharing} />
          </View>
          <Pressable style={styles.privateBtn} onPress={() => router.back()}>
            <Text style={styles.privateBtnText}>Keep private</Text>
          </Pressable>
        </View>
      </ScrollView>

      <PhotoViewer visible={viewerUri !== null} uri={viewerUri} onClose={() => setViewerUri(null)} />

      <View style={styles.offscreenCard} pointerEvents="none">
        <LockInShareCard
          ref={cardRef}
          displayName={profile?.display_name ?? 'You'}
          goalType={detail.goal_type}
          goalDetail={detail.goal_detail}
          durationSeconds={detail.duration_seconds ?? 0}
          xpEarned={detail.xp_earned}
          prCount={prCount}
          streakDays={streakDays}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: Fonts.body,
    color: Colors.muted,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
  },
  hero: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  gicon: {
    width: 60,
    height: 60,
    borderRadius: 15,
    backgroundColor: Colors.selectedBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giconEmoji: {
    fontSize: 28,
  },
  gname: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 19,
    color: Colors.ink,
    marginTop: Spacing.two,
  },
  gdate: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  bigStats: {
    flexDirection: 'row',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    marginTop: Spacing.four,
  },
  bigStat: {
    flex: 1,
    alignItems: 'center',
  },
  bigStatValue: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 20,
    color: Colors.ink,
  },
  amber: {
    color: Colors.amber,
  },
  bigStatLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  detailsCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  rowKey: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  rowValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  rowValueInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  prBadge: {
    backgroundColor: Colors.achieverBg,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  prBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.ember,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: Radius.card,
    backgroundColor: Colors.disabled,
  },
  shareRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.five,
  },
  shareBtn: {
    flex: 1,
  },
  privateBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
  },
  privateBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  offscreenCard: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
});
