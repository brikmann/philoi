import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { setRoomStandings, type RoomKind, type RoomWeek } from '@/lib/api/club';
import { formatPeopleHours } from '@/lib/api/home';
import { getErrorMessage } from '@/lib/errors';

/**
 * THE CLUB'S WEEK + ITS STANDINGS BADGE (Phase 8.2, mock 335).
 *
 *   "312 hrs · LOCKED IN TOGETHER THIS WEEK"     — members only; one number, nobody ranked in it
 *   "✓ Leaderboard off · this club's choice"     — anyone who can see the room
 *
 * `canManage` (campfire admin / forest owner) adds the switch beside the badge. Turning standings on
 * opens the opt-in view inside the club only — it never surfaces the global board.
 */
export function ClubWeekCard({
  kind,
  id,
  week,
  canManage = false,
  onChanged,
}: {
  kind: RoomKind;
  id: string;
  week: RoomWeek;
  canManage?: boolean;
  onChanged?: (standingsEnabled: boolean) => void;
}) {
  const [on, setOn] = useState(week.standingsEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server's value wins whenever a fresh read lands.
  const [seen, setSeen] = useState(week.standingsEnabled);
  if (week.standingsEnabled !== seen) {
    setSeen(week.standingsEnabled);
    setOn(week.standingsEnabled);
  }

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      await setRoomStandings(kind, id, next);
      onChanged?.(next);
    } catch (e) {
      setOn(!next);
      setError(getErrorMessage(e, 'Could not change that — try again.'));
    } finally {
      setBusy(false);
    }
  };

  const hours = week.thisWeekSeconds;
  const more = hours != null && week.lastWeekToDateSeconds != null ? hours - week.lastWeekToDateSeconds : 0;

  return (
    <View style={styles.wrap}>
      {week.isMember && hours != null ? (
        <View style={styles.card}>
          <Text style={styles.big}>{formatPeopleHours(hours)}</Text>
          <Text style={styles.kick}>LOCKED IN TOGETHER THIS WEEK</Text>
          {more >= 3600 ? (
            <Text style={styles.delta}>+{Math.floor(more / 3600).toLocaleString('en-US')} hrs on last week</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.badgeRow}>
        <View style={[styles.badge, on && styles.badgeOn]}>
          <Text style={[styles.badgeText, on && styles.badgeTextOn]}>
            {on ? 'Standings on · inside this club only' : '✓ Leaderboard off · this club’s choice'}
          </Text>
        </View>
        {canManage ? (
          <Switch
            value={on}
            onValueChange={(v) => void toggle(v)}
            disabled={busy}
            trackColor={{ false: Colors.spacePanel2, true: Colors.navEmber }}
            thumbColor={Colors.ink}
            accessibilityLabel="Club standings"
          />
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  card: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.65)',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  big: {
    fontFamily: Fonts.black,
    fontSize: 30,
    letterSpacing: -0.5,
    color: Colors.navEmber2,
  },
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.spaceDim,
    marginTop: 3,
  },
  delta: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.green,
    marginTop: 5,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  badge: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(57,217,138,0.45)',
    backgroundColor: 'rgba(57,217,138,0.10)',
  },
  badgeOn: {
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
  },
  badgeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.green,
  },
  badgeTextOn: {
    color: Colors.spaceDim,
  },
  error: {
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
  },
});
