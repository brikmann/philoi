import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { JournalEntry } from '@/types/database';

// §5 — the Journal (migration 0091).
//
// Entries are DERIVED from notification_events rather than stored twice: every achievement the
// spec names is already recorded there with its leading art. What lives in journal_notes is only
// the human layer — the comment and the per-entry hide.

export async function fetchJournal(userId: string, limit = 50): Promise<JournalEntry[]> {
  const { data, error } = await supabase.rpc('get_journal', { p_user: userId, p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

/** Attach or edit a note. Pass null/empty to clear it. */
export async function setJournalNote(entryKey: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_journal_note', { p_entry_key: entryKey, p_note: note });
  if (error) throw error;
  track('journal_note_set', { cleared: !note });
}

/** Hide an entry from visitors. It stays visible in the owner's own journal. */
export async function setJournalHidden(entryKey: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_journal_hidden', { p_entry_key: entryKey, p_hidden: hidden });
  if (error) throw error;
  track('journal_entry_hidden', { hidden });
}

/** §3 — the profile bio. Returns the stored value so the caller renders what the server kept. */
export async function setMyBio(bio: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_my_bio', { p_bio: bio });
  if (error) throw error;
  track('bio_updated', { cleared: !data });
  return data ?? null;
}
