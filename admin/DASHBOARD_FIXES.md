# Admin dashboard — analytics fix tickets

Findings from a review of the metrics page + `analytics_*` views (2026-07-20).
Ordered by impact on trusting the numbers. P0 = fix before relying on the dashboard.

**Status: P0-1, P0-2, P0-3, P1-1, and P1-2 are all fixed** (`supabase/migrations/0005_dashboard_fixes.sql`
and `0006_exclude_demo_accounts.sql`). Kept below as the reviewable history of what was
found and why — P2 notes are still just things to know when reading the charts, not bugs.

---

## P0-3 — Demo accounts leak into live metrics (flag mismatch) — FIXED (0006)

**Where:** every `analytics_*` view in `supabase/schema.sql`, `analytics_top_circles`, and `admin/src/app/(dashboard)/metrics/page.tsx`'s standalone check-ins query.

**Problem:** the seed script `scripts/seed-demo-circles.js` marks its 4 demo profiles `is_demo = true` (Jordan, Casey, Riley, Sam + their circles Sunrise Lift, Couch to 5K, Push Day Collective, run club). But the analytics views only excluded `is_admin` and `is_test` — **not `is_demo`** — so all 4 demo users and their 4 seeded circles were counted in total signups, DAU/WAU, check-ins, retention, activation funnel, and top circles.

**Second bug found while fixing this:** `schema.sql` had a *second*, unfiltered redefinition of `analytics_daily_active_users`/`analytics_weekly_active_users` further down the file (near the storage-policy section). `create or replace view` is order-dependent, so that stray copy silently won over the filtered ones defined earlier — DAU/WAU in production weren't excluding even `is_admin`/`is_test`, let alone `is_demo`. Deleted; a single definition of each view now lives in the main analytics block.

**Intended behavior (confirmed with Noah):** keep demos flagged `is_demo` — do NOT relabel them as `is_test`. Just also exclude `is_demo` from the metrics.

**Fix applied:** `and not is_demo` (or `and not p.is_demo` for aliased forms) added everywhere `is_admin`/`is_test` was already excluded — `analytics_daily_signups`, `analytics_event_counts`, `analytics_retention`, `analytics_viral_coefficient`, `analytics_daily_active_users`, `analytics_weekly_active_users`, `analytics_by_university`, `analytics_activation_funnel`, `analytics_user_last_active`, `analytics_top_circles`. Metrics page's `excludedProfiles` query now also matches `is_demo.eq.true`. `noahbrikman@gmail.com` (second founder) is now seeded into `is_admin = true` alongside `spikeythedoge1@gmail.com`, so his usage is excluded the same way, not just the demo personas'. See `supabase/migrations/0006_exclude_demo_accounts.sql`.

**To apply:** run `supabase/schema.sql` (or just `0006_exclude_demo_accounts.sql`) against the `coaqgcquzywadrghzbfj` project's SQL editor — this is a schema/view change, not something that ships via the Next.js deploy.

**Verify after applying:** total signups drops by 4 and the four seeded circles disappear from Top circles / all metrics; they should still appear in the roster and content browser (those don't use the analytics views).

---

## P0-1 — `analytics_top_circles`: check-in counts inflated by member count

**Where:** `supabase/schema.sql` (~line 2654), also `supabase/migrations/0001_admin_dashboard.sql`.

**Bug:** the view joins `groups → check_ins → group_members` in a single query and then uses non-distinct `count(ci.id)`. The `group_members` join multiplies every check-in row by the circle's member count, so `check_ins_7d` and `check_ins_total` are overstated by ~member_count. A 6-member circle with 10 check-ins reports ~60. Inflation scales with circle size, so larger circles rank artificially higher — corrupts the "top circles by activity" chart (the one used to watch the core beta group).

**Confirm:** `analytics_by_university` (same file, ~line 1137) does the same shape of join but correctly uses `count(distinct ci.id)`.

**Fix:** count distinct, or aggregate check-ins and members in separate subqueries before joining. Example:

```sql
create or replace view analytics_top_circles as
with ci_agg as (
  select group_id,
         count(*) filter (where created_at >= now() - interval '7 days' and removed_at is null) as check_ins_7d,
         count(*) filter (where removed_at is null) as check_ins_total
  from check_ins group by group_id
),
mem_agg as (
  select group_id, count(distinct user_id) as member_count
  from group_members group by group_id
)
select g.id as group_id, g.name, g.emoji,
       coalesce(ci_agg.check_ins_7d, 0)    as check_ins_7d,
       coalesce(ci_agg.check_ins_total, 0) as check_ins_total,
       coalesce(mem_agg.member_count, 0)   as member_count
from groups g
left join ci_agg  on ci_agg.group_id = g.id
left join mem_agg on mem_agg.group_id = g.id
order by check_ins_7d desc;
```

---

## P0-2 — Exclude admin/test accounts from all analytics

**Where:** every `analytics_*` view (schema.sql) + `checkInsTotal` query in `admin/src/app/(dashboard)/metrics/page.tsx`.

**Problem:** nothing excludes admins or test accounts. The admin's own usage inflates signups, DAU, active-7d, check-ins, and retention — defeating the goal of measuring whether the beta is self-sustaining *without the founder poking it*.

**Fix:** filter `where not is_admin` (join/subselect on `profiles`) in the signup/active/retention/check-in views, and exclude the same accounts from `check_ins` count on the metrics page. Consider a `profiles.is_test boolean default false` flag for seed/QA accounts and exclude that too.

---

## P1-1 — Add an activation funnel

**Where:** new view + a card on `metrics/page.tsx`.

**Gap:** the dashboard has no signup → joined/created circle → set goal → first check-in funnel. All the events already exist (`signed_up`, `circle_joined`/`circle_created`, `goal_created`, `first_check_in`), nothing assembles them. This is the "where do people stall" view — highest-value thing for a small beta.

**Fix:** create `analytics_activation_funnel` counting distinct users who reached each step (via `events` name or the underlying tables), render as a funnel/step bar chart. Exclude admin/test accounts (see P0-2).

---

## P1-2 — Per-user / per-circle "days since last activity"

**Where:** new view + a column/section on the content or metrics page.

**Gap:** no roster sorted by last-active. Catching the core group going quiet currently means clicking into each user. 

**Fix:** `analytics_user_last_active` = `max(created_at)` per `user_id` from `events` (or check_ins), surfaced as `now() - last_active`. Sort the user list by it; optionally roll up to a per-circle "days since anyone checked in."

---

## P2 — Definitional notes (not bugs; know these when reading the charts)

- **"Active" includes passive views.** DAU/retention fire on any event, including `leaderboard_viewed`, `rank_viewed`, `chat_opened`. Add an "engaged DAU" = distinct users with `check_in_completed` for the habit-formation signal.
- **Retention is noise at n≈7.** Exact-day D1/D7; one user ≈ 14 points; D7 needs 7 days elapsed to populate. Don't lean on the retention chart during early beta.
- **UTC day boundaries.** `date_trunc('day', created_at)` buckets in UTC, so evening Toronto activity rolls into the next day. Consider `date_trunc('day', created_at at time zone 'America/Toronto')`.

---

## Solid — no action needed

- Invite events are wired in (4 call sites) — viral coefficient will actually populate.
- `analytics_by_university` correctly uses `count(distinct …)`.
- Check-in totals exclude `removed_at` content.
- Admin RLS / `is_admin()` gating and audit logging look sound.
