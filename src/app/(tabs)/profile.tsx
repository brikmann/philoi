import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ChatMuteToggle } from '@/components/chat-mute-toggle';
import { DevTools } from '@/components/dev-tools';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { ReminderSettings } from '@/components/reminder-settings';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useAuth } from '@/lib/auth/auth-context';
import { deleteMyAccount, fetchUniversityMemberCount } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import { loadRewardPreferences, setHapticsEnabled, setSoundEnabled } from '@/lib/reward-settings';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { groups } = useMyGroups();
  const { isMember, devOverride, setDevOverride } = useEntitlement();
  const [universityCount, setUniversityCount] = useState<number | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [showPreviews, setShowPreviews] = useState(profile?.show_message_previews ?? false);

  useEffect(() => {
    loadRewardPreferences().then((prefs) => {
      setSoundEnabledState(prefs.sound);
      setHapticsEnabledState(prefs.haptics);
    });
  }, []);

  async function handleTogglePreviews(value: boolean) {
    setShowPreviews(value);
    try {
      await supabase.from('profiles').update({ show_message_previews: value }).eq('id', profile?.id ?? '');
    } catch {
      setShowPreviews(!value);
    }
  }

  function handleToggleSound(value: boolean) {
    setSoundEnabledState(value);
    setSoundEnabled(value);
  }

  function handleToggleHaptics(value: boolean) {
    setHapticsEnabledState(value);
    setHapticsEnabled(value);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This permanently deletes your profile, all your circles you own, check-ins, and photos. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete my account',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await deleteMyAccount();
              await signOut();
            } catch (e) {
              Alert.alert('Could not delete account', getErrorMessage(e, 'Try again or contact support@getphiloi.com.'));
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  }

  const totalActiveStreaks = groups.filter((g) => g.current_streak > 0).length;
  const longestStreak = groups.reduce((max, g) => Math.max(max, g.longest_streak), 0);

  useEffect(() => {
    if (profile?.university) {
      fetchUniversityMemberCount(profile.university).then(setUniversityCount);
    }
  }, [profile?.university]);

  if (!profile) return null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{profile.display_name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View>
          <Text style={styles.name}>{profile.display_name}</Text>
          <Text style={styles.handle}>@{profile.handle}</Text>
          {isMember && <Chip label="Philoi Member" tone="pro" />}
        </View>
      </View>

      <Pressable onPress={() => router.push('/edit-profile')}>
        <Text style={styles.editProfileLink}>Edit profile</Text>
      </Pressable>

      {profile.university && (
        <Pressable onPress={() => router.push('/university-leaderboard')}>
          <Text style={styles.universityLine}>
            📍 {profile.university}
            {universityCount !== null && universityCount > 1
              ? ` — ${universityCount} people here are on Philoi`
              : ''}
            {'  '}
            <Text style={styles.universityLink}>See leaderboard →</Text>
          </Text>
        </Pressable>
      )}

      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{totalActiveStreaks}</Text>
          <Text style={styles.statLabel}>{totalActiveStreaks === 1 ? 'active streak' : 'active streaks'}</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statValue}>{longestStreak}</Text>
          <Text style={styles.statLabel}>longest streak</Text>
        </Card>
      </View>

      {!isMember && (
        <Card style={styles.membershipCard}>
          <Text style={styles.membershipTitle}>Free during early access</Text>
          <Text style={styles.membershipBody}>
            Everything&apos;s unlocked while we build this out together — no ads, no catch.
          </Text>
          <SecondaryButton label="What's coming later" onPress={() => router.push('/paywall')} onDark />
        </Card>
      )}

      {groups.length > 0 && (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Reminders</Text>
          {groups.map((group) => (
            <ReminderSettings key={group.id} groupId={group.id} groupName={group.name} />
          ))}
        </Card>
      )}

      {groups.length > 0 && (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Chat notifications</Text>
          <View style={styles.devRow}>
            <Text style={styles.devLabel}>Show message previews on lock screen</Text>
            <Switch
              value={showPreviews}
              onValueChange={handleTogglePreviews}
              trackColor={{ true: Colors.coral, false: Colors.line }}
            />
          </View>
          {groups.map((group) => (
            <ChatMuteToggle key={group.id} groupId={group.id} initialMuted={group.chat_muted} />
          ))}
        </Card>
      )}

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Sound &amp; haptics</Text>
        <View style={styles.devRow}>
          <Text style={styles.devLabel}>Check-in sound</Text>
          <Switch
            value={soundEnabled}
            onValueChange={handleToggleSound}
            trackColor={{ true: Colors.coral, false: Colors.line }}
          />
        </View>
        <View style={styles.devRow}>
          <Text style={styles.devLabel}>Haptics</Text>
          <Switch
            value={hapticsEnabled}
            onValueChange={handleToggleHaptics}
            trackColor={{ true: Colors.coral, false: Colors.line }}
          />
        </View>
      </Card>

      <DevTools devOverride={devOverride} setDevOverride={setDevOverride} groups={groups} />

      <SecondaryButton label="Sign out" onPress={signOut} />

      {/* Legal links — required for store listing + Apple/Google review */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Pressable onPress={() => router.push('/legal?page=privacy')} style={styles.legalRow}>
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/legal?page=terms')} style={styles.legalRow}>
          <Text style={styles.legalLink}>Terms of Service</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/legal?page=child-safety')} style={styles.legalRow}>
          <Text style={styles.legalLink}>Child Safety Standards</Text>
        </Pressable>
      </Card>

      <Pressable onPress={handleDeleteAccount} disabled={deletingAccount}>
        <Text style={styles.deleteLink}>{deletingAccount ? 'Deleting…' : 'Delete account'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
    backgroundColor: Colors.cream,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarFallback: {
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: Colors.cream,
    fontFamily: Fonts.display,
    fontSize: 24,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    marginBottom: Spacing.one,
  },
  editProfileLink: {
    fontFamily: Fonts.bodyBold,
    color: Colors.coral,
    fontSize: 14,
  },
  universityLine: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  universityLink: {
    fontFamily: Fonts.bodyBold,
    color: Colors.coral,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.coral,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  membershipCard: {
    gap: Spacing.two,
    backgroundColor: Colors.plum,
    borderColor: Colors.plum,
  },
  membershipTitle: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ember,
  },
  membershipBody: {
    fontFamily: Fonts.body,
    color: Colors.cream,
  },
  section: {
    gap: Spacing.one,
  },
  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    marginBottom: Spacing.one,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  devLabel: {
    fontFamily: Fonts.body,
    color: Colors.ink,
    flex: 1,
  },
  legalRow: {
    paddingVertical: Spacing.two,
  },
  legalLink: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    fontSize: 14,
  },
  deleteLink: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.muted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: Spacing.two,
  },
});
