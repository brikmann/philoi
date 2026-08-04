import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { showRankUp } from '@/components/rank-up-watcher';
import { Card } from '@/components/ui/card';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
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

type DevToolsProps = {
  devOverride: boolean;
  setDevOverride: (value: boolean) => void;
  groups: MyGroup[];
};

// Everything here is callable by any authenticated user at the DB layer (see the
// "dev tools" section in schema.sql) — this component just keeps them out of the UI real
// users see, which is the actual safety boundary the spec asks for.
export function DevTools({ devOverride, setDevOverride, groups }: DevToolsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Whether the tier buttons fire a within-tier bump instead of a crossing (RANKUP_SPEC §7b) —
  // the difference is the whole point of the escalation model, so it's a toggle rather than a
  // separate row of buttons.
  const [bumpOn, setBumpOn] = useState(false);

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

      {/* Rank-up tester (RANKUP_SPEC §7b). These go through showRankUp() — the SAME entry point
          the global rank-watcher uses — so what you audition here is the real escalation, audio
          and haptics, not a dev-only replica that can drift. The celebration itself is presented
          by RankUpWatcher at the root, which is why nothing is mounted locally any more. */}
      <Text style={styles.subheading}>Rank-up tester</Text>

      <Pressable style={styles.toggleRow} onPress={() => setBumpOn((v) => !v)}>
        <View style={[styles.toggleBox, bumpOn && styles.toggleBoxOn]}>
          {bumpOn && <Text style={styles.toggleCheck}>✓</Text>}
        </View>
        <Text style={styles.toggleLabel}>Division bump (no copy, lighter flash)</Text>
      </Pressable>

      <View style={styles.rankGrid}>
        {RANK_TIER_ORDER.map((tier) => (
          <Pressable
            key={tier}
            style={[styles.rankPill, { borderColor: RANK_TIER_COLOR[tier] }]}
            onPress={() =>
              showRankUp({
                tier,
                division: bumpOn ? 2 : 3,
                // A bump comes from the same tier one division lower; a crossing from the tier
                // below, so the component's own fromTier !== tier check reads it as a crossing.
                fromTier: bumpOn ? tier : previousTier(tier),
                fromDivision: bumpOn ? 3 : 1,
                isDivisionBump: bumpOn,
                isBandCrossing: false,
              })
            }>
            <Text style={styles.rankPillText}>{formatRankTier(tier, bumpOn ? 2 : 3)}</Text>
          </Pressable>
        ))}
      </View>

      {/* The two ascension events, forced — you shouldn't have to climb to Diamond I to check
          that the Realm-of-Legend takeover reads right. */}
      <View style={styles.rankGrid}>
        <Pressable
          style={[styles.rankPill, styles.ascensionPill, { borderColor: RANK_TIER_COLOR.hero }]}
          onPress={() =>
            showRankUp({ tier: 'hero', division: 3, fromTier: 'diamond', fromDivision: 1, isDivisionBump: false, isBandCrossing: true })
          }>
          <Text style={styles.rankPillText}>✦ Diamond → Hero</Text>
        </Pressable>
        <Pressable
          style={[styles.rankPill, styles.ascensionPill, { borderColor: RANK_TIER_COLOR.primordial }]}
          onPress={() =>
            showRankUp({
              tier: 'primordial',
              division: 1,
              fromTier: 'immortal',
              fromDivision: 1,
              isDivisionBump: false,
              isBandCrossing: true,
            })
          }>
          <Text style={styles.rankPillText}>✦ Immortal → Primordial</Text>
        </Pressable>
      </View>
    </Card>
  );
}

/** The tier one step below — the "from" for a simulated crossing. Bronze is the floor, so it
 * crosses from itself, which the celebration reads as an entry rather than a cross. */
function previousTier(tier: RankTierName): RankTierName {
  const i = RANK_TIER_ORDER.indexOf(tier);
  return RANK_TIER_ORDER[Math.max(0, i - 1)];
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  toggleBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBoxOn: {
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  toggleCheck: {
    fontSize: 12,
    color: Colors.ink,
  },
  toggleLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  ascensionPill: {
    borderWidth: 1.5,
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
