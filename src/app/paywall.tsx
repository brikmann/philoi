import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useEntitlement } from '@/hooks/use-entitlement';
import { PRO_FEATURES, PRO_PRICING, purchasePro } from '@/lib/billing';

export default function PaywallScreen() {
  const { setDevOverride } = useEntitlement();
  const [plan, setPlan] = useState<keyof typeof PRO_PRICING>('yearly');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePurchase() {
    setLoading(true);
    setError(null);
    try {
      await purchasePro(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchases are not available yet.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen dark>
      <ScrollView contentContainerStyle={styles.container}>
        <FlameIcon size={64} />
        <Text style={styles.title}>Philoi Pro</Text>
        <Text style={styles.subtitle}>For the ones who go all in.</Text>

        <View style={styles.features}>
          {PRO_FEATURES.map((feature) => (
            <Text key={feature} style={styles.feature}>
              ✨ {feature}
            </Text>
          ))}
        </View>

        <View style={styles.plans}>
          {(Object.keys(PRO_PRICING) as (keyof typeof PRO_PRICING)[]).map((key) => (
            <Text
              key={key}
              onPress={() => setPlan(key)}
              style={[styles.planChip, plan === key && styles.planChipActive]}>
              {PRO_PRICING[key].label}
            </Text>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <PrimaryButton label="Unlock Philoi Pro" onPress={handlePurchase} loading={loading} />

        {__DEV__ && (
          <Text style={styles.devLink} onPress={() => setDevOverride(true)}>
            Dev: force Pro without billing
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
  title: {
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.ember,
  },
  subtitle: {
    fontFamily: Fonts.body,
    color: Colors.cream,
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
