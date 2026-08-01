import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ChallengeCompletionCard } from '@/components/challenge-completion-card';
import { FeedItem } from '@/components/feed-item';
import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { FlameCompletionCard } from '@/components/flame-completion-card';
import { LiveLockInCard } from '@/components/live-lockin-card';
import { LockInEventCard } from '@/components/lock-in-event-card';
import { LockinGoalPicker } from '@/components/lockin-goal-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { CHAT_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveCircleLockIns } from '@/hooks/use-active-circle-lockins';
import { useCircleTimeline, type TimelineRow } from '@/hooks/use-circle-timeline';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchFlameCompletionFeed, type FlameCompletionFeedItem } from '@/lib/api/daily-fire';
import type { ActiveCircleLockIn } from '@/lib/api/lock-ins';
import { deleteMyMessage, sendMessage, type ChatMessage } from '@/lib/api/messages';
import { supabase } from '@/lib/supabase';

// A trailing system line, not part of the merged/sorted timeline data itself — it's a
// standing nudge about *your* streak, not an event that happened at a point in time
// (design-mocks/06's `.sys`: "12-day streak — don't let it die").
type StreakSystemRow = { kind: 'streak_system'; id: 'streak-system'; days: number };
// A currently-running session — sorted into the chain by when it started, distinct from a
// `check_in` row (which only exists once a session ends). Live, not fetched: sourced from
// useActiveCircleLockIns' own poll (design-mocks/06's `.livecard`).
type LiveSessionRow = { kind: 'live_session'; id: string; created_at: string; data: ActiveCircleLockIn };
// The opt-in daily-flame-meter completion card (§5) — fetched once per mount (not polled;
// these are historical posts, not live state like LiveSessionRow above).
type FlameCompletionRow = { kind: 'flame_completion'; id: string; created_at: string; data: FlameCompletionFeedItem };
type Row = TimelineRow | StreakSystemRow | LiveSessionRow | FlameCompletionRow;

