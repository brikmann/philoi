import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { sendFriendRequest } from '@/lib/api/friend-requests';
import { fetchGrindAlikes, fetchMyMatchSettings } from '@/lib/api/matchmaking';
import type { GrindAlike } from '@/types/social';

/**
 * Home's cold start (0285, mock 323): when "what your people are doing" is empty, the people who
 * grind like you stand in — the same grind-alike engine, so it runs on declared interests from day
 * one. Opt-in is 0275's: if you haven't turned matching on, this is a single invitation row
 * instead, and nobody is listed. Add friend is the only action (no stranger contact).
 */
export function PeopleLikeYou({
  limit = 3,
  lead = 'People who grind like you',
}: {
  limit?: number;
  /** The block's own heading; null when the host screen already titles the section (Discover). */
  lead?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'off' | 'ready' | 'hidden'>('loading');
  const [rows, setRows] = useState<GrindAlike[]>([]);
  const [sent, setSent] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let live = true;
    fetchMyMatchSettings()
      .then(async (s) => {
        if (!s.discoverable) {
          if (live) setState('off');
          return;
        }
        const all = await fetchGrindAlikes(undefined, limit + 3);
        if (!live) return;
        const strangers = all.filter((m) => !m.is_friend).slice(0, limit);
        setRows(strangers);
        setState(strangers.length > 0 ? 'ready' : 'hidden');
      })
      .catch(() => {
        // Pre-0275 server or offline — the empty "your people" state already says enough.
        if (live) setState('hidden');
      });
    return () => {
      live = false;
    };
  }, [limit]);

  if (state === 'loading' || state === 'hidden') return null;

  if (state === 'off') {
    return (
      <Pressable style={styles.invite} onPress={() => router.push('/grind-alikes' as never)} accessibilityRole="button">
        <Icon name="compass" size={16} color={Colors.legend} />
        <Text style={styles.inviteText}>Find people who grind like you</Text>
        <Icon name="plus" size={14} color={Colors.spaceDim} />
      </Pressable>
    );
  }

  const add = (id: string) => {
    setSent((prev) => new Set(prev).add(id));
    sendFriendRequest(id).catch(() =>
      setSent((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    );
  };

  return (
    <View style={styles.wrap}>
      {lead ? <Text style={styles.lead}>{lead}</Text> : null}
      {rows.map((m) => {
        const done = sent.has(m.user_id);
        return (
          <Pressable
            key={m.user_id}
            style={styles.row}
            onPress={() => router.push({ pathname: '/grind-alike/[userId]', params: { userId: m.user_id } } as never)}
            accessibilityRole="button"
            accessibilityLabel={`${m.display_name}, why you two match`}>
            <MatchAvatar name={m.display_name} avatarUrl={m.avatar_url} size={34} live={m.live} />
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>
                {m.display_name}
              </Text>
              <Text style={styles.why} numberOfLines={1}>
                {m.reasons
                  .slice(0, 3)
                  .map((r) => r.label)
                  .join(' · ')}
              </Text>
            </View>
            <Pressable
              onPress={() => add(m.user_id)}
              disabled={done}
              hitSlop={8}
              style={[styles.addBtn, done && styles.addBtnDone]}
              accessibilityRole="button"
              accessibilityLabel={done ? 'Request sent' : `Add ${m.display_name}`}>
              <Icon name={done ? 'check' : 'plus'} size={13} color={done ? Colors.green : Colors.ink} />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.twelve,
    gap: Spacing.two,
  },
  lead: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  why: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.legend,
    marginTop: 1,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDone: {
    borderColor: Colors.green,
  },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.twelve,
    backgroundColor: 'rgba(185,139,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(185,139,255,0.35)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  inviteText: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
});
