import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AgoraCard } from '@/components/agora/agora-card';
import { AgoraCommentsSheet } from '@/components/agora/agora-comments-sheet';
import { ForestAvatar, ForestSheet, SheetRow } from '@/components/forests/forest-bits';
import { ForestCampfireSheet } from '@/components/forests/forest-campfire-sheet';
import { ForestReportSheet } from '@/components/forests/forest-report-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import { ScreenBackground } from '@/components/ui/screen-background';
import { SPACE_GUTTER, SpaceButton, SpaceEmpty, SpaceHeader, SpaceIconButton, SpaceSection } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePublicLoadouts } from '@/hooks/use-public-loadouts';
import { blockAgoraUser, reportAgora } from '@/lib/api/agora';
import {
  closeForest,
  fetchForest,
  fetchForestFeed,
  joinForest,
  leaveForest,
  removeForestMember,
  removeForestPost,
  respondForestRequest,
} from '@/lib/api/forests';
import { joinGroupWithCode, requestToJoinGroup } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { shortSchoolName } from '@/lib/universities';
import type { AgoraItem } from '@/types/database';
import type { ForestCampfire, ForestDetail, ForestMember } from '@/types/social';

// A FOREST (CODE_PROMPT_agora_forests.md §2, mock 283 §02 "Inside a forest → campfire").
//
// The forest is open discovery; the campfire is the commitment. So the order down the page is the
// funnel: who's here and how many are locked in → the campfires you could step into (with their
// join codes) → what people are posting → everyone in it.
//
// Moderation is on the page from day one (the spec's "time-bomb"): owners approve requests,
// remove members and posts and can close the forest; anyone can report it. Every menu is a sheet —
// Android drops the fourth button of an Alert without saying so.
//
// A request-only forest you haven't been let into returns can_read=false: header and the request
// button only, nothing of what's inside.

const FEED_PAGE = 20;

