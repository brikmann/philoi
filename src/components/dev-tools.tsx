import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { RankUpCelebration } from '@/components/rank-up-celebration';
import { Card } from '@/components/ui/card';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import {
  fetchOneDemoMember,
  resetMyCheckIns,
  seedMyDemoCircle,
  sendTestNotification,
  simulateFriendCheckIn,
} from '@/lib/api/dev-tools';
import { getErrorMessage } from '@/lib/errors';
import type { MyGroup } from '@/lib/api/groups';
import { formatRankTier, RANK_TIER_COLOR, RANK_TIER_ORDER } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// Every rank in ladder order, low → high (RANK_REWORK_SPEC.md, migration 0063). Division 1 is
// the TOP sub-tier within a tier (I), 3 is the bottom (III) — matches formatRankTier and
// rank_tier_for_score.
//
// COMPLETE on purpose: all 28 ranks, generated from TIER_ORDER rather than hand-listed, so a
// future tier can never be added to the ladder and silently left un-previewable here. Platinum
// used to be skipped (it predated the spec's forge table) — that gap is exactly the kind of
// thing this now can't reproduce. Primordial is the singular apex: one entry, no divisions.
type LadderRank = { tier: RankTierName; division: number };

const RANK_LADDER: LadderRank[] = RANK_TIER_ORDER.flatMap((tier): LadderRank[] =>
  tier === 'primordial' ? [{ tier, division: 1 }] : [3, 2, 1].map((division) => ({ tier, division }))
);

type DevToolsProps = {
  devOverride: boolean;
  setDevOverride: (value: boolean) => void;
  groups: MyGroup[];
};

// Everything here is callable by any authenticated user at the DB layer (see the
// "dev tools" section in schema.sql) — this component just keeps them out of the UI real
// users see, which is the actual safety boundary the spec asks for.
export function DevTools({ devOverride, setDevOverride, groups }: DevToolsProps) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Index into RANK_LADDER of the rank currently being previewed, or null when the overlay is closed.
  const [previewRank, setPreviewRank] = useState<number | null>(null);
  // Bumped on every pill tap and folded into the celebration's key, so each tap forces a fresh
  // remount even for the same rank — re-running composeRankUpHeadline (new {personal}/{social}
  // combo) and replaying the flash/sound. Tap "Diamond II" ten times → ten different headlines.
  const [previewTap, setPreviewTap] = useState(0);

  function previewRankUp(index: number) {
    setPreviewRank(index);
    setPreviewTap((n) => n + 1);
  }

  if (!__DEV__) return null;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setStatus(null);
    try {
      await fn();
      setStatus(`${label}: done`);
    } catch (e) {
      setStatus(`${label}: ${getErrorMessage(e, 'failed')}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleSimulateFriendCheckIn() {
    const demoGroup = groups.find((g) => g.name === 'Dev Test Circle');
    if (!demoGroup) {
      Alert.alert('No demo circle yet', 'Tap "Seed a demo circle" first.');
      return;
    }
    await run('Simulate friend check-in', async () => {
      const fakeUserId = await fetchOneDemoMember(demoGroup.id);
      if (!fakeUserId) throw new Error('No is_demo member in Dev Test Circle — run npm run seed:demo first.');
      await simulateFriendCheckIn(demoGroup.id, fakeUserId);
    });
  }

  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>Dev tools</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Simulate active membership</Text>
        <Toggle value={devOverride} onValueChange={setDevOverride} />
      </View>

      <SecondaryButton
        label={busy === 'Test notification' ? 'Sending…' : 'Send me a test notification'}
        onPress={() => run('Test notification', sendTestNotification)}
        disabled={busy !== null}
      />
      <SecondaryButton
        label={busy === 'Seed demo circle' ? 'Seeding…' : 'Seed a demo circle'}
        onPress={() => run('Seed demo circle', async () => void (await seedMyDemoCircle()))}
        disabled={busy !== null}
      />
      <SecondaryButton
        label={busy === 'Simulate friend check-in' ? 'Simulating…' : 'Simulate a friend check-in'}
        onPress={handleSimulateFriendCheckIn}
        disabled={busy !== null}
      />
      <SecondaryButton
        label={busy === 'Reset my data' ? 'Resetting…' : 'Reset my data'}
        onPress={() => run('Reset my data', () => resetMyCheckIns())}
        disabled={busy !== null}
      />

      {status && <Text style={styles.status}>{status}</Text>}

      {/* Pure client-side rank-up preview — mounts RankUpCelebration with mock props for any rank
          so the forge → flash → sound → aura → composed headline can be eyeballed without earning
          XP or touching the DB. `from` is the immediately-lower rank in the ladder (itself for the
          Bronze III floor), which is what drives the component's tier-cross vs. division-bump logic. */}
      <Text style={styles.subheading}>Simulate rank-up</Text>
      <View style={styles.rankGrid}>
        {RANK_LADDER.map((rank, i) => (
          <Pressable
            key={`${rank.tier}-${rank.division}`}
            style={[styles.rankPill, { borderColor: RANK_TIER_COLOR[rank.tier] }]}
            onPress={() => previewRankUp(i)}>
            <Text style={styles.rankPillText}>{formatRankTier(rank.tier, rank.division)}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={previewRank !== null} animationType="fade" onRequestClose={() => setPreviewRank(null)}>
        {previewRank !== null &&
          (() => {
            const to = RANK_LADDER[previewRank];
            // Bronze III is the floor — reuse it as its own "from" so it reads as an entry, not a cross.
            const from = RANK_LADDER[Math.max(0, previewRank - 1)];
            return (
              <View style={styles.overlay}>
                <RankUpCelebration
                  // Keyed on the tap counter (not just the rank) so every tap — even re-tapping the
                  // same rank — remounts and re-fires the once-per-mount headline + animation timeline.
                  key={previewTap}
                  tier={to.tier}
                  division={to.division}
                  fromTier={from.tier}
                  fromDivision={from.division}
                  streakDays={6}
                  firstName={profile?.display_name?.split(' ')[0] ?? 'You'}
                  university={profile?.university}
                  onContinue={() => setPreviewRank(null)}
                  onShare={() => setPreviewRank(null)}
                />
                {/* Dev-only bar over the celebration: Re-roll remounts in place (bumps the key →
                    fresh headline + replayed flash/sound, same rank) so you don't have to dismiss
                    and re-tap between rolls. box-none lets taps fall through to the celebration's
                    own CTAs; only the two buttons capture. */}
                <View style={styles.devBar} pointerEvents="box-none">
                  <Pressable
                    style={styles.devBarBtn}
                    hitSlop={8}
                    onPress={() => setPreviewRank(null)}>
                    <Text style={styles.devBarText}>Close</Text>
                  </Pressable>
                  <Text style={styles.devBarLabel}>{formatRankTier(to.tier, to.division)}</Text>
                  <Pressable
                    style={styles.devBarBtn}
                    hitSlop={8}
                    onPress={() => setPreviewTap((n) => n + 1)}>
                    <Text style={styles.devBarText}>Re-roll ↻</Text>
                  </Pressable>
                </View>
              </View>
            );
          })()}
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: Fonts.body,
    color: Colors.ink,
    flex: 1,
  },
  status: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  subheading: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
    marginTop: Spacing.two,
  },
  rankGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  rankPill: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: Spacing.twelve,
  },
  rankPillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  overlay: {
    flex: 1,
    backgroundColor: Colors.forgeBg,
  },
  devBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 52,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  devBarBtn: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: Spacing.twelve,
  },
  devBarText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  devBarLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ember,
  },
});
