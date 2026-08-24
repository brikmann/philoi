# Build prompt — campfire #3: wire the challenge reward screen + share card

Builds the one net-new campfire item (ledger #3). Runs on **`fix/campfire-pass`**. `ChallengeRewardScreen` and
`ChallengeWinShareCard` are fully built with **zero call sites** — wire them per mock 47 and
`DECISION_reward_screen_and_goal_drip.md`. Don't rebuild the components; wire + feed them.

## Server — one forward-only migration `0116_challenge_reward_reveal.sql`
(0112 is on this branch; 0113–0115 are on `fix/app-sweep`. Use **0116**; re-verify it's the next free number at
integration.)

1. **`challenge_participants`** — add:
   - `reward_seen_at timestamptz` (fire-once flag)
   - `reward_payload jsonb` (the reward that actually paid)
2. **Capture the payload at settlement.** In the settlement path that calls `grant_reward` per racer
   (`finalize_social_challenges` / `economy_on_social_challenge_closed`, updated in 0112), store
   `grant_reward(...)`'s returned jsonb — `{embers, box, badge, band, significance}` — into that racer's
   `challenge_participants.reward_payload`, in the same UPDATE that writes `final_rank`/`final_*`.
   🔴 Depends on `0114` (grant_reward): until it deploys, `grant_reward` raises and the payload is empty — the
   client must render gracefully on null (see below). Deploy order stays `0112 → 0113 → 0114 → 0115 → 0116`.
3. **`get_challenge_reward(p_challenge_id uuid) returns jsonb`** — `security definer`, `search_path=public`,
   granted to `authenticated`. For `auth.uid()`, only if they're a participant: return
   `{ placement: final_rank, xp: <bonus_xp_awards for this challenge+user>, payload: reward_payload }`.
   Non-participant / not-settled → empty. It only **reads** what `grant_reward` already paid — never grants.
4. **`mark_challenge_reward_seen(p_challenge_id uuid)`** — sets `reward_seen_at = now()` where
   `user_id = auth.uid() and reward_seen_at is null`. Granted to `authenticated`.

## Client
1. **Fire-once, on first settled view** — in `challenge-info/[challengeId].tsx`: when
   `settled && my_state ∈ {accepted/participant} && reward_seen_at IS NULL`, present **`ChallengeRewardScreen`**
   (modal or route) fed by `get_challenge_reward`. On dismiss → call `mark_challenge_reward_seen` → refetch →
   fall through to the **standings block**. Every later view → standings only.
2. **Deep-link parity** — the `challenge_won` push already deep-links to the challenge; make sure that route
   lands on `challenge-info` so the same fire-once logic runs (don't build a second entry point).
3. **`ChallengeRewardScreen`** renders `placement` + `xp` + `payload.embers/box/badge/band`. Handle a null/zero
   payload gracefully (show placement + XP even if embers/box are null — covers pre-`0114` settlements and
   completion-band results). Primary CTA = **Share** → `ChallengeWinShareCard`.
4. **Share is not one-shot** — add a **Share** affordance to the standings block too, opening
   `ChallengeWinShareCard` (placement + headline stat). Matches the "advertise your wins" ethos.
5. **Losers get a results screen, not a victory screen** — everyone who was a participant sees the reveal once
   (their placement + any consolation), then standings.

## Guardrails
- `security definer` RPCs are `auth.uid()`-scoped; results visible to participants only. Reward math stays
  server-authoritative — this feature **only reads** paid rewards, grants nothing (firewall intact).
- Migration forward-only; **don't run** `db push` / `functions deploy` — list deploy-gated for Noah.

## Verify
- Settle a **duel** and a **group race** → winner and a non-winner each see the reveal **once**, then standings
  on re-open. Share opens with the right placement/stat. `challenge_won` push deep-link fires the reveal.
- `get_challenge_reward` returns empty (no crash) for a non-participant and for an unsettled challenge.
- `npx tsc --noEmit` clean.
