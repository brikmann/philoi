import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SpaceButton, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { disputePr } from '@/lib/api/stats';
import { getErrorMessage } from '@/lib/errors';
import { shortName } from '@/lib/format';
import type { MetricLeaderboardRow } from '@/types/house';

// Tap a PR on an exercise board (mock 295): what the ✓ means, and the community's one lever on it.
//
// There is NO watch button on the board. With no age gate, a public clip feed would broadcast
// minors' workout video, so a clip is never public: only the owner's friends and circle-mates can
// play it (gym-clip-playback-url), plus a moderator when somebody disputes the number. A dispute files a moderation report (0266); enough of them, or a failed
// review, pulls the PR off the board.
//
// The server rejects a second dispute of the same PR and a dispute of your own, with readable
// messages, so those are surfaced as-is rather than pre-empted here.

export function PrDisputeSheet({
  row,
  value,
  onClose,
  onPulled,
  onViewProfile,
}: {
  /** null hides the sheet. */
  row: MetricLeaderboardRow | null;
  /** The row's formatted value, "+45 lb". */
  value: string;
  onClose: () => void;
  /** The PR came off the board — refetch it. */
  onPulled: () => void;
  onViewProfile: (userId: string) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setNote('');
    onClose();
  };

  // Nothing to dispute: your own PR, or a row the board couldn't tie to a set.
  const canDispute = !!row && !row.is_me && !!row.pr_set_id;

  async function handleDispute() {
    if (!row?.pr_set_id || busy) return;
    setBusy(true);
    try {
      const result = await disputePr(row.pr_set_id, note.trim() || undefined);
      close();
      if (result.status === 'pulled') {
        onPulled();
        Alert.alert('PR pulled', 'Enough people flagged this one — it is off the board until a moderator clears it.');
      } else {
        Alert.alert('Sent to a moderator', 'They review the clip. A failed review pulls the PR.');
      }
    } catch (e) {
      Alert.alert("Couldn't dispute", getErrorMessage(e, 'Could not send the dispute. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={row !== null} transparent animationType="fade" onRequestClose={close}>
      {/* The note field sits at the foot of the sheet — lift it over the keyboard. */}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {row ? (
            <>
              <Text style={styles.title}>
                {shortName(row.display_name)}&apos;s #{row.rank} · {value}
                {row.verified ? ' ✓' : ''}
              </Text>
              <Text style={styles.body}>
                {row.verified ? 'Clip on file — their connections can watch to verify; never public.' : 'No clip on file — this PR is unverified.'}{' '}
                Looks off? Dispute sends it to a moderator; a failed review pulls the PR.
              </Text>
              {canDispute ? (
                <>
                  <TextInput
                    style={styles.note}
                    value={note}
                    onChangeText={setNote}
                    placeholder="What looks off? (optional)"
                    placeholderTextColor={Colors.spaceFaint}
                    maxLength={280}
                    multiline
                  />
                  <SpaceButton label="⚑ Dispute this PR" variant="danger" onPress={handleDispute} loading={busy} />
                </>
              ) : null}
              <SpaceButton
                label="View profile"
                variant="ghost"
                onPress={() => {
                  const id = row.user_id;
                  close();
                  onViewProfile(id);
                }}
              />
            </>
          ) : null}
          <SpaceButton label="Close" variant="secondary" onPress={close} />
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.spaceLine,
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
    gap: Spacing.twelve,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.spaceLine,
    marginTop: Spacing.two,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
  },
  note: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.twelve,
    minHeight: 56,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
    textAlignVertical: 'top',
    letterSpacing: 0,
  },
});
