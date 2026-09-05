import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { DisciplineRelicShelf } from '@/components/profile/discipline-relic-shelf';
import { isLadderHallRelic } from '@/components/profile/relic-ladder-row';
import { TrophyTile } from '@/components/profile/trophy-tile';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { winRate } from '@/lib/api/trophy-hall';
import { getItem } from '@/lib/economy/catalog';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { featuredTrophies, formatPlacement } from '@/lib/economy/milestone-badges';
import type { TrophyHall } from '@/types/database';

// §4 — the Trophy Hall as it appears COLLAPSED on a profile.
//
// EARNED-ONLY. Nothing on this surface is buyable or rollable: if a whale could get it from the
// shop or a box it does not belong here. That is the whole reason the hall renders on other
// people's profiles too — cosmetics prove nothing, placements and a W-L record cannot be bought.
//
// NO PEAK-RANK TILE. Rank is live and already leads the profile on the rank strip; a frozen copy
// here would disagree with it the moment someone ranked up.
//
// The featured strip is AUTO-curated (rarest + newest) rather than hand-picked — see
// featuredTrophies(). "See all" opens the full grouped hall.

export function TrophyHallSection({ hall, userId, isOwn }: { hall: TrophyHall; userId: string; isOwn: boolean }) {
  const router = useRouter();

  const featured = featuredTrophies(hall.relics);
  const season = hall.seasons[0];
  const record = hall.record;
  const rate = record ? winRate(record.won, record.lost) : null;

  // Only for the empty test below. The shelf draws the ladders itself, and draws the FULL set
  // rather than whichever ones the server returned — see DisciplineRelicShelf.
  const ladders = hall.relics.filter(isLadderHallRelic);

  // Nothing earned yet and it isn't yours: render nothing. An empty hall on a profile you are
  // visiting is a comment on that person, not a prompt you can act on.
  //
  // A ladder in progress counts as something to show even though it is not yet EARNED — it is the
  // one thing on this surface that can be true of someone who has never won anything, and it is the
  // whole reason the hall stopped rendering blank for users with real hours behind them.
  const isEmpty = !season && featured.length === 0 && !record && ladders.length === 0;
  if (isEmpty && !isOwn) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headingRow}>
          <Ionicons name="trophy" size={14} color={Colors.ember} />
          <Text style={styles.heading}>Trophy Hall</Text>
        </View>
        <Text
          style={styles.seeAll}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/trophy-hall', params: { userId } })}>
          See all ›
        </Text>
      </View>

      {isEmpty ? (
        <Text style={styles.empty}>
          Season placements, earned relics and your duel record land here. None of it can be bought.
        </Text>
      ) : null}

      {season ? (
        <View style={styles.season}>
          <Text style={styles.seasonKicker}>{seasonLabel(season.season_id)}</Text>
          <Text style={styles.seasonPlacement}>{formatPlacement(season.placement, season.board_size)}</Text>
          {season.title || season.medal_key ? (
            <View style={styles.seasonMeta}>
              <Ionicons name="medal" size={11} color={RARITY_COLOR.mythic} />
              <Text style={styles.seasonMetaText} numberOfLines={1}>
                {[season.title ? `“${season.title}”` : null, medalName(season.medal_key)].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {featured.length > 0 ? (
        <>
          <Text style={styles.autoLabel}>FEATURED · auto — rarest + newest</Text>
          <View style={styles.trophies}>
            {featured.map((t) => (
              <View key={t.key} style={styles.trophySlot}>
                <TrophyTile itemKey={t.key} tag={t.tag} />
              </View>
            ))}
            {/* One or two featured trophies must not stretch to half the screen each — the strip
                keeps its 4-up rhythm and simply ends early. */}
            {featured.length < 4
              ? Array.from({ length: 4 - featured.length }, (_, i) => (
                  <View key={`pad-${i}`} style={styles.trophySlot} />
                ))
              : null}
          </View>
        </>
      ) : null}

      <DisciplineRelicShelf relics={hall.relics} userId={userId} isOwn={isOwn} />

      {record ? (
        <View style={styles.record}>
          <Stat value={String(record.won)} label="duels won" tone={Colors.green} />
          <Stat value={String(record.lost)} label="lost" tone={Colors.muted} />
          <Stat value={rate === null ? '—' : `${rate}%`} label="win rate" tone={Colors.amber} />
        </View>
      ) : null}

      {/* Honest about the gap without naming what fills it. */}
      {!isOwn && hall.hidden_count > 0 ? (
        <Text style={styles.hiddenNote}>
          🔒 {hall.hidden_count} {hall.hidden_count === 1 ? 'trophy' : 'trophies'} hidden by owner
        </Text>
      ) : null}
    </View>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <View style={styles.rec}>
      <Text style={[styles.recValue, { color: tone }]}>{value}</Text>
      <Text style={styles.recLabel}>{label}</Text>
    </View>
  );
}

/** "s1" / "S1" / "2026-s1" all render as "SEASON 1" — plainly, never as "résumé" (§4). */
export function seasonLabel(seasonId: string): string {
  const n = seasonId.match(/(\d+)\s*$/)?.[1] ?? seasonId.match(/s(\d+)/i)?.[1];
  return n ? `SEASON ${Number(n)}` : seasonId.toUpperCase();
}

function medalName(key: string | null): string | null {
  if (!key) return null;
  return getItem(key)?.name ?? null;
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.four,
    gap: Spacing.twelve,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  seeAll: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ember,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    lineHeight: 18,
  },
  // The season card is the headline career flex, so it gets the one warm gradient-ish surface in
  // the section and everything else stays neutral around it.
  season: {
    backgroundColor: 'rgba(242,163,60,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.28)',
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
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
    marginTop: 1,
  },
  seasonMetaText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: RARITY_COLOR.mythic,
  },
  autoLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.4,
    color: Colors.textTertiary,
    marginBottom: -4,
  },
  trophies: {
    flexDirection: 'row',
    gap: 9,
  },
  trophySlot: {
    flex: 1,
    flexDirection: 'row',
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
  hiddenNote: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
  },
});
