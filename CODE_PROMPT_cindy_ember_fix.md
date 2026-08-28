# Fix — Cindy reads the wrong ember balance

**Bug:** Cindy tells the user they have ~75 embers when the app shows millions. `get_coach_context`
(`0101_ai_coach.sql`) builds the context with `'embers', v_profile.embers` — i.e. `profiles.embers`. That
column is a stale/legacy denormalization; the **real** balance is `ember_wallet.balance` (`0064`), the
materialized wallet that `economy_move_embers` keeps current. The two have diverged, so she reports the wrong
number.

## Fix (server, forward-only migration)
New migration `CREATE OR REPLACE FUNCTION get_coach_context(...)` — identical to the deployed version except the
embers source:

```sql
-- was:  'embers', v_profile.embers,
'embers', coalesce((select balance from ember_wallet w where w.user_id = p_user), 0),
```

- Read the wallet, not `profiles.embers`. `coalesce(..., 0)` covers a user who has no wallet row yet.
- Change **nothing else** in the function — same signature, same firewall (this file still grants nothing),
  same everything.
- If `p_user` isn't the variable name in scope there, use whatever the function already uses for the target
  user id (it's `security definer`, `auth.uid()`-scoped upstream).

## Deploy
- Forward-only migration (next free number). `npx supabase db push`. No `functions deploy` needed — the edge
  function reads the SQL function fresh each call.
- Verify: ask Cindy "how many embers do I have?" → matches the app's wallet exactly.

## While you're here (optional consistency)
`profiles.embers` being out of sync with `ember_wallet.balance` is a latent trap — anything else reading it will
lie too. Either point every reader at the wallet, or drop/att sync the column. Not required for this fix, but
worth a grep for other `profiles.embers` / `.embers` readers.

---

## Separate decision — a shop tool for Cindy (not a bug)
She has no buy/shop tool, so she correctly says she can't. If you want her to help with the shop, add a
`buy_item` tool — but it **spends embers**, so it must be **confirm-gated** ("buy X for N embers — confirm?"),
route through the same purchase path the shop UI uses (firewall intact — she proposes, the real function
charges), and refuse if the balance is short. Leave it out and "I can't shop for you" stays a safe, honest
answer.
