import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AutoPostSyncedToggle } from '@/components/auto-post-synced-toggle';
import { DevTools } from '@/components/dev-tools';
import { CONTACT_EMAIL, FeedbackSheet } from '@/components/feedback-sheet';
import { RankVisibilityPicker } from '@/components/rank-visibility-picker';
import { ReminderSettings } from '@/components/reminder-settings';
import { Avatar } from '@/components/ui/avatar';
import { SettingsGlyph, type SettingsGlyphName } from '@/components/ui/glyphs-settings';
import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { Screen } from '@/components/ui/screen';
import { SpaceButton, SpaceCard, SpaceHeader, SpaceSection, SPACE_GUTTER } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { UiGlyph, type UiGlyphName } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useCindy } from '@/hooks/use-cindy';
import { useCoachMark } from '@/hooks/use-coach-mark';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { setPostToAgora } from '@/lib/api/agora';
import { setCoachConsent, setCoachPreference } from '@/lib/api/coach';
import { setDailyGoalMode, setPublishFlameCompletion } from '@/lib/api/daily-fire';
import { deleteMyAccount } from '@/lib/api/groups';
import { setMyWatchOptIn } from '@/lib/api/leaderboard-social';
import { track } from '@/lib/analytics';
import { resetCoachMarks } from '@/lib/coach-marks';
import { resetTutorial } from '@/lib/tutorial';
import { rankVisibilityOf, setRankVisibility } from '@/lib/api/privacy';
import { setLiveStatusPrefs, type LiveStatusPrefs } from '@/lib/api/presence';
import { setMyPhotoVisibility } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { revokeAppleSignInBestEffort } from '@/lib/auth/providers';
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
import type { PhotoVisibility, RankVisibility } from '@/types/database';

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

// A row icon from any of the three bespoke sets. Settings rows reach across all of them (the bell is
// a nav destination, the trash a control, the headphones a settings-only glyph), so the row takes a
// tagged name rather than three icon props.
type RowIcon = { nav: NavGlyphName } | { ui: UiGlyphName } | { set: SettingsGlyphName };

function RowGlyph({ icon, color }: { icon: RowIcon; color: string }) {
  if ('nav' in icon) return <NavGlyph name={icon.nav} size={18} color={color} />;
  if ('ui' in icon) return <UiGlyph name={icon.ui} size={18} color={color} />;
  return <SettingsGlyph name={icon.set} size={18} color={color} />;
}

// The two settings rows, drawn to SpaceRow's spec (panel, 1px line, 13 corners, a 36px glyph tile)
// but kept local for one reason: SpaceRow clamps its sub-line to two lines, and several of these
// descriptions ARE the setting — "Reciprocal — hide yours and you can't see theirs" cannot be the
// part that gets an ellipsis. Same look, untruncated copy, plus the inline value column (mock 16).
function RowShell({
  icon,
  label,
  description,
  danger,
  trailing,
}: {
  icon: RowIcon;
  label: string;
  description?: string;
  danger?: boolean;
  trailing: ReactNode;
}) {
  return (
    <>
      <View style={[styles.tile, danger && styles.tileDanger]}>
        <RowGlyph icon={icon} color={danger ? Colors.danger : Colors.navEmber2} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && styles.rowLabelDanger]}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      {trailing}
    </>
  );
}

