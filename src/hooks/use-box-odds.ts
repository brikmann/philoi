import { useEffect, useState } from 'react';

import { fetchBoxConfig, type BoxConfig, type ServerPity } from '@/lib/api/economy-config';
import { BOXES, BOX_KEYS, type BoxKey } from '@/lib/economy/boxes';
import { oddsTable, sameWeights, type BoxWeights, type OddsRow } from '@/lib/economy/odds';
import { Sentry } from '@/lib/sentry';

// The odds a screen is allowed to print. Always the LIVE weights when they've loaded, because
// those are the ones `economy_roll_rarity` rolls on (migration 0064); the table bundled in
// boxes.ts is a first-paint / offline fallback and nothing more.
//
// Why a fallback at all, when a stale number is the exact failure the disclosure rule targets: a
// disclosure that is absent is worse than one that is a build behind, and the odds have to be on
// screen BEFORE the buy button is reachable, not one round-trip later. The drift check below is
// what keeps the fallback honest — if the server ever rolls on weights the bundled table doesn't
// have, that's a bug report, not something to discover from a Play review.

export type BoxOdds = {
  rows: OddsRow[];
  pity: ServerPity;
  source: 'server' | 'bundled';
};

// Config is a handful of rows that change on the order of a retune, and three surfaces ask for it
// (box detail, the stack sheet, the open flow). One in-flight promise for the session; a failure
// clears it so the next screen retries rather than caching the outage.
let inFlight: Promise<BoxConfig> | null = null;

function loadBoxConfig(): Promise<BoxConfig> {
  inFlight ??= fetchBoxConfig()
    .then((config) => {
      reportDrift(config);
      return config;
    })
    .catch((e: unknown) => {
      inFlight = null;
      throw e;
    });
  return inFlight;
}

let driftReported = false;

/**
 * The anti-parallel-table guard. Screens render the server's numbers, so drift can no longer show
 * a user a wrong odds table — but it CAN still reach a user as a stale first paint, and it means
 * a `formatOddsFlex` share card is quoting a percentage the roll no longer uses. Both are worth a
 * report, once per session.
 */
function reportDrift(config: BoxConfig) {
  if (driftReported) return;
  const drifted = BOX_KEYS.filter((key) => {
    const server = config.odds[key];
    return server && !sameWeights(server, BOXES[key].odds);
  });
  if (drifted.length === 0) return;
  driftReported = true;
  const message = `[odds] economy_config.box_odds no longer matches boxes.ts for: ${drifted.join(', ')}`;
  if (__DEV__) console.warn(message);
  Sentry.captureMessage(message, 'warning');
}

/** Live drop odds for one box, falling back to the bundled table until (or unless) they load. */
export function useBoxOdds(boxKey: BoxKey | null | undefined): BoxOdds {
  const [config, setConfig] = useState<BoxConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBoxConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      // A config read that fails leaves `config` null, which renders the bundled table. There is
      // nothing for the user to do about it and nothing to say — the odds are still on screen.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Config is box-agnostic: the whole row loads once and every box reads out of it.
  }, []);

  const box = boxKey ? BOXES[boxKey] : undefined;
  const fallbackOdds: BoxWeights = box?.odds ?? {};
  const fallbackPity: ServerPity = box?.pity ?? { rarity: 'rare', every: 10 };

  const serverOdds = boxKey ? config?.odds[boxKey] : undefined;
  const serverPity = boxKey ? config?.pity[boxKey] : undefined;

  return {
    rows: oddsTable(serverOdds ?? fallbackOdds),
    pity: serverPity ?? fallbackPity,
    source: serverOdds ? 'server' : 'bundled',
  };
}
