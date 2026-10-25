import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { shortSchoolName } from '@/lib/universities';
import type { ForestSummary } from '@/types/social';

// Small pieces every forest surface shares (0274, mock 283 §02): the avatar, the bottom sheet and
// the one-line "who's here" caption. Kept here so browse, the forest page and create read as one
// feature rather than three that happen to share a name.

/** "86 members · 4 campfires" — presence, not popularity, so member counts are fine to show. */
export function forestSubline(f: Pick<ForestSummary, 'member_count' | 'campfire_count' | 'university' | 'is_official' | 'suggested'>): string {
  const members = `${f.member_count.toLocaleString()} ${f.member_count === 1 ? 'member' : 'members'}`;
  // A forest with no campfires yet still says where it lives, so the line never reads "0 campfires".
  const tail =
    f.campfire_count > 0
      ? `${f.campfire_count} ${f.campfire_count === 1 ? 'campfire' : 'campfires'}`
      : f.is_official && f.suggested
        ? 'your class'
        : f.university
          ? shortSchoolName(f.university)
          : 'cross-uni';
  return `${members} · ${tail}`;
}

/** Real photo when there is one, else the initial — same fallback the composer uses. */
export function ForestAvatar({ name, url, size = 34, live = false }: { name: string; url: string | null; size?: number; live?: boolean }) {
  const ring = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View>
      {url ? (
        <Image source={{ uri: url }} style={[ring, styles.avatarBg]} contentFit="cover" />
      ) : (
        <View style={[ring, styles.avatarBg, styles.avatarFallback]}>
          <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>{(name || '?').charAt(0).toUpperCase()}</Text>
        </View>
      )}
      {live ? <View style={styles.liveDot} accessibilityLabel="Locked in now" /> : null}
    </View>
  );
}

/**
 * A bottom sheet in the house style (report-block-sheet's backdrop + grabber). Used for every
 * forest menu — never Alert.alert with more than three buttons, which Android silently truncates.
 */
export function ForestSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows taps so pressing inside the sheet doesn't dismiss it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One tappable row in a ForestSheet. */
export function SheetRow({
  label,
  onPress,
  danger = false,
  disabled = false,
  right,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  right?: ReactNode;
}) {
  return (
    <Pressable style={[styles.row, disabled && styles.rowOff]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Text style={[styles.rowLabel, danger && styles.rowDanger]}>{label}</Text>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarBg: {
    backgroundColor: Colors.disabled,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  liveDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.green,
    borderWidth: 2,
    borderColor: Colors.cream,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: Spacing.twelve,
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowOff: {
    opacity: 0.5,
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowDanger: {
    color: Colors.danger,
  },
});
