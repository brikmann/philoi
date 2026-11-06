import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts } from '@/constants/theme';
import { formatPeopleHours, peopleWeekDelta, type PeopleWeek } from '@/lib/api/home';

/**
 * YOUR PEOPLE, THIS WEEK (mocks 331 + 332, migration 0288) — the collective. One big number: the
 * lock-in time everyone you're connected to put in this week, together, with a delta only when it's
 * up on last week, and the faces of who's locked in today. Nobody is ranked in it and you aren't in
 * it — it's the room you're part of, not a board.
 *
 * Home draws it under Your week; the lock-in done screen draws it `centered` under your own result.
 */
export function PeopleWeekCard({ week, centered = false }: { week: PeopleWeek; centered?: boolean }) {
  const delta = peopleWeekDelta(week);
  const quiet = week.thisWeekSeconds < 60;
  return (
    <View style={[styles.card, centered && styles.cardCentered]}>
      <Text style={styles.kick}>Your people, this week</Text>
      <Text style={[styles.big, centered && styles.bigCentered]}>{formatPeopleHours(week.thisWeekSeconds)}</Text>
      <Text style={[styles.sub, centered && styles.textCentered]}>
        {quiet ? 'Nobody’s locked in yet this week — start it off.' : 'locked in together'}
        {delta ? (
          <Text style={styles.delta}>
            {' — '}
            {delta}
          </Text>
        ) : null}
      </Text>
      {week.activeToday > 0 ? (
        <View style={[styles.faces, centered && styles.facesCentered]}>
          {week.faces.map((f, i) => (
            <View key={f.userId} style={[styles.face, i > 0 && styles.faceOverlap]}>
              {f.avatarUrl ? (
                <Image source={{ uri: f.avatarUrl }} style={styles.faceImg} contentFit="cover" />
              ) : (
                <Avatar label={f.name} size={26} lit />
              )}
            </View>
          ))}
          <Text style={styles.active}>{week.activeToday} locked in today</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Mock 331's `.people`: the panel with an ember wash from the top-left.
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.65)',
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  cardCentered: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.spaceDim,
  },
  big: {
    fontFamily: Fonts.black,
    fontSize: 30,
    letterSpacing: -0.5,
    color: Colors.navEmber2,
    marginTop: 4,
  },
  bigCentered: {
    fontSize: 40,
    letterSpacing: -1,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    marginTop: 5,
  },
  textCentered: {
    textAlign: 'center',
  },
  delta: {
    fontFamily: Fonts.bodyBold,
    color: Colors.green,
  },
  faces: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 11,
  },
  facesCentered: {
    justifyContent: 'center',
  },
  face: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: Colors.spacePanel,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceOverlap: {
    marginLeft: -8,
  },
  faceImg: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  active: {
    marginLeft: 9,
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.green,
  },
});
