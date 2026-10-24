import { View, type StyleProp, type ViewStyle } from 'react-native';

import { PatronCrest } from '@/components/story-sticker/patron-crest';
import { useIdentityBadge } from '@/lib/house/identity-badges';

// ── THE HOUSE SEAL (mock 288) ──
//
// The patron crest at name size, for the line a person's name sits on: boards, the Agora, campfire
// rosters, profiles. One glance says which house someone reps. Not the Emberfall SealBadge that
// BurningName pins — that one is a pass you finished; this one is the program you study.
//
// Given a `userId` it reads the batched identity badge (lib/house/identity-badges), so a list can
// drop one in per row without plumbing anything. Given a `patronKey` it draws that house directly —
// for surfaces that already hold the key (your own program, a board row that carries it).
//
// It renders NOTHING without a house: before 0264 is live, for someone who never picked a program,
// or while the badge is in flight. A name with no seal is the base look, never a placeholder.

export function HouseSeal({
  userId,
  patronKey,
  patronName,
  size,
  style,
}: {
  userId?: string | null;
  /** Wins over `userId` — the house is already known, so nothing is fetched. */
  patronKey?: string | null;
  /** Only for the initial an unknown key falls back to. */
  patronName?: string | null;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  // Handed `null` when the key is already known, so a row that has it never queues a fetch.
  const badge = useIdentityBadge(patronKey ? null : userId);
  const key = patronKey ?? badge?.patron_key;
  if (!key) return null;
  const name = patronName ?? badge?.patron_name ?? key;

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`House of ${name.replace(/^The\s+/i, 'the ')}`}>
      <PatronCrest patronKey={key} name={name} size={size} />
    </View>
  );
}

/**
 * The seal INSIDE a name's text line — BurningName's / PublicIdentity's `suffix`, which is always
 * rendered within a <Text>. Carries its own leading space so a name with no house gets no gap; a
 * View nested in Text lays out inline on both platforms.
 */
export function HouseSealInline({ userId, size }: { userId: string | null | undefined; size: number }) {
  const badge = useIdentityBadge(userId);
  if (!badge?.patron_key) return null;
  return (
    <>
      {' '}
      <HouseSeal patronKey={badge.patron_key} patronName={badge.patron_name} size={size} />
    </>
  );
}
