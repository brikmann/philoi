import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchCampfirePreview, joinPublicGroup, requestToJoinGroup } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { CampfirePreview } from '@/types/database';

type CampfirePreviewSheetProps = {
  groupId: string | null;
  onClose: () => void;
};

// The valley's "tap a fire" sheet (PHILOI_UI_SPEC.md §10) — never an instant join. CTA is
// privacy-state-aware: Open joins immediately, Gated only requests (owner approves), Mine
// just opens the interior. Built as the same transparent-Modal bottom sheet pattern as
// lockin-goal-picker.tsx/campfire-options-sheet.tsx.
export function CampfirePreviewSheet({ groupId, onClose }: CampfirePreviewSheetProps) {
  const router = useRouter();
  const [preview, setPreview] = useState<CampfirePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!groupId) {
      setPreview(null);
      setError(null);
      setRequested(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchCampfirePreview(groupId)
      .then((p) => {
        setPreview(p);
        setRequested(p.has_pending_request);
      })
      .catch((e) => setError(getErrorMessage(e, 'Could not load this campfire.')))
      .finally(() => setLoading(false));
  }, [groupId]);

  function openInterior() {
    if (!groupId) return;
    onClose();
    router.push(`/group/${groupId}`);
  }

  async function handleJoin() {
    if (!groupId) return;
    setBusy(true);
    try {
      await joinPublicGroup(groupId);
      openInterior();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not join that campfire.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRequest() {
    if (!groupId) return;
    setBusy(true);
    try {
      await requestToJoinGroup(groupId);
      setRequested(true);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not send that request.'));
    } finally {
      setBusy(false);
    }
  }

  const isGated = preview?.privacy === 'gated' && !preview.is_member;

  return (
    <Modal visible={groupId !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.sheet}>
          <View style={styles.grab} />

          {loading && <Text style={styles.loading}>Loading…</Text>}

          {preview && !loading && (
            <>
              <View style={styles.header}>
                <View style={styles.flameTile}>
                  <Ionicons name="flame" size={20} color={Colors.amber} />
                </View>
                <View style={styles.headerInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {preview.name}
                    </Text>
                    {isGated && <Ionicons name="lock-closed" size={13} color={Colors.textTertiary} />}
                  </View>
                  <Text style={styles.sub}>
                    {preview.member_count} {preview.member_count === 1 ? 'member' : 'members'}
                  </Text>
                </View>
              </View>

              {preview.active_lock_in_count > 0 && (
                <Text style={styles.presence}>
                  {preview.active_lock_in_count} locked in now
                </Text>
              )}

              {preview.member_names.length > 0 && (
                <View style={styles.avatarRow}>
                  {preview.member_names.slice(0, 6).map((name, i) => (
                    <Avatar key={`${name}-${i}`} label={name} size={30} overlap={i > 0} />
                  ))}
                  {preview.member_count > 6 && (
                    <View style={styles.avatarOverflow}>
                      <Text style={styles.avatarOverflowLabel}>+{preview.member_count - 6}</Text>
                    </View>
                  )}
                </View>
              )}

              {preview.recent_photo_urls.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
                  {preview.recent_photo_urls.map((url) => (
                    <Image key={url} source={{ uri: url }} style={styles.photo} />
                  ))}
                </ScrollView>
              )}

              {isGated && <Text style={styles.gatedNote}>The owner approves new members.</Text>}
              {error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.cta}>
                {preview.is_member ? (
                  <PrimaryButton label={`Open ${preview.name}`} onPress={openInterior} />
                ) : isGated ? (
                  <PrimaryButton
                    label={requested ? 'Request sent' : 'Request to join'}
                    onPress={handleRequest}
                    disabled={requested}
                    loading={busy}
                    variant={requested ? 'cold' : 'primary'}
                  />
                ) : (
                  <PrimaryButton label={`Join ${preview.name}`} onPress={handleJoin} loading={busy} />
                )}
              </View>
            </>
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
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 22,
    minHeight: 160,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  loading: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  flameTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
    flexShrink: 1,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  presence: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.achieverText,
    marginTop: Spacing.three,
  },
  avatarRow: {
    flexDirection: 'row',
    marginTop: Spacing.three,
  },
  avatarOverflow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.disabled,
    borderWidth: 2,
    borderColor: Colors.card,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverflowLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  photoRow: {
    marginTop: Spacing.three,
  },
  photo: {
    width: 64,
    height: 64,
    borderRadius: 10,
    marginRight: Spacing.two,
    backgroundColor: Colors.disabled,
  },
  gatedNote: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
  cta: {
    marginTop: Spacing.four,
  },
});
