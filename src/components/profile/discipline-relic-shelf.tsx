import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { RelicDetailSheet } from '@/components/profile/relic-detail-sheet';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, rarityGlow } from '@/lib/economy/rarity';
import { disciplineStandings, earnedDisciplineCount, rungGlyph, type DisciplineStanding } from '@/lib/economy/relic-ladders';
import type { HallRelic } from '@/types/database';

// THE DISCIPLINE RELICS SHELF (mock 107) — the §4a-2 set as a progress tracker on the profile.
//
// It is on the profile rather than only behind "See all" because the locked half is the point.
// Every other group in the Trophy Hall answers "what has this person won"; this one answers "how
// deep are they into a discipline, and how far from the next rung" — the chase-depth motivator,
// which is worth nothing if it is two taps away from the surface people actually open.
//
// THE WHOLE SET, ALWAYS. get_trophy_hall returns a ladder only once it has been granted or has
// value > 0, so a discipline nobody has touched is simply missing from the array. The shelf
// enumerates from RELIC_LADDERS and matches the hall's rows onto it (disciplineStandings), so an
// untouched Daedalus renders as a greyed tile at 0% rather than as a gap — a locked tile is the
// only thing that tells someone the discipline exists.
//
// LIT vs GREYED, and the badge under each tile:
//   · earned  — rarity glow + the relic art, with the rung glyph (α…Ω) underneath.
//   · locked  — desaturated art with a live progress % toward its FIRST threshold.
// Colour is rarity and the letter is rung, independently (§4a-2), so neither is derived from the
// other and a maxed Movement relic can read red + δ next to a maxed Gym relic's red + Ω.
//
// OWN AND OTHER PROFILES ALIKE. §4a-2's thresholds are public (only the §4a ancient relics are
// secret), so a visitor sees the same numbers the owner does and no copy here addresses "you".
//
// A relic the owner has HIDDEN is absent from a visitor's hall.relics, so it draws here as a locked
// tile at 0%. That is the faithful reading of the hide rather than a hole in it: hiding says "do not
// show visitors that I have this", and a tile claiming nothing is exactly what that asks for. The
// owner still sees their own real standing, because get_trophy_hall returns hidden rows to them.

export function DisciplineRelicShelf({
  relics,
  userId,
  isOwn,
}: {
  relics: HallRelic[];
  userId: string;
  isOwn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<DisciplineStanding | null>(null);

  const standings = useMemo(() => disciplineStandings(relics), [relics]);
  const { earned, total } = earnedDisciplineCount(standings);

  // Nothing earned, nothing started, and it isn't yours: render nothing. A shelf of eight grey
  // tiles on a stranger's profile is a comment on that person rather than a prompt anyone can act
  // on — the same rule the rest of the Hall follows. On your OWN profile it always shows, because
  // that is exactly where "here is what there is to chase" belongs.
  const untouched = standings.every((s) => !s.earned && s.value <= 0);
  if (untouched && !isOwn) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>
          Discipline Relics <Text style={styles.count}>· {earned} / {total}</Text>
        </Text>
        <Text
          style={styles.seeAll}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/trophy-hall', params: { userId } })}>
          See all ›
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
        {standings.map((s) => (
          <ShelfTile key={s.relicKey} standing={s} onPress={() => setOpen(s)} />
        ))}
      </ScrollView>

      <Text style={styles.footnote}>
        Earned by depth in one discipline — hours, gym volume, distance moved. Locked shows live progress.
      </Text>

      <RelicDetailSheet standing={open} onClose={() => setOpen(null)} />
    </View>
  );
}

function ShelfTile({ standing, onPress }: { standing: DisciplineStanding; onPress: () => void }) {
  const item = getItem(standing.relicKey);
  // A key this build's catalog has never heard of. Drawing a blank square would read as a broken
  // tile, and the set is enumerated from a list this file owns, so the honest response is to skip it.
  if (!item) return null;

  const colour = standing.earned ? RARITY_COLOR[standing.rarity] : Colors.textTertiary;
  const glyph = rungGlyph(standing.tier);
  const pct = Math.round(standing.pct * 100);

  return (
    <Pressable
      style={styles.tile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        standing.earned
          ? `${item.name}, ${standing.short}, earned, rung ${standing.tier} of ${standing.maxTier}`
          : `${item.name}, ${standing.short}, locked, ${pct}% of the way there`
      }>
      <View style={[styles.art, { borderColor: colour + (standing.earned ? '80' : '33') }]}>
        {standing.earned ? (
          <View style={[styles.glow, { backgroundColor: rarityGlow(standing.rarity, 0.22) }]} />
        ) : null}
        <View style={!standing.earned ? styles.dim : undefined}>
          <ItemArt item={item} size={28} />
        </View>

        {/* One badge, never two: the rung a relic HOLDS, or the distance to the one it doesn't.
            A tile showing both would be claiming and chasing the same rung at once. */}
        {standing.earned && glyph ? (
          <View style={[styles.badge, { borderColor: colour + '66' }]}>
            <Text style={[styles.badgeText, { color: colour }]}>{glyph}</Text>
          </View>
        ) : (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pct}%</Text>
          </View>
        )}
      </View>

      <Text style={[styles.label, standing.earned && styles.labelEarned]} numberOfLines={2}>
        {standing.short}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.twelve,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  count: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  seeAll: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ember,
  },
  shelf: {
    flexDirection: 'row',
    gap: 9,
    // Room under the tiles for the %/rung badge, which hangs off the bottom edge of the art.
    paddingBottom: 4,
  },
  tile: {
    width: 56,
    alignItems: 'center',
    gap: 8,
  },
  art: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardDark,
  },
  dim: {
    opacity: 0.26,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
  },
  badge: {
    position: 'absolute',
    bottom: -7,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: Colors.twilight900,
  },
  badgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: Colors.muted,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 8.5,
    lineHeight: 11,
    textAlign: 'center',
    color: Colors.textTertiary,
  },
  labelEarned: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ember,
  },
  footnote: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    lineHeight: 14,
    color: Colors.textTertiary,
    marginTop: -4,
  },
});
