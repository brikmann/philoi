// The LIVE season window, read straight off `economy_config.season` — the same row season_config()
// and season_phase() (0074) decide every purchase and claim against.
//
// A table select rather than a new get_season_window() RPC, for the reason economy-config.ts gives:
// the row already carries a select-only policy for `authenticated`, so an RPC would add a migration
// (and the prod-ledger risk MIGRATIONS.md documents) to re-expose a row the client may already read.

import { SEASON, type SeasonPhase } from '@/lib/economy/forge-pass';
import { supabase } from '@/lib/supabase';

export type SeasonWindow = {
  /** 'S1' */
  id: string;
  /** 'Emberfall' */
  name: string;
  /** Epoch ms, or null when the row has no window configured. */
  startsAt: number | null;
  endsAt: number | null;
  claimWindowDays: number;
};

/** The bundled copy (forge-pass.ts) — the first paint and offline fallback, never the authority. */
export const BUNDLED_SEASON_WINDOW: SeasonWindow = {
  id: SEASON.id,
  name: SEASON.name,
  startsAt: SEASON.startsAt,
  endsAt: SEASON.endsAt,
  claimWindowDays: SEASON.claimWindowDays,
};

type SeasonRow = {
  id?: string;
  name?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  claim_window_days?: number | null;
};

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export async function fetchSeasonWindow(): Promise<SeasonWindow> {
  const { data, error } = await supabase.from('economy_config').select('value').eq('key', 'season').maybeSingle();
  if (error) throw error;
  const v = ((data as { value: SeasonRow } | null)?.value ?? {}) as SeasonRow;
  return {
    id: v.id ?? BUNDLED_SEASON_WINDOW.id,
    name: v.name ?? BUNDLED_SEASON_WINDOW.name,
    startsAt: toMs(v.starts_at),
    endsAt: toMs(v.ends_at),
    claimWindowDays: v.claim_window_days ?? 0,
  };
}

/**
 * season_phase() (0074), line for line, over a given window. Differs from forge-pass.ts's
 * seasonPhase() only in taking the window as an argument — and in the null case: a row with no
 * window is 'live', which is the server's deliberate failure mode ("a misconfigured window should
 * not silently switch the whole economy off").
 */
export function phaseOf(w: SeasonWindow, now: number = Date.now()): SeasonPhase {
  if (w.startsAt === null || w.endsAt === null) return 'live';
  if (now < w.startsAt) return 'upcoming';
  if (now < w.endsAt) return 'live';
  if (now < w.endsAt + w.claimWindowDays * 86_400_000) return 'claim-window';
  return 'closed';
}
