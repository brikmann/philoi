import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FriendPingSheet } from '@/components/friend-ping-sheet';
import { LockinGoalPicker } from '@/components/lockin-goal-picker';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useFriends } from '@/hooks/use-friends';
import { useMyActiveLockIns } from '@/hooks/use-my-active-lockins';
import { friendStatusLine, nudgeToLockIn, type Friend } from '@/lib/api/friends';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_TYPE_META } from '@/lib/goal-types';

// Friend ping — "Your people" (design-mocks/21, PHILOI_UI_SPEC.md §4b/§16). Person-first entry:
// real (mutually-accepted) friends grouped by live state, each with a state-aware quick action
// (join their session vs. nudge them) and a tap-to-open sheet with the challenge deep-links.
export default function PeopleScreen() {
  const router = useRouter();
  const { friends, loading, error } = useFriends();
  const activeLockIns = useMyActiveLockIns();
  const [search, setSearch] = useState('');
  const [sheetFriend, setSheetFriend] = useState<Friend | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  // friend_ids currently showing the ✓ nudge confirmation (reverts to the 🔥 after ~1.4s).
  const [nudged, setNudged] = useState<Set<string>>(new Set());
  const nudgeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Live "locked in now" by user id → the goal label for their status line (design-mocks/06's
  // presence source). A friend in this map is locked in right now.
  const goalByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of activeLockIns) {
      map.set(a.session.user_id, GOAL_TYPE_META[a.session.goal_type]?.label ?? 'a session');
    }
    return map;
  }, [activeLockIns]);

  const filtered = useMemo(
    () => friends.filter((f) => f.display_name.toLowerCase().includes(search.trim().toLowerCase())),
    [friends, search]
  );
  const lockedIn = filtered.filter((f) => goalByUser.has(f.friend_id));
  const rest = filtered.filter((f) => !goalByUser.has(f.friend_id));

  function statusLine(f: Friend): string {
    return friendStatusLine(f, goalByUser.get(f.friend_id) ?? null);
  }

  async function handleNudge(f: Friend) {
    // Optimistic ✓ confirmation (design-mocks/21's quickPing) — reverts after a moment.
    setNudged((prev) => new Set(prev).add(f.friend_id));
    clearTimeout(nudgeTimers.current[f.friend_id]);
    nudgeTimers.current[f.friend_id] = setTimeout(() => {
      setNudged((prev) => {
        const next = new Set(prev);
        next.delete(f.friend_id);
        return next;
      });
    }, 1400);
    try {
      await nudgeToLockIn(f.friend_id);
    } catch (e) {
      Alert.alert('Could not nudge', getErrorMessage(e, 'Try again in a moment.'));
    }
  }

  // "Lock in with them" — start your own session alongside theirs (ambient body-doubling); the
  // app's lock-in is solo with live presence, so this just opens the goal picker.
  function handleLockInWith() {
    setSheetFriend(null);
    setPickerVisible(true);
  }

  // The sheet's primary action mirrors the row quick button: join if they're locked in, else nudge.
  function handleSheetPrimary() {
    if (!sheetFriend) return;
    if (sheetLockedIn) {
      handleLockInWith();
    } else {
      handleNudge(sheetFriend);
      setSheetFriend(null);
    }
  }

  function handleChallenge(f: Friend, mode: 'h2h' | 'group') {
    setSheetFriend(null);
    // shared_circle_id is optional now (§16 — friend-to-friend, no shared campfire required):
    // real friends may not share one at all, so only pass it when it actually exists rather
    // than sending the literal string "null". The create screen still pre-fills the opponent
    // either way (see challenge/create.tsx's opponentPrefilled) — it just also needs a campfire
    // picked when there's no shared one, pending the fuller campfire-optional H2H flow.
    const params = new URLSearchParams({ mode });
    if (f.shared_circle_id) params.set('circleId', f.shared_circle_id);
    if (mode === 'h2h') {
      params.set('opponentId', f.friend_id);
      params.set('opponentName', f.display_name);
    }
    router.push(`/challenge/create?${params.toString()}` as Parameters<typeof router.push>[0]);
  }

  const sheetLockedIn = sheetFriend ? goalByUser.has(sheetFriend.friend_id) : false;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.title}>Your people</Text>
        <Pressable onPress={() => router.push('/add-friend')} hitSlop={8} accessibilityLabel="Add friends">
          <Ionicons name="person-add-outline" size={21} color={Colors.muted} />
        </Pressable>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={14} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search friends"
          placeholderTextColor={Colors.textTertiary}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {!loading && friends.length === 0 && (
          <EmptyState
            emoji="👥"
            title="No friends yet"
            body="Add people by @username or name — friend requests you send or receive show up here once accepted."
          />
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        {lockedIn.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Locked in now</Text>
            {lockedIn.map((f) => (
              <FriendRow
                key={f.friend_id}
                friend={f}
                status={statusLine(f)}
                lockedIn
                nudged={false}
                onOpen={() => setSheetFriend(f)}
                onQuick={handleLockInWith}
              />
            ))}
          </>
        )}

        {rest.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, lockedIn.length > 0 && styles.sectionLabelSpaced]}>All friends</Text>
            {rest.map((f) => (
              <FriendRow
                key={f.friend_id}
                friend={f}
                status={statusLine(f)}
                lockedIn={false}
                nudged={nudged.has(f.friend_id)}
                onOpen={() => setSheetFriend(f)}
                onQuick={() => handleNudge(f)}
              />
            ))}
          </>
        )}
      </ScrollView>

      <FriendPingSheet
        visible={sheetFriend !== null}
        onClose={() => setSheetFriend(null)}
        friend={sheetFriend}
        lockedIn={sheetLockedIn}
        goalLabel={sheetFriend ? (goalByUser.get(sheetFriend.friend_id) ?? null) : null}
        onPrimary={handleSheetPrimary}
        onChallengeH2H={() => sheetFriend && handleChallenge(sheetFriend, 'h2h')}
        onChallengeGroup={() => sheetFriend && handleChallenge(sheetFriend, 'group')}
      />

      <LockinGoalPicker visible={pickerVisible} onClose={() => setPickerVisible(false)} />
    </SafeAreaView>
  );
}

