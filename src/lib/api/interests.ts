import type { IconName } from '@/components/ui/icon';
import { supabase } from '@/lib/supabase';

// What you're here to grind (0285, mock 323) — declared disciplines, interest-hub tags and goals.
// The cold-start input for grind-alike matching (0275) and forest suggestions: a brand-new account
// has no logged sessions, so this is what it's matched on until it does. Every tag is a key of the
// server's vocabulary (interest_vocab), never free text. Goals are intent, not a tracked target.

export type VocabKind = 'discipline' | 'interest' | 'goal';

export type VocabTag = {
  key: string;
  kind: VocabKind;
  label: string;
  sub: string | null;
  icon: string;
  featured: boolean;
  /**
   * Interest tags only (0296): the picker section, a key of INTEREST_CATEGORIES — or 'program', the
   * academic tags your program implies, which aren't browsed. Absent from a pre-0296 server.
   */
  category?: string | null;
  /** Forests this tag would find for you. */
  forest_count: number;
};

// The ten picker sections (0296, mock 339), in the order they render. Hobbies lead, not disciplines.
// A category key this build doesn't list lands in the trailing "More" section rather than vanishing.
export const INTEREST_CATEGORIES: readonly { key: string; title: string }[] = [
  { key: 'active', title: 'Active & sport' },
  { key: 'mind', title: 'Mind & study' },
  { key: 'finance', title: 'Finance' },
  { key: 'create', title: 'Create' },
  { key: 'play', title: 'Play & games' },
  { key: 'culture', title: 'Culture & media' },
  { key: 'food', title: 'Food & going out' },
  { key: 'outdoors', title: 'Outdoors & travel' },
  { key: 'people', title: 'People & purpose' },
  { key: 'pets', title: 'Pets & life' },
];

/** Academic tags the program fold reads (Pre-med, Kinesiology …): searchable, never a browse section. */
export const PROGRAM_CATEGORY = 'program';

export type MyInterests = {
  disciplines: string[];
  interest_tags: string[];
  goals: string[];
  /** Tags your program already implies — they count toward matching without being picked. */
  program_tags: string[];
  updated_at: string | null;
};

export type SuggestedForest = {
  id: string;
  name: string;
  purpose: string | null;
  emoji: string;
  visibility: 'open' | 'request';
  university: string | null;
  is_official: boolean;
  member_count: number;
  locked_in_now: number;
  /** The tag of yours that found it ("Pre-med"). */
  because: string | null;
  icon: string | null;
};

const EMPTY: MyInterests = { disciplines: [], interest_tags: [], goals: [], program_tags: [], updated_at: null };

export async function fetchInterestVocab(): Promise<VocabTag[]> {
  const { data, error } = await supabase.rpc('get_interest_vocab');
  if (error) throw error;
  return (data as VocabTag[] | null) ?? [];
}

export async function fetchMyInterests(): Promise<MyInterests> {
  const { data, error } = await supabase.rpc('get_my_interests');
  if (error) throw error;
  return { ...EMPTY, ...((data as Partial<MyInterests> | null) ?? {}) };
}

/** A patch: leave a list out to keep it, pass [] to clear it. */
export async function setMyInterests(patch: {
  disciplines?: string[];
  interest_tags?: string[];
  goals?: string[];
}): Promise<MyInterests> {
  const { data, error } = await supabase.rpc('set_my_interests', {
    p_disciplines: patch.disciplines ?? null,
    p_interest_tags: patch.interest_tags ?? null,
    p_goals: patch.goals ?? null,
  });
  if (error) throw error;
  return { ...EMPTY, ...((data as Partial<MyInterests> | null) ?? {}) };
}

export async function fetchSuggestedForests(limit = 6): Promise<SuggestedForest[]> {
  const { data, error } = await supabase.rpc('get_suggested_forests', { p_limit: limit });
  if (error) throw error;
  return (data as SuggestedForest[] | null) ?? [];
}

// The server names icons by string; only these are drawn, so a name a newer server sends that this
// build doesn't know falls back to the sparkle rather than crashing the registry lookup.
const KNOWN_ICONS = new Set<string>([
  'study', 'read', 'gym', 'run', 'deep-work', 'timer', 'heart', 'bolt', 'chat', 'chart', 'sparkle',
  'compass', 'hand', 'shield', 'card', 'sprout', 'notes', 'edit', 'music', 'clock', 'flame', 'trophy',
  'friends', 'campus', 'target', 'streak', 'session', 'forest',
  // 0296's broad taxonomy
  'sun', 'moon', 'star', 'up', 'flag', 'versus', 'challenge', 'globe', 'plane', 'megaphone', 'temple',
  'hammer', 'home', 'palette', 'camera', 'video', 'photo', 'play', 'phone', 'box', 'bag',
]);

export function vocabIcon(name: string | null | undefined): IconName {
  return name && KNOWN_ICONS.has(name) ? (name as IconName) : 'sparkle';
}
