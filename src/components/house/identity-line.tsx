import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useIdentityBadge } from '@/lib/house/identity-badges';
import { shortUniversityName } from '@/lib/story-sticker/data';

// ── THE IDENTITY LINE (mock 288) ──
//
// "Heir to Heracles · Kin · Laurier" — house, program, school, on the line under a name. The
// program is the one lit word (mock 288's `<b>`): it is the part a student chose, and the part that
// tells two Heirs of Heracles at the same school apart from nobody.
//
// One <Text>, so it can stand alone OR nest inside a caller's own line (a board row's tier label
// runs into it as one truncating sentence). `leading` is the separator for that case, drawn only
// when there is something after it.
//
// Fails soft, like the seal: no badge yet (0264 not live, offline, in flight) and no `university`
// fallback means it renders nothing, not an empty row.

/** "Heir to Heracles", "Heir to the Moirai" — the house as a phrase. */
export function heirTo(patronName: string): string {
  return `Heir to ${patronName.replace(/^The\s+/i, 'the ')}`;
}

export function IdentityLine({
  userId,
  showSchool = true,
  university,
  leading,
  numberOfLines = 1,
  style,
}: {
  userId: string | null | undefined;
  /** Off where the school already shows beside it (the Agora's campus pill, a profile's uni row). */
  showSchool?: boolean;
  /** The school the caller already has, used until the badge lands (or when it never does). */
  university?: string | null;
  /** Drawn before the line when it has content — " · " to run on from a tier label. */
  leading?: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const badge = useIdentityBadge(userId);
  const program = badge?.program_abbrev || badge?.program_name || null;
  const schoolName = badge?.university || university;
  const school = showSchool && schoolName ? shortUniversityName(schoolName) : null;
  // A house without a program can't happen (the program names the house), but a program whose
  // patron row failed to join can — so each part stands on its own.
  const house = program && badge?.patron_name ? heirTo(badge.patron_name) : null;

  if (!program && !school) return null;

  const parts: { text: string; lit?: boolean }[] = [];
  if (house) parts.push({ text: house });
  if (program) parts.push({ text: program, lit: true });
  if (school) parts.push({ text: school });

  return (
    <Text style={[styles.line, style]} numberOfLines={numberOfLines}>
      {leading}
      {parts.map((p, i) => (
        <Text key={i}>
          {i > 0 ? ' · ' : ''}
          {p.lit ? <Text style={styles.program}>{p.text}</Text> : p.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  program: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
});
