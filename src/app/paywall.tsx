import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useAuth } from '@/lib/auth/auth-context';
import { signInWithGoogle } from '@/lib/auth/providers';
import { MEMBERSHIP_PITCH, MEMBERSHIP_PRICING, purchaseMembership } from '@/lib/billing';
import { getErrorMessage } from '@/lib/errors';

// Voluntary preview only — Philoi is free for everyone during early access (no gating
// anywhere routes here). See use-entitlement.ts for why isMember/devOverride still exist.
export default function PaywallScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { isMember, setDevOverride } = useEntitlement();
  const [plan, setPlan] = useState<keyof typeof MEMBERSHIP_PRICING>('yearly');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePurchase() {
    setLoading(true);
    setError(null);
    try {
      await purchaseMembership(plan);
    } catch (e) {
      setError(getErrorMessage(e, 'Membership isn’t available yet.'));
    } finally {
      setLoading(false);
    }
  }

  if (!session) {
    return (
      <Screen dark style={styles.centeredContainer}>
        <FlameLogo size={64} />
        <Text style={styles.title}>Philoi Membership</Text>
        <Text style={styles.subtitle}>Sign in to see what&apos;s coming.</Text>
        <PrimaryButton label="Continue with Google" onPress={() => signInWithGoogle().catch((e) => setError(e.message))} />
        {error && <Text style={styles.error}>{error}</Text>}
      </Screen>
    );
  }

  return (
    <Screen dark>
      <ScrollView contentContainerStyle={styles.container}>
        <FlameLogo size={64} />
        <Text style={styles.title}>Philoi is free right now</Text>
        <Text style={styles.subtitle}>
          {isMember
            ? 'Dev override is on — this is a preview of what membership will look like.'
            : "We're in early access — everything's unlocked. Here's a preview of what membership will look like later:"}
        </Text>

        <View style={styles.features}>
          {MEMBERSHIP_PITCH.map((feature) => (
            <Text key={feature} style={styles.feature}>
              ✨ {feature}
            </Text>
          ))}
        </View>

        <View style={styles.plans}>
          {(Object.keys(MEMBERSHIP_PRICING) as (keyof typeof MEMBERSHIP_PRICING)[]).map((key) => (
            <Text
              key={key}
              onPress={() => setPlan(key)}
              style={[styles.planChip, plan === key && styles.planChipActive]}>
              {MEMBERSHIP_PRICING[key].label}
            </Text>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <PrimaryButton label="Join (coming later)" onPress={handlePurchase} loading={loading} />
        <SecondaryButton label="Back to Philoi" onPress={() => router.back()} onDark />

        {__DEV__ && (
          <Text style={styles.devLink} onPress={() => setDevOverride(!isMember)}>
            Dev: {isMember ? 'clear' : 'simulate'} membership override
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.six,
  },
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.ember,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.body,
    color: Colors.cream,
    textAlign: 'center',
  },
  features: {
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  feature: {
    fontFamily: Fonts.body,
    color: Colors.cream,
    fontSize: 15,
  },
  plans: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  planChip: {
    fontFamily: Fonts.bodyBold,
    color: Colors.cream,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  planChipActive: {
    borderColor: Colors.coral,
    backgroundColor: Colors.coral,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.amber,
    textAlign: 'center',
  },
  devLink: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textDecorationLine: 'underline',
    marginTop: Spacing.three,
  },
});
