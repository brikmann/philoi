import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useNetworkStatus } from '@/hooks/use-network-status';

export function OfflineBanner() {
  const { isOffline } = useNetworkStatus();

  if (!isOffline) return null;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea} pointerEvents="none">
      <Text style={styles.banner}>No connection — showing what&apos;s already loaded.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: Colors.plum,
  },
  banner: {
    color: Colors.cream,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: Spacing.one,
  },
});
