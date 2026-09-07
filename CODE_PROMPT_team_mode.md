# Code Prompt — Campfire Team Mode (ref-tracked matches)

> **🔴 BUILD NOW — Noah greenlit team-mode integration.** This spec is complete and ready to build.
> It's **campfire-only**, additive, and independent of the four-lane work — give it its own agent and
> the **next free migration slot** (after the release close-out lands 0167–0172, this is `0173`).
> Build to mock `design-mocks/177-team-mode-ref.html`. Default scorekeeping = **mode A (final score +
> captain confirm)** so it never competes with a real intramural scoreboard (§1b). Deliver + verify per
> the "Verify / Done" section, then serialized-push its migration per `CODE_PROMPT_release_closeout.md`.


A new **campfire-only** challenge type: two teams play a sport, a **ref** keeps score live, and **everyone on each team gets the same team-flat reward** (winners a tier above losers). Built for intramurals — Philoi as the ref's scoreboard. Match **`design-mocks/177-team-mode-ref.html`** (A create → B campfire card → C ref view → D result). On `integration-wave1`.

## The model (keep it simple — this is the whole point)
- **No individual tracking.** No per-player metrics, no `challenge_racer_score`. A team-match has exactly two teams and one live score each. Complexity killed features before (0162's count bug) — don't reintroduce per-person scoring.
- **Reward is team-flat by tier.** Winning team → every member gets the **winner tier** (e.g. Uncommon / Ignition Crate); losing team → every member gets the **loser tier** (e.g. Common). Everyone who played earns something. Tiers are configurable at create; default winner = loser + 1 rarity.
- **Campfire-exclusive.** This shape can't exist as a solo goal or a 1v1 duel — it's a `social_challenges` row on a `circle_id`, admin/host-created (0162's gate applies).

## §1 · Data
- New challenge shape `team_match` on `social_challenges` (alongside collective/placement). Columns: `sport` (text/enum), `team_a_name`, `team_a_color`, `team_b_name`, `team_b_color`, `score_a int default 0`, `score_b int default 0`, `ref_user_id`, `winner_reward_tier`, `loser_reward_tier`, `match_state` (`draft|live|final`), optional `clock_started_at`.
- **Team rosters:** members join a side (`challenge_participants.team` in {a,b}) — that's the only per-user data, and it's just which team you're on (for the flat reward), not a score.
- **Sport catalog:** a small table or enum with `{key, label, emoji, score_step_label, step_values}` (soccer → "+1 goal" / [1]; basketball → "+1/+2/+3"; volleyball → "+1 point"; etc.). List a lot (mock 177 grid + "custom"). A custom sport = free-text label, default +1 step.

## §1b · 🔴 Don't compete with the official scoreboard — TWO scorekeeping modes
Intramural refs already keep score on the league's own system; asking them to run a *parallel* live scoreboard in Philoi is a non-starter (double-entry = they won't). So Philoi is the **rewards/engagement layer on top of the real game, never the system of record**, and there are two ways to keep score, chosen at create:
- **A · Final score + captain confirm (DEFAULT — for real/officiated games).** Nobody live-tracks. After the game, **one captain enters the final score** ("Red 2 – 1 Blue") and **the other team's captain taps to confirm**. On confirm → settle + reward. **Disagreement → disputed** (stays pending; both re-enter, or the campfire host resolves). This is the intramural path — it never touches the ref's workflow.
- **B · Live scoreboard (OPTIONAL — for pickup games / hype).** The live +/− scorekeeper screen (§2) with the ticking campfire card — for games where nobody has an official board, or when someone just wants the hype. Not required.
- **Reframe "ref" → "scorekeeper," and it can be anyone** (a captain, a spectator, a player) — not necessarily the game's actual referee. Anti-cheese comes from **dual captain confirmation** (mode A) or the single trusted scorekeeper (mode B), not from being the official ref.

## §2 · The scorekeeper (LIVE mode B), and score editing (§C)
- **Ref view** = a dedicated screen, reachable from the match card ("Open ref view") **only for `ref_user_id`**. Two big team panels (colour-coded), the live score, **+ / − controls labelled to the sport** ("+1 goal", or +1/+2/+3 buttons for basketball), a match clock (start/pause), **Undo**, and **End match**.
- **`ref_set_score(challenge_id, team, delta)` / `ref_end_match(challenge_id)` RPCs — gated to `ref_user_id` only** (server-checked; a non-ref call fails). Score edits are the ref's alone.
- **Realtime:** score changes push live to every campfire member via the existing `postgres_changes` subscription on `social_challenges` (the campfire already subscribes for messages). The match card (§B) reflects the ref's edits instantly.
- The **ref can be the creator or any appointed member**; allow reassigning the ref (host-only). One ref at a time.

## §3 · The match card in campfire chat (§B)
- On create, post a **`team_match` card into campfire chat** (reuse the 0162/0163 challenge-card-in-chat path so late joiners see it too): sport + emoji, both teams' names/colours/scores, a **LIVE** dot while `match_state='live'`, the clock, and who's reffing. Members tap → a **watch** view (read-only score); the ref taps → the ref view.
- Card updates live with the score; on final it flips to the result.

## §4 · Settlement — flat team rewards (§D)
- **Settlement triggers on either mode:** mode B → `ref_end_match`; mode A → the **second captain's confirm** of the reported final score (`confirm_team_match_score`). A disputed mode-A score does **not** settle — it stays pending until they agree or the host resolves.
- Higher score wins (handle a tie — either "draw" both get the loser+1 middle tier, or the ref picks; default = draw pays both teams the winner tier, note it). `match_state='final'`.
- **Grant every member of the winning team the winner tier, every member of the losing team the loser tier** — one `grant_reward` per participant at their team's tier, box + embers + (small) XP. No per-person scoring, so it's a straight roster loop.
- Fire the reward reveal for each player (mock D → the standard reveal, "Winners take Uncommon · you earned an Ignition Crate"). A campfire result card in chat: "Full time · Red 2 – 1 Blue."
- **Anti-abuse:** the ref shouldn't be able to mint by spamming matches — cap team-match rewards under the same weekly earned-ember ceiling (`CHALLENGE_REWARD_ALGO.md`), and only credit players actually on a roster.

## §5 · Create flow (§A)
- In the campfire challenge create ("Set a race" / host flow), add **Team mode** as a type. Pick sport (grid + custom), name/colour two teams, appoint the ref, set winner/loser tiers (default winner = loser+1). CTA "Post to campfire."
- Players **pick a side** to join (a simple "Join Red / Join Blue" on the card) before or during the match; roster locks at End match.

## Verify / Done
- Create a soccer team match in a campfire → card posts to chat, members join Red/Blue.
- Ref opens the ref view, taps +1 goal for Red twice, +1 for Blue → the campfire card shows **Red 2 – 1 Blue live** for everyone; a non-ref member cannot edit.
- End match → Red (winners) each get an Uncommon crate, Blue each get a Common; every player gets a reveal; result card posts.
- No individual score anywhere; tie handled per §4; rewards respect the weekly cap.
- Reference: mock 177; `social_challenges` + 0162/0163 (campfire challenge + chat-card + admin gate); the campfire realtime subscription; `grant_reward`; `CHALLENGE_REWARD_ALGO.md` (tiers + cap).
