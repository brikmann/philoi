import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import type { MetricScope } from '@/types/house';

export const FITNESS_SCOPE_LABEL: Record<MetricScope, string> = {
  global: 'Global',
  my_uni: 'My uni',
  my_program: 'My program',
  friends: 'Friends',
};

/** Mock 289's order: Global · My uni · My program · Friends. */
export const FITNESS_SCOPES: MetricScope[] = ['global', 'my_uni', 'my_program', 'friends'];

// The Fitness and exercise boards' scope tabs — the same segmented control as the Leaderboard tab's
// (raised panel + ember label for the selected one), so moving between the boards never changes
// what a tab looks like.
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
            style={[styles.tab, on && styles.tabOn]}
            onPress={() => onChange(s)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}>
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {FITNESS_SCOPE_LABEL[s]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderRadius: 9,
  },
  tabOn: {
    backgroundColor: Colors.spacePanel2,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  labelOn: {
    color: Colors.navEmber2,
  },
});
