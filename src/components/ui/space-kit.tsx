import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// THE SPACE-PURPLE KIT (ui_pass2 §1) — the handful of pieces every restyled screen is built from, so
// "the same treatment as the main nav" is one set of components rather than twenty screens each
// re-deriving the look. Matches the five tabs: #1A1230 panels on a 1px #2E2348 line, 14px corners,
// ember for the one action, gold for earned, legend purple for secondary.
//
//   SpaceHeader   — back chevron · title (· subtitle) · right slot. For every pushed screen.
//   SpaceCard     — the rounded panel. `onPress` makes it a tappable card.
//   SpaceRow      — a list row: leading · title/sub · trailing (chevron by default when pressable).
//   SpaceButton   — primary (ember fill) / secondary (panel) / ghost; loading + disabled states.
//   SpaceSection  — the small uppercase label above a group.
//   SpaceChip     — a pill toggle (filters, scopes).

export function SpaceHeader({
  title,
  subtitle,
  right,
  onBack,
  back = true,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  /** Defaults to router.back(), falling back to Home when there's no history (a cold deep link). */
  onBack?: () => void;
  back?: boolean;
}) {
  const router = useRouter();
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={styles.header}>
      {back ? (
        <Pressable onPress={goBack} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <UiGlyph name="back" size={20} color={Colors.ink} />
        </Pressable>
      ) : null}
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

/** A round 36px header action — the same button the top bar's ✈ 🔔 ☰ use. */
export function SpaceIconButton({
  children,
  onPress,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </Pressable>
  );
}

export function SpaceCard({
  children,
  onPress,
  style,
  tone = 'panel',
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** 'ember' / 'gold' / 'legend' tint the border + wash for a card that leads its screen. */
  tone?: 'panel' | 'ember' | 'gold' | 'legend';
  accessibilityLabel?: string;
}) {
  const toneStyle = tone === 'panel' ? null : TONES[tone];
  if (!onPress) return <View style={[styles.card, toneStyle, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, toneStyle, pressed && styles.pressed, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      {children}
    </Pressable>
  );
}

const TONES = StyleSheet.create({
  ember: { borderColor: Colors.navEmber, backgroundColor: 'rgba(255,122,47,0.08)' },
  gold: { borderColor: '#5A4A1E', backgroundColor: 'rgba(255,209,102,0.07)' },
  legend: { borderColor: '#3A2D5A', backgroundColor: 'rgba(185,139,255,0.08)' },
});

export function SpaceRow({
  title,
  sub,
  leading,
  trailing,
  onPress,
  danger = false,
  accessibilityLabel,
}: {
  title: string;
  sub?: string | null;
  leading?: ReactNode;
  /** Defaults to a chevron when the row is pressable. Pass null for none. */
  trailing?: ReactNode | null;
  onPress?: () => void;
  danger?: boolean;
  accessibilityLabel?: string;
}) {
  const tail = trailing === undefined ? (onPress ? <UiGlyph name="forward" size={14} color={Colors.spaceFaint} /> : null) : trailing;
  const body = (
    <>
      {leading ? <View style={styles.rowLead}>{leading}</View> : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {tail}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}>
      {body}
    </Pressable>
  );
}

/** A square leading tile for SpaceRow — holds a glyph or an emoji. */
export function SpaceTile({ children, tone = 'panel' }: { children: ReactNode; tone?: 'panel' | 'ember' | 'gold' | 'legend' }) {
  return <View style={[styles.tile, tone !== 'panel' && TILE_TONES[tone]]}>{children}</View>;
}

const TILE_TONES = StyleSheet.create({
  ember: { backgroundColor: 'rgba(255,122,47,0.14)' },
  gold: { backgroundColor: 'rgba(255,209,102,0.12)' },
  legend: { backgroundColor: 'rgba(185,139,255,0.14)' },
});

export function SpaceButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  leading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  leading?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.btn,
        BTN[variant],
        off && styles.btnOff,
        pressed && !off && styles.pressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#2A0F05' : Colors.ink} />
      ) : (
        <>
          {leading}
          <Text style={[styles.btnText, BTN_TEXT[variant], off && styles.btnTextOff]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const BTN = StyleSheet.create({
  primary: {
    backgroundColor: Colors.navEmber,
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  secondary: { backgroundColor: Colors.spacePanel2, borderWidth: 1, borderColor: Colors.spaceLine },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'rgba(232,106,90,0.12)', borderWidth: 1, borderColor: 'rgba(232,106,90,0.4)' },
});

const BTN_TEXT = StyleSheet.create({
  primary: { color: '#2A0F05', fontFamily: Fonts.black },
  secondary: { color: Colors.ink },
  ghost: { color: Colors.navEmber2 },
  danger: { color: Colors.danger },
});

export function SpaceSection({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionText}>{children}</Text>
      {right}
    </View>
  );
}

export function SpaceChip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.chip, selected && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected }}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** Centered empty / error state inside a screen. */
export function SpaceEmpty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action}
    </View>
  );
}

export const SPACE_GUTTER = Spacing.three;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.twelve,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: Fonts.black,
    fontSize: 20,
    color: Colors.ink,
  },
  headerSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: Spacing.three,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowLead: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowTitleDanger: {
    color: Colors.danger,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 50,
    paddingHorizontal: Spacing.four,
    borderRadius: 16,
  },
  btnOff: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  btnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
  },
  btnTextOff: {},
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  sectionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  chipTextOn: {
    color: Colors.navEmber2,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  emptyTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
});
