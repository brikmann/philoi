import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GrindAlikeCard } from '@/components/matchmaking/grind-alike-card';
import { MatchOptInCard, MatchSettingsSection } from '@/components/matchmaking/match-settings-section';
import { SafetyNote } from '@/components/matchmaking/safety-note';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { SPACE_GUTTER, SpaceButton, SpaceCard, SpaceChip, SpaceEmpty, SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { blockUser } from '@/lib/api/agora';
import { fetchGrindAlikes, fetchMyMatchSettings, MATCH_SCOPE_LABELS, setMyMatchSettings } from '@/lib/api/matchmaking';
import { getErrorMessage } from '@/lib/errors';
import type { GrindAlike, MatchScope, MatchSettings } from '@/types/social';

const SCOPES: MatchScope[] = ['program', 'uni', 'wider'];

// Grind-alikes (0275, mock 299) — people whose lock-in habits, goals and field line up with yours.
// Every read here fails SOFT: until 0275 is applied the RPCs don't exist, and a drawer row that
// opens onto a crash is worse than one that says "not yet".
export default function GrindAlikesScreen() {
  const router = useRouter();
  const { profile: myProfile } = useAuth();

  const [settings, setSettings] = useState<MatchSettings | null>(null);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);
  const [saving, setSaving] = useState(false);
  // A chip narrows THIS look only; the saved "Match within" is the default it starts from.
  const [scopeOverride, setScopeOverride] = useState<MatchScope | null>(null);
  const [matches, setMatches] = useState<GrindAlike[] | null>(null);
  const [shelfFailed, setShelfFailed] = useState(false);
  const [shelfKey, setShelfKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [moreFor, setMoreFor] = useState<GrindAlike | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyMatchSettings()
      .then((s) => {
        if (!live) return;
        setSettings(s);
        setSettingsFailed(false);
      })
      .catch(() => {
        if (live) setSettingsFailed(true);
      });
    return () => {
      live = false;
    };
  }, [settingsKey]);

  const discoverable = settings?.discoverable ?? false;
  const scope = scopeOverride ?? settings?.match_scope ?? 'uni';

  useEffect(() => {
    if (!discoverable) return;
    let live = true;
    fetchGrindAlikes(scope)
      .then((rows) => {
        if (!live) return;
        setMatches(rows);
        setShelfFailed(false);
      })
      .catch(() => {
        if (live) setShelfFailed(true);
      })
      .finally(() => {
        if (live) setRefreshing(false);
      });
    return () => {
      live = false;
    };
  }, [discoverable, scope, shelfKey]);

  function changeSettings(patch: Partial<MatchSettings>) {
    if (!settings || saving) return;
    const before = settings;
    // Optimistic, so a switch doesn't sit still for a round-trip; reverted if the save fails.
    setSettings({ ...settings, ...patch });
    if (patch.match_scope) setScopeOverride(null);
    setSaving(true);
    setMyMatchSettings(patch)
      .then(setSettings)
      .catch((e) => {
        setSettings(before);
        Alert.alert("Couldn't save that", getErrorMessage(e, 'Try again in a moment.'));
      })
      .finally(() => setSaving(false));
  }

  function refresh() {
    setRefreshing(true);
    if (settingsFailed || !settings) {
      setSettingsKey((k) => k + 1);
      setRefreshing(false);
    } else if (discoverable) {
      setShelfKey((k) => k + 1);
    } else {
      setRefreshing(false);
    }
  }

  async function handleBlock(target: GrindAlike) {
    if (!myProfile) return;
    try {
      await blockUser(myProfile.id, target.user_id);
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Try again.'));
      return;
    }
    setMatches((rows) => rows?.filter((r) => r.user_id !== target.user_id) ?? rows);
    Alert.alert('User blocked', "They won't show up for you anymore, and you won't show up for them.");
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <SpaceHeader title="Who grinds like you" />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.navEmber} />}>
        <Text style={styles.intro}>
          People whose lock-in habits, goals and field line up with yours. Not a ranking — a way to find your people.
        </Text>

        {settingsFailed ? (
          <SoftState
            title="Grind-alikes is still warming up"
            sub="We couldn't reach matchmaking just now. Check back soon."
            onRetry={() => setSettingsKey((k) => k + 1)}
          />
        ) : !settings ? (
          <ActivityIndicator color={Colors.navEmber} style={styles.spinner} />
        ) : (
          <>
            {!discoverable ? (
              <MatchOptInCard busy={saving} onEnable={(on) => changeSettings({ discoverable: on })} />
            ) : (
              <>
                <View style={styles.chips}>
                  {SCOPES.map((s) => (
                    <SpaceChip key={s} label={MATCH_SCOPE_LABELS[s]} selected={s === scope} onPress={() => setScopeOverride(s)} />
                  ))}
                </View>

                {shelfFailed ? (
                  <SoftState
                    title="No shelf right now"
                    sub="We couldn't load your grind-alikes. Pull down to try again."
                    onRetry={() => setShelfKey((k) => k + 1)}
                  />
                ) : !matches ? (
                  <ActivityIndicator color={Colors.navEmber} style={styles.spinner} />
                ) : matches.length === 0 ? (
                  <SoftState
                    title="No one lines up yet"
                    sub={
                      scope === 'wider'
                        ? 'The shelf refreshes daily — keep locking in and check back tomorrow.'
                        : 'Try Anywhere, or check back tomorrow — the shelf refreshes daily.'
                    }
                  />
                ) : (
                  matches.map((m) => (
                    <GrindAlikeCard
                      key={m.user_id}
                      match={m}
                      onOpen={() => router.push({ pathname: '/grind-alike/[userId]', params: { userId: m.user_id } } as never)}
                      onMore={() => setMoreFor(m)}
                    />
                  ))
                )}
              </>
            )}

            <SafetyNote />
            <MatchSettingsSection settings={settings} busy={saving} onChange={changeSettings} hideDiscoverable={!discoverable} />
          </>
        )}
      </ScrollView>

      <ReportBlockSheet
        visible={moreFor !== null}
        onClose={() => setMoreFor(null)}
        onReport={() => {
          if (moreFor) router.push({ pathname: '/report', params: { userId: moreFor.user_id } });
        }}
        onBlock={() => {
          if (moreFor) void handleBlock(moreFor);
        }}
      />
    </SafeAreaView>
  );
}

// The soft "not yet" states sit in a kit card rather than floating on the canvas, so a failed read
// still occupies the slot the shelf will fill — the page doesn't jump when it arrives.
function SoftState({ title, sub, onRetry }: { title: string; sub: string; onRetry?: () => void }) {
  return (
    <SpaceCard style={styles.soft}>
      <SpaceEmpty
        title={title}
        body={sub}
        action={onRetry ? <SpaceButton label="Try again" variant="secondary" onPress={onRetry} style={styles.retry} /> : undefined}
      />
    </SpaceCard>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    // Transparent so the root ScreenBackground radial shows through, like every pushed screen.
    backgroundColor: 'transparent',
  },
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  intro: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.spaceDim,
    marginBottom: Spacing.three,
  },
  spinner: {
    marginVertical: Spacing.five,
  },
  chips: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.twelve,
  },
  soft: {
    padding: 0,
  },
  retry: {
    marginTop: Spacing.two,
    minHeight: 40,
  },
});
