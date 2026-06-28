import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { Colors, Fonts } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.coral,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: { backgroundColor: Colors.card, borderTopColor: Colors.line },
        tabBarLabelStyle: styles.label,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ focused }) => <FlameIcon size={26} background={focused ? Colors.plum : null} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Text style={[styles.glyph, { color }]}>{'☺'}</Text>,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
  },
  glyph: {
    fontSize: 22,
  },
});