function FriendRow({
  friend,
  status,
  lockedIn,
  nudged,
  onOpen,
  onQuick,
}: {
  friend: Friend;
  status: string;
  lockedIn: boolean;
  nudged: boolean;
  onOpen: () => void;
  onQuick: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onOpen}>
      <View style={styles.avatarWrap}>
        <Avatar label={friend.display_name} size={38} lit={lockedIn} />
        {lockedIn && <View style={styles.liveDot} />}
      </View>
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>
          {friend.display_name}
        </Text>
        <Text style={[styles.status, lockedIn && styles.statusOn]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      <Pressable
        onPress={onQuick}
        hitSlop={8}
        accessibilityLabel={lockedIn ? 'Lock in with them' : 'Nudge to lock in'}
        style={[styles.quick, lockedIn ? styles.quickJoin : nudged && styles.quickDone]}>
        <Ionicons
          name={lockedIn ? 'lock-closed' : nudged ? 'checkmark' : 'flame'}
          size={17}
          color={lockedIn ? '#FFFFFF' : nudged ? Colors.achieverText : Colors.amber}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    marginBottom: Spacing.twelve,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 18,
    color: Colors.ink,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.twelve,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    gap: 4,
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginLeft: 2,
    marginBottom: 8,
  },
  sectionLabelSpaced: {
    marginTop: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: Radius.card,
  },
  avatarWrap: {
    position: 'relative',
  },
  liveDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: Radius.pill,
    backgroundColor: Colors.coral,
    borderWidth: 2,
    borderColor: Colors.cream,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  status: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  statusOn: {
    color: Colors.achieverText,
  },
  quick: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickJoin: {
    backgroundColor: Colors.coral,
  },
  quickDone: {
    backgroundColor: Colors.achieverBg,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
    marginBottom: Spacing.two,
  },
});
