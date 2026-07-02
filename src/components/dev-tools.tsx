import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  fetchOneDemoMember,
  resetMyCheckIns,
  seedMyDemoCircle,
  sendTestNotification,
  simulateFriendCheckIn,
} from '@/lib/api/dev-tools';
import { getErrorMessage } from '@/lib/errors';
import type { MyGroup } from '@/lib/api/groups';

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
});
