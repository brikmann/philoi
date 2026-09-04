import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CampfireFab, type CampfireFabAction } from '@/components/campfire/campfire-fab';
import { ChallengeAcceptRow } from '@/components/campfire/challenge-accept-row';
import { ChallengeChatCard } from '@/components/campfire/challenge-chat-card';
import { MentionAutocomplete } from '@/components/campfire/mention-autocomplete';
import { PingMemberSheet } from '@/components/campfire/ping-member-sheet';
import { ShareLockInSheet } from '@/components/campfire/share-lockin-sheet';
import { ChallengeCompletionCard } from '@/components/challenge-completion-card';
import { FeedItem } from '@/components/feed-item';
import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { FlameCompletionCard } from '@/components/flame-completion-card';
import { LiveLockInCard } from '@/components/live-lockin-card';
import { LockInEventCard } from '@/components/lock-in-event-card';
import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmberFill } from '@/components/ui/ember-fill';
import { EmptyState } from '@/components/ui/empty-state';
import { TextInput } from '@/components/ui/text-input';
import { CHAT_ENABLED } from '@/constants/feature-flags';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveCircleLockIns } from '@/hooks/use-active-circle-lockins';
import { useCircleTimeline, type TimelineRow } from '@/hooks/use-circle-timeline';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchFlameCompletionFeed, type FlameCompletionFeedItem } from '@/lib/api/daily-fire';
import { respondToChallengeInvite } from '@/lib/api/challenge-lifecycle';
import type { ActiveCircleLockIn } from '@/lib/api/lock-ins';
import { campfirePhotoUrl, deleteMyMessage, sendMessage, type ChatMessage } from '@/lib/api/messages';
import { fetchMySocialChallenges } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import { activeMentionQuery, applyMention, splitMentions } from '@/lib/mentions';
import { supabase } from '@/lib/supabase';
import type { CampfireMember, SocialChallenge } from '@/types/database';

// THE CAMPFIRE IS THE CHAT (mock 101 frame 1).
//
// This used to be one of three tabs behind a Leaderboard / Feed / Challenges bar. The
// campfire-as-chat pass deletes that bar: the chat is the whole screen, full-bleed over the
// animated banner, and everything else — the leaderboard, the options, the four + actions — opens
// ON TOP of it and dismisses back to here. See group/[groupId]/index.tsx for the chrome.
//
// WHAT THIS FILE ALREADY DID, AND WHY IT WAS THE RIGHT THING TO RE-COMPOSE RATHER THAN REPLACE:
// it has always merged chat messages, check-ins, challenge completions, live sessions and flame
// completions into ONE chronological chain (see useCircleTimeline). That merge is precisely the
// Discord model — a stream of messages with rich things dropped inline — so mock 101 is much less
// a rewrite than a restyle of a structure that was already correct.
//
// WHAT IS NEW HERE:
//   · Bubbles get AVATARS and a sender name (mock's `.msg .av` / `.who`).
//   · DAY DIVIDERS ("Today"), computed from the chain rather than fetched.
//   · Non-message rows render inside an EMBED FRAME — the mock's left-accent card — so a lock-in
//     and a Strava import read as attachments to the conversation instead of as loose cards.
//   · ACTIVE CHALLENGES are injected into the chain as embeds carrying Accept/Decline (§7). They
//     used to live only in the Challenges tab, which no longer exists.
//   · @MENTIONS: an autocomplete over the composer, and highlighted tokens in delivered messages.
//   · THE + FAB and its four actions.
//   · AUTOSCROLL to the newest message.

type StreakSystemRow = { kind: 'streak_system'; id: 'streak-system'; days: number };
type LiveSessionRow = { kind: 'live_session'; id: string; created_at: string; data: ActiveCircleLockIn };
type FlameCompletionRow = { kind: 'flame_completion'; id: string; created_at: string; data: FlameCompletionFeedItem };
/** §7 — a live challenge, in the chat, where the Challenges tab used to be. */
type ActiveChallengeRow = { kind: 'active_challenge'; id: string; created_at: string; data: SocialChallenge };
/** Not data: a separator the renderer inserts between calendar days. */
type DayRow = { kind: 'day'; id: string; created_at: string; label: string };
type Row = TimelineRow | StreakSystemRow | LiveSessionRow | FlameCompletionRow | ActiveChallengeRow | DayRow;

