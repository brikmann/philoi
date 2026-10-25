import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AgoraFeed } from '@/app/agora/index';
import { LockInCheersSheet } from '@/components/lockin-cheers/lockin-cheers-sheet';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useLockInCheers } from '@/hooks/use-lockin-cheers';
import { useActiveSession } from '@/lib/active-session-context';
import { fetchMyRanks } from '@/lib/api/goals';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRankTier } from '@/lib/rank-tiers';
import type { MyRank } from '@/types/database';

// HOME = THE COMMUNITY (nav restructure, mocks 301/302). The Agora feed is the landing now; the
// flame/lock-in hub that used to live here moved to /your-fire (one tap, via the fire strip) and
// starting a session moved to the center Lock In tab.
//
// The thin fire strip keeps your own flame visible without making it the hero: streak · rank, and
// "● N live" for friends locked in right now, which opens the same locked-in-with-you panel the
// old Home's strip did.

export default function HomeScreen() {
  const router = useRouter();

  // A friend's "lock in?" nudge still deep-links to /?lockin=1 (0207 writes that route server-side
  // and installed builds read it). Starting a session lives on the Lock In tab now, so forward there.
  const { lockin } = useLocalSearchParams<{ lockin?: string }>();
  useEffect(() => {
    if (lockin === '1') {
      router.setParams({ lockin: undefined });
      router.navigate('/lockin');
    }
  }, [lockin, router]);

  return (
    <AgoraFeed
      embedded
      top={
        <>
          <AppTopBar />
          <FireStrip />
        </>
      }
    />
  );
}

function FireStrip() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const { session: activeSession } = useActiveSession();
  const lockInCheers = useLockInCheers({ live: Boolean(activeSession) });
  const [cheersOpen, setCheersOpen] = useState(false);
  const [rank, setRank] = useState<MyRank | undefined>(undefined);

  useEffect(() => {
    fetchMyRanks()
      .then((ranks) => setRank(ranks.find((r) => r.scope === 'universal')))
      .catch(() => {
        // Rank is flavour on the strip — a failed read just hides it.
      });
  }, []);

  const streak = profile?.current_streak ?? 0;
  const live = lockInCheers.friends.filter((f) => f.live).length;

  return (
    <>
      <View style={styles.strip}>
        <Pressable
          style={styles.fire}
          onPress={() => router.push('/your-fire')}
          accessibilityRole="button"
          accessibilityLabel={`${streak}-day streak${rank ? `, ${formatRankTier(rank.tier, rank.division)}` : ''}. Open your fire`}>
          <NavGlyph name="flame" size={18} color={streak > 0 ? Colors.navEmber : Colors.spaceFaint} />
          <Text style={styles.streak}>
            {streak}-day streak
          </Text>
          {rank ? <Text style={styles.rank}>· {formatRankTier(rank.tier, rank.division)}</Text> : null}
        </Pressable>
        {/* Never a "0 live" pill (0ac26b4): the chip shows only when a friend is locked in, or when
            a cheer is waiting on a reply — the two reasons to open the panel. */}
        {live > 0 || lockInCheers.unreadTotal > 0 ? (
          <Pressable
            style={styles.live}
            onPress={() => setCheersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={live > 0 ? `${live} friends locked in now` : 'Cheers waiting for a reply'}>
            <View style={styles.dot} />
            <Text style={styles.liveText}>{live > 0 ? `${live} live` : 'reply'}</Text>
            {lockInCheers.unreadTotal > 0 ? <View style={styles.unread} /> : null}
          </Pressable>
        ) : null}
      </View>

      <LockInCheersSheet
        visible={cheersOpen}
        onClose={() => setCheersOpen(false)}
        friends={lockInCheers.friends}
        meId={session?.user.id ?? null}
        meLive={Boolean(activeSession)}
        inboundSeq={lockInCheers.inboundSeq}
        onCheered={lockInCheers.markCheered}
        onThreadRead={lockInCheers.markThreadRead}
        onChanged={lockInCheers.refetch}
      />
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: Spacing.twelve,
    borderRadius: Radius.card,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  fire: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  streak: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  rank: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.gold,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(57,217,138,0.12)',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#39D98A',
  },
  liveText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#39D98A',
  },
  unread: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.navEmber,
  },
});
