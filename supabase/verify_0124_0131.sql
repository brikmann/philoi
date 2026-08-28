-- Post-deploy verification for migrations 0124–0131 — the challenge-v2, Agora and integration half.
-- The companion to verify_0119_0123.sql, which covers the logic batch.
--
-- SAFE TO RUN AGAINST PRODUCTION: everything happens inside a transaction that ends in ROLLBACK,
-- and `philoi.suppress_push` is set for the duration so nothing this fabricates can reach anyone's
-- phone.
--
--   npx supabase db query --linked -f supabase/verify_0124_0131.sql
--
-- Expected output — any other value is a regression:
--
--   0125 exactly one grant_reward     | 1              <- drop-first worked; no ambiguous overload
--   0125 grant_reward takes a ceiling | yes
--   0125 payload carries box_id       | yes
--   0126 placement create exists      | yes
--   0127 placement arm present        | yes
--   0127 tie branch SURVIVES 0127     | yes            <- see the note below. Do not skip this one.
--   0127 sweep pays a real tie        | yes            <- ditto
--   148 uncapped band                 | apex           <- the problem is real without the ceiling
--   148 uncapped box                  | promethean
--   148 CAPPED band                   | elite
--   148 CAPPED box                    | hephaestus     <- Hephaestus' Chest, never the Vault
--   148 capped pays less              | yes
--   148 ceiling never promotes        | casual
--   148 capped win still mints a box  | yes
--   148 unknown ceiling ignored       | apex           <- a typo must not zero a real reward
--   0128 agora_posts RLS on           | yes
--   0129 agora_comments RLS on        | yes
--   0129 session_complete cat         | streak_reminders  <- 0129 restates the whole CASE
--   0130 feed function exists         | yes
--   0131 photo cleanup trigger        | yes
--   0131 moderation removes a post    | yes
--   0131 moderation removes a comment | yes
--   sanity roster == field mismatches | 0
--
-- ─────────────────────────── WHY TWO OF THESE EXIST ───────────────────────────
--
-- `0127 tie branch SURVIVES 0127` and `0127 sweep pays a real tie` are not checks on 0127's own
-- feature. They are regression guards on 0122, which 0127 reverted once already.
--
-- Postgres cannot replace part of a function, so any migration touching finalize_social_challenges
-- or economy_on_social_challenge_closed restates the whole body. 0127 was written on a parallel
-- branch from 0112's copy — before 0122 made a dead-even duel pay both sides — so it silently
-- carried "a draw pays nobody" back in. No conflict, no error, an entire migration undone. It was
-- caught by verify_0119_0123 and repaired inside 0127.
--
-- The next migration to touch either function will restate it again. These two lines are how that
-- gets noticed the same day instead of by a user who tied a race and got nothing.

begin;

-- Nothing below may notify a real person.
set local philoi.suppress_push = 'on';

create temp table _out(step text, detail text);

-- ─────────────────────────── 0125 · grant_reward ───────────────────────────

insert into _out
select '0125 exactly one grant_reward', count(*)::text
from pg_proc where proname = 'grant_reward';

insert into _out
select '0125 grant_reward takes a ceiling',
       case when 'p_max_band' = any(proargnames) then 'yes' else 'NO' end
from pg_proc where proname = 'grant_reward';

insert into _out
select '0125 payload carries box_id',
       case when prosrc like '%box_id%' then 'yes' else 'NO' end
from pg_proc where proname = 'grant_reward';

-- ─────────────────────────── 0126 / 0127 · placement ───────────────────────────

insert into _out
select '0126 placement create exists',
       case when count(*) > 0 then 'yes' else 'NO' end
from pg_proc where proname = 'create_placement_challenge';

insert into _out
select '0127 placement arm present',
       case when prosrc like '%placement%' then 'yes' else 'NO' end
from pg_proc where proname = 'finalize_social_challenges';

-- The two 0122 regression guards. See the header.
insert into _out
select '0127 tie branch SURVIVES 0127',
       case when prosrc like '%both get the win%' then 'yes' else 'NO — 0122 HAS BEEN REVERTED' end
from pg_proc where proname = 'economy_on_social_challenge_closed';

insert into _out
select '0127 sweep pays a real tie',
       case when prosrc like '%v_my = v_opp and v_my > 0%' then 'yes' else 'NO — 0122 HAS BEEN REVERTED' end
from pg_proc where proname = 'finalize_social_challenges';