export default function ForestScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();

  const [forest, setForest] = useState<ForestDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [feed, setFeed] = useState<AgoraItem[]>([]);
  const [feedDone, setFeedDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [campfireOpen, setCampfireOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<AgoraItem | null>(null);
  const [postFor, setPostFor] = useState<AgoraItem | null>(null);
  const [memberFor, setMemberFor] = useState<ForestMember | null>(null);
  const [removeMemberFor, setRemoveMemberFor] = useState<ForestMember | null>(null);

  const runId = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const run = (runId.current += 1);
    try {
      const f = await fetchForest(id);
      if (run !== runId.current) return;
      if (!f) {
        setState('missing');
        return;
      }
      setForest(f);
      setState('ready');
      if (f.can_read) {
        // The feed failing alone leaves the rest of the forest usable — it just reads as quiet.
        const rows = await fetchForestFeed(id, null, FEED_PAGE).catch(() => [] as AgoraItem[]);
        if (run !== runId.current) return;
        setFeed(rows);
        setFeedDone(rows.length < FEED_PAGE);
      } else {
        setFeed([]);
      }
    } catch {
      if (run === runId.current) setState((s) => (s === 'ready' ? s : 'failed'));
    }
  }, [id]);

  // On focus, so a post you just wrote or a campfire you just joined shows on the way back.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const authorIds = useMemo(() => feed.map((i) => i.user_id), [feed]);
  const loadouts = usePublicLoadouts(authorIds);

  async function loadMore() {
    if (!id || loadingMore || feedDone || feed.length === 0) return;
    setLoadingMore(true);
    try {
      const last = feed[feed.length - 1];
      const rows = await fetchForestFeed(id, { created_at: last.created_at, id: last.id }, FEED_PAGE);
      const seen = new Set(feed.map((i) => i.id));
      setFeed((prev) => [...prev, ...rows.filter((r) => !seen.has(r.id))]);
      setFeedDone(rows.length < FEED_PAGE);
    } catch {
      setFeedDone(true);
    } finally {
      setLoadingMore(false);
    }
  }

  /** Every write here ends the same way: run it, say why if it failed, re-read the forest. */
  async function act(fn: () => Promise<unknown>, failTitle: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert(failTitle, getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  const join = () => act(() => joinForest(id), 'Could not join');

  async function confirmLeave() {
    setLeaveOpen(false);
    await act(() => leaveForest(id), 'Could not leave');
  }

  async function confirmClose() {
    if (busy) return;
    setBusy(true);
    try {
      await closeForest(id);
      setCloseOpen(false);
      router.back();
    } catch (e) {
      setCloseOpen(false);
      Alert.alert('Could not close the forest', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function openCampfire(c: ForestCampfire) {
    if (c.is_member) {
      router.push(`/group/${c.id}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      if (c.join_code) {
        // The forest's whole point: tap the code, land in the private chat.
        const group = await joinGroupWithCode(c.join_code);
        router.push(`/group/${group.id}`);
      } else if (c.privacy === 'gated') {
        await requestToJoinGroup(c.id);
        Alert.alert('Request sent', 'The campfire’s owner will let you in.');
      }
    } catch (e) {
      Alert.alert('Could not join', getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  function openProfile(userId: string) {
    if (userId === profile?.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId } });
  }

  function tapMember(m: ForestMember) {
    // Owners get a menu (view / remove); everyone else goes straight to the profile.
    if (forest?.is_owner && m.user_id !== profile?.id) setMemberFor(m);
    else openProfile(m.user_id);
  }

  async function confirmRemoveMember() {
    const m = removeMemberFor;
    setRemoveMemberFor(null);
    if (!m) return;
    await act(() => removeForestMember(id, m.user_id), 'Could not remove');
  }

  async function removePost(item: AgoraItem) {
    try {
      await removeForestPost(item.id);
      setFeed((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      Alert.alert('Could not remove', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function reportPost(item: AgoraItem) {
    if (!profile) return;
    try {
      await reportAgora({ reporterId: profile.id, reportedUserId: item.user_id, reason: 'Reported from a forest', postId: item.id });
      setFeed((prev) => prev.filter((i) => i.id !== item.id));
      Alert.alert('Reported', 'Thanks — we’ll take a look. You won’t see this post again.');
    } catch (e) {
      Alert.alert('Could not report', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function blockAuthor(item: AgoraItem) {
    if (!profile) return;
    try {
      await blockAgoraUser(profile.id, item.user_id);
      setFeed((prev) => prev.filter((i) => i.user_id !== item.user_id));
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  function compose() {
    if (!forest) return;
    router.push({ pathname: '/agora/compose', params: { forestId: forest.id, forestName: forest.name } });
  }

  const isMember = forest?.my_status === 'active';
  const isPending = forest?.my_status === 'pending';
  const postMine = postFor?.user_id === profile?.id;

  return (
    <ScreenBackground>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SpaceHeader
          title="Forest"
          right={
            forest ? (
              <SpaceIconButton onPress={() => setMenuOpen(true)} label="Forest options">
                <UiGlyph name="more" size={18} color={Colors.ink} />
              </SpaceIconButton>
            ) : undefined
          }
        />

        {state === 'loading' ? (
          <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
        ) : state !== 'ready' || !forest ? (
          <View style={styles.emptyWrap}>
            <Icon name="forest" size={32} color={Colors.spaceDim} />
            <SpaceEmpty
              title={state === 'missing' ? 'This forest isn’t here anymore.' : 'Couldn’t reach this forest just now.'}
              action={
                state === 'failed' ? (
                  <SpaceButton label="Try again" variant="secondary" onPress={() => void load()} style={styles.emptyBtn} />
                ) : undefined
              }
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            {/* ── header ── */}
            <View style={styles.hero}>
              <View style={styles.heroEmoji}>
                <Text style={styles.heroEmojiText}>{forest.emoji}</Text>
              </View>
              <Text style={styles.name}>{forest.name}</Text>
              {forest.purpose ? <Text style={styles.purpose}>{forest.purpose}</Text> : null}
              <Text style={styles.presence}>
                {forest.locked_in_now > 0 ? (
                  <Text style={styles.presenceLive}>{forest.locked_in_now} locked in now · </Text>
                ) : null}
                {forest.member_count.toLocaleString()} {forest.member_count === 1 ? 'member' : 'members'}
                {forest.university ? ` · ${shortSchoolName(forest.university)} only` : ''}
              </Text>
              {forest.tags.length > 0 ? (
                <View style={styles.tags}>
                  {forest.tags.map((t) => (
                    <Text key={t} style={styles.tag}>
                      #{t}
                    </Text>
                  ))}
                </View>
              ) : null}

              {forest.is_owner ? (
                <Text style={styles.ownerNote}>You started this forest</Text>
              ) : isMember ? (
                <SpaceButton label="Leave" variant="secondary" onPress={() => setLeaveOpen(true)} disabled={busy} style={styles.heroBtn} />
              ) : isPending ? (
                <View style={[styles.ghostBtn, styles.btnOff]}>
                  <Text style={styles.ghostText}>Requested</Text>
                </View>
              ) : (
                <SpaceButton
                  label={forest.visibility === 'request' ? 'Request to join' : 'Join forest'}
                  onPress={() => void join()}
                  loading={busy}
                  style={styles.heroBtn}
                />
              )}
            </View>

            {!forest.can_read ? (
              <Text style={styles.locked}>
                {isPending
                  ? 'Your request is with the owner. Once you’re in, its campfires and feed open up.'
                  : 'This forest is request-to-join. Its campfires, feed and members open up once the owner lets you in.'}
              </Text>
            ) : (
              <>
                {/* ── owner: pending requests ── */}
                {forest.is_owner && forest.pending && forest.pending.length > 0 ? (
                  <>
                    <SpaceSection>WAITING TO JOIN</SpaceSection>
                    {forest.pending.map((p) => (
                      <View key={p.user_id} style={styles.row}>
                        <Pressable onPress={() => openProfile(p.user_id)} accessibilityRole="button">
                          <ForestAvatar name={p.display_name} url={p.avatar_url} size={32} />
                        </Pressable>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {p.display_name}
                        </Text>
                        <Pressable
                          style={styles.smallGhost}
                          disabled={busy}
                          onPress={() => void act(() => respondForestRequest(id, p.user_id, false), 'Could not decline')}
                          accessibilityRole="button">
                          <Text style={styles.smallGhostText}>Decline</Text>
                        </Pressable>
                        <Pressable
                          style={styles.smallPrimary}
                          disabled={busy}
                          onPress={() => void act(() => respondForestRequest(id, p.user_id, true), 'Could not approve')}
                          accessibilityRole="button">
                          <Text style={styles.smallPrimaryText}>Approve</Text>
                        </Pressable>
                      </View>
                    ))}
                  </>
                ) : null}

                {/* ── campfires: the funnel ── */}
                <SpaceSection>CAMPFIRES IN THIS FOREST</SpaceSection>
                {(forest.campfires ?? []).length === 0 ? (
                  <Text style={styles.quiet}>No campfires yet. Start the first — that’s where challenges and dares run.</Text>
                ) : (
                  (forest.campfires ?? []).map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.row}
                      onPress={() => void openCampfire(c)}
                      disabled={busy || (!c.is_member && !c.join_code && c.privacy !== 'gated')}
                      accessibilityRole="button"
                      accessibilityLabel={c.name}>
                      {c.emoji ? (
                        <Text style={styles.campfireEmoji}>{c.emoji}</Text>
                      ) : (
                        <Icon name="campfire" size={22} color={Colors.navEmber} />
                      )}
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {c.member_count} {c.member_count === 1 ? 'member' : 'members'}
                          {c.privacy === 'gated' ? ' · ask to join' : c.privacy === 'private' ? ' · invite only' : ''}
                        </Text>
                      </View>
                      {c.is_member ? (
                        <Text style={styles.inText}>You’re in</Text>
                      ) : c.join_code ? (
                        <View style={styles.codeChip}>
                          <Text style={styles.codeText}>{c.join_code}</Text>
                        </View>
                      ) : c.privacy === 'gated' ? (
                        <Text style={styles.inText}>Request</Text>
                      ) : null}
                    </Pressable>
                  ))
                )}
                {isMember ? (
                  <Pressable style={styles.addRow} onPress={() => setCampfireOpen(true)} accessibilityRole="button">
                    <UiGlyph name="add" size={14} color={Colors.navEmber2} />
                    <Text style={styles.addText}>Start a campfire in this forest</Text>
                  </Pressable>
                ) : null}

                {/* ── feed ── */}
                <SpaceSection>FOREST FEED</SpaceSection>
                {isMember ? (
                  <Pressable style={styles.composer} onPress={compose} accessibilityRole="button" accessibilityLabel="Post to this forest">
                    <ForestAvatar name={profile?.display_name ?? ''} url={profile?.avatar_url ?? null} size={28} />
                    <Text style={styles.composerHint}>Drop your grind here…</Text>
                    <UiGlyph name="edit" size={16} color={Colors.navEmber2} />
                  </Pressable>
                ) : null}
                {feed.length === 0 ? (
                  <Text style={styles.quiet}>{isMember ? 'Nothing posted yet. Be the first.' : 'Join to post here.'}</Text>
                ) : (
                  feed.map((item) => (
                    <View key={item.id} style={styles.card}>
                      <AgoraCard
                        item={item}
                        loadout={loadouts[item.user_id] ?? {}}
                        onComment={setCommentsFor}
                        onMore={setPostFor}
                      />
                    </View>
                  ))
                )}
                {!feedDone && feed.length > 0 ? (
                  <Pressable style={styles.moreBtn} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button">
                    {loadingMore ? <ActivityIndicator color={Colors.spaceDim} /> : <Text style={styles.ghostText}>Load more</Text>}
                  </Pressable>
                ) : null}

                {/* ── members ── */}
                <SpaceSection>MEMBERS</SpaceSection>
                <View style={styles.members}>
                  {(forest.members ?? []).map((m) => (
                    <Pressable key={m.user_id} style={styles.member} onPress={() => tapMember(m)} accessibilityRole="button" accessibilityLabel={m.display_name}>
                      <ForestAvatar name={m.display_name} url={m.avatar_url} size={40} live={m.locked_in} />
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.display_name.split(' ')[0]}
                      </Text>
                      {m.role === 'owner' ? <Text style={styles.memberRole}>owner</Text> : null}
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {forest ? (
        <>
          <ForestSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={forest.name}>
            <SheetRow
              label="Report this forest"
              onPress={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
            />
            {forest.is_owner ? (
              <SheetRow
                label="Close this forest"
                danger
                onPress={() => {
                  setMenuOpen(false);
                  setCloseOpen(true);
                }}
              />
            ) : null}
            <SheetRow label="Cancel" onPress={() => setMenuOpen(false)} />
          </ForestSheet>

          <ForestReportSheet
            forestId={forest.id}
            visible={reportOpen}
            onClose={() => setReportOpen(false)}
            onReported={() => Alert.alert('Reported', 'Thanks — a person will look at this forest.')}
          />

          <ForestCampfireSheet
            forestId={forest.id}
            visible={campfireOpen}
            onClose={() => setCampfireOpen(false)}
            onCreated={(group) => {
              setCampfireOpen(false);
              router.push(`/group/${group.id}`);
            }}
          />
        </>
      ) : null}

      {/* A post's ⋯ — yours or the owner's gets Remove; someone else's gets report/block. */}
      <ForestSheet visible={postFor !== null} onClose={() => setPostFor(null)}>
        {postFor && (postMine || forest?.is_owner) ? (
          <SheetRow
            label={postMine ? 'Delete post' : 'Remove from forest'}
            danger
            onPress={() => {
              const item = postFor;
              setPostFor(null);
              void removePost(item);
            }}
          />
        ) : null}
        {postFor && !postMine ? (
          <>
            <SheetRow
              label="Report post"
              onPress={() => {
                const item = postFor;
                setPostFor(null);
                void reportPost(item);
              }}
            />
            <SheetRow
              label="Block user"
              danger
              onPress={() => {
                const item = postFor;
                setPostFor(null);
                void blockAuthor(item);
              }}
            />
          </>
        ) : null}
        <SheetRow label="Cancel" onPress={() => setPostFor(null)} />
      </ForestSheet>

      <ForestSheet visible={memberFor !== null} onClose={() => setMemberFor(null)} title={memberFor?.display_name}>
        <SheetRow
          label="View profile"
          onPress={() => {
            const m = memberFor;
            setMemberFor(null);
            if (m) openProfile(m.user_id);
          }}
        />
        <SheetRow
          label="Remove from forest"
          danger
          onPress={() => {
            setRemoveMemberFor(memberFor);
            setMemberFor(null);
          }}
        />
        <SheetRow label="Cancel" onPress={() => setMemberFor(null)} />
      </ForestSheet>

      <AgoraCommentsSheet
        item={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCountChange={(itemId, count) => setFeed((prev) => prev.map((i) => (i.id === itemId ? { ...i, comments: count } : i)))}
      />

      <ConfirmDialog
        visible={leaveOpen}
        title="Leave this forest?"
        body="You can rejoin any time. Campfires you’re in stay yours."
        confirmLabel="Leave"
        destructive={false}
        busy={busy}
        onCancel={() => setLeaveOpen(false)}
        onConfirm={() => void confirmLeave()}
      />
      <ConfirmDialog
        visible={closeOpen}
        title="Close this forest?"
        body="It disappears for everyone. Its campfires keep running on their own."
        confirmLabel="Close forest"
        busy={busy}
        onCancel={() => setCloseOpen(false)}
        onConfirm={() => void confirmClose()}
      />
      <ConfirmDialog
        visible={removeMemberFor !== null}
        title={`Remove ${removeMemberFor?.display_name ?? 'this member'}?`}
        body="They can’t rejoin, and their posts in this forest are removed."
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setRemoveMemberFor(null)}
        onConfirm={() => void confirmRemoveMember()}
      />
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loader: {
    marginTop: Spacing.six,
  },
  body: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  heroEmoji: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: 'rgba(255,122,47,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmojiText: {
    fontSize: 32,
  },
  name: {
    fontFamily: Fonts.black,
    fontSize: 22,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: Spacing.twelve,
  },
  purpose: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: 4,
  },
  presence: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  presenceLive: {
    color: Colors.navEmber2,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.two,
  },
  // Tags are secondary metadata — legend purple, the kit's secondary accent.
  tag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.legend,
  },
  ownerNote: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.gold,
    marginTop: Spacing.three,
  },
  heroBtn: {
    marginTop: Spacing.three,
    minWidth: 180,
  },
  // "Requested" — the secondary SpaceButton's shape, as a non-pressable label.
  ghostBtn: {
    marginTop: Spacing.three,
    minWidth: 180,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: Spacing.four,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  ghostText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  btnOff: {
    opacity: 0.6,
  },
  locked: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  quiet: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.spaceDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    padding: Spacing.twelve,
    marginBottom: Spacing.two,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  campfireEmoji: {
    fontSize: 22,
  },
  // The join code is the tap's payoff, so it carries the ember chip.
  codeChip: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderWidth: 1,
    borderColor: Colors.navEmber,
  },
  codeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1,
    color: Colors.navEmber2,
  },
  inText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.spaceLine,
    paddingVertical: Spacing.twelve,
  },
  addText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.navEmber2,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
    marginBottom: Spacing.twelve,
  },
  composerHint: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceFaint,
  },
  card: {
    marginBottom: Spacing.three,
  },
  moreBtn: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
  members: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.twelve,
  },
  member: {
    width: 56,
    alignItems: 'center',
  },
  memberName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.spaceDim,
    marginTop: 4,
    maxWidth: 56,
  },
  memberRole: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: Colors.gold,
  },
  smallGhost: {
    borderRadius: Radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  smallGhostText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ink,
  },
  smallPrimary: {
    borderRadius: Radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: Colors.navEmber,
  },
  smallPrimaryText: {
    fontFamily: Fonts.black,
    fontSize: 11.5,
    color: '#2A0F05',
  },
  emptyWrap: {
    alignItems: 'center',
    marginTop: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  emptyBtn: {
    alignSelf: 'stretch',
  },
});
