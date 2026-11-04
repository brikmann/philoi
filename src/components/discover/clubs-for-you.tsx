import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { joinForest } from '@/lib/api/forests';
import { fetchSuggestedForests, type SuggestedForest } from '@/lib/api/interests';
import { getErrorMessage } from '@/lib/errors';

// Onboarding's own bar for the ★ tag (interests.tsx, mock 333) — one definition of "Popular".
const POPULAR_MEMBERS = 25;

/**
 * DISCOVER · CLUBS FOR YOU (Phase 8.3, mock 336) — forests matched to what you declared you grind,
 * get_suggested_forests (0285): the same shelf onboarding's step offers, so there is one matcher.
 * Tagged "★ Popular" past onboarding's bar and "matches {your tag}"; Join inline (an open forest
 * lets you straight in, a request forest says Requested). No engagement ordering — the server's
 * match order, nothing re-sorted here.
 */
export function ClubsForYou({ limit = 4 }: { limit?: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<SuggestedForest[] | null>(null);
  const [joined, setJoined] = useState<Record<string, 'active' | 'pending' | 'busy'>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchSuggestedForests(limit)
      .then((r) => {
        if (live) setRows(r);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [limit]);

  if (!rows) return null;
  if (rows.length === 0) {
    return (
      <Pressable onPress={() => router.push('/search')} accessibilityRole="button" style={styles.row}>
        <Text style={styles.sub}>No club matches yet — search every forest ›</Text>
      </Pressable>
    );
  }

  const join = async (f: SuggestedForest) => {
    setError(null);
    setJoined((prev) => ({ ...prev, [f.id]: 'busy' }));
    try {
      const status = await joinForest(f.id);
      setJoined((prev) => ({ ...prev, [f.id]: status }));
    } catch (e) {
      setJoined((prev) => {
        const next = { ...prev };
        delete next[f.id];
        return next;
      });
      setError(getErrorMessage(e, 'Could not join — try again.'));
    }
  };

  return (
    <View>
      {rows.map((f) => {
        const state = joined[f.id];
        const tags = [
          f.member_count >= POPULAR_MEMBERS ? '★ Popular' : null,
          f.because ? `matches ${f.because}` : null,
          f.because ? null : `${f.member_count.toLocaleString('en-US')} members`,
        ].filter(Boolean);
        return (
          <Pressable
            key={f.id}
            onPress={() => router.push({ pathname: '/forest/[id]', params: { id: f.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${f.name}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.crest}>
              <Text style={styles.emoji}>{f.emoji}</Text>
            </View>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {tags.join(' · ')}
              </Text>
            </View>
            <Pressable
              onPress={() => void join(f)}
              disabled={Boolean(state)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={state ? (state === 'pending' ? 'Requested' : 'Joined') : `Join ${f.name}`}
              style={[styles.join, state && styles.joinDone]}>
              <Text style={[styles.joinText, state && styles.joinTextDone]}>
                {state === 'active' ? 'Joined' : state === 'pending' ? 'Requested' : state === 'busy' ? '…' : f.visibility === 'request' ? 'Ask' : 'Join'}
              </Text>
            </Pressable>
          </Pressable>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.65)',
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  pressed: {
    opacity: 0.85,
  },
  crest: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 19,
  },
  text: {
    flex: 1,
    marginLeft: 11,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  join: {
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    backgroundColor: Colors.navEmber,
    marginLeft: 8,
  },
  joinDone: {
    backgroundColor: Colors.spacePanel2,
  },
  joinText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.spaceBg,
  },
  joinTextDone: {
    color: Colors.green,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
    marginTop: 2,
  },
});
