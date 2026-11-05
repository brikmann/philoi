import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { epicLockup } from '@/lib/api/patrons';
import { useIdentityBadge } from '@/lib/house/identity-badges';
import { shortUniversityName } from '@/lib/story-sticker/data';

// ── THE IDENTITY LINE (mocks 288 → 338 / 341) ──
//
// Phase 9 (0293): the patron is a persona the person CHOSE, and the program rides beside it as the
// pride badge — two independent facts, so each part stands on its own. Three reads of them:
//
//   'compact' (default) — tight spots: feed rows, member lists, the Agora handle — "Heracles · Kin"
//                         (+ " · Laurier" unless showSchool is off)
//   'plain'             — the profile's identity line — "Heracles · Kinesiology · Laurier"
//   'epic'              — the profile hero + share cards — "Heracles of Kinesiology"
//
// No trait bracket, ever — `represents` is sort metadata. The program is the one lit word: it's what
// tells two Heracleses at the same school apart.
//
// One <Text>, so it can stand alone OR nest inside a caller's own line (a board row's tier label
// runs into it as one truncating sentence). `leading` is the separator for that case, drawn only
// when there is something after it. Fails soft: no badge yet and no `university` fallback renders
// nothing, not an empty row.

/** @deprecated The "Heir to …" phrasing is gone with the house system (Phase 9). Kept for old call sites: the bare name. */
export function heirTo(patronName: string): string {
  return patronName;
}

export type IdentityForm = 'compact' | 'plain' | 'epic';

export function IdentityLine({
  userId,
  form = 'compact',
  showSchool = true,
  university,
  leading,
  numberOfLines = 1,
  style,
}: {
  userId: string | null | undefined;
  form?: IdentityForm;
  /** Off where the school already shows beside it (the Agora's campus pill, a profile's uni row). Epic never shows it. */
  showSchool?: boolean;
  /** The school the caller already has, used until the badge lands (or when it never does). */
  university?: string | null;
  /** Drawn before the line when it has content — " · " to run on from a tier label. */
  leading?: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const badge = useIdentityBadge(userId);
  const patron = badge?.patron_name?.trim() || null;
  const programFull = badge?.program_name || badge?.program_abbrev || null;
  const programShort = badge?.program_abbrev || badge?.program_name || null;
  const schoolName = badge?.university || university;
  const school = form !== 'epic' && showSchool && schoolName ? shortUniversityName(schoolName) : null;

  if (form === 'epic') {
    const line = epicLockup(patron, programFull);
    if (!line) return null;
    return (
      <Text style={[styles.line, style]} numberOfLines={numberOfLines}>
        {leading}
        {line}
      </Text>
    );
  }

  const program = form === 'plain' ? programFull : programShort;
  const parts: { text: string; lit?: boolean }[] = [];
  if (patron) parts.push({ text: patron });
  if (program) parts.push({ text: program, lit: true });
  if (school) parts.push({ text: school });
  if (parts.length === 0) return null;

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
