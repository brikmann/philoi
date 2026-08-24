import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChallengeMemberTicker } from '@/components/challenge-member-ticker';
import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TargetEmberHero } from '@/components/empty-states/target-ember-hero';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { inviteChallengeMembers, respondToChallengeInvite, startChallenge } from '@/lib/api/challenge-lifecycle';
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
  const [inviteFor, setInviteFor] = useState<SocialChallenge | null>(null);

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

  // Mount fetch. This used to be a second, hand-inlined copy of `load` — same RPC, same filter,
  // same error string — so the campfire-scoping rule lived in two places and a fix to one would
  // silently miss the other. `load` already owns its own error handling and never rejects, so
  // there is nothing left here to guard.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    void load();
  }, [load]);

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
            <SocialChallengeCard challenge={item} myUserId={myUserId} onChanged={load} isAdmin={isAdmin} />
          </Pressable>

          {/* A DRAFT WITH NOBODY IN IT. This is the state every group challenge created since 0098
              has been stuck in: created as a draft, no participants, and "Start the race" below
              refusing with "Nobody has accepted yet." because nothing ever called
              invite_challenge_members. The ticker now runs at create time, but drafts stranded
              before that need a way out, and an admin who skipped the ticker needs one too. */}
          {isAdmin && item.status === 'draft' && item.invited_count === 0 && item.accepted_count <= 1 ? (
            <Pressable
              style={[styles.btn, styles.start]}
              onPress={() => setInviteFor(item)}
              accessibilityRole="button">
              <Text style={styles.startText}>Invite members</Text>
            </Pressable>
          ) : null}

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
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {inviteFor ? (
            <InviteSheet
              challenge={inviteFor}
              myUserId={myUserId}
              onClose={() => setInviteFor(null)}
              onInvited={() => {
                setInviteFor(null);
                void load();
              }}
            />
          ) : null}
        </>
      }
    />
  );
}

/** The member ticker as a sheet, for a draft that already exists. Same component the create
 *  screen uses inline — one definition of "pick people from this campfire". */
function InviteSheet({
  challenge,
  myUserId,
  onClose,
  onInvited,
}: {
  challenge: SocialChallenge;
  myUserId: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await inviteChallengeMembers(challenge.id, picked);
      onInvited();
    } catch (e) {
      setErr(getErrorMessage(e, 'Those invites did not go out.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        {/* Inside a <Modal>, so the OS inset is this component's problem — the parent Screen's
            SafeAreaView does not extend over a modal. */}
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>Who&apos;s racing?</Text>
          <Text style={styles.sheetSub}>
            They get an invite to accept. Once someone has, you can start the race.
          </Text>

          {challenge.circle_id ? (
            <ChallengeMemberTicker
              groupId={challenge.circle_id}
              value={picked}
              onChange={setPicked}
              excludeUserIds={[myUserId]}
            />
          ) : null}

          {err ? <Text style={styles.error}>{err}</Text> : null}

          <Pressable
            style={[styles.btn, styles.accept, (busy || picked.length === 0) && styles.btnOff]}
            disabled={busy || picked.length === 0}
            onPress={send}
            accessibilityRole="button">
            <Text style={styles.acceptText}>
              {busy ? 'Sending…' : picked.length === 0 ? 'Pick someone' : `Invite ${picked.length}`}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  btnOff: {
    opacity: 0.5,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  grab: {
    alignSelf: 'center',
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.trackAlt,
    marginBottom: Spacing.two,
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  sheetSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
  },
});
