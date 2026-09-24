import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PublicTitle } from '@/components/economy/loadout-bits';
import { CosmeticAvatar, useResolvedLoadout } from '@/components/economy/public-identity';
import { FriendPingSheet } from '@/components/friend-ping-sheet';
import { LockinGoalPicker } from '@/components/lockin-goal-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useFriends } from '@/hooks/use-friends';
import {
  usePublicLoadouts,
  useRefreshPublicLoadoutsOnFocus,
  type PublicLoadout,
} from '@/hooks/use-public-loadouts';
import { useMyActiveLockIns } from '@/hooks/use-my-active-lockins';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { friendStatusLine, nudgeToLockIn, type Friend } from '@/lib/api/friends';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import type { PingResult } from '@/types/database';

// Friend ping — "Your people" (design-mocks/21, PHILOI_UI_SPEC.md §4b/§16). Person-first entry:
// real (mutually-accepted) friends grouped by live state, each with a state-aware quick action
// (join their session vs. nudge them) and a tap-to-open sheet with the challenge deep-links.
export default function PeopleScreen() {
  const router = useRouter();
  const { friends, loading, error } = useFriends();
  const activeLockIns = useMyActiveLockIns();
  const { challenges: socialChallenges } = useSocialChallenges();
  const [search, setSearch] = useState('');
  const [sheetFriend, setSheetFriend] = useState<Friend | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [lockInWithCircle, setLockInWithCircle] = useState<{ id: string; name: string | null } | null>(null);
  // friend_ids currently showing the ✓ nudge confirmation (reverts to the 🔥 after ~1.4s).
  const [nudged, setNudged] = useState<Set<string>>(new Set());
  // What the last send on the open sheet did — 'sent' / 'sent_no_push' / 'rate_limited' (0207).
  // Cleared whenever a different friend's sheet opens, so it can never describe the wrong person.
  const [lastPing, setLastPing] = useState<PingResult | null>(null);
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

  // One call for the whole list — see the batching note in economy/public-identity.tsx.
  const friendIds = filtered.map((f) => f.friend_id);
  const loadouts = usePublicLoadouts(friendIds);
  // Re-read on focus: this list is where you look to see what your friends are wearing, and it
  // outlives every equip they make while you have the app open.
  useRefreshPublicLoadoutsOnFocus(friendIds);

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
      // 0207 · the RPC reports what it actually did. The ✓ above is still optimistic, because the
      // row has one glyph and no room to explain — but the SHEET has room, so it shows the truth
      // rather than a tick that means nothing.
      setLastPing(await nudgeToLockIn(f.friend_id));
    } catch (e) {
      setLastPing(null);
      Alert.alert('Could not nudge', getErrorMessage(e, 'Try again in a moment.'));
    }
  }

  // "Lock in with them" — start your own session scoped to the SAME circle theirs is running
  // in, so the live-presence strip actually pairs the two of you (punchlist 2, §5: this used to
  // open a fully unscoped picker, which never joined anything — presence is circle_id-matched,
  // not a real join/request flow). If their session has no circle_id (a solo lock-in, not
  // posted to any campfire), there's genuinely nothing to scope into — RLS never shares a solo
  // session with anyone, so this falls back to an ordinary unscoped lock-in for you. Takes the
  // friend explicitly (not read off sheetFriend state) since the row's own quick-join button
  // calls this directly, without the sheet ever opening.
  function handleLockInWith(f: Friend) {
    const theirSession = activeLockIns.find((a) => a.session.user_id === f.friend_id)?.session;
    const circleId = theirSession?.circle_id ?? null;
    setSheetFriend(null);
    setLockInWithCircle(circleId ? { id: circleId, name: f.shared_circle_name } : null);
    setPickerVisible(true);
  }

  // Opening a sheet forgets the previous friend's send result. Without this, nudging Maya and then
  // opening Sam's sheet would show Sam "Already nudged them in the last 10 minutes".
  function openSheet(f: Friend) {
    setLastPing(null);
    setSheetFriend(f);
  }

  // WS3 · the 1:1 thread. Takes the friend explicitly, like handleLockInWith, because both the row
  // bubble and the sheet row call it and only one of those has sheetFriend set.
  function handleMessage(f: Friend) {
    setSheetFriend(null);
    router.push({ pathname: '/dm/[friendId]', params: { friendId: f.friend_id } });
  }

  // The sheet's primary action mirrors the row quick button: join if they're locked in, else nudge.
  function handleSheetPrimary() {
    if (!sheetFriend) return;
    if (sheetLockedIn) {
      handleLockInWith(sheetFriend);
    } else {
      // Deliberately does NOT close. It used to dismiss on tap, which is what made "nudged ✓"
      // unfalsifiable — the sheet was gone before there was anything to report. The result line
      // needs the sheet to still be open.
      handleNudge(sheetFriend);
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
  // Punchlist 2, §5: "the H2H option still shows even when you already have an accepted
  // challenge with that person" — an existing active h2h with this friend replaces the
  // "Challenge — head to head" row with "View challenge" instead of offering a second one.
  const sheetActiveH2H = sheetFriend
    ? (socialChallenges.find(
        (c) => c.mode === 'h2h' && c.status === 'active' && (c.created_by === sheetFriend.friend_id || c.opponent_id === sheetFriend.friend_id)
      ) ?? null)
    : null;

  function handleViewChallenge() {
    if (!sheetActiveH2H) return;
    setSheetFriend(null);
    router.push({ pathname: '/watch/[challengeId]', params: { challengeId: sheetActiveH2H.id, mode: 'h2h' } });
  }

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
                loadout={loadouts[f.friend_id]}
                status={statusLine(f)}
                lockedIn
                nudged={false}
                onOpen={() => openSheet(f)}
                onQuick={() => handleLockInWith(f)}
                onMessage={() => handleMessage(f)}
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
                loadout={loadouts[f.friend_id]}
                status={statusLine(f)}
                lockedIn={false}
                nudged={nudged.has(f.friend_id)}
                onOpen={() => openSheet(f)}
                onQuick={() => handleNudge(f)}
                onMessage={() => handleMessage(f)}
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
        lastPing={lastPing}
        activeH2H={Boolean(sheetActiveH2H)}
        onChallengeH2H={() => sheetFriend && handleChallenge(sheetFriend, 'h2h')}
        onViewChallenge={handleViewChallenge}
        onChallengeGroup={() => sheetFriend && handleChallenge(sheetFriend, 'group')}
      />

      <LockinGoalPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        lockedCircleId={lockInWithCircle?.id}
        lockedCircleName={lockInWithCircle?.name ?? undefined}
      />
    </SafeAreaView>
  );
}

