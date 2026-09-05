import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ActiveChallengeStrip } from '@/components/campfire/active-challenge-strip';
import { CampfireFab, type CampfireFabAction } from '@/components/campfire/campfire-fab';
import { ChallengeAcceptRow } from '@/components/campfire/challenge-accept-row';
import { ChallengeChatCard } from '@/components/campfire/challenge-chat-card';
import { MentionAutocomplete } from '@/components/campfire/mention-autocomplete';
import { PingMemberSheet } from '@/components/campfire/ping-member-sheet';
import { ReactionTray, type TrayAnchor } from '@/components/campfire/reaction-tray';
import { ShareLockInSheet } from '@/components/campfire/share-lockin-sheet';
import { ChallengeCompletionCard } from '@/components/challenge-completion-card';
import { FeedItem } from '@/components/feed-item';
import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { FlameCompletionCard } from '@/components/flame-completion-card';
import { LiveLockInCard } from '@/components/live-lockin-card';
import { LockInEventCard } from '@/components/lock-in-event-card';
import { PhotoViewer } from '@/components/photo-viewer';
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
import { fetchCheckInById, type FeedCheckIn } from '@/lib/api/check-ins';
import { fetchFlameCompletionFeed, type FlameCompletionFeedItem } from '@/lib/api/daily-fire';
import { respondToChallengeInvite } from '@/lib/api/challenge-lifecycle';
import type { ActiveCircleLockIn } from '@/lib/api/lock-ins';
import { campfirePhotoUrl, deleteMyMessage, sendMessage, type ChatMessage } from '@/lib/api/messages';
import {
  fetchCampfireReactions,
  setMessageReaction,
  subscribeToReactions,
  type ReactionsByMessage,
} from '@/lib/api/message-reactions';
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

