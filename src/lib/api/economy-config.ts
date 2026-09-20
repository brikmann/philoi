// Reads the LIVE roll weights — the single source of truth for the loot-box odds disclosure.
//
// Unlike everything in inventory.ts this is a plain table select rather than an RPC, and that is
// deliberate: `economy_config` is the row `economy_roll_rarity` itself reads (migration 0064), and
// it already carries a read-only policy for exactly this purpose —
//
//   create policy economy_config_read on economy_config for select to authenticated using (true);
//
// so the disclosure and the roll cannot diverge without the same row changing under both. Wrapping
// it in a new `get_box_odds()` RPC would add a migration (and the prod ledger risk MIGRATIONS.md
// documents) to re-expose a row the client is already allowed to read, and would add a second
// place a future retune could be forgotten. There is no write path here — the table is writable by
// the service role only.

import type { BoxWeights } from '@/lib/economy/odds';
import type { Rarity } from '@/lib/economy/rarity';
import { supabase } from '@/lib/supabase';

export type ServerPity = { rarity: Rarity; every: number };

export type BoxConfig = {
  /** box_key -> rarity -> weight, straight off `economy_config.box_odds`. */
  odds: Record<string, BoxWeights>;
  /** box_key -> the bad-luck backstop, straight off `economy_config.box_pity`. */
  pity: Record<string, ServerPity>;
};

export async function fetchBoxConfig(): Promise<BoxConfig> {
  const { data, error } = await supabase
    .from('economy_config')
    .select('key, value')
    .in('key', ['box_odds', 'box_pity']);
  if (error) throw error;

  const rows = (data ?? []) as { key: string; value: unknown }[];
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    odds: (byKey.get('box_odds') as Record<string, BoxWeights>) ?? {},
    pity: (byKey.get('box_pity') as Record<string, ServerPity>) ?? {},
  };
}
