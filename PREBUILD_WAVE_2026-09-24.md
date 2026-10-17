# Pre-build wave — pause + privacy dial + placement push, then cut the dev build (2026-09-24)

Three features to land before cutting the development build. All on `integration-wave1`. Migrations 0208–0215 are
already live; these take **0216–0218**. Paste each directive into its own Code agent, but **respect the ordering
below** — two of the three touch the same function.

## The three
| # | Feature | Directive | Migration | Touches |
|---|---|---|---|---|
| 1 | **Pause / resume** a lock-in | `CODE_PROMPT_lockin_pause.md` | **0216** | `lock_in_sessions` cols + pause/resume RPCs + `stop_lock_in_session` (restate) |
| 2 | **Season privacy** 3-dial (+ onboarding) | `CODE_PROMPT_season_privacy.md` | **0217** | `rank_visibility` enum, `can_see_rank` (rewrite), `send_daily_placement` (gate to public), `set_rank_visibility` |
| 3 | **Placement movement push** | `CODE_PROMPT_placement_movement.md` | **0218** | `send_daily_placement` (add "climbed from #X to #Y" copy) |

## 🔴 The one hard dependency — read before firing agents
**0217 (privacy) and 0218 (placement push) BOTH restate `send_daily_placement`.** If two agents each restate it from
today's prosrc, whoever's applied second wipes the other's change. So:
- **Build & apply 0217 (privacy) FIRST.** It adds the "public-only" gate to `send_daily_placement`.
- **Then build 0218 (placement push), restating `send_daily_placement` FROM 0217's version** (read live prosrc after
  0217 is applied, or base it on 0217's file). Its movement copy then lands *inside* the public-only gate — which is
  exactly right: private/friends users already get no global push, so movement only fires for public users. No extra
  privacy check needed in 0218.
- **Pause (0216) is independent** — it touches `stop_lock_in_session`, not `send_daily_placement` — so it can be
  built in parallel with 0217.

Also: the **done-screen placement card** (already live) must respect the dial — a **private** user sees only their
own tier ladder, not the "Where You Stand" board; **friends** users see a friends-scoped board. That's the privacy
agent's client work (§2 of its directive), not the placement-push agent's.

## Build order
1. **Parallel:** Pause (0216) + Privacy (0217). Different functions, no collision.
2. **After 0217 lands:** Placement push (0218), restated from 0217's `send_daily_placement`.
Each agent: one-writer lease, per-file `db query` + `migration repair`, dry-run, restate from LIVE prosrc, assert,
never bare `db push`, never `git add -A`, commit narrow.

## Before cutting the build
```powershell
# ledger: 0216, 0217, 0218 all show applied (Remote filled)
npx supabase migration list --linked
# cross-tree gates — the whole point, since ~a dozen sessions merged:
npm run typecheck                        # MUST exit 0
npm run lint
node scripts/check-iap-ids.js
node scripts/check-cosmetic-rarity.js    # 0213's drift guard
# Cindy's classifier still needs its server deploy (unrelated to these three, but do it so EC120 tags right):
npx supabase functions deploy ai-coach --project-ref coaqgcquzywadrghzbfj
```

## Cut it
```powershell
eas build --platform android --profile development
npx expo start --dev-client -c
```

## What this build then carries (for the on-device pass)
Everything from the grade/reward wave already committed — grade card, prize-pool panel (217), done-screen placement
(204), finisher badges, earned-item sale block — **plus** the three new ones: **pause button, the 3-dial privacy
(onboarding + settings), and the placement-movement push.** IAP still won't test in a dev client (Play-install only).
Box gating (0211) stays flag-OFF until you flip it post-build.
