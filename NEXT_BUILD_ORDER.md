# Next build order — from `integration-wave0` to a smoke-tested build

Wave-0 is merged + deployed (schema at **0132**, server-side verified, #151 closed). This sequences everything left: the urgent security fix, the three small features that share one native rebuild, and the on-device smoke that finally closes "deployed vs verified." Migration numbers continue from **0133**.

**Carry the wave's hard lesson:** the three worst bugs were *semantic* collisions — a later migration **restated an earlier function and silently reverted it** (0127→0122, 0129→session_complete), invisible to git and tsc. So: **every migration below is additive-only. Do NOT restate any function from 0112–0132.** If you must touch one, splice onto its extracted body and prove `prosrc` before/after removes zero lines — the way the integrator did.

---

## Step 0 · Preconditions (do first, in order)
1. **Push `integration-wave0`** and make it the mainline/base. It's 25 commits deep and currently **local-only** — everything below branches off it, and it carries the #151 revoke + the three clobber fixes that must not be lost.
2. **Enable PITR** (#153). It's off; the last deploy's backup gate was met only by a 16h-old daily snapshot. Turn it on **before** any of the migrations below touch prod — a bad commit is otherwise fix-forward only.

---

## TRACK A · 🔴 `claim_pass_level` — urgent, server-only, before Sept 10 (#144)
- **Migration 0133.** Server must validate the claimed reward's **content**, not just its shape: ignore whatever the client sends and grant the **authoritative reward for that level** from the server-side pass-track definition. Same fix 0090 did for boxes, same family as #151.
- **Deploy to prod on its own**, ahead of Track B — it's the season-open blocker and needs no client change. Verify with a rollback-wrapped dry-run against prod schema first (the integrator's pattern), then commit, then a self-assert that a spoofed over-claim is denied and a legitimate claim still pays the real amount.
- This can run **in parallel** with Track B's code — it doesn't gate the native build.

---

## TRACK B · The native-rebuild bundle — one build, three features
All three need a fresh native binary anyway, so land them together, not in three builds.

- **#146 · Per-campfire banners — migration 0134.** Add `groups.banner_item_id` (nullable, an owned BANNER key). Repoint Agent 5's owner-only picker to write `groups.banner_item_id` instead of `equipCosmetic`; `campfire-banner-art` reads it per-group with the base-hearth fallback. Additive.
- **#150 · Per-type notification gating — migration 0135.** Add a `type_<event>` gate to `notify_event` so every switch in `settings-notifications` actually suppresses its event (today only the 6 legacy keys are truly gated). Also the authoritative server-side version of the category-override fix Agent 6 patched client-side. Additive — restate nothing.
- **#147 · Background audio — config, no migration.** `app.config.ts` → iOS `UIBackgroundModes:['audio']` + Android foreground-service audio; `sound.ts` → `shouldPlayInBackground` on the ambient player (note: expo-audio ignores `staysActiveInBackground`). This is what forces the native rebuild.
- **#150 remainder · Reaction ping + cheer split — migration 0136.** (a) Add a `lockin_reaction` `notify_event` type and **fire it when someone reacts to your lock-in** — reactions don't push today, so this creates the path — gated by a new **"Reactions"** toggle. (b) Split `challenge_cheered` onto its **own "Cheers" sub-toggle** under the Challenges category (a cheer is a push tick / dopamine loop, not a result); **"Invites & results" maps only** invites + won / lost / settled. Additive — restate nothing.

Deploy 0134 + 0135 + 0136 to prod (PITR now on) via the same guarded flow: rollback dry-run against prod schema → commit ascending → re-run verify on the persisted state → watch the next `pg_cron` finalize tick.

---

## Step 4 · Cut ONE Android build + device smoke (#152) — Noah's device
Off `integration-wave0` + Tracks A/B. This closes the gap the schema-only deploy left open. Walk, on-device:
- **Wave-0 surfaces:** Agora feed at all 4 scopes; a placement challenge create→settle; a rank-up paying embers + a box; cards / halos / flares / particles rendering; keep-awake holding through a lock-in; the drawer nav.
- **This bundle:** set a per-campfire banner as owner (#146); toggle a per-type notification off and confirm that push actually stops (#150); lock the phone mid-session and confirm audio keeps playing (#147).

Until this passes, the wave is *deployed*, not *verified*.

---

## Order in one line
**push branch → enable PITR → deploy `claim_pass_level` (0133, before Sept 10) → deploy the bundle migrations (0134/0135) → cut one native build (adds #147 config + #146/#150 client UI) → on-device smoke of the wave + the bundle.**

Parallel-safe: Track A's migration and Track B's code can be written at the same time; only the **prod deploys** serialize (0133 before 0134/0135), and only after **PITR is on.**
