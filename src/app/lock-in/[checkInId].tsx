import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PhotoViewer } from '@/components/photo-viewer';
import { StoryShareSheet } from '@/components/story-sticker/story-share-sheet';
import { GOAL_TYPE_NAV_GLYPH } from '@/components/ui/glyphs-session';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Screen } from '@/components/ui/screen';
import { SPACE_GUTTER, SpaceButton, SpaceEmpty, SpaceSection } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchLockInDetail, type LockInDetail } from '@/lib/api/check-ins';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';

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
// (54b) — now the story sticker, the same one the done screen shares.
//
// Space-purple pass: the discipline glyph the Lock In tab started it with (not the goal emoji),
// kit panels and buttons, gold for the XP it earned.
export default function LockInDetailScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { checkInId } = useLocalSearchParams<{ checkInId: string }>();
  const [detail, setDetail] = useState<LockInDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);

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

  if (loading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Colors.navEmber} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen style={styles.centered}>
        <SpaceEmpty title="This lock-in isn’t available." />
      </Screen>
    );
  }

  const prCount = detail.workoutSets.filter((s) => s.is_pr).length;
  const topSet = [...detail.workoutSets].sort((a, b) => Number(b.is_pr) - Number(a.is_pr))[0] ?? null;
  const streakDays = profile?.current_streak ?? 0;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Close">
          <UiGlyph name="down" size={18} color={Colors.ink} />
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.gicon}>
            <NavGlyph name={GOAL_TYPE_NAV_GLYPH[detail.goal_type]} size={30} color={Colors.navEmber} />
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
          <View style={styles.statDivider} />
          <View style={styles.bigStat}>
            <Text style={[styles.bigStatValue, styles.earned]}>+{detail.xp_earned}</Text>
            <Text style={styles.bigStatLabel}>XP EARNED</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.bigStat}>
            <Text style={styles.bigStatValue}>{prCount}</Text>
            <Text style={styles.bigStatLabel}>PRs</Text>
          </View>
        </View>

        <SpaceSection>Details</SpaceSection>
        <View style={styles.detailsCard}>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Streak</Text>
            <View style={styles.rowValueInline}>
              <NavGlyph name="flame" size={13} color={Colors.gold} />
              <Text style={styles.rowValue}>{streakDays} days · kept alive</Text>
            </View>
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
                    <NavGlyph name="trophy" size={10} color={Colors.gold} />
                    <Text style={styles.prBadgeText}>PR</Text>
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
            <SpaceSection>Photos</SpaceSection>
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
          <SpaceButton
            label="Share"
            onPress={() => setStickerOpen(true)}
            leading={<UiGlyph name="share" size={16} color="#2A0F05" />}
            style={styles.shareBtn}
          />
          <SpaceButton label="Keep private" variant="secondary" onPress={() => router.back()} style={styles.shareBtn} />
        </View>
      </ScrollView>

      <PhotoViewer visible={viewerUri !== null} uri={viewerUri} onClose={() => setViewerUri(null)} />

      <StoryShareSheet
        visible={stickerOpen}
        onClose={() => setStickerOpen(false)}
        session={{
          checkInId: detail.id,
          goalType: detail.goal_type,
          goalDetail: detail.goal_detail,
          durationSeconds: detail.duration_seconds ?? 0,
          xpEarned: detail.xp_earned,
          distanceM: detail.distance_m,
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  // The kit's round 36px header action, chevron pointing down: this screen dismisses, it doesn't
  // go "back" through a stack.
  back: {
    alignSelf: 'flex-start',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  hero: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  gicon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(255,122,47,0.10)',
    borderWidth: 1,
    borderColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gname: {
    fontFamily: Fonts.black,
    fontSize: 22,
    color: Colors.ink,
    marginTop: Spacing.twelve,
    textAlign: 'center',
  },
  gdate: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    marginTop: 3,
    textAlign: 'center',
  },
  bigStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    marginTop: Spacing.four,
  },
  bigStat: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: Colors.spaceLine,
  },
  bigStatValue: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 20,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  // Gold = earned (the space kit's rule).
  earned: {
    color: Colors.gold,
  },
  bigStatLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    color: Colors.spaceFaint,
    marginTop: 3,
  },
  detailsCard: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.twelve,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
  },
  rowKey: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,209,102,0.12)',
    borderRadius: Radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  prBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.gold,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel2,
  },
  shareRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.five,
  },
  shareBtn: {
    flex: 1,
  },
});