-- ─────────────────────────── #148 · the placement ceiling ───────────────────────────
--
-- A semester-long race (120 days) across a 48-strong campfire, won outright. Significance is
-- log(49) * (120/7) ≈ 29, over the apex threshold of 24 — reached entirely on field size and
-- calendar rather than on the result, which is the case the ceiling exists for.
do $cap$
declare
  v_user uuid;
  v_uncapped jsonb;
  v_capped jsonb;
  v_small jsonb;
begin
  select id into v_user from profiles order by created_at limit 1;

  v_uncapped := grant_reward(v_user, 'campfire_group', 1.0, 120, 48, 0.0, true, null);
  v_capped   := grant_reward(v_user, 'campfire_group', 1.0, 120, 48, 0.0, true, null, 'elite');
  -- 14 days, 8 people, won: log(9) * 2 ≈ 1.9 -> 'casual'. A ceiling must never raise this.
  v_small    := grant_reward(v_user, 'campfire_group', 1.0, 14, 8, 0.0, true, null, 'elite');

  insert into _out values ('148 uncapped band', v_uncapped ->> 'band');
  insert into _out values ('148 uncapped box',  coalesce(v_uncapped ->> 'box', '(none)'));
  insert into _out values ('148 CAPPED band',   v_capped ->> 'band');
  insert into _out values ('148 CAPPED box',    coalesce(v_capped ->> 'box', '(none)'));
  insert into _out values ('148 capped pays less',
    case when (v_capped ->> 'embers')::int < (v_uncapped ->> 'embers')::int then 'yes' else 'NO' end);
  insert into _out values ('148 ceiling never promotes', v_small ->> 'band');
  insert into _out values ('148 capped win still mints a box',
    case when (v_capped ->> 'box_id') is not null then 'yes' else 'NO' end);
  insert into _out values ('148 unknown ceiling ignored',
    grant_reward(v_user, 'campfire_group', 1.0, 120, 48, 0.0, true, null, 'nonsense') ->> 'band');
end;
$cap$;

-- ─────────────────────────── 0128–0130 · the Agora ───────────────────────────

insert into _out
select '0128 agora_posts RLS on', case when relrowsecurity then 'yes' else 'NO' end
from pg_class where relname = 'agora_posts';

insert into _out
select '0129 agora_comments RLS on', case when relrowsecurity then 'yes' else 'NO' end
from pg_class where relname = 'agora_comments';

-- 0129 restates notification_category in full and once dropped a type this way (session_complete,
-- added by 0120 on a parallel branch). Same guard as the 0122 pair above.
insert into _out values ('0129 session_complete cat', notification_category('session_complete'));

insert into _out
select '0130 feed function exists', case when count(*) > 0 then 'yes' else 'NO' end
from pg_proc where proname = 'get_agora_feed';

-- ─────────────────────────── 0131 · removal is real ───────────────────────────

insert into _out
select '0131 photo cleanup trigger', case when count(*) > 0 then 'yes' else 'NO' end
from pg_trigger where tgname = 'agora_posts_photo_cleanup';

insert into _out
select '0131 moderation removes a post',
       case when prosrc like '%reported_agora_post_id%' then 'yes' else 'NO' end
from pg_proc where proname = 'admin_resolve_report';

insert into _out
select '0131 moderation removes a comment',
       case when prosrc like '%reported_agora_comment_id%' then 'yes' else 'NO' end
from pg_proc where proname = 'admin_resolve_report';

-- ─────────────────────────── sanity · roster == field ───────────────────────────
--
-- challenge_field is the denominator every payout and every standings row is computed against, and
-- it filters `state = 'accepted'`. If it ever disagrees with the accepted roster for a settled
-- challenge, somebody was paid who should not have been or missed who should have been — the class
-- of bug ledger items 7 and 10 are both about. Live data, so this is a real check and not a
-- fabricated one.
insert into _out
select 'sanity roster == field mismatches', count(*)::text
from (
  select sc.id
  from social_challenges sc
  where sc.circle_id is not null
    and challenge_is_settled(sc.status)
    and exists (select 1 from challenge_participants p where p.challenge_id = sc.id)
    and (select count(*) from challenge_participants p
          where p.challenge_id = sc.id and p.state = 'accepted')
        <> (select count(*) from challenge_field(sc.id, sc.circle_id))
) mismatched;

select step, detail from _out order by step;

rollback;
