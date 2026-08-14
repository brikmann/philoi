import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { EmberIcon } from '@/components/economy/ember-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from '@/lib/economy/rarity';

// The small shared pieces every economy screen repeats: the ember balance chip that's pinned
// top-right on Shop/Inventory/box-detail, the RARITY · TYPE line, and the section label.

// Coerced rather than trusted: every argument here traces back to a jsonb field off an RPC, and a
// SQL `null` (a config key that doesn't cover a rarity, an empty wallet row) would otherwise reach
// `.toLocaleString` and throw inside render — taking a whole results grid down over one number.
export function formatEmbers(n: number | null | undefined): string {
  return (Number.isFinite(n) ? (n as number) : 0).toLocaleString('en-US');
}

/** The always-visible balance (mock 56/57/67 top-right). */
export function EmberPill({ embers }: { embers: number | null | undefined }) {
  return (
    <View style={styles.pill} accessibilityLabel={`${formatEmbers(embers)} embers`}>
      <EmberIcon size={14} />
      <Text style={styles.pillText}>{formatEmbers(embers)}</Text>
    </View>
  );
}

/**
 * Inline price/payout — the ember token followed by "4,000".
 *
 * A row, not a single <Text>: everything inside a <Text> lays out as text rather than flexbox, so an
 * SVG can't sit inline there. Callers that need the amount *inside* a sentence should write the word
 * "embers" instead of reaching for the icon.
 */
export function EmberAmount({
  amount,
  style,
  containerStyle,
  size = 13,
}: {
  amount: number | null | undefined;
  /** Text style for the number. Layout (margins, alignment) belongs on `containerStyle`. */
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  size?: number;
}) {
  return (
    <View style={[styles.amountRow, containerStyle]} accessibilityLabel={`${formatEmbers(amount)} embers`}>
      <EmberIcon size={size} />
      <Text style={[styles.amount, style]}>{formatEmbers(amount)}</Text>
    </View>
  );
}

export function RarityLabel({ rarity, type, size = 8 }: { rarity: Rarity; type?: string; size?: number }) {
  return (
    <Text style={[styles.rarity, { color: RARITY_COLOR[rarity], fontSize: size }]}>
      {RARITY_LABEL[rarity]}
      {type ? ` · ${type}` : ''}
    </Text>
  );
}

export function SectionLabel({ label, action }: { label: string; action?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionText}>{label}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

/**
 * The earned-vs-paid split (§0.3 / 21a: "earned-vs-bought must be visually unambiguous"). Earned
 * gets the warm amber treatment and the word EARNED; anything bought reads as neutral flair and is
 * never styled to look earned.
 */
export function SourceTag({ source }: { source: 'earned' | 'paid' | 'box' | 'forge_pass' }) {
  const earned = source === 'earned';
  return (
    <View style={[styles.sourceTag, earned ? styles.sourceEarned : styles.sourceBought]}>
      <Text style={[styles.sourceText, { color: earned ? Colors.achieverText : Colors.muted }]}>
        {earned ? 'EARNED' : source === 'forge_pass' ? 'FORGE PASS' : source === 'box' ? 'FROM A BOX' : 'BOUGHT'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
  },
  amount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.ember,
  },
  rarity: {
    fontFamily: Fonts.bodyBold,
    letterSpacing: 0.5,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  sectionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    flex: 1,
  },
  sectionAction: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.amber,
  },
  sourceTag: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  sourceEarned: {
    backgroundColor: Colors.achieverBg,
  },
  sourceBought: {
    backgroundColor: Colors.disabled,
  },
  sourceText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.8,
  },
});
