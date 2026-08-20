import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TrophyTile } from '@/components/profile/trophy-tile';
import { seasonLabel } from '@/components/profile/trophy-hall-section';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { fetchTrophyHall, setProfileItemHidden, winRate } from '@/lib/api/trophy-hall';
import { fetchProfileById } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { badgeLabel } from '@/lib/economy/badges';
import { getItem } from '@/lib/economy/catalog';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { extraGrantedBadges, formatPlacement, milestoneBadges, type BadgeState } from '@/lib/economy/milestone-badges';
import type { HallSeason, TrophyHall } from '@/types/database';

// §4 — the full "See all" hall, grouped: season placements · relics · the milestone badge grid ·
// the duel record.
//
// EARNED-ONLY, on your profile and on anyone else's. Every group here is something that cannot be
// bought or rolled, which is the entire argument for showing it to a visitor.
//
// The owner can hide any individual item, or the record, from visitors — long-press a tile, or tap
// a season card. Hidden things stay visible to the owner (marked 🔒) rather than disappearing from
// their own hall, so "hidden" never reads as "lost".

export default function TrophyHallScreen() {
  const router = useRouter();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const { profile: myProfile } = useAuth();

  const userId = userIdParam ?? myProfile?.id;
  const [hall, setHall] = useState<TrophyHall | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setHall(await fetchTrophyHall(userId));
    } catch {
      // Leaves the screen on its empty state rather than an error page — the hall is a showcase,
      // and a failed read is not worth a dead end.
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId || userId === myProfile?.id) return;
    fetchProfileById(userId)
      .then((p) => setOwnerName(p.display_name))
      .catch(() => {});
  }, [userId, myProfile?.id]);

  useEffect(() => {
    if (hall) track('trophy_hall_see_all', { own: hall.is_owner });
  }, [hall]);

  const isOwner = hall?.is_owner ?? false;

  async function toggleHidden(kind: 'cosmetic' | 'badge' | 'season' | 'record', key: string, hidden: boolean) {
    await setProfileItemHidden(kind, key, hidden);
    await load();
  }

  function pressSeason(season: HallSeason) {
    if (!isOwner) return;
    Alert.alert(
      seasonLabel(season.season_id),
      formatPlacement(season.placement, season.board_size),
      [
        {
          text: season.hidden ? 'Show to visitors' : 'Hide from visitors',
          onPress: () => void toggleHidden('season', season.season_id, !season.hidden),
        },
        { text: 'Done', style: 'cancel' },
      ]
    );
  }

  function pressTrophy(key: string, hidden: boolean) {
    const item = getItem(key);
    const body = item ? `${item.rarity.toUpperCase()}\n\n${item.lore}` : 'Earned.';
    Alert.alert(item?.name ?? key, body, [
      ...(isOwner
        ? [
            {
              text: hidden ? 'Show to visitors' : 'Hide from visitors',
              onPress: () => void toggleHidden('cosmetic', key, !hidden),
            },
          ]
        : []),
      { text: 'Done', style: 'cancel' as const },
    ]);
  }

  const title = isOwner ? 'Trophy Hall' : ownerName ? `${ownerName.split(' ')[0]}'s Trophy Hall` : 'Trophy Hall';
  const record = hall?.record ?? null;
  const rate = record ? winRate(record.won, record.lost) : null;
  const badges = hall ? milestoneBadges(hall.stats, hall.record, hall.badges) : [];
  const extras = hall ? extraGrantedBadges(hall.badges) : [];

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.muted} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.topSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.blurb}>
            Everything here was earned. None of it is in a box or a shop.
          </Text>

          {hall && hall.seasons.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>SEASON PLACEMENTS</Text>
              {hall.seasons.map((s) => (
                <Pressable
                  key={s.season_id}
                  style={[styles.season, s.hidden && styles.dimmed]}
                  onPress={() => pressSeason(s)}
                  disabled={!isOwner}>
                  <View style={styles.seasonTop}>
                    <Text style={styles.seasonKicker}>{seasonLabel(s.season_id)}</Text>
                    {s.hidden ? <Text style={styles.lock}>🔒</Text> : null}
                  </View>
                  <Text style={styles.seasonPlacement}>{formatPlacement(s.placement, s.board_size)}</Text>
                  {s.title || s.medal_key ? (
                    <View style={styles.seasonMeta}>
                      <Ionicons name="medal" size={11} color={RARITY_COLOR.mythic} />
                      <Text style={styles.seasonMetaText} numberOfLines={1}>
                        {[s.title ? `“${s.title}”` : null, s.medal_key ? getItem(s.medal_key)?.name : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {hall && hall.relics.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>RELICS & MEDALS</Text>
              <View style={styles.trophies}>
                {hall.relics.map((r) => (
                  <View key={r.key} style={styles.trophySlot}>
                    <TrophyTile itemKey={r.key} hidden={r.hidden} onPress={() => pressTrophy(r.key, r.hidden)} />
                  </View>
                ))}
                {/* Keeps a short final row left-aligned on the 4-up grid instead of stretching. */}
                {padding(hall.relics.length).map((i) => (
                  <View key={`pad-${i}`} style={styles.trophySlot} />
                ))}
              </View>
            </View>
          ) : null}

          {hall ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>MILESTONES</Text>
              <View style={styles.badges}>
                {badges.map((b) => (
                  <BadgeTile key={b.key} badge={b} />
                ))}
              </View>
              {extras.length > 0 ? (
                <Text style={styles.extras}>Also earned: {extras.map((e) => badgeLabel(e.key)).join(' · ')}</Text>
              ) : null}
            </View>
          ) : null}

          {record ? (
            <View style={styles.group}>
              <View style={styles.recordHead}>
                <Text style={styles.groupLabel}>CHALLENGE RECORD</Text>
                {isOwner ? (
                  <Pressable onPress={() => void toggleHidden('record', 'record', !record.hidden)} hitSlop={8}>
                    <Text style={styles.hideLink}>{record.hidden ? '🔒 Hidden — show' : 'Hide from visitors'}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.record}>
                <Rec value={String(record.won)} label="duels won" tone={Colors.green} />
                <Rec value={String(record.lost)} label="lost" tone={Colors.muted} />
                <Rec value={rate === null ? '—' : `${rate}%`} label="win rate" tone={Colors.amber} />
              </View>
              {record.drawn > 0 ? (
                <Text style={styles.drawn}>
                  {record.drawn} drawn — draws don&rsquo;t count toward the win rate.
                </Text>
              ) : null}
            </View>
          ) : null}

          {hall && !hall.is_owner && hall.hidden_count > 0 ? (
            <Text style={styles.hiddenNote}>
              🔒 {hall.hidden_count} {hall.hidden_count === 1 ? 'item' : 'items'} hidden by owner
            </Text>
          ) : null}

          {hall && hall.seasons.length === 0 && hall.relics.length === 0 && !record ? (
            <Text style={styles.blurb}>
              {isOwner
                ? 'Nothing earned yet. Finish a season, hold a streak, or win a duel and it lands here.'
                : 'Nothing to show here yet.'}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

/** Locked tiles are greyed rather than absent — the grid is a collection to complete (§4). */
function BadgeTile({ badge }: { badge: BadgeState }) {
  return (
    <Pressable
      style={[styles.badge, !badge.earned && styles.badgeLocked]}
      onPress={() => Alert.alert(badge.label, badge.earned ? 'Earned.' : badge.requirement)}
      accessibilityRole="button"
      accessibilityLabel={`${badge.label}, ${badge.earned ? 'earned' : `locked — ${badge.requirement}`}`}>
      <Ionicons name={badge.icon} size={26} color={badge.earned ? badge.tint : Colors.textTertiary} />
      {badge.earned && badge.count && badge.count > 1 ? (
        <Text style={styles.badgeCount}>×{badge.count}</Text>
      ) : null}
      <Text style={styles.badgeLabel} numberOfLines={1}>
        {badge.label}
      </Text>
    </Pressable>
  );
}

function Rec({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <View style={styles.rec}>
      <Text style={[styles.recValue, { color: tone }]}>{value}</Text>
      <Text style={styles.recLabel}>{label}</Text>
    </View>
  );
}

/** Empty cells to fill out the last row of a 4-up grid. */
function padding(count: number): number[] {
  const rem = count % 4;
  if (rem === 0) return [];
  return Array.from({ length: 4 - rem }, (_, i) => i);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
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
    width: 22,
  },
  container: {
    padding: Spacing.four,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  blurb: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 18,
  },
  group: {
    gap: Spacing.two,
  },
  groupLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.muted,
  },
  dimmed: {
    opacity: 0.5,
  },
  lock: {
    fontSize: 10,
  },
  season: {
    backgroundColor: 'rgba(242,163,60,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.28)',
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  seasonTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seasonKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: Colors.amber,
  },
  seasonPlacement: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  seasonMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seasonMetaText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: RARITY_COLOR.mythic,
  },
  trophies: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  trophySlot: {
    width: '22.5%',
    flexDirection: 'row',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    width: '22.5%',
    aspectRatio: 1,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 3,
  },
  badgeLocked: {
    opacity: 0.32,
  },
  badgeLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 7.5,
    color: Colors.muted,
    textAlign: 'center',
  },
  badgeCount: {
    position: 'absolute',
    bottom: 4,
    right: 5,
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: Colors.ember,
  },
  extras: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  recordHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  hideLink: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.ember,
  },
  record: {
    flexDirection: 'row',
    gap: 9,
  },
  rec: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingVertical: 10,
  },
  recValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
  },
  recLabel: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.muted,
    marginTop: 2,
  },
  drawn: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  hiddenNote: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
});
