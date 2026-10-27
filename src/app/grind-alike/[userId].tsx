import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SHOW_ALIKE_SCORE } from '@/components/matchmaking/config';
import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { MixOverlapBars } from '@/components/matchmaking/mix-overlap-bars';
import { ReasonChips } from '@/components/matchmaking/reason-chips';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { IconText } from '@/components/ui/icon';
import { SPACE_GUTTER, SpaceButton, SpaceEmpty, SpaceHeader, SpaceIconButton } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
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
        <SpaceEmpty
          title="This match isn't available"
          body={
            state === 'failed'
              ? "We couldn't load it just now. Try again in a bit."
              : 'They may have changed who can find them, or the shelf has moved on.'
          }
          action={<SpaceButton label="Back" variant="secondary" onPress={() => router.back()} style={styles.missingBack} />}
        />
      </SafeAreaView>
    );
  }

  if (state === 'loading' || !detail) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <TopBar onBack={() => router.back()} />
        <ActivityIndicator color={Colors.navEmber} style={styles.spinner} />
      </SafeAreaView>
    );
  }

  const d = detail;
  const firstName = d.display_name.split(/\s+/)[0] || d.display_name;
  const streakLine = d.streak > 0 ? `${d.streak}-day streak` : null;

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
        <View style={styles.hero}>
          <MatchAvatar name={d.display_name} avatarUrl={d.avatar_url} size={72} live={d.live} />
          <Text style={styles.name}>{d.display_name}</Text>
          {d.career_goal ? <Text style={styles.goal}>{d.career_goal}</Text> : null}
          {d.working_toward ? <Text style={styles.toward}>Working toward {d.working_toward}</Text> : null}
          {d.university || streakLine ? (
            <View style={styles.metaRow}>
              {d.university ? <Text style={styles.meta}>{streakLine ? `${d.university} · ` : d.university}</Text> : null}
              {streakLine ? (
                <IconText icon="streak" style={styles.meta} iconColor={Colors.amber}>
                  {streakLine}
                </IconText>
              ) : null}
            </View>
          ) : null}
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
              <View style={styles.btnIcon}>
                <SocialGlyph name="chat" size={16} color={Colors.ink} />
              </View>
              <Text style={[styles.btnText, styles.btnTextOn]}>Message</Text>
            </Pressable>
          ) : relation === 'outgoing' ? (
            <View style={styles.btn}>
              <Text style={styles.btnText}>Requested</Text>
            </View>
          ) : (
            <Pressable style={styles.btn} onPress={handleAddFriend} disabled={busy}>
              <View style={styles.btnIcon}>
                <SocialGlyph name="personAdd" size={16} color={Colors.ink} />
              </View>
              <Text style={[styles.btnText, styles.btnTextOn]}>Add friend</Text>
            </Pressable>
          )}
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleChallenge}>
            <View style={styles.btnIcon}>
              <SocialGlyph name="swords" size={16} color="#2A0F05" />
            </View>
            <Text style={[styles.btnText, styles.btnTextPrimary]}>Challenge</Text>
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

// The kit header: back chevron, the screen's own title (it used to sit as a small caps line under a
// bare chevron), and the ⋯ that opens report/block once the match has loaded.
function TopBar({ onBack, onMore }: { onBack: () => void; onMore?: () => void }) {
  return (
    <SpaceHeader
      title="Why you two match"
      onBack={onBack}
      right={
        onMore ? (
          <SpaceIconButton onPress={onMore} label="More options">
            <UiGlyph name="more" size={18} color={Colors.ink} />
          </SpaceIconButton>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  spinner: {
    marginTop: Spacing.six,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  name: {
    fontFamily: Fonts.black,
    fontSize: 20,
    color: Colors.ink,
    marginTop: 9,
    textAlign: 'center',
  },
  // Career goal is identity — gold.
  goal: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.gold,
    marginTop: 3,
    textAlign: 'center',
  },
  toward: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    marginTop: 2,
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    textAlign: 'center',
  },
  live: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.green,
    marginTop: 4,
  },
  why: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  // Muted, not ember: the number is a similarity read and gets none of the earned-status colour.
  whyTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginBottom: 10,
  },
  acts: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  // Kit button shapes (SpaceButton secondary / primary), drawn locally because these carry their own
  // accessibility labels and a non-pressable "Requested" state that SpaceButton has no slot for.
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 16,
  },
  btnAccept: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
  btnPrimary: {
    backgroundColor: Colors.navEmber,
    borderColor: Colors.navEmber,
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  btnIcon: {
    marginRight: 6,
  },
  btnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.spaceDim,
  },
  btnTextOn: {
    color: Colors.ink,
  },
  btnTextPrimary: {
    fontFamily: Fonts.black,
    color: '#2A0F05',
  },
  mini: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: Spacing.twelve,
  },
  missingBack: {
    marginTop: Spacing.two,
    alignSelf: 'stretch',
  },
});
