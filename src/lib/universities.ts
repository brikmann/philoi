// University → email domain (UNI_VERIFICATION_SPEC.md §1).
//
// Two sources, in this order:
//   1. the shipped cache below — instant, works offline, and is what the onboarding picker shows
//      before a single network call;
//   2. the Hipolabs universities API, for anything not cached.
// A school with no resolvable domain simply can't be verified. That must never block onboarding:
// they still get a profile, a campus name, and every other board — just not the two campus ones.

export type UniversityEntry = {
  /** Must match the canonical `universities` table spelling exactly — profiles.university is
   * plain text, so a mismatch here fragments the campus leaderboards. */
  name: string;
  /** The domain students actually receive mail at, which is not always the school's web domain
   * (Laurier's site is wlu.ca; student mail is @mylaurier.ca). */
  domain: string;
  /** Curated, guidance-only helper text for the local part. Deliberately absent for most schools
   * — see FORMAT_HINT note below. */
  formatHint?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HINTS: there is no API for a school's local-part convention (§1b) — it's internal IT
// policy and it varies within a school (students vs faculty vs alumni vs legacy accounts). So
// this is a hand-maintained list, and a WRONG hint is worse than none: it tells someone their
// real address is malformed. Only Laurier's is filled in, because it's the one the spec and mock
// state outright. Everything else is intentionally blank until a human confirms it — the field
// is here and wired up, so adding one is a one-line change.
//
// Whatever the hint says, nothing is ever enforced beyond the DOMAIN. The code arriving is the
// proof of ownership.
// ─────────────────────────────────────────────────────────────────────────────

export const TOP_UNIVERSITIES: UniversityEntry[] = [
  { name: 'University of Toronto', domain: 'mail.utoronto.ca' },
  { name: 'University of British Columbia', domain: 'student.ubc.ca' },
  { name: 'McGill University', domain: 'mail.mcgill.ca' },
  { name: 'University of Waterloo', domain: 'uwaterloo.ca' },
  { name: 'University of Alberta', domain: 'ualberta.ca' },
  { name: 'McMaster University', domain: 'mcmaster.ca' },
  { name: 'Université de Montréal', domain: 'umontreal.ca' },
  { name: 'University of Calgary', domain: 'ucalgary.ca' },
  { name: 'Western University', domain: 'uwo.ca' },
  { name: "Queen's University", domain: 'queensu.ca' },
  { name: 'University of Ottawa', domain: 'uottawa.ca' },
  { name: 'Simon Fraser University', domain: 'sfu.ca' },
  { name: 'Dalhousie University', domain: 'dal.ca' },
  { name: 'University of Victoria', domain: 'uvic.ca' },
  {
    name: 'Wilfrid Laurier University',
    domain: 'mylaurier.ca',
    formatHint: 'first 4 of last name + last 4 of student # · e.g. smit4521',
  },
  { name: 'York University', domain: 'yorku.ca' },
  { name: 'Carleton University', domain: 'cmail.carleton.ca' },
  { name: 'Toronto Metropolitan University', domain: 'torontomu.ca' },
  { name: 'Université Laval', domain: 'ulaval.ca' },
  { name: 'University of Guelph', domain: 'uoguelph.ca' },
  { name: 'Concordia University', domain: 'mail.concordia.ca' },
];

const BY_NAME = new Map(TOP_UNIVERSITIES.map((u) => [u.name.toLowerCase(), u]));

/** Cache hit only — synchronous, so the picker can show a domain the instant a school is tapped
 * without waiting on the network (mock 76A's live example@domain preview). */
export function findCachedUniversity(name: string): UniversityEntry | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

export function formatHintFor(name: string | null | undefined): string | null {
  if (!name) return null;
  return findCachedUniversity(name)?.formatHint ?? null;
}

/** A sample address for the domain preview — `smit4521@mylaurier.ca` where a hint exists (so the
 * example matches the shape being described), a neutral one otherwise. */
export function sampleEmailFor(entry: { domain: string; formatHint?: string }): string {
  const fromHint = entry.formatHint?.match(/e\.g\.\s*([\w.+-]+)/i)?.[1];
  return `${fromHint ?? 'you'}@${entry.domain}`;
}

/** "Wilfrid Laurier University" → "Laurier"; "University of Waterloo" → "Waterloo". Copy like
 * "Prove you're a Warrior" / "You're verified at Waterloo" (mocks 75B/D) reads as a mouthful with
 * the full legal name, and these strings sit in headlines. Falls back to the full name whenever
 * trimming would leave something unrecognisable. */
export function shortSchoolName(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed
    .replace(/^(University|Université|College)\s+(of|de|du)\s+/i, '')
    .replace(/\s+(University|Université|College|Polytechnic)$/i, '')
    .trim();
  return stripped.length >= 3 ? stripped : trimmed;
}

type HipolabsUniversity = { name: string; domains?: string[]; country?: string };

// https, never http (§1) — this runs on a student's phone, often on campus wifi, and a plaintext
// request is trivially rewritable.
const HIPOLABS_URL = 'https://universities.hipolabs.com/search';

/** Resolves a school's domain: cache first, then Hipolabs. Returns null when neither knows it —
 * the caller treats that as "can't be verified", not as an error. */
export async function resolveUniversityDomain(name: string, signal?: AbortSignal): Promise<string | null> {
  const cached = findCachedUniversity(name);
  if (cached) return cached.domain;

  try {
    const res = await fetch(`${HIPOLABS_URL}?name=${encodeURIComponent(name)}&country=Canada`, { signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as HipolabsUniversity[];
    // Prefer an exact name match — a search for "Waterloo" also returns "Waterloo Lutheran", and
    // handing back the wrong school's domain would send the code somewhere the user can't read.
    const exact = rows.find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
    const row = exact ?? rows[0];
    return row?.domains?.[0]?.trim().toLowerCase() ?? null;
  } catch {
    // Offline, or the API is down. Not an error the user needs to see: they keep their school,
    // and verification is offered again from Settings later.
    return null;
  }
}

/** Type-ahead over the shipped cache plus whatever Hipolabs knows. The cache is returned first
 * and synchronously by findCachedMatches so the list never feels like it's waiting. */
export function findCachedMatches(query: string): UniversityEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOP_UNIVERSITIES;
  return TOP_UNIVERSITIES.filter((u) => u.name.toLowerCase().includes(q));
}

export async function searchUniversities(query: string, signal?: AbortSignal): Promise<UniversityEntry[]> {
  const q = query.trim();
  if (q.length < 2) return findCachedMatches(q);

  const cached = findCachedMatches(q);
  try {
    const res = await fetch(`${HIPOLABS_URL}?name=${encodeURIComponent(q)}&country=Canada`, { signal });
    if (!res.ok) return cached;
    const rows = (await res.json()) as HipolabsUniversity[];
    const seen = new Set(cached.map((u) => u.name.toLowerCase()));
    const remote = rows
      .filter((r) => r.name && !seen.has(r.name.trim().toLowerCase()))
      .map((r) => ({ name: r.name.trim(), domain: r.domains?.[0]?.trim().toLowerCase() ?? '' }))
      // A row with no domain can't be verified against, but it's still a real school someone may
      // attend — kept, with an empty domain the caller renders as "—" (mock 75A's third row).
      .slice(0, 20);
    return [...cached, ...remote];
  } catch {
    return cached;
  }
}
