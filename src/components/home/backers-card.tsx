import { StyleSheet, Text, View } from 'react-native';

import { FriendFaceStack } from '@/components/lockin-cheers/friend-faces';
import { Colors, Fonts } from '@/constants/theme';
import type { Backer } from '@/lib/api/home';

const BACKER_RING = '#24170F';

/**
 * Home §2 — WHO'S BACKING YOU (mock 318). The emotional core: people are rooting for you. Stacked
 * faces, "{N} friends cheered your grind this week", and a human line of the latest few.
 *
 * It counts PEOPLE, never cheers — a friend who cheered five times is one friend backing you. There
 * is no total-cheers number on purpose; this card is warmth, not a vanity metric.
 */
export function BackersCard({ backers }: { backers: Backer[] }) {
  if (backers.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Your people’s cheers land here</Text>
        <Text style={styles.detail}>When a friend cheers your lock-in or a post this week, you’ll see who’s in your corner.</Text>
      </View>
    );
  }

  const n = backers.length;
  const extra = n - 4;
  return (
    <View style={styles.card} accessible accessibilityLabel={`${n} ${n === 1 ? 'friend' : 'friends'} cheered your grind this week`}>
      <View style={styles.faces}>
        <FriendFaceStack people={backers} size={28} max={4} ringColor={BACKER_RING} />
        {extra > 0 ? (
          <View style={styles.more}>
            <Text style={styles.moreText}>+{extra}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title}>
        <Text style={styles.count}>
          {n === 1 ? backers[0].name.split(/\s+/)[0] : `${n} friends`}
        </Text>
        {' cheered your grind this week'}
      </Text>
      <Text style={styles.detail} numberOfLines={2}>
        {backers
          .slice(0, 3)
          .map((b) => b.line)
          .join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Ember-tinted: the warmest card on Home.
  card: {
    backgroundColor: BACKER_RING,
    borderWidth: 1,
    borderColor: '#4A3018',
    borderRadius: 14,
    padding: 12,
  },
  faces: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  more: {
    marginLeft: -8,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: BACKER_RING,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.muted,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  count: {
    color: Colors.navEmber2,
  },
  detail: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.spaceDim,
    marginTop: 3,
  },
});
