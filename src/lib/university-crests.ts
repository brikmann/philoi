import { Colors } from '@/constants/theme';

// Brand-colour crest + monogram stand-ins for the "Vs. unis" collective board (PHILOI_UI_SPEC.md
// §15, mock 42 frame B) — official school logos are trademarked and need licensing, so a
// colour-crest is the shipping default. Keyed to the exact canonical names in the `universities`
// table (verified live). Anything not listed (a "not listed" free-text entry at onboarding, or a
// school added to the table later) falls back to a muted crest with its own initials.
const UNIVERSITY_CREST: Record<string, { bg: string; text: string; monogram: string }> = {
  'University of Waterloo': { bg: '#1D1D1D', text: '#FFCE34', monogram: 'UW' },
  'Wilfrid Laurier University': { bg: '#4A2E6E', text: '#F5C542', monogram: 'WLU' },
  'Toronto Metropolitan University': { bg: '#004C9B', text: '#FFFFFF', monogram: 'TMU' },
  'University of Toronto': { bg: '#002A5C', text: '#FFFFFF', monogram: 'UofT' },
  'McMaster University': { bg: '#7A003C', text: '#FFFFFF', monogram: 'Mac' },
  "Queen's University": { bg: '#9D1939', text: '#FFFFFF', monogram: 'Q' },
  'Western University': { bg: '#4F2683', text: '#FFFFFF', monogram: 'W' },
  'University of Guelph': { bg: '#CF1E3B', text: '#FFFFFF', monogram: 'UG' },
  'University of Ottawa': { bg: '#8F0025', text: '#FFCE00', monogram: 'uO' },
  'York University': { bg: '#E31837', text: '#FFFFFF', monogram: 'Y' },
};

function initialsFor(name: string): string {
  const words = name.replace(/^(University of|The)\s+/i, '').split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export function getUniversityCrest(name: string): { bg: string; text: string; monogram: string } {
  return UNIVERSITY_CREST[name] ?? { bg: Colors.disabled, text: Colors.muted, monogram: initialsFor(name) };
}
