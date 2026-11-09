import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { JoinOutcome } from '@/lib/api/discover';
import { sendFriendRequest } from '@/lib/api/friend-requests';
import { getErrorMessage } from '@/lib/errors';

// The Discover kit (ShareSpot ss2): the pieces every Search surface is built from, so the board
// (345), the active search (349) and the browse pages (354–357) read as one system.
//   • SectionHead — "Trending rooms ›": the header IS the link to the full browse page.
//   • PersonTile / PersonRow — circular avatar, name, why, inline + Add.
//   • CoverCard — gradient banner + crest + about-tagline + live pill (mocks 355/356), not a flat row.
//   • TopicTile — #topic with its post count.
//   • JoinButton / AddButton — the inline action with busy / done states.

// Banner gradients from the mocks (green run club, ember study, cyan gaming, pink art, legend).
const BANNERS: readonly [string, string][] = [
  ['#1FA463', '#0F7A52'],
  ['#FF7A2F', '#C9461C'],
  ['#45C9D6', '#2A8F9C'],
  ['#F08DB5', '#C2477E'],
  ['#9D6BFF', '#6A3FC9'],
  ['#FFB05A', '#D9792A'],
];

/** A stable banner for an id, so a room keeps its colour across screens. */
export function bannerFor(id: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BANNERS[h % BANNERS.length];
}

export function SectionHead({ title, onSeeAll, right }: { title: string; onSeeAll?: () => void; right?: ReactNode }) {
  const body = (
    <View style={styles.headRow}>
      <Text style={styles.head} accessibilityRole="header">
        {title}
      </Text>
      {right ?? (onSeeAll ? <Icon name="forward" size={16} color={Colors.spaceDim} /> : null)}
    </View>
  );
  if (!onSeeAll) return body;
  return (
    <Pressable onPress={onSeeAll} accessibilityRole="link" accessibilityLabel={`${title}, see all`} hitSlop={6}>
      {body}
    </Pressable>
  );
}

// ── people ──────────────────────────────────────────────────────────────────────────────────────

export type AddState = 'busy' | 'sent';

/** One add-friend state map per screen. Errors surface through `error`. */
export function useAddFriend() {
  const [state, setState] = useState<Record<string, AddState>>({});
  const [error, setError] = useState<string | null>(null);
  const add = useCallback(async (userId: string) => {
    setError(null);
    setState((s) => ({ ...s, [userId]: 'busy' }));
    try {
      await sendFriendRequest(userId);
      setState((s) => ({ ...s, [userId]: 'sent' }));
    } catch (e) {
      setState((s) => {
        const next = { ...s };
        delete next[userId];
        return next;
      });
      setError(getErrorMessage(e, "Couldn't send that request."));
    }
  }, []);
  return { state, add, error };
}

