import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AutoPostSyncedToggle } from '@/components/auto-post-synced-toggle';
import { DevTools } from '@/components/dev-tools';
import { ReminderSettings } from '@/components/reminder-settings';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { useWhoopConnection } from '@/hooks/use-whoop-connection';
import { setDailyGoalMode, setPublishFlameCompletion } from '@/lib/api/daily-fire';
import { deleteMyAccount } from '@/lib/api/groups';
import { setMyWatchOptIn } from '@/lib/api/leaderboard-social';
import { setMyPhotoVisibility } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { getRewardPreferencesSync, setHapticsEnabled, setSoundEnabled } from '@/lib/reward-settings';
import type { PhotoVisibility } from '@/types/database';

const PHOTO_VISIBILITY_LABEL: Record<PhotoVisibility, string> = {
  campfires: 'My campfires',
  everyone: 'Everyone',
  private: 'Just me',
};

// Order + copy per PHILOI_UI_SPEC.md §19. 'campfires' is the default.
const PHOTO_VISIBILITY_OPTIONS: { value: PhotoVisibility; description: string }[] = [
  { value: 'campfires', description: 'People in campfires you share' },
  { value: 'everyone', description: 'Anyone on Philoi' },
  { value: 'private', description: 'A private journal only you can see' },
];

const DELETE_CONFIRM_WORD = 'DELETE';

function SettingsToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={Colors.amber} style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  danger,
  chevron = true,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  danger?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Ionicons name={icon} size={18} color={danger ? Colors.danger : Colors.amber} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { groups } = useMyGroups();
  const { devOverride, setDevOverride } = useEntitlement();
  const { connected: deviceFitnessConnected } = useFitnessConnection();
  const { connected: stravaConnected } = useStravaConnection();
  const { connected: whoopConnected } = useWhoopConnection();
  const anyFitnessSourceConnected = deviceFitnessConnected || stravaConnected || whoopConnected;
  const [photoVisibility, setPhotoVisibility] = useState<PhotoVisibility>(profile?.photo_visibility ?? 'campfires');
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [soundEnabled, setSoundEnabledState] = useState(() => getRewardPreferencesSync().sound);
  const [hapticsEnabled, setHapticsEnabledState] = useState(() => getRewardPreferencesSync().haptics);
  const [goalMode, setGoalMode] = useState<'auto' | 'manual'>(profile?.daily_goal_mode ?? 'auto');
  const [manualTarget, setManualTarget] = useState(profile?.daily_goal_manual_target ?? 1);
  const [publishCompletion, setPublishCompletion] = useState(profile?.publish_flame_completion ?? false);
  const [watchOptIn, setWatchOptInState] = useState(profile?.watch_opt_in ?? false);

  function handleToggleGoalMode() {
    const next = goalMode === 'auto' ? 'manual' : 'auto';
    setGoalMode(next);
    setDailyGoalMode(next, next === 'manual' ? manualTarget : undefined).catch(() => setGoalMode(goalMode));
  }

  function handleAdjustManualTarget(delta: number) {
    const next = Math.max(1, manualTarget + delta);
    setManualTarget(next);
    setDailyGoalMode('manual', next).catch(() => setManualTarget(manualTarget));
  }

  function handleTogglePublishCompletion(value: boolean) {
    setPublishCompletion(value);
    setPublishFlameCompletion(value).catch(() => setPublishCompletion(!value));
  }

  function handleToggleWatchOptIn(value: boolean) {
    setWatchOptInState(value);
    setMyWatchOptIn(value).catch(() => setWatchOptInState(!value));
  }

  function handleToggleSound(value: boolean) {
    setSoundEnabledState(value);
    setSoundEnabled(value);
  }

  function handleToggleHaptics(value: boolean) {
    setHapticsEnabledState(value);
    setHapticsEnabled(value);
  }

  function handleSelectPhotoVisibility(next: PhotoVisibility) {
    setPhotoModalOpen(false);
    if (next === photoVisibility) return;
    const previous = photoVisibility;
    setPhotoVisibility(next);
    setMyPhotoVisibility(next).catch(() => setPhotoVisibility(previous));
  }

  function handleSignOut() {
    Alert.alert('Sign out of Philoi?', 'Your campfires and progress stay saved — you can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  async function handleConfirmDelete() {
    setDeletingAccount(true);
    try {
      await deleteMyAccount();
      setDeleteModalOpen(false);
      await signOut();
    } catch (e) {
      Alert.alert('Could not delete account', getErrorMessage(e, 'Try again or contact support@getphiloi.com.'));
    } finally {
      setDeletingAccount(false);
    }
  }

  const deleteArmed = deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.sectionLabel}>PREFERENCES</Text>
        <View style={styles.group}>
          <SettingsToggleRow icon="volume-high" label="Sound effects" value={soundEnabled} onValueChange={handleToggleSound} />
          <SettingsToggleRow icon="phone-portrait" label="Haptics" value={hapticsEnabled} onValueChange={handleToggleHaptics} />
          <SettingsRow icon="notifications" label="Notifications" onPress={() => router.push('/settings-notifications')} />
          <SettingsRow
            icon="image"
            label="Who can see my photos"
            value={PHOTO_VISIBILITY_LABEL[photoVisibility]}
            chevron={false}
            onPress={() => setPhotoModalOpen(true)}
          />
          <SettingsToggleRow
            icon="eye"
            label="Let friends watch my live challenges"
            value={watchOptIn}
            onValueChange={handleToggleWatchOptIn}
          />
          <SettingsRow icon="fitness" label="Connected apps" onPress={() => router.push('/connected-apps')} />
          {/* Campus verification state (UNI_VERIFICATION_SPEC.md §6) — the value column is the
              whole story: verified, or the reason it isn't. */}
          <SettingsRow
            icon="school"
            label="Campus"
            value={
              profile?.university_email_verified
                ? 'Verified'
                : profile?.university
                  ? profile?.university_domain
                    ? 'Not verified'
                    : 'No domain'
                  : 'Not set'
            }
            onPress={() => router.push('/campus')}
          />
        </View>

        <Text style={styles.sectionLabel}>DAILY FIRE</Text>
        <View style={styles.group}>
          <Pressable style={styles.row} onPress={handleToggleGoalMode}>
            <Ionicons name="flame" size={18} color={Colors.amber} style={styles.rowIcon} />
            <Text style={styles.rowLabel}>Goal mode</Text>
            <Text style={styles.rowValue}>{goalMode === 'auto' ? 'Adaptive' : 'Manual'}</Text>
          </Pressable>
          {goalMode === 'manual' && (
            <View style={styles.row}>
              <Ionicons name="options" size={18} color={Colors.amber} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>Daily target</Text>
              <View style={styles.stepper}>
                <Pressable onPress={() => handleAdjustManualTarget(-1)} hitSlop={8} style={styles.stepperBtn}>
                  <Ionicons name="remove" size={14} color={Colors.ink} />
                </Pressable>
                <Text style={styles.stepperValue}>{manualTarget}</Text>
                <Pressable onPress={() => handleAdjustManualTarget(1)} hitSlop={8} style={styles.stepperBtn}>
                  <Ionicons name="add" size={14} color={Colors.ink} />
                </Pressable>
              </View>
            </View>
          )}
          <SettingsToggleRow
            icon="send"
            label="Publish completion to campfires"
            value={publishCompletion}
            onValueChange={handleTogglePublishCompletion}
          />
        </View>

        {groups.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>REMINDERS</Text>
            <View style={styles.reminderGroup}>
              {groups.map((group) => (
                <ReminderSettings key={group.id} groupId={group.id} groupName={group.name} groupEmoji={group.emoji} />
              ))}
            </View>
          </>
        )}

        {/* Auto-post synced workouts (§17b) — only shown with something connected to actually
            sync from; a lock-in's campfire is opt-in per fire, never posted without consent. */}
        {groups.length > 0 && anyFitnessSourceConnected && (
          <>
            <Text style={styles.sectionLabel}>AUTO-POST SYNCED WORKOUTS</Text>
            <Text style={styles.sectionHint}>
              When a synced workout becomes a lock-in, post it automatically to the campfires you turn on below.
            </Text>
            <View style={styles.reminderGroup}>
              {groups.map((group) => (
                <AutoPostSyncedToggle
                  key={group.id}
                  groupId={group.id}
                  groupName={group.name}
                  groupEmoji={group.emoji}
                  initialEnabled={group.auto_post_synced}
                />
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>LEGAL</Text>
        <View style={styles.group}>
          <SettingsRow icon="document-text-outline" label="Privacy Policy" onPress={() => Linking.openURL('https://getphiloi.com/privacy')} />
          <SettingsRow icon="reader-outline" label="Terms of Service" onPress={() => Linking.openURL('https://getphiloi.com/terms')} />
          <SettingsRow
            icon="shield-checkmark-outline"
            label="Child Safety Standards"
            onPress={() => Linking.openURL('https://getphiloi.com/child-safety')}
          />
        </View>

        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.group}>
          <SettingsRow icon="log-out" label="Sign out" chevron={false} onPress={handleSignOut} />
          <SettingsRow
            icon="trash"
            label="Delete account"
            danger
            chevron={false}
            onPress={() => {
              setDeleteConfirmText('');
              setDeleteModalOpen(true);
            }}
          />
        </View>

        <DevTools devOverride={devOverride} setDevOverride={setDevOverride} groups={groups} />
      </ScrollView>

      {/* Who can see my photos — 3-way single-select (§19). Mock 16 shows the value inline, so
          the row stays chevron-less and taps open this sheet. */}
      <Modal visible={photoModalOpen} transparent animationType="fade" onRequestClose={() => setPhotoModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPhotoModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Who can see my photos</Text>
            <Text style={styles.sheetSubtitle}>
              Applies to your profile grid and your photos shown around campfires.
            </Text>
            {PHOTO_VISIBILITY_OPTIONS.map((option) => {
              const selected = option.value === photoVisibility;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.optionRow, selected && styles.optionRowSelected]}
                  onPress={() => handleSelectPhotoVisibility(option.value)}>
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{PHOTO_VISIBILITY_LABEL[option.value]}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={22} color={Colors.coral} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete account — irreversible, so an explicit typed confirm (§19), never a single tap. */}
      <Modal visible={deleteModalOpen} transparent animationType="fade" onRequestClose={() => setDeleteModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !deletingAccount && setDeleteModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Delete account</Text>
            <Text style={styles.sheetSubtitle}>
              This permanently deletes your profile, all lock-ins, photos, streaks, XP and rank, and your
              campfire memberships. It can&apos;t be undone.
            </Text>
            <Text style={styles.confirmPrompt}>
              Type <Text style={styles.confirmWord}>{DELETE_CONFIRM_WORD}</Text> to confirm.
            </Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={DELETE_CONFIRM_WORD}
              editable={!deletingAccount}
              style={styles.confirmInput}
            />
            <Pressable
              style={[styles.deleteButton, (!deleteArmed || deletingAccount) && styles.deleteButtonDisabled]}
              disabled={!deleteArmed || deletingAccount}
              onPress={handleConfirmDelete}>
              <Text style={styles.deleteButtonText}>
                {deletingAccount ? 'Deleting…' : 'Permanently delete my account'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.cancelButton}
              disabled={deletingAccount}
              onPress={() => setDeleteModalOpen(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: Spacing.two,
    marginLeft: 2,
  },
  sectionHint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: -Spacing.one,
    marginBottom: Spacing.two,
    marginLeft: 2,
  },
  group: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    marginBottom: Spacing.four,
    overflow: 'hidden',
  },
  reminderGroup: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    marginBottom: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowIcon: {
    width: 22,
    textAlign: 'center',
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  rowLabelDanger: {
    color: Colors.danger,
  },
  rowValue: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepperBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    minWidth: 16,
    textAlign: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  sheetSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    marginBottom: Spacing.two,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
    backgroundColor: Colors.cardDark,
  },
  optionRowSelected: {
    backgroundColor: Colors.selectedBg,
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  optionDescription: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: 2,
  },
  confirmPrompt: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    marginTop: Spacing.two,
  },
  confirmWord: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  confirmInput: {
    marginTop: Spacing.two,
  },
  deleteButton: {
    marginTop: Spacing.three,
    backgroundColor: Colors.danger,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  deleteButtonDisabled: {
    opacity: 0.4,
  },
  deleteButtonText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  cancelButton: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
  },
});
