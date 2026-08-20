import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ShareCardFrame } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import { effortChips } from '@/lib/api/milestones';
import type { MilestoneEffort, RankTierName } from '@/types/database';

// §8 / mock Frame 5b — the milestone share card. The "advertise it" surface.
//
// THE PHILOI TWIST IS THE LAYOUT. The win leads, but the effort receipts sit directly under it with
// "the work behind it" pointing up at them. Every other app that lets you post a grade posts the
// grade; this one posts the grade ATTACHED to the hours and the streak that produced it, which is
// the only claim here nobody else can make.
//
// Zero economy — this card celebrates something that paid out nothing.

// The lilac the mock points at the receipts with — deliberately NOT an ember tone. Ember is the
// effort economy's colour throughout the app, and the one thing this card must not imply is that
// the milestone paid out.
const RECEIPT_LILAC = '#C79BEC';

type Props = {
  /** The win, as the user typed it: "85% on the Orgo II midterm". */
  headline: string;
  note: string | null;
  effort: MilestoneEffort;
  handle: string | null;
  tier?: RankTierName;
  division?: number;
};

export const MilestoneShareCard = forwardRef<View, Props>(function MilestoneShareCard(
  { headline, note, effort, handle, tier, division },
  ref
) {
  const chips = effortChips(effort);
  // The headline carries a leading number often enough ("85% on…", "3 offers…") that pulling it
  // out gives the card the same big-numeral hero the rest of the family has. When there isn't one,
  // the headline simply becomes the hero at a smaller size rather than inventing a stat.
  const lead = headline.match(/^(\S*\d\S*)\s+(?:on|in|at)?\s*(.*)$/);
  const big = lead?.[1] ?? null;
  const rest = (lead?.[2] ?? headline).replace(/^the\s+/i, '');

  return (
    <ShareCardFrame kick="MILESTONE" ref={ref} handle={handle} tier={tier} division={division}>
      {big ? (
        <>
          <Text style={styles.big} numberOfLines={1}>
            {big}
          </Text>
          <Text style={styles.name} numberOfLines={2}>
            {rest}
          </Text>
        </>
      ) : (
        <Text style={styles.headlineOnly} numberOfLines={3}>
          {headline}
        </Text>
      )}

      {note ? (
        <Text style={styles.note} numberOfLines={2}>
          {note}
        </Text>
      ) : null}

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
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  big: {
    fontFamily: Fonts.display,
    fontSize: 72,
    lineHeight: 76,
    letterSpacing: -2,
    color: Colors.ink,
    textAlign: 'center',
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 8,
  },
  headlineOnly: {
    fontFamily: Fonts.bodyBold,
    fontSize: 28,
    lineHeight: 34,
    color: Colors.ink,
    textAlign: 'center',
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    marginTop: 22,
  },
  pill: {
    backgroundColor: 'rgba(36,26,46,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
  },
  receiptCaption: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: RECEIPT_LILAC,
    textAlign: 'center',
    marginTop: 12,
  },
});