export function AddButton({
  name,
  state,
  isFriend,
  onPress,
}: {
  name: string;
  state?: AddState;
  isFriend?: boolean;
  onPress: () => void;
}) {
  if (isFriend) {
    return (
      <View style={[styles.add, styles.addDone]}>
        <Text style={styles.addDoneText}>Friends</Text>
      </View>
    );
  }
  const sent = state === 'sent';
  return (
    <Pressable
      onPress={onPress}
      disabled={!!state}
      style={({ pressed }) => [styles.add, sent && styles.addDone, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={sent ? `Request sent to ${name}` : `Add ${name}`}>
      {state === 'busy' ? (
        <ActivityIndicator size="small" color={Colors.ink} />
      ) : (
        <>
          <Icon name={sent ? 'check' : 'plus'} size={12} color={sent ? Colors.green : Colors.onEmber} />
          <Text style={sent ? styles.addDoneText : styles.addText}>{sent ? 'Sent' : 'Add'}</Text>
        </>
      )}
    </Pressable>
  );
}

export function PersonTile({
  name,
  avatarUrl,
  sub,
  live,
  isFriend,
  addState,
  onAdd,
  onPress,
}: {
  name: string;
  avatarUrl: string | null;
  sub: string | null;
  live?: boolean;
  isFriend?: boolean;
  addState?: AddState;
  onAdd: () => void;
  onPress: () => void;
}) {
  return (
    <View style={styles.tile}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${name}'s Campfire`} style={styles.tileTop}>
        <MatchAvatar name={name} avatarUrl={avatarUrl} size={56} live={live} />
        <Text style={styles.tileName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          {sub ?? ' '}
        </Text>
      </Pressable>
      <AddButton name={name} state={addState} isFriend={isFriend} onPress={onAdd} />
    </View>
  );
}

export function PersonRow({
  name,
  avatarUrl,
  sub,
  live,
  isFriend,
  addState,
  onAdd,
  onPress,
}: {
  name: string;
  avatarUrl: string | null;
  sub: string | null;
  live?: boolean;
  isFriend?: boolean;
  addState?: AddState;
  onAdd?: () => void;
  onPress: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} style={styles.rowMain} accessibilityRole="button" accessibilityLabel={`Open ${name}'s Campfire`}>
        <MatchAvatar name={name} avatarUrl={avatarUrl} size={44} live={live} />
        <View style={styles.flex}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          {sub ? (
            <Text style={styles.rowSub} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {onAdd ? <AddButton name={name} state={addState} isFriend={isFriend} onPress={onAdd} /> : null}
    </View>
  );
}

// ── rooms & clubs ───────────────────────────────────────────────────────────────────────────────

export type JoinState = 'busy' | JoinOutcome['kind'];

export function JoinButton({ label, state, onPress }: { label: string; state?: JoinState; onPress: () => void }) {
  const done = state === 'joined' || state === 'requested';
  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'busy' || done}
      style={({ pressed }) => [styles.join, done && styles.joinDone, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={done ? (state === 'joined' ? `Joined ${label}` : `Requested ${label}`) : `Join ${label}`}>
      {state === 'busy' ? (
        <ActivityIndicator size="small" color={Colors.navEmber2} />
      ) : (
        <Text style={[styles.joinText, done && styles.joinDoneText]}>
          {state === 'joined' ? 'Joined' : state === 'requested' ? 'Requested' : 'Join'}
        </Text>
      )}
    </Pressable>
  );
}

/** One join-state map per screen; `run` wraps any join call that returns a JoinOutcome. */
export function useJoin() {
  const [state, setState] = useState<Record<string, JoinState>>({});
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (id: string, go: () => Promise<JoinOutcome>) => {
    setError(null);
    setState((s) => ({ ...s, [id]: 'busy' }));
    const r = await go();
    setState((s) => {
      const next = { ...s };
      if (r.kind === 'joined' || r.kind === 'requested') next[id] = r.kind;
      else delete next[id];
      return next;
    });
    if (r.kind === 'error') setError(r.message);
  }, []);
  return { state, run, error };
}

export function CoverCard({
  id,
  emoji,
  title,
  sub,
  tagline,
  online,
  locked,
  width,
  action,
  onPress,
}: {
  id: string;
  emoji: string;
  title: string;
  sub?: string | null;
  /** The about-line on the banner ("3 runs/week · all paces"). */
  tagline?: string | null;
  /** Live count; hidden at 0. */
  online?: number;
  /** Code-gated room. */
  locked?: boolean;
  /** Fixed width for a swipe row; full width when absent. */
  width?: number;
  action?: ReactNode;
  onPress: () => void;
}) {
  const [a, b] = bannerFor(id);
  return (
    <View style={[styles.cover, width ? { width } : null]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${title}`}>
        <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.banner, width ? styles.bannerSmall : null]}>
          <View style={styles.crest}>
            <Text style={styles.crestEmoji}>{emoji || '🔥'}</Text>
          </View>
          {online && online > 0 ? (
            <View style={styles.online}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>{online} online</Text>
            </View>
          ) : null}
          {tagline ? (
            <View style={styles.tagline}>
              <Text style={styles.taglineText} numberOfLines={1}>
                {tagline}
              </Text>
            </View>
          ) : null}
        </LinearGradient>
      </Pressable>
      <View style={styles.coverBody}>
        <Pressable onPress={onPress} style={styles.flex}>
          <View style={styles.titleRow}>
            {locked ? <Icon name="lock" size={13} color={Colors.gold} /> : null}
            <Text style={styles.coverTitle} numberOfLines={1}>
              {title}
            </Text>
          </View>
          {sub ? (
            <Text style={styles.coverSub} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </Pressable>
        {action}
      </View>
    </View>
  );
}

// ── topics ──────────────────────────────────────────────────────────────────────────────────────

export function TopicTile({ tag, count, onPress }: { tag: string; count: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.topic, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Posts about ${tag}`}>
      <Text style={styles.topicTag} numberOfLines={1}>
        {tag}
      </Text>
      <Text style={styles.topicCount}>{count === 0 ? 'be the first' : `${formatCount(count)} ${count === 1 ? 'post' : 'posts'}`}</Text>
    </Pressable>
  );
}

export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function EmptyLine({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (!onPress) return <Text style={styles.empty}>{children}</Text>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Text style={[styles.empty, styles.emptyLink]}>{children}</Text>
    </Pressable>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
    marginBottom: Spacing.twelve,
  },
  head: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },

  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 64,
    height: 30,
    paddingHorizontal: Spacing.twelve,
    borderRadius: Radius.pill,
    backgroundColor: Colors.navEmber2,
  },
  addText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.onEmber },
  addDone: { backgroundColor: Colors.spacePanel2, borderWidth: 1, borderColor: Colors.spaceLine },
  addDoneText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.muted },

  tile: {
    width: 128,
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  tileTop: { alignItems: 'center', gap: 4, alignSelf: 'stretch' },
  tileName: { marginTop: 6, fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink, maxWidth: '100%' },
  tileSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim, maxWidth: '100%' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: Spacing.twelve,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.spaceLine,
  },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.twelve },
  rowName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  rowSub: { marginTop: 2, fontFamily: Fonts.body, fontSize: 13, color: Colors.spaceDim },

  join: {
    minWidth: 72,
    height: 34,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.navEmber2,
  },
  joinText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.navEmber2 },
  joinDone: { borderColor: Colors.spaceLine, backgroundColor: Colors.spacePanel2 },
  joinDoneText: { color: Colors.muted },

  cover: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  banner: { height: 92, padding: Spacing.twelve, justifyContent: 'flex-end' },
  bannerSmall: { height: 76 },
  crest: {
    position: 'absolute',
    top: Spacing.twelve,
    left: Spacing.twelve,
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(14,10,28,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestEmoji: { fontSize: 20 },
  online: {
    position: 'absolute',
    top: Spacing.twelve,
    right: Spacing.twelve,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(14,10,28,0.55)',
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#39D98A' },
  onlineText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.ink },
  tagline: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(14,10,28,0.7)',
  },
  taglineText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.ink },
  coverBody: { flexDirection: 'row', alignItems: 'center', gap: Spacing.twelve, padding: Spacing.twelve },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  coverTitle: { flexShrink: 1, fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  coverSub: { marginTop: 2, fontFamily: Fonts.body, fontSize: 13, color: Colors.spaceDim },

  topic: {
    width: 132,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    gap: 4,
  },
  topicTag: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.navEmber2 },
  topicCount: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim },

  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.spaceDim, paddingVertical: Spacing.twelve },
  emptyLink: { color: Colors.navEmber2 },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, paddingVertical: Spacing.two },
});
