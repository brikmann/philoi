import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmberFill } from '@/components/ui/ember-fill';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { MetricScope } from '@/types/house';

export const FITNESS_SCOPE_LABEL: Record<MetricScope, string> = {
  global: 'Global',
  my_uni: 'My uni',
  my_program: 'My program',
  friends: 'Friends',
};

/** Mock 289's order: Global · My uni · My program · Friends. */
export const FITNESS_SCOPES: MetricScope[] = ['global', 'my_uni', 'my_program', 'friends'];

// The Fitness and exercise boards' scope tabs — the same lit-ember / dark-pill treatment as the
// Leaderboard tab's (mock 259), so moving between the boards never changes what a tab looks like.
export function FitnessScopePills({
  scopes,
  value,
  onChange,
}: {
  scopes: MetricScope[];
  value: MetricScope;
  onChange: (scope: MetricScope) => void;
}) {
  return (
    <View style={styles.row}>
      {scopes.map((s) => {
        const on = value === s;
        return (
          <Pressable
            key={s}
            style={[styles.press, on && styles.pressOn]}
            onPress={() => onChange(s)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}>
            {on ? (
              <EmberFill radius={Radius.pill} style={styles.tab}>
                <Text style={[styles.label, styles.labelOn]} numberOfLines={1}>
                  {FITNESS_SCOPE_LABEL[s]}
                </Text>
              </EmberFill>
            ) : (
              <View style={[styles.tab, styles.tabIdle]}>
                <Text style={styles.label} numberOfLines={1}>
                  {FITNESS_SCOPE_LABEL[s]}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  press: {
    flex: 1,
  },
  // iOS-only lift under the lit tab, as on the Leaderboard tab. No elevation: Android's casts grey.
  pressOn: {
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: Spacing.one,
  },
  tabIdle: {
    backgroundColor: Colors.cardDark,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.muted,
  },
  labelOn: {
    color: Colors.onEmber,
  },
});
