import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TargetEmberHero } from '@/components/empty-states/target-ember-hero';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { respondToChallengeInvite, startChallenge } from '@/lib/api/challenge-lifecycle';
import { fetchMySocialChallenges } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import type { SocialChallenge } from '@/types/database';

// THE A/B SEAM (handoff B). A owns the campfire container, its header and the tab bar; this is the
// content that mounts into A's Challenges slot. The prop shape is A's — do not change it here
// without telling them, since their screen is the only caller.
//
// bottomGap, not an inset: A's <Screen> already applies the OS bottom inset via SafeAreaView, so
// adding insets.bottom here would double-pad. Only components inside a <Modal> need
// useSafeAreaInsets — which will matter for the cheer composer, not for this list.

export type ChallengesTabProps = {
  groupId: string;
  myUserId: string;
  /** Whether the viewer may start/manage challenges here — from A's useCampfireRole. */
  isAdmin: boolean;
  /** A's header + tab-bar chrome, rendered as our list header so the tab scrolls as one surface. */
  ListHeaderComponent?: React.ReactElement | null;
  /** Breathing room above the safe area, not the inset itself. A passes Spacing.four. */
  bottomGap: number;
};

export function ChallengesTab({
  groupId,
  myUserId,
  isAdmin,
  ListHeaderComponent,
  bottomGap,
}: ChallengesTabProps) {
  const router = useRouter();
  const [challenges, setChallenges] = useState<SocialChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchMySocialChallenges();
      // Campfire-scoped: this tab lives inside one campfire, so a duel the viewer is running
      // elsewhere does not belong here even though the feed returns it.
      setChallenges(all.filter((c) => c.circle_id === groupId));
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load challenges.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const all = await fetchMySocialChallenges();
        if (current) {
          setChallenges(all.filter((c) => c.circle_id === groupId));
          setLoading(false);
        }
      } catch (e) {
        if (current) {
          setError(getErrorMessage(e, 'Could not load challenges.'));
          setLoading(false);
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [groupId]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(getErrorMessage(e, 'That did not work.'));
    } finally {
      setBusyId(null);
    }
  }

  // Live races first, then anything awaiting a decision, then the rest. Sorting by lifecycle
  // rather than by date because "what needs me" is the question this tab answers.
  // Bands, not literals scattered about: 'active' is racing and (draft|pending) is awaiting a
  // decision. Matches challenge_is_live / challenge_is_awaiting in 0096 so client and server agree.
  const live = challenges.filter((c) => c.status === 'active');
  const awaiting = challenges.filter((c) => c.status === 'draft' || c.status === 'pending');
  const done = challenges.filter((c) => !live.includes(c) && !awaiting.includes(c));
  const ordered = [...live, ...awaiting, ...done];

  return (
    <FlatList
      data={ordered}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={ListHeaderComponent}
      contentContainerStyle={[styles.content, { paddingBottom: bottomGap }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.coral} />}
      ListEmptyComponent={
        loading ? null : (
          <EmptyState
            icon={<TargetEmberHero />}
            title="No challenges yet"
            body={
              isAdmin
                ? 'Start a race for the campfire — invite everyone or just a few.'
                : "Nothing running here yet. An admin starts the campfire's challenges."
            }
            action={
              // Members do not get a dead button. Admin-only creation is enforced server-side
              // regardless; hiding it is about not offering an action that will be refused.
              isAdmin ? (
                <View style={styles.emptyCta}>
                  <PrimaryButton
                    label="Start a challenge"
                    onPress={() => router.push({ pathname: '/challenge/create', params: { groupId } })}
                  />
                </View>
              ) : undefined
            }
          />
        )
      }
      renderItem={({ item }) => (
        <View style={styles.item}>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/challenge-info/[challengeId]', params: { challengeId: item.id } })
            }>
            <SocialChallengeCard challenge={item} myUserId={myUserId} onChanged={load} />
          </Pressable>

          {/* The two v2 lifecycle actions that belong on the card. Everything else (edit, delete,
              terms) lives in the manage sheet. */}
          {item.status === 'pending' ? (
            <View style={styles.actions}>
              <Pressable
                style={[styles.btn, styles.accept]}
                disabled={busyId === item.id}
                onPress={() => act(item.id, () => respondToChallengeInvite(item.id, true))}>
                <Text style={styles.acceptText}>Accept</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.decline]}
                disabled={busyId === item.id}
                onPress={() => act(item.id, () => respondToChallengeInvite(item.id, false))}>
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
            </View>
          ) : null}

          {isAdmin && (item.status === 'pending' || item.status === 'draft') ? (
            <Pressable
              style={[styles.btn, styles.start]}
              disabled={busyId === item.id}
              onPress={() => act(item.id, () => startChallenge(item.id))}>
              <Text style={styles.startText}>
                {busyId === item.id ? 'Starting…' : 'Start the race'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
      ListFooterComponent={
        error ? <Text style={styles.error}>{error}</Text> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.four,
  },
  item: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.button,
    paddingVertical: Spacing.twelve,
  },
  accept: {
    backgroundColor: Colors.ember,
  },
  acceptText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  decline: {
    backgroundColor: Colors.achieverBg,
  },
  declineText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.muted,
  },
  start: {
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: Colors.ember,
  },
  startText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ember,
  },
  emptyCta: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.four,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