function formatRelativeTime(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "Today" / "Yesterday" / a date. Compared on the local calendar day, not on elapsed hours —
 *  a message sent at 00:30 is yesterday's, not "1h ago"'s. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

type CircleTimelineProps = {
  groupId: string;
  myUserId: string;
  /** For the mention autocomplete and the ping sheet. Fetched once by the screen above. */
  members: CampfireMember[];
  /** Room under the composer for the OS home indicator. */
  bottomInset: number;
};

export function CircleTimeline({ groupId, myUserId, members, bottomInset }: CircleTimelineProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const timeline = useCircleTimeline(groupId);
  const activeLockIns = useActiveCircleLockIns(groupId);
  const listRef = useRef<FlatList<Row>>(null);

  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [flameCompletions, setFlameCompletions] = useState<FlameCompletionFeedItem[]>([]);
  const [challenges, setChallenges] = useState<SocialChallenge[]>([]);
  const [busyChallengeId, setBusyChallengeId] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [pingOpen, setPingOpen] = useState(false);
  const [lockInPickerOpen, setLockInPickerOpen] = useState(false);

  const myHandle = (profile?.handle ?? '').toLowerCase();

  useEffect(() => {
    fetchFlameCompletionFeed(groupId)
      .then(setFlameCompletions)
      .catch(() => {
        // Opt-in flavor content — a failed fetch just leaves it out of the chain.
      });
  }, [groupId]);

  // §7 — challenges are feed embeds now, so this screen has to know about them. Campfire-scoped,
  // the same filter the Challenges tab used to apply.
  const loadChallenges = useCallback(() => {
    fetchMySocialChallenges()
      .then((all) => setChallenges(all.filter((c) => c.circle_id === groupId)))
      .catch(() => {
        // The chat still works without them; a failed fetch just means no challenge embeds.
      });
  }, [groupId]);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

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
    // Settled challenges already arrive as `challenge` completion rows in the timeline; these are
    // the ones still to be answered or still running, which had no home in the chat before.
    const challengeRows: ActiveChallengeRow[] = challenges
      .filter((c) => c.status === 'draft' || c.status === 'pending' || c.status === 'active')
      .map((c) => ({ kind: 'active_challenge', id: `chal-${c.id}`, created_at: c.created_at, data: c }));

    const merged: (TimelineRow | LiveSessionRow | FlameCompletionRow | ActiveChallengeRow)[] = [
      ...timeline.rows,
      ...liveRows,
      ...flameRows,
      ...challengeRows,
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Day dividers, inserted between calendar days. Done here rather than in the renderer so the
    // FlatList's own keys and separators stay simple.
    const withDays: Row[] = [];
    let lastKey = '';
    for (const row of merged) {
      const key = dayKey(row.created_at);
      if (key !== lastKey) {
        withDays.push({ kind: 'day', id: `day-${key}`, created_at: row.created_at, label: dayLabel(row.created_at) });
        lastKey = key;
      }
      withDays.push(row);
    }

    return streakDays > 0
      ? [...withDays, { kind: 'streak_system', id: 'streak-system', days: streakDays }]
      : withDays;
  }, [timeline.rows, activeLockIns, flameCompletions, challenges, streakDays]);

  // Newest at the bottom, so the chain has to be pinned there. `onContentSizeChange` rather than a
  // rows-length effect: the list has to have LAID OUT before scrollToEnd means anything, and a
  // freshly-measured tall embed changes the content height after the row count stopped changing.
  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(groupId, myUserId, body);
      // Mentions notify from a trigger on the insert (migration 0152), not from here — so a
      // message and the notification it causes cannot come apart.
    } catch {
      setDraft(body);
      Alert.alert('Could not send', 'Try again.');
    } finally {
      setSending(false);
    }
  }

  async function respondToChallenge(challengeId: string, accept: boolean) {
    setBusyChallengeId(challengeId);
    try {
      await respondToChallengeInvite(challengeId, accept);
      loadChallenges();
    } catch (e) {
      Alert.alert('That did not work', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusyChallengeId(null);
    }
  }

  function handleFabAction(action: CampfireFabAction) {
    setFabOpen(false);
    if (action === 'challenge') {
      // Scoped to THIS campfire, and opening on the whole-campfire placement race — the shape an
      // owner wants from a campfire (CODE_PROMPT_campfires §6). They can still switch.
      router.push({
        pathname: '/challenge/create',
        params: { circleId: groupId, mode: 'group', shape: 'placement' },
      });
      return;
    }
    if (action === 'ping') {
      setPingOpen(true);
      return;
    }
    if (action === 'photo') {
      void postPhoto();
      return;
    }
    if (action === 'lockin') {
      setLockInPickerOpen(true);
      return;
    }
  }

  // §7a — pick, upload, post. The upload lives inside sendMessage so a failed insert can delete
  // the file it just wrote rather than orphaning it in the bucket.
  async function postPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Philoi needs photo access to post an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    setSending(true);
    try {
      await sendMessage(groupId, myUserId, '', { kind: 'photo', photoUri: result.assets[0].uri });
      timeline.chat.refetch();
    } catch (e) {
      Alert.alert('Could not post that photo', getErrorMessage(e, 'Try again.'));
    } finally {
      setSending(false);
    }
  }

  // §7b — re-post one of your own lock-ins into the chat. The card it renders as is the same
  // LockInEventCard the feed already draws for a fresh lock-in; this just puts an older one back
  // in front of people.
  async function shareLockIn(lockInId: string) {
    setLockInPickerOpen(false);
    setSending(true);
    try {
      await sendMessage(groupId, myUserId, '', { kind: 'lockin', lockInId });
      timeline.chat.refetch();
    } catch (e) {
      Alert.alert('Could not share that lock-in', getErrorMessage(e, 'Try again.'));
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

  // The live "@…" under the caret, or null. Recomputed per keystroke; see lib/mentions.ts for why
  // the token is a handle rather than a display name.
  const mention = activeMentionQuery(draft, caret);

  function pickMention(handle: string) {
    if (!mention) return;
    const next = applyMention(draft, mention.start, caret, handle);
    setDraft(next.text);
    setCaret(next.caret);
  }

  function renderRow({ item: row }: { item: Row }) {
    if (row.kind === 'day') {
      return (
        <View style={styles.dayWrap}>
          <Text style={styles.dayLabel}>{row.label}</Text>
        </View>
      );
    }

    if (row.kind === 'streak_system') {
      return (
        <View style={styles.sysRow}>
          {/* Streak heat — the brand flame, not the ember coal (ember = currency). */}
          <FlameLogo size={12} />
          <Text style={styles.sysText}>{row.days}-day streak — don&apos;t let it die</Text>
        </View>
      );
    }

    // ── the inline embeds (mock 101's `.embed`) ────────────────────────────────────────────────
    // Everything that is not a message is an attachment to the conversation, so it gets the same
    // frame: a left accent stripe in the colour of what it is, over the chat's own ground. That
    // one frame is what makes a lock-in card and a challenge card read as the same KIND of thing
    // — a rich thing someone dropped in — rather than as two unrelated widgets.
    if (row.kind === 'live_session') {
      return (
        <Embed accent={Colors.amber}>
          <LiveLockInCard activeLockIn={row.data} />
        </Embed>
      );
    }
    if (row.kind === 'flame_completion') {
      return (
        <Embed accent={Colors.amber}>
          <FlameCompletionCard item={row.data} />
        </Embed>
      );
    }
    if (row.kind === 'active_challenge') {
      return (
        <Embed accent={Colors.ember}>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/challenge-info/[challengeId]', params: { challengeId: row.data.id } })
            }>
            <SocialChallengeCard challenge={row.data} myUserId={myUserId} onChanged={loadChallenges} isAdmin={false} />
          </Pressable>
          <ChallengeAcceptRow
            challenge={row.data}
            busy={busyChallengeId === row.data.id}
            onRespond={(accept) => respondToChallenge(row.data.id, accept)}
          />
        </Embed>
      );
    }
    if (row.kind === 'check_in') {
      return (
        <Embed accent={Colors.amber}>
          {row.data.duration_seconds != null ? (
            <LockInEventCard item={row.data} onReactionChanged={timeline.feed.refetch} />
          ) : (
            <FeedItem item={row.data} onReactionChanged={timeline.feed.refetch} />
          )}
        </Embed>
      );
    }
    if (row.kind === 'challenge') {
      return (
        <Embed accent={Colors.ember}>
          <ChallengeCompletionCard event={row.data} />
        </Embed>
      );
    }

    // ── a plain message ───────────────────────────────────────────────────────────────────────
    const message = row.data;
    const isOwn = message.user_id === myUserId;
    // `body` is nullable since 0158 — a photo with no caption is a message with no text.
    const body = message.body ?? '';
    const pieces = splitMentions(body);
    // "This one is aimed at me" — the mock's `.bubble.mentioned` ember stripe. Own messages never
    // light up: you already know you wrote it.
    const mentionsMe =
      !isOwn &&
      pieces.some((p) => p.mention && (p.text.toLowerCase() === '@all' || p.text.toLowerCase() === `@${myHandle}`));

    return (
      <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
        {!isOwn && (
          <View style={styles.avatar}>
            {message.profiles.avatar_url ? (
              <Image source={{ uri: message.profiles.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Text style={styles.avatarInitial}>{message.profiles.display_name.charAt(0).toUpperCase()}</Text>
            )}
          </View>
        )}
        <View style={styles.msgBody}>
          {!isOwn && <Text style={styles.sender}>{message.profiles.display_name}</Text>}
          <Pressable
            onLongPress={() => handleMoreMessage(message)}
            style={[
              styles.bubble,
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
              mentionsMe && styles.bubbleMentioned,
            ]}>
            {/* §4 · YOUR OWN BUBBLE IS THE EMBER GRADIENT, NOT FLAT ORANGE.
                It was `backgroundColor: Colors.coral` — one flat orange, which is the same drift
                §3 fixes on the buttons. Mock 101 paints `.msg.me .bubble` as a coral→ember
                gradient, so it gets the app's real primary fill.
                Painted UNDERNEATH via absoluteFill rather than as the Pressable's background,
                because the bubble's corners are ASYMMETRIC (the squared tail corner points at the
                sender) and EmberFill takes one radius. The parent clips with `overflow: 'hidden'`,
                so the gradient takes the bubble's real shape including that 4px corner. */}
            {isOwn && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <EmberFill style={styles.ownFill} radius={0} direction="diagonal" />
              </View>
            )}
            {/* §7a/§7b · the attachment, above the caption. A photo renders inline; a shared
                lock-in renders as the same card the feed draws for a fresh one, so a re-post and
                the original read identically. */}
            {message.attach_kind === 'photo' && message.attach_path && (
              <Image
                source={{ uri: campfirePhotoUrl(message.attach_path) }}
                style={styles.attachPhoto}
                contentFit="cover"
                transition={120}
              />
            )}
            {message.attach_kind === 'lockin' && message.attach_ref_id && (
              <View style={styles.attachLockIn}>
                <Text style={styles.attachLockInLabel}>Shared a lock-in</Text>
              </View>
            )}
            {/* 0162 · §Distribution — a campfire-hosted challenge posts as a card in the chat with
                an inline join CTA. The card OWNS the body text (it renders the host's line as its
                headline), which is why the `body.length > 0` block below excludes this kind: the
                alternative is the same sentence printed twice, once as a heading and once under
                it. Same reason the photo branch does not repeat its caption inside the image. */}
            {message.attach_kind === 'challenge' && message.attach_ref_id && (
              <ChallengeChatCard
                challengeId={message.attach_ref_id}
                headline={message.body}
                isOwn={isOwn}
              />
            )}

            {message.attach_kind !== 'challenge' && body.length > 0 && (
              <Text style={[styles.body, isOwn && styles.bodyOwn]}>
                {pieces.map((piece, i) =>
                  piece.mention ? (
                    <Text key={i} style={[styles.mention, isOwn && styles.mentionOwn]}>
                      {piece.text}
                    </Text>
                  ) : (
                    <Text key={i}>{piece.text}</Text>
                  )
                )}
              </Text>
            )}
            <Text style={[styles.time, isOwn && styles.timeOwn]}>{formatRelativeTime(message.created_at)}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const composerHeight = 64 + bottomInset;

  return (
    // A plain View, not a second KeyboardAvoidingView — this is already nested inside the parent
    // screen's Screen component, which provides ONE keyboard-avoiding wrapper for the whole page
    // (PHILOI_UI_SPEC.md §4b). Two nested KeyboardAvoidingViews fight each other's padding math,
    // which was the actual cause of "nothing moves" here.
    <View style={styles.container}>
      {/* §2 · THE AMBIENT GROUND (mock 174's `.body` + `.stars`).
          Behind the list and non-interactive, so it is depth rather than a layer the chat has to
          fight. Two deliberate choices:
            · POSITIONED DOTS, not the SVG polyline the first pass used and that vanished on
              device. A <View> with a background colour is the one thing guaranteed to paint.
            · A FIXED constellation, not Math.random(). A random field reshuffles on every render —
              stars would twinkle by accident on each keystroke in the composer, which is both
              noisy and the opposite of the "keep the starfield static" reduce-motion rule.
          Kept dim and cool so it reads as sky and never competes with a message. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {STARS.map((st, i) => (
          <View
            key={i}
            style={[
              styles.star,
              { left: `${st.x}%`, top: `${st.y}%` },
              st.lg && styles.starLarge,
            ]}
          />
        ))}
      </View>

      {timeline.error && <Text style={styles.error}>{timeline.error}</Text>}

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.id}
        style={styles.flatlist}
        contentContainerStyle={styles.list}
        onContentSizeChange={scrollToEnd}
        refreshControl={
          <RefreshControl
            refreshing={timeline.loading}
            onRefresh={() => {
              timeline.refetch();
              loadChallenges();
            }}
            tintColor={Colors.coral}
          />
        }
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
              title="Nothing here yet"
              body="Say something, or tap + to start a challenge."
            />
          ) : null
        }
      />

      {mention && CHAT_ENABLED && (
        <MentionAutocomplete
          query={mention.query}
          members={members}
          myUserId={myUserId}
          onPick={pickMention}
          bottom={composerHeight + 4}
        />
      )}

      <CampfireFab open={fabOpen} onToggle={() => setFabOpen((v) => !v)} onAction={handleFabAction} bottom={composerHeight} />

      {CHAT_ENABLED && (
        <View style={[styles.inputRow, { paddingBottom: Spacing.two + bottomInset }]}>
          <TextInput
            style={styles.input}
            placeholder="Message the campfire…"
            value={draft}
            onChangeText={setDraft}
            onSelectionChange={(e) => setCaret(e.nativeEvent.selection.start)}
            maxLength={2000}
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={sending || !draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message">
            {draft.trim() && !sending ? (
              <EmberFill style={styles.sendButton} radius={20} direction="diagonal">
                <Ionicons name="send" size={16} color={Colors.onEmber} style={styles.sendGlyph} />
              </EmberFill>
            ) : (
              <View style={[styles.sendButton, styles.sendButtonOff]}>
                <Ionicons name="send" size={16} color={Colors.textTertiary} style={styles.sendGlyph} />
              </View>
            )}
          </Pressable>
        </View>
      )}

      <ShareLockInSheet
        visible={lockInPickerOpen}
        onClose={() => setLockInPickerOpen(false)}
        myUserId={myUserId}
        onPick={shareLockIn}
      />

      <PingMemberSheet
        visible={pingOpen}
        onClose={() => setPingOpen(false)}
        groupId={groupId}
        members={members}
        myUserId={myUserId}
      />
    </View>
  );
}

// mock 174's `.stars` — nine dots, transcribed rather than generated. See the render for why this
// is a constant and not a random field.
const STARS: { x: number; y: number; lg?: boolean }[] = [
  { x: 12, y: 8 },
  { x: 70, y: 6, lg: true },
  { x: 40, y: 20 },
  { x: 86, y: 24 },
  { x: 22, y: 40 },
  { x: 60, y: 52, lg: true },
  { x: 82, y: 64 },
  { x: 16, y: 74 },
  { x: 48, y: 82 },
];

/** The mock's `.embed` frame: a left accent stripe over the chat's ground, so every rich thing in
 *  the chain reads as the same kind of attachment. */
function Embed({ accent, children }: { accent: string; children: React.ReactNode }) {
  return <View style={[styles.embed, { borderLeftColor: accent }]}>{children}</View>;
}

const styles = StyleSheet.create({
  // Transparent throughout — group/[groupId]/index.tsx paints the animated banner as an
  // absolutely-filled sibling BEHIND this, so an opaque fill here is a lid over it. That is what
  // made the banner stop at the header before: the feed was painting the ground the banner was
  // supposed to be.
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    backgroundColor: 'transparent',
  },
  list: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  star: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#5A4F74',
  },
  starLarge: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  dayWrap: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  // `.day` — a proper pill with its own edge, rather than text on a smear of black. The border is
  // what stops it dissolving into a dark patch of banner.
  dayLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: '#9A8FB8',
    backgroundColor: '#1A1226',
    borderWidth: 1,
    borderColor: '#2A1F3A',
    paddingVertical: 3,
    paddingHorizontal: 12,
    borderRadius: 11,
    overflow: 'hidden',
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
  // 🐛 §4 · WHY EMBEDS RENDERED AS A TALL THIN SLIVER.
  //
  // This was `alignSelf: 'flex-start'` with `maxWidth: '92%'` and no width. `alignSelf:
  // 'flex-start'` on a column child means SHRINK-TO-FIT, so the embed took its intrinsic width —
  // and its children are cards like LockInEventCard whose root is `flexDirection: 'row'` with
  // `flex: 1` sections inside. A flex child has an intrinsic width of zero, so the row collapsed,
  // the box came out a few characters wide, and every label wrapped one letter per line. That is
  // the "tall, thin, squished box" exactly: not a height bug, a MISSING DEFINITE WIDTH.
  //
  // `width` instead of `maxWidth` is the whole fix — it gives the flex children something to
  // divide up. alignSelf stays flex-start so embeds still hang on the left like the mock's, and
  // `flexShrink: 0` stops the FlatList's own cross-axis sizing undoing it again.
  // §3 · THE TROPHY CARD (mock 174 `.embed`). Same bones as before — the left accent rail was
  // already right — with the three things that make it read as a framed award rather than a
  // bordered div: a deeper radius, a real drop shadow so it sits ABOVE the ground rather than in
  // it, and a slightly more opaque body so the starfield does not show through the content.
  embed: {
    alignSelf: 'flex-start',
    width: '92%',
    flexShrink: 0,
    backgroundColor: 'rgba(22,15,30,0.93)',
    borderWidth: 1,
    borderColor: '#322648',
    borderLeftWidth: 3,
    borderRadius: 16,
    padding: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 5,
  },
  msgRow: {
    flexDirection: 'row',
    gap: 9,
    maxWidth: '86%',
  },
  msgRowOwn: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Sits at the bottom of a multi-line bubble, as in the mock.
    alignSelf: 'flex-end',
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
  },
  msgBody: {
    flexShrink: 1,
  },
  sender: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.muted,
    marginBottom: 2,
  },
  bubble: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  // Asymmetric "tail" corner (mock 101's `.bubble`) — the squared corner points toward whoever's
  // side the bubble came from.
  bubbleOther: {
    backgroundColor: 'rgba(36,28,56,0.86)',
    borderWidth: 1,
    borderColor: Colors.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: Radius.card,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
  },
  bubbleOwn: {
    // The solid coral stays as the UNDER-colour: EmberFill needs one layout pass to measure
    // before it can paint, and a transparent bubble for that frame would flash.
    backgroundColor: Colors.coral,
    overflow: 'hidden',
    // mock 174 `.mine`: 16 16 5 16, which moves the tail corner from the top-right to the
    // BOTTOM-right. Not a correction — mock 101 deliberately pointed it up, and bubbleOther below
    // still follows that. 174 tucks the tail toward the composer instead, which is what every
    // messaging app the user already has does. Others' bubbles keep 101's shape on purpose: the
    // asymmetry is how you tell the two sides apart at a glance.
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 5,
    // `box-shadow:0 6px 18px rgba(224,97,44,.32)` — the lit bubble casts its own ember light.
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 6,
  },
  ownFill: {
    flex: 1,
  },
  bubbleMentioned: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.ember,
    backgroundColor: 'rgba(58,42,26,0.6)',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  bodyOwn: {
    color: Colors.ink,
  },
  attachPhoto: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  attachLockIn: {
    marginBottom: 4,
  },
  attachLockInLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.ember,
  },
  mention: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ember,
  },
  // On the coral bubble the ember token disappears into the fill, so own-message mentions go
  // white instead — the mock does the same thing with `.msg.me .mention`.
  mentionOwn: {
    color: '#FFFFFF',
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  timeOwn: {
    color: 'rgba(255,255,255,0.75)',
  },
  // The composer sits on a gradient-ish translucent shelf so the banner continues behind it
  // rather than ending at an opaque bar.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: 14,
    paddingTop: Spacing.two,
    backgroundColor: Colors.scrim,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: 'rgba(36,28,56,0.9)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonOff: {
    backgroundColor: Colors.disabledSurface,
    borderWidth: 1,
    borderColor: Colors.disabledBorder,
  },
  sendGlyph: {
    // Ionicons' paper plane sits visually low-left inside its box; nudge it back to centre.
    marginLeft: 2,
  },
});