function formatRelativeTime(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type CircleTimelineProps = {
  groupId: string;
  myUserId: string;
  groupName?: string;
};

// The merged Campfire timeline (UI_REDESIGN_SPEC.md) — check-ins, challenge completions, and
// chat messages interleaved in one chronological scroll with the composer pinned at the
// bottom, replacing the old separate Feed and Chat tabs. See useCircleTimeline for the merge
// itself and why it's ascending-sorted.
export function CircleTimeline({ groupId, myUserId, groupName }: CircleTimelineProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const { session: activeSession } = useActiveSession();
  const timeline = useCircleTimeline(groupId);
  const activeLockIns = useActiveCircleLockIns(groupId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [lockInPickerVisible, setLockInPickerVisible] = useState(false);
  const [flameCompletions, setFlameCompletions] = useState<FlameCompletionFeedItem[]>([]);

  useEffect(() => {
    fetchFlameCompletionFeed(groupId)
      .then(setFlameCompletions)
      .catch(() => {
        // Opt-in flavor content — a failed fetch just leaves it out of the chain.
      });
  }, [groupId]);

  // One lock-in at a time app-wide (design-mocks/25) — this composer's own "Lock in" hero
  // bar is disabled rather than opening a second picker while one is already running; the
  // global mini-map is the one "return to it" affordance.
  function openLockInPicker() {
    if (activeSession) return;
    setLockInPickerVisible(true);
  }

  const streakDays = profile?.current_streak ?? 0;
  const rows = useMemo<Row[]>(() => {
    const liveRows: LiveSessionRow[] = activeLockIns.map((a) => ({
      kind: 'live_session',
      id: `live-${a.session.id}`,
      created_at: a.session.started_at,
      data: a,
    }));
    const flameRows: FlameCompletionRow[] = flameCompletions.map((f) => ({
      kind: 'flame_completion',
      id: `flame-${f.id}`,
      created_at: f.posted_at,
      data: f,
    }));
    const merged: (TimelineRow | LiveSessionRow | FlameCompletionRow)[] = [...timeline.rows, ...liveRows, ...flameRows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    return streakDays > 0 ? [...merged, { kind: 'streak_system', id: 'streak-system', days: streakDays }] : merged;
  }, [timeline.rows, activeLockIns, flameCompletions, streakDays]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(groupId, myUserId, body);
    } catch {
      setDraft(body);
      Alert.alert('Could not send', 'Try again.');
    } finally {
      setSending(false);
    }
  }

  function handleMoreMessage(message: ChatMessage) {
    const isOwn = message.user_id === myUserId;
    const options = isOwn
      ? [
          {
            text: 'Delete',
            style: 'destructive' as const,
            onPress: async () => {
              await deleteMyMessage(message.id);
              timeline.chat.refetch();
            },
          },
          { text: 'Cancel', style: 'cancel' as const },
        ]
      : [
          { text: 'Report', onPress: () => router.push(`/report?messageId=${message.id}&userId=${message.user_id}`) },
          {
            text: 'Block user',
            style: 'destructive' as const,
            onPress: async () => {
              await supabase.from('blocked_users').insert({ blocker_id: myUserId, blocked_id: message.user_id });
              timeline.refetch();
              Alert.alert('User blocked', "You won't see their posts or messages anymore.");
            },
          },
          { text: 'Cancel', style: 'cancel' as const },
        ];
    Alert.alert(isOwn ? 'Message options' : 'Report or block', '', options);
  }

  function renderRow({ item: row }: { item: Row }) {
    if (row.kind === 'streak_system') {
      return (
        <View style={styles.sysRow}>
          <Ionicons name="flame" size={12} color={Colors.amber} />
          <Text style={styles.sysText}>{row.days}-day streak — don't let it die</Text>
        </View>
      );
    }
    if (row.kind === 'live_session') return <LiveLockInCard activeLockIn={row.data} />;
    if (row.kind === 'flame_completion') return <FlameCompletionCard item={row.data} />;
    if (row.kind === 'check_in') {
      return row.data.duration_seconds != null ? (
        <LockInEventCard item={row.data} onReactionChanged={timeline.feed.refetch} />
      ) : (
        <FeedItem item={row.data} onReactionChanged={timeline.feed.refetch} />
      );
    }
    if (row.kind === 'challenge') return <ChallengeCompletionCard event={row.data} />;

    const message = row.data;
    const isOwn = message.user_id === myUserId;
    return (
      <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
        <Pressable
          onLongPress={() => handleMoreMessage(message)}
          style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          {!isOwn && <Text style={styles.sender}>{message.profiles.display_name}</Text>}
          <Text style={[styles.body, isOwn && styles.bodyOwn]}>{message.body}</Text>
          <Text style={[styles.time, isOwn && styles.timeOwn]}>{formatRelativeTime(message.created_at)}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    // A plain View, not a second KeyboardAvoidingView — this is already nested inside the
    // parent screen's Screen component, which provides ONE keyboard-avoiding wrapper for the
    // whole page (PHILOI_UI_SPEC.md §4b). Two nested KeyboardAvoidingViews fight each other's
    // padding math, which was the actual cause of "nothing moves" here.
    <View style={styles.container}>
      {timeline.error && <Text style={styles.error}>{timeline.error}</Text>}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        style={styles.flatlist}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={timeline.loading} onRefresh={timeline.refetch} tintColor={Colors.coral} />}
        renderItem={renderRow}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        ListEmptyComponent={
          !timeline.loading ? (
            <EmptyState
              icon={
                <View style={{ opacity: 0.4 }}>
                  <FlameSvg width={44 * FLAME_ASPECT_RATIO} height={44} />
                </View>
              }
              title="No lock-ins yet"
              body="Tap Lock in to start the fire."
              action={activeSession ? undefined : <PrimaryButton label="Go lock in" onPress={openLockInPicker} />}
            />
          ) : null
        }
      />

      {/* Suppressed once the chain is empty — the empty state's own centered "Go lock in"
          button already covers this exact action there (punchlist 2, §3: the docked bar
          reading "weird" was this literal duplicate CTA stacked right above the chat composer
          on top of the one the empty state already shows). */}
      {(rows.length > 0 || timeline.loading) && (
        <Pressable
          style={[styles.lockInBar, Boolean(activeSession) && styles.lockInBarDisabled]}
          onPress={openLockInPicker}
          disabled={Boolean(activeSession)}>
          <Ionicons name="lock-closed" size={15} color={activeSession ? Colors.muted : Colors.ink} />
          <Text style={[styles.lockInBarLabel, Boolean(activeSession) && styles.lockInBarLabelDisabled]}>
            {activeSession ? 'Already locked in' : 'Lock in'}
          </Text>
        </Pressable>
      )}

      {CHAT_ENABLED && (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message the campfire"
            value={draft}
            onChangeText={setDraft}
            maxLength={2000}
            multiline
          />
          <Pressable onPress={handleSend} disabled={sending || !draft.trim()} style={styles.sendButton}>
            <Text style={styles.sendLabel}>Send</Text>
          </Pressable>
        </View>
      )}

      <LockinGoalPicker
        visible={lockInPickerVisible}
        onClose={() => setLockInPickerVisible(false)}
        lockedCircleId={groupId}
        lockedCircleName={groupName}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Explicit backgroundColor at every layer (not just relying on the parent Screen's) — the
  // interior was repeatedly reported as reading a shade darker than the rest of the app despite
  // no override anywhere in this tree; setting it here too closes off any transparency/
  // compositing gap in this View's own layer.
  container: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  flatlist: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  list: {
    padding: Spacing.four,
  },
  sysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  sysText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowOwn: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  // Asymmetric "tail" corner (design-mocks/06's `.bub`/`.me .bub`) — the squared corner
  // points toward whoever's avatar/side the bubble came from.
  bubbleOther: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: Radius.card,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
  },
  bubbleOwn: {
    backgroundColor: Colors.coral,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
  },
  sender: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.muted,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  bodyOwn: {
    color: Colors.ink,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  timeOwn: {
    color: 'rgba(255,255,255,0.75)',
  },
  lockInBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.card,
    backgroundColor: Colors.coral,
  },
  lockInBarDisabled: {
    backgroundColor: Colors.disabled,
  },
  lockInBarLabelDisabled: {
    color: Colors.muted,
  },
  lockInBarLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
    fontSize: 15,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  input: {
    flex: 1,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  sendLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
    fontSize: 14,
  },
});
