import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EquippedFlameSvg } from '@/components/flame-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// Cindy during a live session (CINDY_SPEC mock 117 §C).
//
// Tapping her mid-session opens THIS, not the full chat. The distinction is the whole point: a
// session is the thing the screen exists to protect, and pushing a full conversation over it
// turns a glance into a detour. Three ways out, one of which is the full chat for when the
// glance was not enough.
//
// Slides up over the camera/Stop row with the screen dimmed behind, so the timer and flame stay
// visible above it — you can see your session while you ask about it.

export type CindyQuickAction = 'status' | 'note' | 'chat';

const ACTIONS: { key: CindyQuickAction; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { key: 'status', icon: 'stats-chart-outline', label: 'How am I doing?' },
  { key: 'note', icon: 'create-outline', label: 'Add a note to this session' },
  { key: 'chat', icon: 'chatbubble-ellipses-outline', label: 'Open full chat' },
];

export function CindyQuickSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (action: CindyQuickAction) => void;
}) {
  // Inside a <Modal>, which renders outside the screen's SafeAreaView, so the inset is ours.
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
          <View style={styles.grab} />

          <View style={styles.head}>
            {/* Her own flame, never an emoji or a generic assistant glyph. The mirror is
                unconditional inside FlameSvg now, so there is no prop to pass. */}
            <EquippedFlameSvg width={17} height={21} />
            <Text style={styles.headText}>Cindy</Text>
          </View>

          {ACTIONS.map((a) => (
            <Pressable
              key={a.key}
              style={styles.row}
              onPress={() => onSelect(a.key)}
              accessibilityRole="button">
              <Ionicons name={a.icon} size={17} color={Colors.ember} />
              <Text style={styles.rowText}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    // Dimmed, not opaque: the flame and timer stay readable above the sheet.
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.four,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.lineStrong,
    marginBottom: Spacing.three,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  headText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  rowText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
});
