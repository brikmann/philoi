import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { SEASON, msUntilSeasonBoundary, seasonPhase } from '@/lib/economy/forge-pass';

// Home's top row (DESIGN_LANGUAGE_EMBER §5, mock 92): the season pill, centred, and nothing else
// of its own. The hamburger and the bell are Home's, drawn beside it in (tabs)/index.tsx.
//
// What this replaces: a title plus two loose icon buttons (Shop, Friends) that had grown by
// accretion — every new destination meant another glyph competing with the hero.

/** "S1 EMBERFALL · 90d 0h" — always visible, so the season is never something you have to go look for. */
export function SeasonPill() {
  const [now, setNow] = useState(() => Date.now());

  // Hour granularity is all the label shows, but ticking every minute keeps a screen left open
  // from sitting on a stale number for an hour.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const phase = seasonPhase(now);
  const left = msUntilSeasonBoundary(now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);

  // The countdown means something different in each phase, so the prefix has to say which —
  // "90d" against a season that hasn't opened yet would read as time remaining in it.
  const countdown =
    phase === 'closed'
      ? 'ended'
      : phase === 'upcoming'
        ? `opens in ${days}d`
        : phase === 'claim-window'
          ? `${days}d to claim`
          : `${days}d ${hours}h`;

  return (
    <View style={styles.pill}>
      <FlameLogo size={12} />
      <Text style={styles.pillText}>
        {SEASON.id} {SEASON.name.toUpperCase()}
      </Text>
      <Text style={styles.pillSep}>·</Text>
      <Text style={styles.pillCountdown}>{countdown}</Text>
    </View>
  );
}

// The menu that used to live here is gone. It was Home's own private modal — six rows, reachable
// from exactly one screen — and mock 157 replaces it with the app-wide drawer in
// components/nav/app-drawer.tsx. Home renders <DrawerButton /> from there now, so there is one
// menu with one row list instead of a per-screen copy that could drift.

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.card,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.1,
    color: Colors.ember,
  },
  pillSep: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },
  pillCountdown: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.muted,
    fontVariant: ['tabular-nums'],
  },
});