/** D3 · a ceiling on one multi-select post, so a stray "select all" cannot flood a campfire. */
const MAX_PHOTOS_PER_POST = 10;

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
  /** D3 · which chat photo is open full-screen, or null. */
  const [photoViewerUri, setPhotoViewerUri] = useState<string | null>(null);

  // ── D6 · reactions ───────────────────────────────────────────────────────────────────────────
  /** Every reaction in this campfire, grouped by message id. One row per person per message. */
  const [reactions, setReactions] = useState<ReactionsByMessage>(() => new Map());
  /** The long-pressed message and where its bubble is on screen, or null when the tray is shut. */
  const [tray, setTray] = useState<{ message: ChatMessage; anchor: TrayAnchor } | null>(null);
  // Measured on long-press so the tray can float above the pressed bubble. A Map of live view
  // handles rather than one ref: the rows are rendered by a FlatList, so there is no fixed set of
  // refs to declare, and the callback deletes its entry on unmount so recycled rows cannot leave a
  // stale handle behind that measures to the wrong place.
  const bubbleNodes = useRef(new Map<string, View>()).current;

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

  // D6 · reactions, live. Loaded once per campfire and refreshed whenever anyone anywhere
  // adds, swaps or removes one — the subscription listens for '*', not just INSERT, because a
  // removal that never reaches the other devices is the bug this is meant to avoid.
  const loadReactions = useCallback(() => {
    fetchCampfireReactions(groupId)
      .then(setReactions)
      .catch(() => {
        // Reactions are decoration on a chat that has to work without them. A failed fetch leaves
        // the bubbles bare rather than taking the conversation down.
      });
  }, [groupId]);

  useEffect(() => {
    loadReactions();
    return subscribeToReactions(groupId, loadReactions);
  }, [groupId, loadReactions]);

  /**
   * Set, swap or clear this viewer's one reaction. The server decides which of the three it is —
   * passing the emoji already held is what removes it, which is exactly what BOTH remove
   * affordances do (tapping your badge on the bubble, or tapping your highlighted emoji in the
   * tray). The client never has to know the difference.
   */
  async function react(messageId: string, emoji: string) {
    setTray(null);
    try {
      await setMessageReaction(messageId, emoji);
      // Realtime will also fire this, harmlessly — but it round-trips through the socket, and the
      // person who tapped should not watch their own reaction lag behind their thumb.
      loadReactions();
    } catch (e) {
      Alert.alert('Could not react', getErrorMessage(e, 'Try again.'));
    }
  }

  /** Long-press → measure the bubble in window coordinates → float the tray above it. */
  function openTray(message: ChatMessage) {
    const node = bubbleNodes.get(message.id);
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setTray({ message, anchor: { x, y, width, height } });
    });
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
  //
  // D3 · MULTI-SELECT, POSTED AS ONE MESSAGE PER PHOTO.
  //
  // The picker took one asset and posted one message, which is the whole of "let me send more than
  // one photo". `allowsMultipleSelection` fixes the picking half; the posting half is a deliberate
  // choice between two shapes the brief allows, and one of them is not actually available:
  // migration 0158's `messages_attachment_shape` constraint pins a photo message to exactly one
  // `attach_path`, so a single multi-photo message would need its own migration and a gallery
  // table. Agora's multi-attachment model (0140) is not that either — it is "at most one of each
  // KIND", one photo plus one video, not a photo gallery. So: one message per asset, in the order
  // they were picked, which the existing schema, the existing renderer and the existing realtime
  // subscription all already handle correctly.
  //
  // SEQUENTIAL, not Promise.all. Each send uploads a file and inserts a row; firing ten at once
  // races the uploads against each other for bandwidth and lands the messages in nondeterministic
  // order, so the chat would show the photos shuffled. Awaiting in turn keeps chat order equal to
  // selection order.
  //
  // A PARTIAL FAILURE STILL KEEPS WHAT LANDED. The loop stops at the first error and reports how
  // many made it, rather than discarding the successful uploads or claiming they all failed.
  async function postPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Philoi needs photo access to post an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      // A ceiling, not a limit anyone will hit deliberately — it stops a stray "select all" in a
      // 3,000-photo camera roll from posting 3,000 messages into a campfire.
      selectionLimit: MAX_PHOTOS_PER_POST,
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;

    const assets = result.assets.slice(0, MAX_PHOTOS_PER_POST);
    setSending(true);
    let posted = 0;
    try {
      for (const asset of assets) {
        await sendMessage(groupId, myUserId, '', { kind: 'photo', photoUri: asset.uri });
        posted += 1;
      }
    } catch (e) {
      Alert.alert(
        posted > 0 ? `Posted ${posted} of ${assets.length}` : 'Could not post that photo',
        getErrorMessage(e, 'Try again.')
      );
    } finally {
      timeline.chat.refetch();
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

    // ── a system line (0163) ──────────────────────────────────────────────────────────────────
    //
    // "{name} joined 🔥", centred and muted, not a chat bubble. It is a real `messages` row so that
    // it rides the same pipeline everything else here does — realtime, ordering, the member-read
    // policy — but it is an EVENT, not something anybody said, so giving it an avatar, a sender
    // name and a speech bubble would be a lie about who wrote it.
    //
    // The row carries no body: the sentence is written HERE, from system_event and the joiner's
    // profile, which is why an unrecognised event renders nothing at all rather than an empty
    // bubble. A build older than the next system event stays silent instead of wrong.
    if (row.data.attach_kind === 'system') {
      if (row.data.system_event !== 'member_joined') return null;
      return (
        <View style={styles.systemRow}>
          <Text style={styles.systemLine}>
            <Text style={styles.systemName}>{row.data.profiles.display_name}</Text> joined 🔥
          </Text>
        </View>
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
    // D4 · this message IS a card rather than something someone typed, so the speech bubble around
    // it stands down. Photos keep their bubble: a photo with a caption is still a message.
    const isCardAttachment = message.attach_kind === 'lockin';

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
            ref={(node) => {
              if (node) bubbleNodes.set(message.id, node as unknown as View);
              else bubbleNodes.delete(message.id);
            }}
            // D6 · long-press is the REACT gesture now (mock 178), which is what it means in every
            // other group chat these people use. The delete / report / block menu it used to open
            // is one tap further in, under the tray — see ReactionTray's `onMore`.
            onLongPress={() => openTray(message)}
            delayLongPress={160}
            style={[
              styles.bubble,
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
              mentionsMe && styles.bubbleMentioned,
              // D4 · a shared lock-in brings its OWN frame (the embed), so the bubble around it
              // stands down to nothing. Without this the card sits in a coral speech bubble, which
              // reads as "someone said a card" and fights the embed's own border and shadow.
              isCardAttachment && styles.bubbleCardHost,
            ]}>
            {/* §4 · YOUR OWN BUBBLE IS THE EMBER GRADIENT, NOT FLAT ORANGE.
                It was `backgroundColor: Colors.coral` — one flat orange, which is the same drift
                §3 fixes on the buttons. Mock 101 paints `.msg.me .bubble` as a coral→ember
                gradient, so it gets the app's real primary fill.
                Painted UNDERNEATH via absoluteFill rather than as the Pressable's background,
                because the bubble's corners are ASYMMETRIC (the squared tail corner points at the
                sender) and EmberFill takes one radius. The parent clips with `overflow: 'hidden'`,
                so the gradient takes the bubble's real shape including that 4px corner. */}
            {isOwn && !isCardAttachment && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <EmberFill style={styles.ownFill} radius={0} direction="diagonal" />
              </View>
            )}
            {/* §7a/§7b · the attachment, above the caption. A photo renders inline; a shared
                lock-in renders as the same card the feed draws for a fresh one, so a re-post and
                the original read identically. */}
            {/* D3 · the inline photo is a THUMBNAIL, not the only view of it. `contentFit: cover`
                crops to a 4:3 box, which is right for the chain and wrong as the only way to see
                the picture — a portrait photo lost its top and bottom and there was nowhere to go
                from there, because the tap went nowhere. Tapping opens the same PhotoViewer the
                lock-in card and the activity screen use, which fits the whole image to the screen
                and offers Save. */}
            {message.attach_kind === 'photo' && message.attach_path && (
              <Pressable
                onPress={() => setPhotoViewerUri(campfirePhotoUrl(message.attach_path!))}
                accessibilityRole="imagebutton"
                accessibilityLabel="View this photo full screen">
                <Image
                  source={{ uri: campfirePhotoUrl(message.attach_path) }}
                  style={styles.attachPhoto}
                  contentFit="cover"
                  transition={120}
                />
              </Pressable>
            )}
            {message.attach_kind === 'lockin' && message.attach_ref_id && (
              <SharedLockIn checkInId={message.attach_ref_id} onReactionChanged={timeline.feed.refetch} />
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

          {/* ── D6 · the badges ──────────────────────────────────────────────────────────────
              ONE BADGE PER PERSON, NEVER A COUNT. Three people reacting shows three small glyphs,
              not "🔥 3" — the server's primary key on (message_id, user_id) is what makes that
              true, so this render cannot drift into the Discord shape even by accident.

              Your own badge is amber-ringed and TAPPABLE TO REMOVE: the first of the two remove
              affordances (the second is re-tapping your highlighted emoji in the tray). Someone
              else's badge is not interactive — it is their reaction, not a button. */}
          {(reactions.get(message.id)?.length ?? 0) > 0 && (
            <View style={[styles.badgeRow, isOwn && styles.badgeRowOwn]}>
              {reactions.get(message.id)!.map((r) => {
                const isMine = r.user_id === myUserId;
                return isMine ? (
                  <Pressable
                    key={r.user_id}
                    onPress={() => react(message.id, r.emoji)}
                    style={[styles.badge, styles.badgeMine]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove your ${r.emoji} reaction`}>
                    <Text style={styles.badgeGlyph}>{r.emoji}</Text>
                  </Pressable>
                ) : (
                  <View key={r.user_id} style={styles.badge} accessibilityLabel={`Reacted ${r.emoji}`}>
                    <Text style={styles.badgeGlyph}>{r.emoji}</Text>
                  </View>
                );
              })}
            </View>
          )}
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

      {/* §1.2 · WHAT THIS FIRE IS RUNNING, pinned where it cannot be scrolled past.
          The card in the chat is the durable record — a message, so history carries it to everyone
          who ever joins — but a member who arrives into a week-old conversation would have to
          scroll back through that week to discover a race is on. This reads by CIRCLE rather than
          by roster (get_circle_active_challenges, 0163), which is the only reason a late joiner
          sees anything here at all: they are deliberately not on the roster yet, and the Join on
          this row is how they get on it. */}
      <ActiveChallengeStrip groupId={groupId} onJoined={loadChallenges} />

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

      {/* D3 · one viewer for the whole chain rather than one per photo row — a FlatList of a
          hundred messages would otherwise mount a hundred idle Modals. */}
      <PhotoViewer visible={photoViewerUri !== null} uri={photoViewerUri} onClose={() => setPhotoViewerUri(null)} />

      {/* D6 · one tray for the whole chain, for the same reason, and because it has to float over
          the list rather than inside it. */}
      <ReactionTray
        // Remount per pressed message, so the tray's own state (an open ＋ picker, a half-typed
        // search) cannot leak from one message to the next. This is what lets ReactionTray reset
        // without a setState-in-effect, which the lint rules reject.
        key={tray?.message.id ?? 'closed'}
        visible={tray !== null}
        anchor={tray?.anchor ?? null}
        current={
          tray ? (reactions.get(tray.message.id)?.find((r) => r.user_id === myUserId)?.emoji ?? null) : null
        }
        onPick={(emoji) => tray && react(tray.message.id, emoji)}
        onClose={() => setTray(null)}
        onMore={() => {
          const message = tray?.message;
          setTray(null);
          if (message) handleMoreMessage(message);
        }}
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

// ── D4 · A SHARED LOCK-IN IS THE REAL CARD, AND IT OPENS THE REAL LOCK-IN ─────────────────────
//
// Noah: you pick a lock-in to share, "then it's just a 'Shared a lock-in' thing that leads to
// nowhere." Both halves of that were true, and the send path was never the problem — shareLockIn
// has always posted a correct `{ kind: 'lockin', lockInId }` attachment. What arrived at the other
// end was a hard-coded ember label reading "Shared a lock-in" with no card, no data and no
// onPress, sitting under a comment that said it should be "the same LockInEventCard the feed
// already draws for a fresh lock-in". This is that comment, implemented.
//
// THE MESSAGE CARRIES AN ID, NOT A COPY. `attach_ref_id` is the check_in's id, so the card has to
// be fetched. That is deliberate and worth keeping: a snapshot copied into the message would
// freeze the session's photos, lifts and reactions at share time and drift from the real one
// forever after. The cost is one round trip per shared lock-in, which is why this is its own
// component — it mounts with the row and only fetches when it scrolls into the list.
//
// A DELETED LOCK-IN IS A NORMAL OUTCOME, not an error: you can share a session and remove it
// later. It degrades to a quiet line rather than throwing inside a FlatList renderer, which would
// take the whole chat down with it.
function SharedLockIn({ checkInId, onReactionChanged }: { checkInId: string; onReactionChanged: () => void }) {
  const router = useRouter();
  const [item, setItem] = useState<FeedCheckIn | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // `alive` guards a setState after unmount. The dependency is a single stable id, so the
    // cleanup here runs on unmount only — unlike the gym lock-in freeze, where the flag was
    // cancelling the effect's own re-runs on every dep change.
    let alive = true;
    fetchCheckInById(checkInId)
      .then((row) => {
        if (!alive) return;
        if (row) setItem(row);
        else setGone(true);
      })
      .catch(() => {
        if (alive) setGone(true);
      });
    return () => {
      alive = false;
    };
  }, [checkInId]);

  if (gone) {
    return (
      <Embed accent={Colors.muted}>
        <Text style={styles.attachLockInGone}>That lock-in isn&apos;t around any more.</Text>
      </Embed>
    );
  }

  if (!item) {
    // A placeholder the same shape as the frame it will become, so the row does not jump when the
    // card lands.
    return (
      <Embed accent={Colors.amber}>
        <Text style={styles.attachLockInGone}>Loading that lock-in…</Text>
      </Embed>
    );
  }

  // The same destination the profile grid and the history screen send a lock-in to: a Strava-synced
  // session has a route of its own with the map and the splits, everything else opens the ordinary
  // lock-in detail. Mirrored rather than reinvented so "tap a lock-in" means one thing app-wide.
  const openLockIn = () =>
    item.source === 'strava'
      ? router.push({ pathname: '/activity/[checkInId]', params: { checkInId: item.id } })
      : router.push({ pathname: '/lock-in/[checkInId]', params: { checkInId: item.id } });

  return (
    <Embed accent={Colors.amber}>
      <Pressable onPress={openLockIn} accessibilityRole="button" accessibilityLabel="Open this lock-in">
        <LockInEventCard item={item} onReactionChanged={onReactionChanged} />
      </Pressable>
    </Embed>
  );
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
  // 0163 · the system line. Centred, small and low-contrast on purpose: it is furniture, and a
  // join in a busy fire should be legible when you look for it and invisible when you don't.
  systemRow: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  systemLine: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  systemName: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.muted,
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
  // D4 · the bubble stands down so the embed frame is the only frame. Radii and shadow go too,
  // otherwise an own-message card carries a coral glow around a card that has its own.
  bubbleCardHost: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  // D6 · the badges hang off the bubble's edge, on the side the message came from, overlapping it
  // slightly so they read as ON the bubble rather than as a row underneath it (mock 178).
  badgeRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: -6,
    marginLeft: Spacing.two,
    alignSelf: 'flex-start',
  },
  badgeRowOwn: {
    alignSelf: 'flex-end',
    marginLeft: 0,
    marginRight: Spacing.two,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,20,40,0.98)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  // Yours is amber-ringed — the same treatment the tray gives your held emoji, so the two places
  // agree about which one is "mine".
  badgeMine: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.amber,
  },
  badgeGlyph: {
    fontSize: 12,
  },
  attachLockInGone: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    padding: Spacing.two,
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
