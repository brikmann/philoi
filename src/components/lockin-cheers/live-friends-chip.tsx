import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { LockInCheersSheet } from '@/components/lockin-cheers/lockin-cheers-sheet';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useLockInCheers } from '@/hooks/use-lockin-cheers';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';

// "● N live" — friends locked in right now, opening the locked-in-with-you panel (0270). It rode on
// Home's fire strip until Home became the feed (mock 317); it moved with your standing to the Lock In
// tab, which is where "who else is grinding" is the question being asked.
//
// Never a "0 live" pill (0ac26b4): the chip shows only when a friend is locked in, or when a cheer
// is waiting on a reply — the two reasons to open the panel.

export function LiveFriendsChip({ style }: { style?: StyleProp<ViewStyle> }) {
  const { session } = useAuth();
  const { session: activeSession } = useActiveSession();
  const lockInCheers = useLockInCheers({ live: Boolean(activeSession) });
  const [open, setOpen] = useState(false);

  const live = lockInCheers.friends.filter((f) => f.live).length;
  const show = live > 0 || lockInCheers.unreadTotal > 0;

  return (
    <>
      {show ? (
        <Pressable
          style={[styles.live, style]}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={live > 0 ? `${live} friends locked in now` : 'Cheers waiting for a reply'}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>
            {live > 0 ? `${live} ${live === 1 ? 'friend' : 'friends'} locked in now` : 'A cheer is waiting on a reply'}
          </Text>
          {lockInCheers.unreadTotal > 0 ? <View style={styles.unread} /> : null}
        </Pressable>
      ) : null}

      <LockInCheersSheet
        visible={open}
        onClose={() => setOpen(false)}
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
  live: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
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
    fontSize: 11.5,
    color: '#39D98A',
  },
  unread: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.navEmber,
  },
});