function SettingsToggleRow({
  icon,
  label,
  description,
  value,
  onValueChange,
}: {
  icon: RowIcon;
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <RowShell
        icon={icon}
        label={label}
        description={description}
        trailing={<Toggle value={value} onValueChange={onValueChange} />}
      />
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
  icon: RowIcon;
  label: string;
  description?: string;
  value?: string;
  danger?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}>
      <RowShell
        icon={icon}
        label={label}
        description={description}
        danger={danger}
        trailing={
          <>
            {value ? <Text style={styles.rowValue}>{value}</Text> : null}
            {chevron ? <UiGlyph name="forward" size={14} color={Colors.spaceFaint} /> : null}
          </>
        }
      />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const settingsCoachRef = useCoachMark('settings');
  const router = useRouter();
  const { session, profile, signOut, refreshProfile } = useAuth();
  const { groups } = useMyGroups();
  const { devOverride, setDevOverride } = useEntitlement();
  const { connected: deviceFitnessConnected } = useFitnessConnection();
  const { connected: stravaConnected } = useStravaConnection();
  const anyFitnessSourceConnected = deviceFitnessConnected || stravaConnected;
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
  // 0273 · the sticky default the lock-in done screen's "Post to the Agora" switch starts from.
  const [postToAgora, setPostToAgoraState] = useState(profile?.post_to_agora ?? false);
  const [watchOptIn, setWatchOptInState] = useState(profile?.watch_opt_in ?? false);
  // 0217 · the season rank dial (0170's Private mode became its middle setting, 'friends').
  const [rankVisibility, setRankVisibilityState] = useState<RankVisibility>(rankVisibilityOf(profile));
  // 0245 · live status. Absent columns (a database older than this build) read as the default, on.
  const [livePrefs, setLivePrefsState] = useState<Required<LiveStatusPrefs>>({
    show_live_status: profile?.show_live_status ?? true,
    show_live_activity: profile?.show_live_activity ?? true,
    show_last_active: profile?.show_last_active ?? true,
  });
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

  // Refreshes the profile on success so the done screen opens on the new default without a relaunch.
  function handleTogglePostToAgora(value: boolean) {
    setPostToAgoraState(value);
    setPostToAgora(value)
      .then(() => refreshProfile?.())
      .catch(() => setPostToAgoraState(!value));
  }

  function handleToggleWatchOptIn(value: boolean) {
    setWatchOptInState(value);
    setMyWatchOptIn(value).catch(() => setWatchOptInState(!value));
  }

  // 0217 · optimistic, with a rollback on failure — the same shape every other toggle here uses.
  // Rolling back matters more than usual for this one: a dial that stays on Private after the write
  // failed tells someone they are hidden when they are still on every board in the app.
  function handleChangeRankVisibility(next: RankVisibility) {
    const prev = rankVisibility;
    setRankVisibilityState(next);
    setRankVisibility(next)
      .then(() => refreshProfile?.())
      .catch(() => setRankVisibilityState(prev));
  }

  // 0245 · optimistic with rollback, like the rank dial: a switch left showing "off" after a failed
  // write would tell someone they are hidden while their badge is still lit for their whole campus.
  function handleChangeLivePref(key: keyof LiveStatusPrefs, value: boolean) {
    if (!session?.user.id) return;
    const prev = livePrefs;
    setLivePrefsState({ ...prev, [key]: value });
    setLiveStatusPrefs(session.user.id, { [key]: value })
      .then(() => refreshProfile?.())
      .catch(() => setLivePrefsState(prev));
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

  // Plain sign-out keeps the welcome-back hint so coming back is one tap; this one drops it too,
  // for a shared or borrowed phone. Same no-confirm reasoning as above.
  function handleSignOutAndForget() {
    signOut({ forget: true });
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
      // Apple accounts only: revoke the Sign in with Apple grant first (5.1.1(v)), while this user
      // still exists to authenticate the call. Never throws — a failure here can't block deletion.
      await revokeAppleSignInBestEffort(session?.user);
      await deleteMyAccount();
      setDeleteModalOpen(false);
      // Forget too — never greet a deleted account on the next sign-in screen.
      await signOut({ forget: true });
    } catch (e) {
      Alert.alert('Could not delete account', getErrorMessage(e, 'Try again or contact support@philoi.app.'));
    } finally {
      setDeletingAccount(false);
    }
  }

  const deleteArmed = deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD;
  const displayName = profile?.display_name ?? 'Your profile';

  return (
    // Top edge only: the global footer sits under every screen and owns the bottom inset itself.
    <Screen padded={false} edges={['top']}>
      <SpaceHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Identity first (mock 16) — the screen should open by telling you whose settings these
            are, and the most common reason anyone lands here is to change their own details. */}
        <SpaceCard
          tone="gold"
          style={styles.identity}
          onPress={() => router.push('/edit-profile')}
          accessibilityLabel={`${displayName}, edit profile`}>
          <Avatar label={displayName} size={44} />
          <View style={styles.rowText}>
            <Text style={styles.identityName}>{displayName}</Text>
            <Text style={styles.identityHandle}>
              {profile?.handle ? `@${profile.handle} · edit profile` : 'Edit profile'}
            </Text>
          </View>
          <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
        </SpaceCard>

        <SpaceSection>Notifications</SpaceSection>
        {/* First visit to Settings (CODE_PROMPT_coach_marks.md). The tour's Settings card names two
            must-dos — notifications on, apps connected — and this is the first of them; the ref sits
            on the existing group View, so there is no extra layout node in the list. */}
        <View ref={settingsCoachRef} collapsable={false} style={styles.group}>
          <SettingsRow
            icon={{ nav: 'bell' }}
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
        <SpaceSection>Focus</SpaceSection>
        <View style={styles.group}>
          <SettingsRow
            icon={{ set: 'shield' }}
            label="Focus Nudge"
            description="A warm pull back when you drift mid-lock-in — never a block"
            onPress={() => router.push('/focus-nudge')}
          />
        </View>

        {/* AUDIO — mock 164 panel 1. The session-audio switch is the one that matters: the ambient
            loop plays over your own music, and at the gym that made the app unusable rather than
            merely annoying (COSMETIC_UI_FIXES §6). */}
        <SpaceSection>Audio</SpaceSection>
        <View style={styles.group}>
          <SettingsToggleRow
            icon={{ set: 'music' }}
            label="Session audio"
            description="Play your equipped ambient during lock-ins"
            value={sessionAudioEnabled}
            onValueChange={handleToggleSessionAudio}
          />
          <SettingsToggleRow
            icon={{ set: 'speaker' }}
            label="Reward & SFX stings"
            description="Box opens, rank-ups, lock-in start and stop"
            value={rewardSfxEnabled}
            onValueChange={handleToggleRewardSfx}
          />
          <SettingsToggleRow
            icon={{ set: 'headphones' }}
            label="Duck to my music"
            description="Lower the ambient when your music is playing, instead of stopping it"
            value={duckToMusic}
            onValueChange={handleToggleDuckToMusic}
          />
          <SettingsToggleRow
            icon={{ set: 'phone' }}
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
        <SpaceSection>Lock-in screen</SpaceSection>
        <View style={styles.group}>
          <SettingsToggleRow
            icon={{ set: 'sun' }}
            label="Keep screen awake"
            description="Hold the display on during a session — a sleeping screen kills the flare and the music"
            value={keepScreenAwake}
            onValueChange={handleToggleKeepScreenAwake}
          />
        </View>
        <Text style={styles.sectionHint}>
          When a lock-in ends, the screen goes back to your normal auto-lock.
        </Text>

        <SpaceSection>Daily fire</SpaceSection>
        <View style={styles.group}>
          <SettingsRow
            icon={{ nav: 'flame' }}
            label="Goal mode"
            value={goalMode === 'auto' ? 'Adaptive' : 'Manual'}
            chevron={false}
            onPress={handleToggleGoalMode}
          />
          {goalMode === 'manual' && (
            <View style={styles.row}>
              <RowShell
                icon={{ set: 'sliders' }}
                label="Daily target"
                trailing={
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => handleAdjustManualTarget(-1)}
                      hitSlop={8}
                      style={styles.stepperBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Lower daily target">
                      <SettingsGlyph name="minus" size={14} color={Colors.ink} />
                    </Pressable>
                    <Text style={styles.stepperValue}>{manualTarget}</Text>
                    <Pressable
                      onPress={() => handleAdjustManualTarget(1)}
                      hitSlop={8}
                      style={styles.stepperBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Raise daily target">
                      <UiGlyph name="add" size={14} color={Colors.ink} />
                    </Pressable>
                  </View>
                }
              />
            </View>
          )}
          <SettingsToggleRow
            icon={{ ui: 'send' }}
            label="Publish completion to campfires"
            value={publishCompletion}
            onValueChange={handleTogglePublishCompletion}
          />
          <SettingsToggleRow
            icon={{ set: 'megaphone' }}
            label="Auto-post my sessions to the Agora"
            description="Finished lock-ins post with their photos, friends only. Change it per session on the done screen."
            value={postToAgora}
            onValueChange={handleTogglePostToAgora}
          />
        </View>

        <SpaceSection>Privacy</SpaceSection>
        <View style={styles.group}>
          <SettingsRow
            icon={{ set: 'image' }}
            label="Who can see my photos"
            value={PHOTO_VISIBILITY_LABEL[photoVisibility]}
            chevron={false}
            onPress={() => setPhotoModalOpen(true)}
          />
          <SettingsToggleRow
            icon={{ set: 'eye' }}
            label="Let friends watch my live challenges"
            value={watchOptIn}
            onValueChange={handleToggleWatchOptIn}
          />
          <SettingsRow icon={{ set: 'ban' }} label="Blocked users" onPress={() => router.push('/blocked-users')} />
        </View>

        {/* LIVE STATUS (mock 273, migration 0245). Every gate is server-side in get_presence, so
            these writes take effect on the next read anyone makes — "hides you instantly" is true
            to within one board refresh. */}
        <SpaceSection>Live status</SpaceSection>
        <View style={styles.group}>
          <SettingsToggleRow
            icon={{ nav: 'flame' }}
            label="Show when I'm locked in or online"
            description="A live badge under your name — “Locked in” while in a session, or “Online now” when the app's open. Visible across your verified campus."
            value={livePrefs.show_live_status}
            onValueChange={(v) => handleChangeLivePref('show_live_status', v)}
          />
          <SettingsToggleRow
            icon={{ nav: 'book' }}
            label="Show what I'm locked in on"
            description="Adds the discipline — STUDY · LIFTING · CARDIO · DEEP WORK. Off = just “Locked in”."
            value={livePrefs.show_live_activity}
            onValueChange={(v) => handleChangeLivePref('show_live_activity', v)}
          />
          <SettingsToggleRow
            icon={{ set: 'clock' }}
            label="Show “last active” to friends"
            description="Lets friends see when you were last on (“Active 12m ago”). Reciprocal — hide yours and you can't see theirs. Friends only."
            value={livePrefs.show_last_active}
            onValueChange={(v) => handleChangeLivePref('show_last_active', v)}
          />
        </View>
        <Text style={styles.sectionHint}>
          Turns off instantly. Clears the moment your lock-in ends, and auto-expires if a session runs stale.
        </Text>

        {/* SEASON RANK (CODE_PROMPT_season_privacy.md, migration 0217) — the three-way dial that
            grew out of 0170's Private mode. The same control onboarding shows, writing through the
            same RPC, so the two never disagree. It is its own card rather than a row in PRIVACY
            because it needs its copy on screen: who sees me, what do I see, and that rewards are
            identical in all three. */}
        <SpaceSection>Rank visibility</SpaceSection>
        <SpaceCard>
          <RankVisibilityPicker value={rankVisibility} onChange={handleChangeRankVisibility} />
        </SpaceCard>

        {/* "Replay tutorial & tips" (CODE_PROMPT_tutorial.md + CODE_PROMPT_coach_marks.md). Clears
            the flag and navigates; the root layout re-reads it on every navigation, so the tour
            opens on the next frame rather than needing its own route push here — one gate decides
            when the tutorial runs, not two.

            🔴 ONE CONTROL RESETS BOTH HALVES OF THE TUTORIAL. The card tour and the seven coach-
            marks are the same feature wearing two shapes, and a Settings screen with "Replay
            tutorial" next to a separate "Reset tips" would be asking the user to know that. It is
            also the demo button: Noah re-runs the whole first-run experience from here.

            🔴 BOTH RESETS ARE AWAITED BEFORE NAVIGATING, and that ordering is the whole reason
            this control works (CODE_PROMPT_tutorial_lands.md). `resetCoachMarks` clears the guided
            tour's done-flag and its in-memory "already ran this session" latch; navigate before
            those have landed and the driver re-reads a stale `true` on arrival and does nothing —
            a Replay button whose effect only appears after a cold start, which is exactly the
            failure being fixed. Neither reset can reject; both swallow their own storage faults. */}
        <View style={[styles.group, styles.groupSpaced]}>
          <SettingsRow
            icon={{ set: 'play' }}
            label="Replay tutorial & tips"
            onPress={() => {
              track('coach_marks_reset', {});
              void (async () => {
                await resetCoachMarks();
                await resetTutorial(session?.user?.id ?? null).catch(() => {});
                // The root layout re-reads the tutorial flag on every navigation, so the card tour
                // opens on the next frame and the guided tour follows it onto Home — one gate
                // decides when the tutorial runs, not two.
                router.replace('/');
              })();
            }}
          />
        </View>

        {/* Height + weight (design-mocks/188). Filed under CONNECTIONS rather than PRIVACY because
            it belongs with the other things that make tracking accurate — and because listing a
            bodyweight under "Privacy" would frame it as something to be defended rather than
            something the user is choosing to tell us. The row says what it is FOR: it is the only
            honest answer to "why does a study app know my weight". */}
        <SpaceSection>Connections</SpaceSection>
        <View style={styles.group}>
          <SettingsRow
            icon={{ set: 'ruler' }}
            label="Height & weight"
            description="Turns steps into kilometres, and lets Cindy score a lift against your own bodyweight. Private, and never used to hand out rewards."
            onPress={() => router.push('/body-metrics')}
          />
          <SettingsRow icon={{ set: 'heart' }} label="Fitness trackers" onPress={() => router.push('/fitness-trackers')} />
          <SettingsRow icon={{ set: 'link' }} label="Integrations" onPress={() => router.push('/connected-apps')} />
          {/* Campus verification state (UNI_VERIFICATION_SPEC.md §6) — the value column is the
              whole story: verified, or the reason it isn't. */}
          <SettingsRow
            icon={{ set: 'cap' }}
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
            <SpaceSection>Cindy</SpaceSection>
            <View style={styles.group}>
              <SettingsRow icon={{ set: 'chat' }} label="Talk to Cindy" onPress={() => router.push('/cindy')} />
              <SettingsToggleRow
                icon={{ nav: 'home' }}
                label="Her messages on Home"
                value={cindyBubbleOn}
                onValueChange={handleToggleCindyBubble}
              />
              <SettingsRow
                icon={{ set: 'power' }}
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
            <SpaceSection>Reminders</SpaceSection>
            <SpaceCard style={styles.listCard}>
              {groups.map((group) => (
                <ReminderSettings key={group.id} groupId={group.id} groupName={group.name} groupEmoji={group.emoji} />
              ))}
            </SpaceCard>
          </>
        )}

        {/* Auto-post synced workouts (§17b) — only shown with something connected to actually
            sync from; a lock-in's campfire is opt-in per fire, never posted without consent. */}
        {groups.length > 0 && anyFitnessSourceConnected && (
          <>
            <SpaceSection>Auto-post synced workouts</SpaceSection>
            <Text style={[styles.sectionHint, styles.sectionHintAbove]}>
              When a synced workout becomes a lock-in, post it automatically to the campfires you turn on below.
            </Text>
            <SpaceCard style={styles.listCard}>
              {groups.map((group) => (
                <AutoPostSyncedToggle
                  key={group.id}
                  groupId={group.id}
                  groupName={group.name}
                  groupEmoji={group.emoji}
                  initialEnabled={group.auto_post_synced}
                />
              ))}
            </SpaceCard>
          </>
        )}

        {/* HELP & FEEDBACK (FEATURE_feedback_and_domain.md §1). "Talk to someone" is the support
            surface, kept in the same group but LAST — reaching a human about the app and reaching
            a human about yourself are different errands, and the wellbeing one shouldn't be the
            first thing a bug report walks past. */}
        <SpaceSection>Help & feedback</SpaceSection>
        <View style={styles.group}>
          <SettingsRow
            icon={{ ui: 'edit' }}
            label="Send feedback"
            description="Bug report, feature request, or anything else"
            chevron={false}
            onPress={() => setFeedbackOpen(true)}
          />
          <SettingsRow
            icon={{ set: 'mail' }}
            label="Email us"
            value={CONTACT_EMAIL}
            chevron={false}
            onPress={handleEmailUs}
          />
          <SettingsRow
            icon={{ set: 'heart' }}
            label="Talk to someone"
            description="Support if things feel heavy"
            onPress={() => router.push('/support')}
          />
        </View>

        <SpaceSection>Legal</SpaceSection>
        <View style={styles.group}>
          <SettingsRow
            icon={{ set: 'doc' }}
            label="Privacy Policy"
            onPress={() => Linking.openURL('https://philoi.app/privacy.html')}
          />
          <SettingsRow
            icon={{ set: 'doc' }}
            label="Terms of Service"
            onPress={() => Linking.openURL('https://philoi.app/terms.html')}
          />
          <SettingsRow
            icon={{ set: 'shield' }}
            label="Child Safety Standards"
            onPress={() => Linking.openURL('https://philoi.app/child-safety.html')}
          />
        </View>

        <SpaceSection>Purchases</SpaceSection>
        <View style={styles.group}>
          {/* Apple REQUIRES this to be reachable for any app selling a non-consumable, and Settings
              is where users look for it. The paywall carries a second copy. */}
          <SettingsRow icon={{ ui: 'refresh' }} label="Restore purchases" chevron={false} onPress={handleRestore} />
        </View>

        <SpaceSection>Account</SpaceSection>
        <View style={styles.group}>
          <SettingsRow icon={{ set: 'logout' }} label="Sign out" chevron={false} onPress={handleSignOut} />
          <SettingsRow
            icon={{ set: 'person-x' }}
            label="Sign out & forget this device"
            description="Next time, sign in from scratch instead of “Welcome back”."
            chevron={false}
            onPress={handleSignOutAndForget}
          />
          <SettingsRow
            icon={{ ui: 'trash' }}
            label="Delete account"
            danger
            chevron={false}
            onPress={() => {
              setDeleteConfirmText('');
              setDeleteModalOpen(true);
            }}
          />
        </View>

        <DevTools
          devOverride={devOverride}
          setDevOverride={setDevOverride}
          groups={groups}
          isDev={Boolean(profile?.is_dev)}
        />
      </ScrollView>

      <FeedbackSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* Who can see my photos — 3-way single-select (§19). Mock 16 shows the value inline, so
          the row stays chevron-less and taps open this sheet. */}
      <Modal visible={photoModalOpen} transparent animationType="fade" onRequestClose={() => setPhotoModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPhotoModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
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
                  onPress={() => handleSelectPhotoVisibility(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}>
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{PHOTO_VISIBILITY_LABEL[option.value]}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                  {selected && (
                    <View style={styles.optionCheck}>
                      <UiGlyph name="check" size={14} color="#2A0F05" />
                    </View>
                  )}
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
            <View style={styles.sheetGrabber} />
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
            <SpaceButton
              variant="danger"
              label={deletingAccount ? 'Deleting…' : 'Permanently delete my account'}
              disabled={!deleteArmed || deletingAccount}
              onPress={handleConfirmDelete}
              style={styles.deleteButton}
            />
            <SpaceButton
              variant="ghost"
              label="Cancel"
              disabled={deletingAccount}
              onPress={() => setDeleteModalOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
  },
  identityName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  identityHandle: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.gold,
    marginTop: 2,
  },
  sectionHint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.spaceDim,
    marginTop: Spacing.two,
    marginLeft: 2,
  },
  // The one hint that introduces its list rather than footnoting it.
  sectionHintAbove: {
    marginTop: 0,
    marginBottom: Spacing.two,
  },
  // A group is a stack of standalone rows (the SpaceRow treatment), not one card with dividers.
  group: {
    gap: 6,
  },
  // Replay sits in no section of its own — give it the same air a section label would.
  groupSpaced: {
    marginTop: Spacing.four,
  },
  // The per-campfire lists (reminders, auto-post) are rows drawn by their own components.
  listCard: {
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDanger: {
    backgroundColor: Colors.dangerBg,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowDescription: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.spaceDim,
  },
  rowLabelDanger: {
    color: Colors.danger,
  },
  rowValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
    flexShrink: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: Colors.navEmber2,
    minWidth: 18,
    textAlign: 'center',
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
    padding: Spacing.four,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.spaceLine,
    marginBottom: Spacing.two,
  },
  sheetTitle: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
  },
  sheetSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
    marginBottom: Spacing.two,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  optionRowSelected: {
    backgroundColor: 'rgba(255,122,47,0.10)',
    borderColor: Colors.navEmber,
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
    color: Colors.spaceDim,
    marginTop: 2,
  },
  optionCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmPrompt: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
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
  },
});
