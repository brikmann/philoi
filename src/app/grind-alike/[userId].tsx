import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SHOW_ALIKE_SCORE } from '@/components/matchmaking/config';
import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { MixOverlapBars } from '@/components/matchmaking/mix-overlap-bars';
import { ReasonChips } from '@/components/matchmaking/reason-chips';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { blockUser } from '@/lib/api/agora';
import { respondFriendRequest, sendFriendRequest } from '@/lib/api/friend-requests';
import { fetchMatchDetail } from '@/lib/api/matchmaking';
import { getErrorMessage } from '@/lib/errors';
import type { MatchDetail } from '@/types/social';

type Relation = 'friends' | 'outgoing' | 'incoming' | 'none';

// "Why you two match" (mock 299 phone 2). Their public identity, the mix overlap drawn as bars,
// the shared traits, then two existing paths out: Add friend and Challenge. No Message unless
// you're already friends — 0275 adds no stranger contact, and dm_open_thread refuses one anyway.
export default function GrindAlikeDetailScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { profile: myProfile } = useAuth();

  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [relation, setRelation] = useState<Relation>('none');
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    fetchMatchDetail(userId)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setState(d ? 'ready' : 'missing');
        if (d) setRelation(d.is_friend ? 'friends' : (d.request ?? 'none'));
      })
      // Fail soft: until 0275 is applied the RPC doesn't exist.
      .catch(() => {
        if (live) setState('failed');
      });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!userId || state === 'missing' || state === 'failed' || (state === 'ready' && !detail)) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <TopBar onBack={() => router.back()} />
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>This match isn&apos;t available</Text>
          <Text style={styles.missingSub}>
            {state === 'failed'
              ? "We couldn't load it just now. Try again in a bit."
              : 'They may have changed who can find them, or the shelf has moved on.'}
          </Text>
          <Pressable style={styles.missingBack} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.missingBackText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'loading' || !detail) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <TopBar onBack={() => router.back()} />
        <ActivityIndicator color={Colors.amber} style={styles.spinner} />
      </SafeAreaView>
    );
  }

  const d = detail;
  const firstName = d.display_name.split(/\s+/)[0] || d.display_name;
  const meta = [d.university, d.streak > 0 ? `🔥 ${d.streak}-day streak` : null].filter(Boolean).join(' · ');

  async function handleAddFriend() {
    if (busy || relation !== 'none') return;
    setBusy(true);
    try {
      await sendFriendRequest(d.user_id);
      setRelation('outgoing');
    } catch (e) {
      Alert.alert('Something went wrong', getErrorMessage(e, 'Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRespond(accept: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await respondFriendRequest(d.user_id, accept);
      setRelation(accept ? 'friends' : 'none');
    } catch (e) {
      Alert.alert('Something went wrong', getErrorMessage(e, 'Try again.'));
    } finally {
      setBusy(false);
    }
  }

  // Exactly what friend-profile.tsx's Challenge does — the committed h2h create flow, pre-filled.
  function handleChallenge() {
    router.push({
      pathname: '/challenge/create',
      params: { opponentId: d.user_id, opponentName: d.display_name, mode: 'h2h' },
    });
  }

  function handleMessage() {
    router.push({ pathname: '/dm/[friendId]', params: { friendId: d.user_id } });
  }

  async function handleBlock() {
    if (!myProfile) return;
    try {
      await blockUser(myProfile.id, d.user_id);
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Try again.'));
      return;
    }
    router.back();
    Alert.alert('User blocked', "They won't show up for you anymore, and you won't show up for them.");
  }

  const whyTitle = SHOW_ALIKE_SCORE && d.score != null ? `${Math.round(d.score)}% alike · why` : 'Why you two match';

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <TopBar onBack={() => router.back()} onMore={() => setMoreOpen(true)} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.screenTitle}>Why you two match</Text>

        <View style={styles.hero}>
          <MatchAvatar name={d.display_name} avatarUrl={d.avatar_url} size={72} live={d.live} />
          <Text style={styles.name}>{d.display_name}</Text>
          {d.career_goal ? <Text style={styles.goal}>{d.career_goal}</Text> : null}
          {d.working_toward ? <Text style={styles.toward}>Working toward {d.working_toward}</Text> : null}
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {d.live ? <Text style={styles.live}>● locked in now</Text> : null}
        </View>

        <View style={styles.why}>
          <Text style={styles.whyTitle}>{whyTitle}</Text>
          <MixOverlapBars theirs={d.their_mix} mine={d.my_mix} theirName={firstName} />
          <ReasonChips reasons={d.reasons} />
        </View>

        <View style={styles.acts}>
          {relation === 'incoming' ? (
            <>
              <Pressable style={styles.btn} onPress={() => handleRespond(false)} disabled={busy}>
                <Text style={styles.btnText}>Decline</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnAccept]} onPress={() => handleRespond(true)} disabled={busy}>
                <Text style={[styles.btnText, styles.btnTextOn]}>Accept</Text>
              </Pressable>
            </>
          ) : relation === 'friends' ? (
            <Pressable style={styles.btn} onPress={handleMessage} accessibilityLabel={`Message ${d.display_name}`}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={Colors.ink} style={styles.btnIcon} />
              <Text style={[styles.btnText, styles.btnTextOn]}>Message</Text>
            </Pressable>
          ) : relation === 'outgoing' ? (
            <View style={styles.btn}>
              <Text style={styles.btnText}>Requested</Text>
            </View>
          ) : (
            <Pressable style={styles.btn} onPress={handleAddFriend} disabled={busy}>
              <Text style={[styles.btnText, styles.btnTextOn]}>＋ Add friend</Text>
            </Pressable>
          )}
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleChallenge}>
            <Text style={[styles.btnText, styles.btnTextPrimary]}>⚔ Challenge</Text>
          </Pressable>
        </View>

        <Text style={styles.mini}>
          {relation === 'friends'
            ? `You and ${firstName} are friends — cheer and message are open.`
            : `Add ${firstName} as a friend to cheer & message, or send a friendly challenge on a shared goal.`}
        </Text>
      </ScrollView>

      <ReportBlockSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onReport={() => router.push({ pathname: '/report', params: { userId: d.user_id } })}
        onBlock={handleBlock}
      />
    </SafeAreaView>
  );
}

function TopBar({ onBack, onMore }: { onBack: () => void; onMore?: () => void }) {
  return (
    <View style={styles.top}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={Colors.muted} />
      </Pressable>
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={10} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={20} color={Colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  container: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  spinner: {
    marginTop: Spacing.six,
  },
  screenTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
    marginTop: 9,
    textAlign: 'center',
  },
  goal: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.amber,
    marginTop: 3,
    textAlign: 'center',
  },
  toward: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 3,
    textAlign: 'center',
  },
  live: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.green,
    marginTop: 4,
  },
  why: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    padding: 13,
    marginTop: Spacing.three,
  },
  // Muted, not ember: the number is a similarity read and gets none of the earned-status colour.
  whyTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.muted,
    marginBottom: 10,
  },
  acts: {
    flexDirection: 'row',
    gap: 9,
    marginTop: Spacing.three,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.button,
    paddingVertical: 12,
  },
  btnAccept: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
  btnPrimary: {
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  btnIcon: {
    marginRight: 4,
  },
  btnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  btnTextOn: {
    color: Colors.ink,
  },
  btnTextPrimary: {
    color: Colors.ink,
  },
  mini: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.twelve,
  },
  missing: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.six,
  },
  missingTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
    textAlign: 'center',
  },
  missingSub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  missingBack: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.button,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  missingBackText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
});