function FriendRow({
  loadout,
  friend,
  status,
  lockedIn,
  nudged,
  onOpen,
  onQuick,
  onMessage,
}: {
  friend: Friend;
  /** Batched by the list above — see economy/public-identity.tsx. */
  loadout?: PublicLoadout;
  status: string;
  lockedIn: boolean;
  nudged: boolean;
  onOpen: () => void;
  onQuick: () => void;
  /** WS3 · straight into the 1:1 thread, skipping the sheet. */
  onMessage: () => void;
}) {
  const resolved = useResolvedLoadout(friend.friend_id, loadout);

  return (
    <Pressable style={styles.row} onPress={onOpen}>
      <View style={styles.avatarWrap}>
        {/* Their gear, not a bare circle — this list is where you look at your friends most, so it
            was the loudest place a bought title rendered as nothing. Flares stay static: this is a
            list, and the live dot is the one thing here that should pull the eye. */}
        <CosmeticAvatar
          userId={friend.friend_id}
          name={friend.display_name}
          avatarUrl={friend.avatar_url}
          size={38}
          loadout={resolved}
          motion="reduced"
          lit={lockedIn}
        />
        {lockedIn && <View style={styles.liveDot} />}
      </View>
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>
          {friend.display_name}
        </Text>
        <PublicTitle loadout={resolved} compact />
        <Text style={[styles.status, lockedIn && styles.statusOn]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      {/* WS3 · the row's second quick action. The row itself still opens the profile and the flame
          still nudges — this is only the shortcut that was missing, since "say something to them"
          previously had no button anywhere in the app. */}
      <Pressable
        onPress={onMessage}
        hitSlop={8}
        accessibilityLabel={`Message ${friend.display_name}`}
        style={[styles.quick, styles.quickMessage]}>
        <Ionicons name="chatbubble-ellipses-outline" size={17} color={Colors.muted} />
      </Pressable>
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
    // Was Colors.cream, an opaque flat fill that painted over the deep-purple radial. These
    // screens don't route through <Screen>, so the radial reaches them from the navigator's
    // scene background — an opaque colour here blocks it (Ember reskin sweep).
    backgroundColor: 'transparent',
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
  // Quieter than the flame beside it: the nudge is the row's primary act and two equally loud
  // buttons would make the row ask a question instead of offering a shortcut.
  quickMessage: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.line,
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
