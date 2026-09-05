import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AutoPostSyncedToggle } from '@/components/auto-post-synced-toggle';
import { DevTools } from '@/components/dev-tools';
import { CONTACT_EMAIL, FeedbackSheet } from '@/components/feedback-sheet';
import { ReminderSettings } from '@/components/reminder-settings';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCindy } from '@/hooks/use-cindy';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { useWhoopConnection } from '@/hooks/use-whoop-connection';
import { setCoachConsent, setCoachPreference } from '@/lib/api/coach';
import { setDailyGoalMode, setPublishFlameCompletion } from '@/lib/api/daily-fire';
import { deleteMyAccount } from '@/lib/api/groups';
import { setMyWatchOptIn } from '@/lib/api/leaderboard-social';
import { setLeaderboardPrivate } from '@/lib/api/privacy';
import { setMyPhotoVisibility } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { restorePurchases } from '@/lib/billing';
import { getErrorMessage } from '@/lib/errors';
import {
  getRewardPreferencesSync,
  setDuckToMusic,
  setHapticsEnabled,
  setKeepScreenAwake,
  setRewardSfxEnabled,
  setSessionAudioEnabled,
} from '@/lib/reward-settings';
import type { PhotoVisibility } from '@/types/database';

// Settings, reorganised (BUILD_SEQUENCE §2.6 · "settings cleanup").
//
// What changed and why: everything used to land in one 8-row PREFERENCES bucket — sound sat next
// to campus verification, which meant the list had no shape and you scanned all of it every time.
// The rows are now grouped by WHAT THEY AFFECT, in rough order of how often anyone touches them:
// notifications, then what the app does to your senses (Audio, Lock-in screen — mock 164 panel 1),
// then your daily fire, then privacy, then the things you connect, then the per-campfire lists,
// and finally the once-a-year rows (help, legal, purchases, account).

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
  description,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={Colors.amber} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  description,
  value,
  danger,
  chevron = true,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  value?: string;
  danger?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Ionicons name={icon} size={18} color={danger ? Colors.danger : Colors.amber} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && styles.rowLabelDanger]}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { profile, signOut, refreshProfile } = useAuth();
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // The device-local sense prefs (reward-settings). Seeded from the sync cache, which _layout
  // warms on boot, so these render at their real value on the first frame rather than flicking
  // from the default a moment later.
  const [rewardSfxEnabled, setRewardSfxEnabledState] = useState(() => getRewardPreferencesSync().reward_sfx_enabled);
  const [hapticsEnabled, setHapticsEnabledState] = useState(() => getRewardPreferencesSync().haptics);
  const [sessionAudioEnabled, setSessionAudioEnabledState] = useState(
    () => getRewardPreferencesSync().session_audio_enabled
  );
  const [keepScreenAwake, setKeepScreenAwakeState] = useState(() => getRewardPreferencesSync().keep_screen_awake);
  const [duckToMusic, setDuckToMusicState] = useState(() => getRewardPreferencesSync().duck_to_music);
  const [goalMode, setGoalMode] = useState<'auto' | 'manual'>(profile?.daily_goal_mode ?? 'auto');
  const [manualTarget, setManualTarget] = useState(profile?.daily_goal_manual_target ?? 1);
  const [publishCompletion, setPublishCompletion] = useState(profile?.publish_flame_completion ?? false);
  const [watchOptIn, setWatchOptInState] = useState(profile?.watch_opt_in ?? false);
  // 0170 · Private mode. Defaults false for a profile loaded by a build that predates the column.
  const [leaderboardPrivate, setLeaderboardPrivateState] = useState(profile?.leaderboard_private ?? false);
  const cindy = useCindy();
  const [cindyBubbleOverride, setCindyBubbleOverride] = useState<boolean | null>(null);
  // Optimistic on top of the fetched value: the toggle has to move on tap, but the hook refetches
  // on focus, so a local override that starts null lets the server value win once it arrives.
  const cindyBubbleOn = cindyBubbleOverride ?? cindy.bubbleEnabled;

  function handleToggleCindyBubble(value: boolean) {
    setCindyBubbleOverride(value);
    setCoachPreference({ home_bubble_enabled: value }).catch(() => setCindyBubbleOverride(!value));
  }

  function handleTurnCindyOff() {
    Alert.alert(
      'Turn Cindy off?',
      "She'll stop reading your data and your chat history with her will be deleted. You can turn her back on any time.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn her off',
          style: 'destructive',
          onPress: async () => {
            try {
              await setCoachConsent(false);
              cindy.refetch();
            } catch (e) {
              Alert.alert('Could not turn Cindy off', getErrorMessage(e, 'Try again.'));
            }
          },
        },
      ]
    );
  }

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

  // 0170 · optimistic, with a rollback on failure — the same shape every other toggle here uses.
  // Rolling back matters more than usual for this one: a switch that stays on after the write
  // failed tells someone they are hidden when they are still on every board in the app.
  function handleTogglePrivate(value: boolean) {
    setLeaderboardPrivateState(value);
    setLeaderboardPrivate(value)
      .then(() => refreshProfile?.())
      .catch(() => setLeaderboardPrivateState(!value));
  }

  // The sense prefs write to AsyncStorage through an in-memory cache that updates synchronously,
  // so there is nothing to roll back — the toggle and the behaviour change on the same frame and
  // the write is just durability.
  function handleToggleRewardSfx(value: boolean) {
    setRewardSfxEnabledState(value);
    setRewardSfxEnabled(value);
  }

  function handleToggleHaptics(value: boolean) {
    setHapticsEnabledState(value);
    setHapticsEnabled(value);
  }

  function handleToggleSessionAudio(value: boolean) {
    setSessionAudioEnabledState(value);
    setSessionAudioEnabled(value);
  }

  function handleToggleKeepScreenAwake(value: boolean) {
    setKeepScreenAwakeState(value);
    setKeepScreenAwake(value);
  }

  function handleToggleDuckToMusic(value: boolean) {
    setDuckToMusicState(value);
    setDuckToMusic(value);
  }

  function handleSelectPhotoVisibility(next: PhotoVisibility) {
    setPhotoModalOpen(false);
    if (next === photoVisibility) return;
    const previous = photoVisibility;
    setPhotoVisibility(next);
    setMyPhotoVisibility(next).catch(() => setPhotoVisibility(previous));
  }

  // No confirmation step (punchlist 6 §2) — signing out is cheap and fully reversible (nothing
  // is deleted; "Delete account" below is the destructive one and keeps its own confirm), so the
  // tap signs out directly and the auth gate lands them on the entry page.
  function handleSignOut() {
    signOut();
  }

  function handleEmailUs() {
    Linking.openURL(`mailto:${CONTACT_EMAIL}`).catch(() => {
      Alert.alert('No mail app found', `Email us at ${CONTACT_EMAIL} and we'll pick it up from there.`);
    });
  }

  // Restores the Flame Pass entitlement only. Ember packs are consumables — they were spent into a
  // balance the moment they were granted, so "restoring" one would mint the embers a second time.
  async function handleRestore() {
    try {
      const { restoredPass } = await restorePurchases();
      Alert.alert(
        restoredPass ? 'Restored' : 'Nothing to restore',
        restoredPass
          ? 'Your Flame Pass is back on this device.'
          : 'No previous Flame Pass purchase was found for this account. Ember packs are consumable and can’t be restored.'
      );
    } catch (e) {
      Alert.alert('Couldn’t restore', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function handleConfirmDelete() {
    setDeletingAccount(true);
    try {
      await deleteMyAccount();
      setDeleteModalOpen(false);
      await signOut();
    } catch (e) {
      Alert.alert('Could not delete account', getErrorMessage(e, 'Try again or contact nb@philoi.app.'));
    } finally {
      setDeletingAccount(false);
    }
  }

  const deleteArmed = deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD;
  const displayName = profile?.display_name ?? 'Your profile';

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Identity first (mock 16) — the screen should open by telling you whose settings these
            are, and the most common reason anyone lands here is to change their own details. */}
        <Pressable style={styles.identity} onPress={() => router.push('/edit-profile')}>
          <Avatar label={displayName} size={44} />
          <View style={styles.rowText}>
            <Text style={styles.identityName}>{displayName}</Text>
            <Text style={styles.identityHandle}>
              {profile?.handle ? `@${profile.handle} · edit profile` : 'Edit profile'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </Pressable>

        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.group}>
          <SettingsRow
            icon="notifications"
            label="Notifications"
            description="Categories, quiet hours and your daily reminder"
            onPress={() => router.push('/settings-notifications')}
          />
        </View>

        {/* FOCUS NUDGE (APP_BLOCKER_SPEC §A, mock 109 frame 1). Shown on every build, including
            ones without the extensions compiled in and on Android — the screen itself explains
            why it is unavailable there. A settings list that hides the row would leave the #1
            most-requested feature undiscoverable on exactly the devices most likely to be asking
            for it. */}
        <Text style={styles.sectionLabel}>FOCUS</Text>
        <View style={styles.group}>
          <SettingsRow
            icon="heart-circle-outline"
            label="Focus Nudge"
            description="A warm pull back when you drift mid-lock-in — never a block"
            onPress={() => router.push('/focus-nudge')}
          />
        </View>

        {/* AUDIO — mock 164 panel 1. The session-audio switch is the one that matters: the ambient
            loop plays over your own music, and at the gym that made the app unusable rather than
            merely annoying (COSMETIC_UI_FIXES §6). */}
        <Text style={styles.sectionLabel}>AUDIO</Text>
        <View style={styles.group}>
          <SettingsToggleRow
            icon="musical-notes"
            label="Session audio"
            description="Play your equipped ambient during lock-ins"
            value={sessionAudioEnabled}
            onValueChange={handleToggleSessionAudio}
          />
          <SettingsToggleRow
            icon="volume-high"
            label="Reward & SFX stings"
            description="Box opens, rank-ups, lock-in start and stop"
            value={rewardSfxEnabled}
            onValueChange={handleToggleRewardSfx}
          />
          <SettingsToggleRow
            icon="headset"
            label="Duck to my music"
            description="Lower the ambient when your music is playing, instead of stopping it"
            value={duckToMusic}
            onValueChange={handleToggleDuckToMusic}
          />
          <SettingsToggleRow
            icon="phone-portrait"
            label="Haptics"
            description="Buzz on rewards and rank-ups"
            value={hapticsEnabled}
            onValueChange={handleToggleHaptics}
          />
        </View>
        <Text style={styles.sectionHint}>
          Turn session audio off and Philoi stays quiet — your own music keeps playing.
        </Text>

        {/* LOCK-IN SCREEN — mock 164 panel 1, second block. Default on: a sleeping display stops
            the flare animations AND pauses the ambient loop, so a session left alone quietly dies
            (COSMETIC_UI_FIXES §7). */}
        <Text style={styles.sectionLabel}>LOCK-IN SCREEN</Text>
        <View style={styles.group}>
          <SettingsToggleRow
            icon="sunny"
            label="Keep screen awake"
            description="Hold the display on during a session — a sleeping screen kills the flare and the music"
            value={keepScreenAwake}
            onValueChange={handleToggleKeepScreenAwake}
          />
        </View>
        <Text style={styles.sectionHint}>
          When a lock-in ends, the screen goes back to your normal auto-lock.
        </Text>

        <Text style={styles.sectionLabel}>DAILY FIRE</Text>
        <View style={styles.group}>
          <Pressable style={styles.row} onPress={handleToggleGoalMode}>
            <FlameLogo size={18} />
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

        <Text style={styles.sectionLabel}>PRIVACY</Text>
        <View style={styles.group}>
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
          {/* PRIVATE MODE (CODE_PROMPT_leaderboard_private.md §4, migration 0170).
              Requested repeatedly and unprompted. The copy is the spec's, and it is written to
              answer the two questions someone asks before flipping it: who can still see me, and
              does it cost me anything. It does not — XP, ranks and streaks all keep accruing, and
              placement rewards are still paid on the real standings. Only the DISPLAY changes. */}
          <SettingsToggleRow
            icon="lock-closed"
            label="Private mode"
            description="Only your friends can see you. You won't appear on the leaderboard or in search, and non-friends see &ldquo;Rank muted&rdquo; on your profile. Climb at your own pace."
            value={leaderboardPrivate}
            onValueChange={handleTogglePrivate}
          />
        </View>

        <Text style={styles.sectionLabel}>CONNECTIONS</Text>
        <View style={styles.group}>
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

        {/* CINDY (CINDY_SPEC). Only shown once she's on — before that her entire on-ramp is the
            consent screen, and a dead toggle here would be a second, worse one. */}
        {cindy.consented && (
          <>
            <Text style={styles.sectionLabel}>CINDY</Text>
            <View style={styles.group}>
              <SettingsRow icon="chatbubbles" label="Talk to Cindy" onPress={() => router.push('/cindy')} />
              <SettingsToggleRow
                icon="chatbox-ellipses"
                label="Her messages on Home"
                value={cindyBubbleOn}
                onValueChange={handleToggleCindyBubble}
              />
              <SettingsRow
                icon="power"
                label="Turn Cindy off"
                chevron={false}
                onPress={handleTurnCindyOff}
              />
            </View>
            <Text style={styles.sectionHint}>
              Turning her off deletes your chat history with her and stops her reading your data.
            </Text>
          </>
        )}

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

        {/* HELP & FEEDBACK (FEATURE_feedback_and_domain.md §1). "Talk to someone" is the support
            surface, kept in the same group but LAST — reaching a human about the app and reaching
            a human about yourself are different errands, and the wellbeing one shouldn't be the
            first thing a bug report walks past. */}
        <Text style={styles.sectionLabel}>HELP & FEEDBACK</Text>
        <View style={styles.group}>
          <SettingsRow
            icon="chatbox-ellipses"
            label="Send feedback"
            description="Bug report, feature request, or anything else"
            chevron={false}
            onPress={() => setFeedbackOpen(true)}
          />
          <SettingsRow
            icon="mail"
            label="Email us"
            value={CONTACT_EMAIL}
            chevron={false}
            onPress={handleEmailUs}
          />
          <SettingsRow
            icon="heart"
            label="Talk to someone"
            description="Support if things feel heavy"
            onPress={() => router.push('/support')}
          />
        </View>

        <Text style={styles.sectionLabel}>LEGAL</Text>
        <View style={styles.group}>
          <SettingsRow icon="document-text-outline" label="Privacy Policy" onPress={() => Linking.openURL('https://philoi.app/privacy.html')} />
          <SettingsRow icon="reader-outline" label="Terms of Service" onPress={() => Linking.openURL('https://philoi.app/terms.html')} />
          <SettingsRow
            icon="shield-checkmark-outline"
            label="Child Safety Standards"
            onPress={() => Linking.openURL('https://philoi.app/child-safety.html')}
          />
        </View>

        <Text style={styles.sectionLabel}>PURCHASES</Text>
        <View style={styles.group}>
          {/* Apple REQUIRES this to be reachable for any app selling a non-consumable, and Settings
              is where users look for it. The paywall carries a second copy. */}
          <SettingsRow icon="refresh" label="Restore purchases" chevron={false} onPress={handleRestore} />
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

      <FeedbackSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginBottom: Spacing.four,
  },
  identityName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  identityHandle: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: 2,
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
  rowText: {
    flex: 1,
  },
  // Standalone label — still the flex spacer in the rows that have no rowText wrapper.
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  // The same label INSIDE rowText, which is already the flex spacer. No flex here: rowText is a
  // column, so a flexed child would stretch against the description below it.
  rowTitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  rowDescription: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
    marginTop: 2,
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
