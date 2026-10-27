import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RelicDetailSheet } from '@/components/profile/relic-detail-sheet';
import { RelicLadderRow, isLadderHallRelic } from '@/components/profile/relic-ladder-row';
import { TrophyTile } from '@/components/profile/trophy-tile';
import { seasonLabel } from '@/components/profile/trophy-hall-section';
import { SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { fetchPublicCollection, fetchTrophyHall, setProfileItemHidden, winRate } from '@/lib/api/trophy-hall';
import { fetchProfileById } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { badgeLabel } from '@/lib/economy/badges';
import { getItem, titleLabel, TITLES_BEHAVIOUR } from '@/lib/economy/catalog';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { disciplineStandings, type DisciplineStanding } from '@/lib/economy/relic-ladders';
import { extraGrantedBadges, formatPlacement, milestoneBadges, type BadgeState } from '@/lib/economy/milestone-badges';
import type { HallSeason, PublicCollection, TrophyHall } from '@/types/database';

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
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const { profile: myProfile } = useAuth();

  const userId = userIdParam ?? myProfile?.id;
  const [hall, setHall] = useState<TrophyHall | null>(null);
  // The owned titles (mock 325). They left the profile's name line, so this is where they live now.
  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  // The §4a-2 tap sheet — lore + the earn metric. One at a time, so tapping a second row swaps the
  // contents rather than stacking modals.
  const [openRelic, setOpenRelic] = useState<DisciplineStanding | null>(null);

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
    if (!userId) return;
    // Fails soft: no collection read, no titles group — the rest of the hall is unaffected.
    fetchPublicCollection(userId).then(setCollection).catch(() => {});
  }, [userId]);

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

  // Two groups out of one array (migration 0143). A relic that rides a discipline ladder is drawn as
  // a rung with its numbers; everything else — medals, the secret Greek relics — stays a tile.
  //
  // Deliberately NOT both: a granted ladder relic would otherwise appear twice on this screen, once
  // as a tile and once as a bar, and the two would disagree about what it is worth (the tile reads
  // the catalog's rung-one rarity, the bar reads the rung actually held).
  //
  // The rows are built from disciplineStandings() rather than straight off hall.relics, so the FULL
  // §4a-2 set appears — a discipline the server returned nothing for is a row at 0%, not a gap.
  // The capstone is dropped here on purpose: it rides no ladder, and it is already a trophy tile
  // below.
  //
  // Furthest along first, so the hall leads with the climb closest to finishing. Earned rungs
  // outrank raw progress: a tier-1 relic at 12 h is a bigger claim than an unearned one at 9.9 h,
  // even though the bar is fuller on the second.
  const ladders = disciplineStandings(hall?.relics ?? [])
    .filter((l) => l.ladder !== null)
    .sort((a, b) => b.tier - a.tier || b.pct - a.pct);
  const trophies = (hall?.relics ?? []).filter((r) => !isLadderHallRelic(r));

  // `ladders` is now always the full set of five, so it can no longer stand in for "is there
  // anything here". A stranger's hall must not open on five untouched bars — that is a comment on
  // them, not a prompt anyone can act on — while your own hall shows the whole set precisely because
  // the locked half is the thing to chase.
  const showLadders = isOwner || ladders.some((l) => l.earned || l.value > 0);

  return (
    // No ScreenBackground of its own any more: the root paints the space ground, screens stay clear.
    <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SpaceHeader title={title} />

        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.blurb}>
            Everything here was earned — except the collected titles, which say so.
          </Text>

          {hall && hall.seasons.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>SEASON PLACEMENTS</Text>
              {hall.seasons.map((s) => (
                <Pressable
                  key={s.season_id}
                  style={[styles.season, s.hidden && styles.dimmed]}
                  onPress={() => pressSeason(s)}
                  disabled={!isOwner}
                  accessibilityRole={isOwner ? 'button' : undefined}>
                  <View style={styles.seasonTop}>
                    <Text style={styles.seasonKicker}>{seasonLabel(s.season_id)}</Text>
                    {s.hidden ? <UiGlyph name="lock" size={11} color={Colors.spaceDim} /> : null}
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

          {collection && userId ? <TitlesGroup userId={userId} collection={collection} isOwner={isOwner} /> : null}

          {showLadders ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>DISCIPLINE RELICS</Text>
              <View style={styles.ladders}>
                {ladders.map((r) => (
                  <RelicLadderRow key={r.relicKey} standing={r} onPress={() => setOpenRelic(r)} />
                ))}
              </View>
              {/* The one place on an earned-only surface where something UNEARNED is shown, so it
                  says why in words rather than leaving a greyed row to be read as a bug. */}
              {ladders.some((r) => !r.earned) ? (
                <Text style={styles.ladderNote}>
                  Greyed relics haven&apos;t been earned yet — the bar is how far along that discipline is.
                </Text>
              ) : null}
            </View>
          ) : null}

          {trophies.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>RELICS &amp; MEDALS</Text>
              <View style={styles.trophies}>
                {trophies.map((r) => (
                  <View key={r.key} style={styles.trophySlot}>
                    <TrophyTile itemKey={r.key} hidden={r.hidden} onPress={() => pressTrophy(r.key, r.hidden)} />
                  </View>
                ))}
                {/* Keeps a short final row left-aligned on the 4-up grid instead of stretching. */}
                {padding(trophies.length).map((i) => (
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
                  <Pressable
                    onPress={() => void toggleHidden('record', 'record', !record.hidden)}
                    hitSlop={8}
                    style={styles.hideLinkRow}
                    accessibilityRole="button">
                    {record.hidden ? <UiGlyph name="lock" size={11} color={Colors.navEmber2} /> : null}
                    <Text style={styles.hideLink}>{record.hidden ? 'Hidden — show' : 'Hide from visitors'}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.record}>
                <Rec value={String(record.won)} label="duels won" tone={Colors.green} />
                <Rec value={String(record.lost)} label="lost" tone={Colors.spaceDim} />
                <Rec value={rate === null ? '—' : `${rate}%`} label="win rate" tone={Colors.gold} />
              </View>
              {record.drawn > 0 ? (
                <Text style={styles.drawn}>
                  {record.drawn} drawn — draws don&rsquo;t count toward the win rate.
                </Text>
              ) : null}
            </View>
          ) : null}

          {hall && !hall.is_owner && hall.hidden_count > 0 ? (
            <View style={styles.hiddenNoteRow}>
              <UiGlyph name="lock" size={11} color={Colors.spaceFaint} />
              <Text style={styles.hiddenNote}>
                {hall.hidden_count} {hall.hidden_count === 1 ? 'item' : 'items'} hidden by owner
              </Text>
            </View>
          ) : null}

          {hall && hall.seasons.length === 0 && hall.relics.length === 0 && !record ? (
            <Text style={styles.blurb}>
              {isOwner
                ? 'Nothing earned yet. Finish a season, hold a streak, or win a duel and it lands here.'
                : 'Nothing to show here yet.'}
            </Text>
          ) : null}
        </ScrollView>

        <RelicDetailSheet standing={openRelic} onClose={() => setOpenRelic(null)} />
    </SafeAreaView>
  );
}

/**
 * Titles, split the way mock 325 splits them (CODE_PROMPT_ui_streamline.md §14).
 *
 * EARNED titles are achievements: the name and what it took ("Night Owl — log 15 lock-ins that
 * start after midnight"). On your own hall the behavioural ones you haven't earned yet sit greyed
 * beside them, the same "collection to complete" rule as the milestone grid.
 *
 * Every other title — box drops, the pass — is still owned and still equippable (that lane pays
 * for the app), so it stays here as a quieter second row with the equipped one marked. It is the
 * one non-earned thing in the hall, and the row's label says so.
 */
function TitlesGroup({ userId, collection, isOwner }: { userId: string; collection: PublicCollection; isOwner: boolean }) {
  const router = useRouter();
  const equipped = collection.loadout.title ?? null;
  const owned = collection.items.flatMap((c) => {
    const item = getItem(c.key);
    if (!item || item.type !== 'TITLE') return [];
    return [{ key: c.key, item, name: titleLabel({ ...item, seasonStamp: c.season_stamp }).name, hidden: c.hidden }];
  });
  const earned = owned.filter((t) => t.item.acquisition === 'earned');
  const ownedKeys = new Set(owned.map((t) => t.key));
  const locked = isOwner ? TITLES_BEHAVIOUR.filter((t) => !ownedKeys.has(t.id)) : [];
  const worn = owned.filter((t) => t.item.acquisition !== 'earned');
  if (earned.length === 0 && locked.length === 0 && worn.length === 0) return null;

  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>TITLES</Text>
      {earned.map((t) => (
        <View key={t.key} style={[styles.titleRow, t.hidden && styles.dimmed]}>
          <UiGlyph name="check" size={14} color={Colors.gold} />
          <View style={styles.titleText}>
            <Text style={[styles.titleName, { color: t.item.art.to }]} numberOfLines={1}>
              {t.name}
            </Text>
            <Text style={styles.titleHow} numberOfLines={2}>
              {t.item.howToGet ?? 'Earned.'}
            </Text>
          </View>
          {t.key === equipped ? <Text style={styles.titleWorn}>WORN</Text> : null}
        </View>
      ))}
      {locked.map((t) => (
        <View key={t.id} style={[styles.titleRow, styles.dimmed]}>
          <UiGlyph name="lock" size={13} color={Colors.spaceFaint} />
          <View style={styles.titleText}>
            <Text style={[styles.titleName, { color: Colors.spaceDim }]} numberOfLines={1}>
              {titleLabel(t).name}
            </Text>
            <Text style={styles.titleHow} numberOfLines={2}>
              {t.howToGet}
            </Text>
          </View>
        </View>
      ))}
      {worn.length > 0 ? (
        <>
          <Text style={styles.titleSubLabel}>Collected titles · equippable</Text>
          <View style={styles.titleChips}>
            {worn.map((t) => (
              <View key={t.key} style={[styles.titleChip, t.key === equipped && styles.titleChipOn, t.hidden && styles.dimmed]}>
                <Text style={[styles.titleChipText, { color: t.item.art.to }]} numberOfLines={1}>
                  {t.name}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {isOwner ? (
        <Pressable onPress={() => router.push('/loadout')} hitSlop={8} accessibilityRole="button" style={styles.titleEquip}>
          <Text style={styles.hideLink}>Change your title in the loadout ›</Text>
        </Pressable>
      ) : null}
      {/* The profile's old Collection entry, moved here: the closet is part of the flex, not the page. */}
      <Pressable onPress={() => router.push({ pathname: '/collection', params: { userId } })} hitSlop={8} accessibilityRole="button">
        <Text style={styles.hideLink}>Full collection ›</Text>
      </Pressable>
    </View>
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
      {/* Badge art (milestone-badges.ts picks the icon + tint per badge) — content, so it stays. */}
      <Ionicons name={badge.icon} size={26} color={badge.earned ? badge.tint : Colors.spaceFaint} />
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
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  blurb: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    lineHeight: 18,
  },
  group: {
    gap: Spacing.two,
  },
  // SpaceSection's label (inline here: each group owns its own gap).
  groupLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: Colors.spaceFaint,
  },
  dimmed: {
    opacity: 0.5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  titleName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
  },
  titleHow: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  titleWorn: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: Colors.navEmber2,
  },
  titleSubLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: Spacing.one,
  },
  titleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  titleChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  titleChipOn: {
    borderColor: Colors.navEmber2,
  },
  titleChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
  },
  titleEquip: {
    marginTop: Spacing.one,
  },
  // SpaceCard tone="gold" — a season placement is earned.
  season: {
    backgroundColor: 'rgba(255,209,102,0.07)',
    borderWidth: 1,
    borderColor: '#5A4A1E',
    borderRadius: 14,
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
    color: Colors.gold,
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
  ladders: {
    gap: 7,
  },
  ladderNote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    lineHeight: 15,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
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
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  badgeCount: {
    position: 'absolute',
    bottom: 4,
    right: 5,
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: Colors.gold,
  },
  extras: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    marginTop: 2,
  },
  recordHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hideLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hideLink: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
  record: {
    flexDirection: 'row',
    gap: 8,
  },
  rec: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: 10,
  },
  recValue: {
    fontFamily: Fonts.black,
    fontSize: 18,
  },
  recLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  drawn: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
  hiddenNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hiddenNote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
});
