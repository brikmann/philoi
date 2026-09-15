import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RelicDetailSheet } from '@/components/profile/relic-detail-sheet';
import { RelicLadderRow } from '@/components/profile/relic-ladder-row';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import {
  disciplineStandings,
  earnedDisciplineCount,
  formatLadderValue,
  rungGlyph,
  type DisciplineStanding,
} from '@/lib/economy/relic-ladders';
import type { HallRelic } from '@/types/database';

// THE DISCIPLINE RELIC TRACKER (#204) — relics as a progression system that sits beside rank.
//
// DIRECTLY UNDER THE RANK STRIP, ON PURPOSE (Noah, 2026-09-14: "peer to ranks"). It replaces the
// 56px tile shelf that lived inside the Trophy Hall, below Collection and the Journal. That shelf
// showed a percentage under a thumbnail; a rank strip shows a tier, a bar and the number to the
// next one. A ladder is the same kind of thing — a rung, a bar, "43 / 50 km" — so it gets the same
// kind of surface, in the same place, instead of reading as one more trophy.
//
// ROWS ARE RelicLadderRow, the Trophy Hall's own. The tracker and "See all" draw the same component
// from the same disciplineStandings(), so the two can never disagree about a bar.
//
// THE CALL-OUT names the ladder closest to its next rung. That is the one line a rank strip has and
// a grid of bars does not: which climb is about to pay. Third person or no person — this renders on
// other people's profiles too.
//
// THE WHOLE SET, ALWAYS, on your own profile: an untouched ladder is a row at 0, because a locked
// row is the only thing that tells someone the discipline exists. On a stranger's profile with
// nothing started it renders nothing — a stack of empty bars is a comment on that person, not a
// prompt anyone can act on (the rule the Trophy Hall follows).
//
// A relic the owner has HIDDEN is absent from a visitor's hall.relics and draws as untouched here,
// which is what hiding asks for. The owner still sees their real standing.

export function DisciplineRelicTracker({
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
  const ladders = standings.filter((s) => s.ladder !== null);
  const capstone = standings.find((s) => s.ladder === null) ?? null;
  const { earned, total } = earnedDisciplineCount(standings);

  const untouched = ladders.every((s) => !s.earned && s.value <= 0);
  if (untouched && !isOwn) return null;

  const next = nextRung(ladders);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.heading}>
          DISCIPLINE RELICS <Text style={styles.count}>· {earned} / {total}</Text>
        </Text>
        <Text
          style={styles.seeAll}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/trophy-hall', params: { userId } })}>
          See all ›
        </Text>
      </View>

      {next ? (
        <Text style={styles.callout} numberOfLines={2}>
          <Text style={styles.calloutLead}>Next rung · </Text>
          {next}
        </Text>
      ) : null}

      <View style={styles.rows}>
        {ladders.map((s) => (
          <RelicLadderRow key={s.relicKey} standing={s} onPress={() => setOpen(s)} />
        ))}
      </View>

      {capstone ? (
        <Text
          style={[styles.capstone, capstone.earned && styles.capstoneEarned]}
          accessibilityRole="button"
          onPress={() => setOpen(capstone)}>
          {getItem(capstone.relicKey)?.name ?? 'Crown of Olympus'} ·{' '}
          {capstone.earned ? 'earned' : `${capstone.value} / ${capstone.nextThreshold ?? total} ladders maxed`}
        </Text>
      ) : null}

      <RelicDetailSheet standing={open} onClose={() => setOpen(null)} />
    </View>
  );
}

/**
 * "Socrates' Scroll β — 4.2 h to go" for the unmaxed ladder furthest through its current rung.
 *
 * Furthest by FRACTION of the rung, not by absolute distance: 4 h short of a 25 h rung and 4,000 lb
 * short of a 25,000 lb rung are not comparable in their units, but "84% of the way" is. A ladder with
 * nothing on it is never the call-out — naming a 0% climb as "next" says nothing true.
 */
function nextRung(ladders: DisciplineStanding[]): string | null {
  const candidates = ladders.filter((s) => s.nextThreshold !== null && s.value > 0);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.pct > a.pct ? b : a));
  const item = getItem(best.relicKey);
  const glyph = rungGlyph(best.tier + 1);
  const left = Math.max(0, (best.nextThreshold as number) - best.value);
  return `${item?.name ?? best.short}${glyph ? ` ${glyph}` : ''} — ${formatLadderValue(left, best.unit)} ${best.unit} to go`;
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.muted,
  },
  count: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.textTertiary,
  },
  seeAll: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ember,
  },
  callout: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  calloutLead: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ember,
  },
  rows: {
    gap: 6,
  },
  capstone: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  capstoneEarned: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ember,
  },
});
