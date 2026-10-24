import { supabase } from '@/lib/supabase';
import type { MyProgramRow, ProgramRow } from '@/types/house';

// Client wrappers for the program/patron reads (0257, widened 0264). The program a student picks
// names their house — the patron is derived from it (programs.patron_key), never chosen.

/** The caller's program + house, or null when none is set. */
export async function fetchMyProgram(): Promise<MyProgramRow | null> {
  const { data, error } = await supabase.rpc('get_my_program');
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Every program at a school, each with the house it grants — the picker's list (mock 291). */
export async function fetchProgramsForUniversity(university: string): Promise<ProgramRow[]> {
  const { data, error } = await supabase.rpc('get_programs_for_university', { p_university: university });
  if (error) throw error;
  return data ?? [];
}

export async function setMyProgram(programId: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_program', { p_program_id: programId });
  if (error) throw error;
}

/** "As a Kinesiology student…" — rows without lore yet read as the patron's one-line attribute. */
export function loreParagraphs(program: Pick<ProgramRow, 'program_lore' | 'patron_attribute'>): string[] {
  const lore = program.program_lore?.trim();
  if (!lore) return [];
  return lore.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}
