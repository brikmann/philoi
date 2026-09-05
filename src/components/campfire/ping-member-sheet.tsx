import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { pingCampfireMember } from '@/lib/api/campfire-ping';
import { getErrorMessage } from '@/lib/errors';
import type { CampfireMember, PingResult } from '@/types/database';

// PING A MEMBER · SILENT NUDGE (mock 101 frame 2, fourth row).
//
// THE ENTIRE POINT IS THAT IT POSTS NOTHING. A ping is a push notification to one person and no
// chat message at all — "get back in here", delivered privately. That is what makes it a different
// act from an @mention, which is a visible message aimed at someone in front of the whole fire.
// Both exist because both are things people actually do, and the mock is careful to label this one
// "· silent nudge" for exactly that reason.
//
// The sheet says so too, in the subtitle, because the failure mode is someone using this thinking
// it writes into the chat and then wondering why nobody replied.
//
// ONE-SHOT, WITH A CONFIRMED STATE. The row goes to a checkmark and stays there for the life of
// the sheet rather than re-arming, so a nudge cannot be sent five times by an impatient thumb. The
// server carries its own rate limit — see ping_campfire_member — because a client-side latch is a
// courtesy, not a control.

export function PingMemberSheet({
  visible,
  onClose,
  groupId,
  members,
  myUserId,
}: {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  members: CampfireMember[];
  myUserId: string;
}) {
  const insets = useSafeAreaInsets();
  const [busyId, setBusyId] = useState<string | null>(null);
  // 0172 · WHAT HAPPENED per member, not merely THAT something happened. This used to be a list of
  // ids and every one of them rendered "nudged" — including the two cases where nothing reached
  // anybody. See PingResult and migration 0172: the sender seeing a confirmation for a nudge that
  // was silently swallowed is the whole of "the ping does fuck all".
  const [results, setResults] = useState<Record<string, PingResult>>({});
  const [error, setError] = useState<string | null>(null);

  const others = members.filter((m) => m.user_id !== myUserId);

  async function ping(member: CampfireMember) {
    // 'rate_limited' is deliberately NOT latched: the ten-minute window passes, and re-arming the
    // row is what lets them try again once it has. Only a real send latches.
    if (busyId || results[member.user_id] === 'sent' || results[member.user_id] === 'sent_no_push') return;
    setBusyId(member.user_id);
    setError(null);
    try {
      const result = await pingCampfireMember(groupId, member.user_id);
      setResults((prev) => ({ ...prev, [member.user_id]: result }));
    } catch (e) {
      setError(getErrorMessage(e, 'That nudge did not go out.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grab} />

          <View style={styles.head}>
            <View style={styles.headIcon}>
              <PhiloiIcon name="bell" size={18} color={Colors.ember} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>Ping a member</Text>
              <Text style={styles.sub}>A silent nudge straight to their phone. Nothing is posted in the chat.</Text>
            </View>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {others.length === 0 ? (
              <Text style={styles.empty}>Nobody else is in this campfire yet. Invite someone first.</Text>
            ) : (
              others.map((m) => {
                const result = results[m.user_id];
                const latched = result === 'sent' || result === 'sent_no_push';
                return (
                  <Pressable
                    key={m.user_id}
                    style={styles.row}
                    onPress={() => ping(m)}
                    disabled={latched || busyId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={
                      latched ? `${m.display_name} nudged` : `Nudge ${m.display_name}`
                    }>
                    <View style={styles.avatar}>
                      {m.avatar_url ? (
                        <Image source={{ uri: m.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Text style={styles.avatarInitial}>{m.display_name.charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={styles.who}>
                      <Text style={styles.name}>{m.display_name}</Text>
                      {m.handle ? <Text style={styles.handle}>@{m.handle}</Text> : null}
                    </View>
                    {/* 0172 · three outcomes, three different things to say. "nudged" is now
                        reserved for a push that actually went to a device. */}
                    {busyId === m.user_id ? (
                      <ActivityIndicator size="small" color={Colors.amber} />
                    ) : result === 'sent' ? (
                      <Text style={styles.sentTag}>nudged</Text>
                    ) : result === 'sent_no_push' ? (
                      <Text style={styles.quietTag}>in their bell</Text>
                    ) : result === 'rate_limited' ? (
                      <Text style={styles.quietTag}>just nudged</Text>
                    ) : (
                      <View style={styles.nudge}>
                        <PhiloiIcon name="bell" size={16} color={Colors.ember} />
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
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
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ember,
  },
  who: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  nudge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  sentTag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.green,
  },
  // Not green and not red: nothing failed, but nothing buzzed either. "in their bell" (their phone
  // is silent, the notification is waiting in-app) and "just nudged" (you did this a minute ago)
  // are both honest half-successes, and calling either of them "nudged" is the bug 0172 fixes.
  quietTag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
  },
});
