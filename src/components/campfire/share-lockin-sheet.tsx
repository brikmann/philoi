import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchMyLockInsPage, type MyRecentLockIn } from '@/lib/api/check-ins';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_TYPE_META } from '@/lib/goal-types';

// SHARE A LOCK-IN (§7b, mock 101 frame 2's third + action).
//
// Pick one of your OWN past lock-ins and re-post it into the campfire chat. Deliberately your own
// only — `fetchMyLockInsPage` is scoped to the caller — because this is a flex, not a way to put
// somebody else's session in front of a room.
//
// WHY THIS EXISTS AT ALL, given a finished lock-in already lands in the feed on its own: the
// automatic one lands at the moment it happens, which is usually when nobody is looking. This is
// for bringing a session back up when the conversation gets to it — "this is the one I meant".
//
// The list is deliberately shallow (one page, newest first). Anything older than that is history
// and belongs on the profile, which is where lock-in history actually lives.

const PAGE = 20;

function durationLabel(seconds: number | null): string {
  if (!seconds) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function ShareLockInSheet({
  visible,
  onClose,
  myUserId,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  myUserId: string;
  onPick: (lockInId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [lockIns, setLockIns] = useState<MyRecentLockIn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open, no caching layer to defer to
    setLoading(true);
    setError(null);
    fetchMyLockInsPage(myUserId, { limit: PAGE })
      .then((rows) => {
        if (!cancelled) setLockIns(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e, 'Could not load your lock-ins.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, myUserId]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grab} />

          <View style={styles.head}>
            <View style={styles.headIcon}>
              <PhiloiIcon name="share" size={18} color={Colors.ember} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>Share a lock-in</Text>
              <Text style={styles.sub}>Post one of your sessions into the chat.</Text>
            </View>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          {loading ? (
            <ActivityIndicator color={Colors.amber} style={styles.loading} />
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {lockIns.length === 0 ? (
                <Text style={styles.empty}>You haven&apos;t logged a lock-in yet. Start one and it lands here.</Text>
              ) : (
                lockIns.map((l) => (
                  <Pressable
                    key={l.id}
                    style={styles.row}
                    onPress={() => onPick(l.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Share this ${durationLabel(l.duration_seconds)} lock-in`}>
                    <View style={styles.rowIcon}>
                      <Text style={styles.rowGlyph}>{GOAL_TYPE_META[l.goal_type]?.emoji ?? '🔥'}</Text>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {l.goal_detail || GOAL_TYPE_META[l.goal_type]?.label || 'Lock-in'}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {durationLabel(l.duration_seconds)}{l.created_at ? ` · ${new Date(l.created_at).toLocaleDateString()}` : ''}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,10,0.55)',
  },
  sheet: {
    maxHeight: '76%',
    backgroundColor: 'rgba(16,11,20,0.97)',
    borderTopWidth: 1,
    borderTopColor: Colors.lineStrong,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  head: {
    flexDirection: 'row',
    gap: 11,
    alignItems: 'flex-start',
    paddingBottom: Spacing.three,
  },
  headIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
    marginTop: 3,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    paddingBottom: Spacing.two,
  },
  loading: {
    paddingVertical: Spacing.four,
  },
  list: {
    paddingBottom: Spacing.two,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    paddingVertical: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowGlyph: {
    fontSize: 17,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
});
