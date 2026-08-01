// One-shot generator for migration 0056 — see that file's header. Kept out of the migration
// itself so the SQL stays a plain, reviewable artifact rather than something assembled at push
// time. Copies both watch-RPC bodies verbatim from the migrations that last defined them and
// changes ONLY the status predicate, so there's no chance of a hand-transcription drift in a
// 90-line plpgsql function.
const fs = require('fs');

function extract(file, startRe) {
  const src = fs.readFileSync(file, 'utf8');
  const i = src.search(startRe);
  if (i < 0) throw new Error('start not found in ' + file);
  const j = src.indexOf('\n$$;', i);
  if (j < 0) throw new Error('end not found in ' + file);
  return src.slice(i, j + 4);
}

const h2h = extract('supabase/migrations/0041_challenge_cheers.sql', /^create function get_challenge_watch/m);
const grp = extract('supabase/migrations/0040_parthenon_leaderboard.sql', /^create or replace function get_group_challenge_watch/m);

const OLD_H = "where id = p_challenge_id and status = 'active';";
const NEW_H = "where id = p_challenge_id and status in ('active', 'completed', 'expired');";
const OLD_G = "where id = p_challenge_id and status = 'active' and mode = 'group';";
const NEW_G = "where id = p_challenge_id and status in ('active', 'completed', 'expired') and mode = 'group';";

if (!h2h.includes(OLD_H)) throw new Error('h2h status predicate not found — body changed since 0041');
if (!grp.includes(OLD_G)) throw new Error('group status predicate not found — body changed since 0040');

const header = `-- Punchlist 4E: a COMPLETED challenge should be tappable and open its final standings.
--
-- Both watch RPCs hard-gated on status = 'active' and raised "Challenge not found or not active."
-- otherwise, so routing a finished challenge to watch/[challengeId] would have thrown instead of
-- showing a recap. Widened to also accept completed/expired.
--
-- Safe as a read-only recap: scores come from social_challenge_score(user, metric, starts_at,
-- ends_at), and once ends_at is in the past that window is fixed — so the same query that renders
-- live standings renders FINAL standings for a finished challenge, with no separate code path.
-- The access gate (circle-mate / friend+opt-in / participant) is unchanged, and cheer_challenge
-- deliberately KEEPS its active-only gate: you can watch a finished duel, not cheer one.
--
-- Bodies below are copied verbatim from 0041 (h2h) and 0040 (group) with ONLY the status
-- predicate changed, so the RETURNS TABLE shapes are identical and CREATE OR REPLACE is safe.
`;

const out =
  header +
  '\n' +
  h2h.replace(OLD_H, NEW_H).replace(/^create function/, 'create or replace function') +
  '\n\n' +
  grp.replace(OLD_G, NEW_G) +
  '\n';

fs.writeFileSync('supabase/migrations/0056_watch_completed_challenges.sql', out);
console.log('written', out.split('\n').length, 'lines');
