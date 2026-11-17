import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { AppTopBar } from '@/components/nav/app-top-bar';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors } from '@/constants/theme';

// THE GYM SPARK global top bar (v2 §6): flame logo + wordmark left; ＋ New post, ✈ Messages,
// 🔔 Notifications, ☰ menu right — identical on Feed / Board / Chat / You, same positions on every tab.
//
// It is AppTopBar with no title, so the three globals (✈ → /messages with the DM badge, 🔔 →
// /notifications with its badge, ☰ → the app drawer) can never drift from the classic bar. The Spark
// adds ONE thing through AppTopBar's `right` slot: posting is global, not a Feed-only FAB — the ember
// ＋ opens the composer from any tab.
//
// Like AppTopBar it draws NO safe-area inset: put it inside a SafeAreaView edges={['top']} (or pad by
// insets.top yourself, as components/group-room.tsx does over its banner).
export function GymTopBar() {
  const router = useRouter();
  return (
    <AppTopBar
      right={
        <Pressable
          onPress={() => router.push('/agora/compose')}
          hitSlop={6}
          style={styles.post}
          accessibilityRole="button"
          accessibilityLabel="New post">
          <NavGlyph name="plus" size={18} color="#160D26" />
        </Pressable>
      }
    />
  );
}

const POST = 30;

const styles = StyleSheet.create({
  post: {
    width: POST,
    height: POST,
    borderRadius: POST / 2,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.navEmber2,
    shadowColor: Colors.navEmber,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
