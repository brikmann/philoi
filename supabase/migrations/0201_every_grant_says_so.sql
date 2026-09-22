-- 0201 — Every grant says so: bell + push for every achievement, and a push path that can tell a
-- dead phone from a live one.
--
-- notify_event() (0135) is the ONE emitter: it always writes the notification_events bell row, then
-- pushes through notify_push_raw → Expo in the same transaction. Anything routed through it lands in
-- both places. The gap was that several grants never called it. Verified on prod before writing
-- this (prosrc of every grant path):
--
--   silent before 0201                         now emits
--   ─────────────────────────────────────────  ─────────────────────────────────────────────
--   a goal completing (drip, non-milestone)    goal_complete     — via the goal_day_awards trigger
--   a personal goal's grant_reward crate       reward_ready      — from economy_on_challenge_completed
--   season settlement (crate/badge/title)      season_settled    — once per user per scope
--   send_friend_request                        friend_request
--   respond_friend_request (accept)            friend_accepted
--   grant_forge_pass (first grant only)        pass_unlocked
--   economy_grant_badge (new badge only)       badge_earned
--
-- NOT emitted from inside grant_reward itself, deliberately. Of its four callers, two already
-- announce the result they paid — economy_on_social_challenge_closed (challenge_won / challenge_lost
-- / campfire_settled) and settle_team_match (campfire_settled) — so a grant-level emit would
-- double-notify every social challenge. The two silent callers are announced at the call site
-- instead, which gives the same "no crate lands unannounced" guarantee without duplicates.
--
-- NOT emitted from open_loot_box. Opening a box is something the user just did, on a screen that is
-- revealing its contents; the crate's ARRIVAL is what needed announcing, and that is covered above.
--
-- PUSH DEFAULTS. notification_push_default() excludes a short list of spammy types; every type added
-- here is outside it, so all of them PUSH by default. They are filed into existing categories so a
-- user can still mute them from Settings → Notifications: goal_complete under Challenges (was falling
-- through to Friends & social), pass_unlocked / badge_earned under Season & rank.
--
-- DEAD TOKENS. notify_push_raw fired net.http_post and never read the answer, so a token Expo had
-- rejected as DeviceNotRegistered was retried forever, and there was no record of whether any push
-- had ever landed. Each dispatch now records its pg_net request id and the tokens in message order;
-- a cron job reads Expo's tickets back out of net._http_response (which pg_net keeps only for a few
-- hours), prunes DeviceNotRegistered tokens, and keeps a per-dispatch delivery summary so coverage
-- is measurable.
--
-- Every function below is restated from its LIVE body on prod (pg_get_functiondef), changed only
-- where marked 0201.

-- ═══════════════════════════════ 1 · categories ═══════════════════════════════

create or replace function public.notification_category(p_type text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in',
                    'milestone_cheered', 'milestone_posted',
                    'agora_cheered', 'agora_commented',
                    'check_in', 'reaction') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered',
                    'challenge_invite', 'challenge_forfeited', 'challenge_change_request',
                    'challenge_change_answered', 'challenge_terms_updated',
                    -- 0164 · the vouch flow. Filed with challenges rather than friends_social even
                    -- though a vouch request comes FROM a friend: what it is about is a goal and
                    -- its reward, and somebody muting friend chatter still wants to be asked.
                    'vouch_requested', 'vouch_passed', 'vouch_settled',
                    -- 0201 · a goal completing. Without this it fell to the else-arm and muting
                    -- friend chatter would have silenced it.
                    'goal_complete') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message',
                    'join_request', 'join_request_approved', 'campfire_admin_granted',
                    'chat_batch', 'mention',
                    'campfire_ping',
                    -- 0162 · fires at every member of a campfire, so the campfire toggle governs it.
                    'challenge_hosted') then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone',
                    'session_complete',
                    'streak_risk', 'lock_in_nudge', 'lockin_still_here') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready',
                    -- 0201 · the pass and badges are rewards, filed with the other rewards.
                    'pass_unlocked', 'badge_earned')
      then 'season_rank'
    else 'friends_social'
  end;
$function$;

-- ═══════════════════════════════ 2 · a goal completing ═══════════════════════════════
--
-- The goal_day_awards trigger (AFTER UPDATE OF embers) already announced streak MILESTONES; a plain
-- completion was silent. It now fires on the FINALISING write — the update that sets streak_len
-- (economy_award_goal_day_for inserts the claim row at 0/0, then updates it once) — so it covers
-- every drip path, client award and lock-in credit alike, exactly once per goal-day. A payout the
-- weekly cap clipped to 0 is still a completed goal and still announced; the copy just omits embers.

create or replace function public.economy_on_goal_day_awarded()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_milestones jsonb := (select value -> 'milestones' from economy_config where key = 'goal_rewards');
  v_bonus int;
  v_goal record;
  v_what text;
begin
  -- 0201 — the finalising write only. economy_award_goal_day_for inserts the row at streak 0 and
  -- updates it exactly once with the real streak and embers; that update is the completion.
  if coalesce(old.streak_len, 0) > 0 or coalesce(new.streak_len, 0) <= 0 then
    return new;
  end if;

  v_bonus := coalesce((v_milestones ->> new.streak_len::text)::int, 0);
  if v_bonus > 0 and new.embers > 0 then
    perform notify_event(
      array[new.user_id], 'goal_streak_milestone',
      new.streak_len || '-day streak',
      '+' || new.embers || ' embers banked.',
      null, new.goal_id,
      -- No deep route: mock 103 already fired inline when they completed the goal. This row is the
      -- RECORD of it, and the tab is where the goal itself lives.
      null, '{}'::jsonb,
      null, 'flame',
      jsonb_build_object('streak', new.streak_len, 'embers', new.embers)
    );
    return new;
  end if;

  -- 0201 — a plain completion: "Weekly goal complete · 10,000 steps · +12 embers".
  select c.period, c.label, c.target, c.unit into v_goal from challenges c where c.id = new.goal_id;
  v_what := coalesce(
    nullif(trim(v_goal.label), ''),
    trim(to_char(v_goal.target, 'FM999,999,990.##')) || ' ' || coalesce(v_goal.unit, '')
  );

  perform notify_event(
    array[new.user_id], 'goal_complete',
    case v_goal.period
      when 'week' then 'Weekly goal complete'
      when 'day' then 'Daily goal complete'
      else 'Goal complete'
    end,
    trim(v_what) || case when new.embers > 0 then ' · +' || new.embers || ' embers' else '' end,
    null, new.goal_id,
    '/(tabs)/challenges', '{}'::jsonb,
    null, 'flame',
    jsonb_build_object('period', v_goal.period, 'embers', new.embers, 'streak', new.streak_len)
  );
  return new;
end;
$function$;

-- ═══════════════════════════════ 3 · a personal goal's crate ═══════════════════════════════
--
-- Restated from 0200's body (applied immediately before this), adding only the announcement.

create or replace function public.economy_on_challenge_completed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_sig numeric;
  v_cap text;
  v_receipt jsonb;
  v_crate text;
  v_embers int;
  v_what text;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- 0162 — a goal minted BY a campfire challenge is that challenge's counter, not a second prize.
  -- evaluate_pass_achievements still runs: pass progress is a record of what they did, and they
  -- did do it.
  if new.challenge_source_id is not null then
    perform evaluate_pass_achievements(new.user_id);
    return new;
  end if;

  -- WAS A LITERAL 1.0 — see 0159's header. That constant is what made every completed goal an
  -- Ignition Crate, and it is also the reason `uncommon` is pinned at significance 1.0 in
  -- tier_payout: an unscoped goal resolves to exactly the number that was hard-coded here, so
  -- nothing in flight changes what it pays.
  v_sig := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0);
  v_cap := goal_paid_band(new.difficulty_tier, new.verifiability);

  -- 0167 — THE RETURN VALUE IS KEPT. Identical call, identical arguments, `perform` → `select into`.
  select grant_reward(
    new.user_id, 'friend_h2h', v_sig,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id,
    v_cap
  ) into v_receipt;

  -- 0167 — the receipt, plus the two facts the reveal needs that grant_reward has no way to know:
  -- WHICH LEVEL the goal settled at, and what tier it was scoped to. `band` inside v_receipt is
  -- already the band actually paid (grant_reward applies v_cap before returning), so the reveal
  -- reads the honest figure without re-pricing anything.
  --
  -- 0200 — and the receipt is RE-ARMED: reward_seen_at goes back to null with every new receipt, so
  -- a recurring goal's second, third, fourth completion can each be revealed. `settled_at` rides
  -- in the payload because rollover clears completed_at and the inbox still has to order this.
  update challenges
     set reward_payload = coalesce(v_receipt, '{}'::jsonb)
                          || jsonb_build_object(
                               'verifiability', new.verifiability,
                               'tier', new.difficulty_tier,
                               'max_band', v_cap,
                               'period', new.period,
                               'settled_at', now()
                             ),
         reward_seen_at = null
   where id = new.id;

  -- 0201 — announce the crate. The display names are a fourth copy of the box catalog (boxes.ts is
  -- the first); presentation only, and an unknown key falls back to a generic word rather than
  -- printing a database value.
  -- A SEARCHED case, not `case x when null`: `null = null` is null, so that arm could never match
  -- and a crate-less receipt would have announced "A crate earned".
  v_crate := case
    when v_receipt ->> 'box' is null          then null
    when v_receipt ->> 'box' = 'kindling'     then 'Kindling'
    when v_receipt ->> 'box' = 'ignition'     then 'Ignition Crate'
    when v_receipt ->> 'box' = 'furnace'      then 'The Furnace'
    when v_receipt ->> 'box' = 'hestia'       then 'Vessel of Hestia'
    when v_receipt ->> 'box' = 'hephaestus'   then 'Hephaestus'' Chest'
    when v_receipt ->> 'box' = 'promethean'   then 'Promethean Vault'
    else 'A crate'
  end;
  v_embers := coalesce((v_receipt ->> 'embers')::int, 0);
  v_what := coalesce(
    nullif(trim(new.label), ''),
    trim(to_char(new.target, 'FM999,999,990.##')) || ' ' || coalesce(new.unit, '')
  );
  if v_crate is not null or v_embers > 0 then
    perform notify_event(
      array[new.user_id], 'reward_ready',
      coalesce(v_crate || ' earned', '+' || v_embers || ' embers earned'),
      'For ' || trim(v_what) ||
        case when v_crate is not null and v_embers > 0 then ' · +' || v_embers || ' embers' else '' end ||
        case when v_crate is not null then '. Open it from your inventory.' else '.' end,
      null, new.id,
      '/inventory', '{}'::jsonb,
      null, null,
      jsonb_build_object('box', v_receipt ->> 'box', 'box_id', v_receipt ->> 'box_id', 'embers', v_embers)
    );
  end if;

  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$function$;

-- ═══════════════════════════════ 4 · season settlement ═══════════════════════════════
--
-- One season_settled per user per scope. The participation badge granted inside the same loop is
-- quieted (philoi.quiet_badge, transaction-local) so a season close is one notification, not two.

create or replace function public.close_season_scope(p_season text, p_scope text, p_key text default null::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_paid int := 0;
  v_is_global boolean := (p_scope = 'global');
  v_stamp_prefix text := case when p_scope = 'global' then '🌍 GLOBAL' else '🎓 ' || upper(coalesce(p_key, '')) end;
  r record;
  v_pct numeric;
  v_band text;
  v_title season_titles;
  v_rarity text;
  v_stamp text;
begin
  insert into season_closures (season_id, scope, scope_key)
  values (p_season, p_scope, coalesce(p_key, ''))
  on conflict do nothing;
  if not found then return 0; end if;

  -- 0201 — the season_settled notification below speaks for the participation badge.
  perform set_config('philoi.quiet_badge', 'on', true);

  for r in
    select p.id as user_id,
           row_number() over (order by universal_score(p.id) desc) as rank,
           count(*) over () as board_size
    from profiles p
    where not p.is_demo and not p.is_disabled
      and (p_scope <> 'uni' or (p.university = p_key and p.university_email_verified))
  loop
    v_pct := r.rank::numeric / greatest(r.board_size, 1);
    perform grant_reward(r.user_id, 'season', 1.0, 90, r.board_size::int, v_pct, true, null);

    -- Everyone who met the floor keeps a dated participation badge (§4b).
    perform economy_grant_badge(r.user_id, 'season-participant-' || p_season, 'Season ' || p_season || ' · took part');

    v_band := season_band(r.rank::int, r.board_size::int);

    if v_band is not null then
      select * into v_title from season_titles st where st.season_id = p_season and st.band = v_band;

      if v_title.cosmetic_key is not null then
        -- Global reads one notch hotter than the same cut on a single campus (mock 66). The podium
        -- gods are already Mythic, so this only ever moves the percentile bands.
        v_rarity := case when v_is_global then rarity_notch_up(v_title.rarity) else v_title.rarity end;
        v_stamp := v_stamp_prefix || ' ' ||
          case v_band
            when 'rank_1' then '#1'
            when 'rank_2' then '#2'
            when 'rank_3' then '#3'
            when 'p1' then '· TOP 1%'
            when 'p10' then '· TOP 10%'
            when 'p25' then '· TOP 25%'
            else '· TOP 50%'
          end || ' · ' || p_season;

        perform economy_grant_title(
          r.user_id, v_title.cosmetic_key,
          'Season ' || p_season || ' · ' || p_scope || ' placement #' || r.rank,
          v_stamp,
          v_rarity
        );
        perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'title', v_title.cosmetic_key,
                                 v_title.title, v_rarity, true, null);

        if v_title.banner_asset is not null then
          perform economy_grant_cosmetic(r.user_id, v_title.banner_asset, 'banner', v_rarity, 'earned',
                                         'Season ' || p_season || ' · ' || v_title.title);
          perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'banner', v_title.banner_asset,
                                   v_title.title || ' Banner', v_rarity, true, null);
        end if;
      end if;
    end if;

    -- 0201 — the season's result, announced once per user per scope.
    perform notify_event(
      array[r.user_id], 'season_settled',
      'Season ' || p_season || case when v_is_global then '' else ' · ' || coalesce(p_key, 'campus') end || ' results are in',
      'You finished #' || r.rank || ' of ' || r.board_size || '. Your rewards are in your inventory.',
      null, null,
      '/inventory', '{}'::jsonb,
      null, null,
      jsonb_build_object('season', p_season, 'scope', p_scope, 'rank', r.rank, 'board_size', r.board_size)
    );

    v_paid := v_paid + 1;
  end loop;

  perform set_config('philoi.quiet_badge', 'off', true);
  return v_paid;
end;
$function$;

-- ═══════════════════════════════ 5 · friend requests ═══════════════════════════════
--
-- friend_request / friend_accepted have existed as types since 0086 and the settings screen
-- advertises them; nothing emitted either. Routes are ones every installed build already has.

create or replace function public.send_friend_request(p_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_user_id = auth.uid() then
    raise exception 'You can''t friend yourself.';
  end if;
  if exists (
    select 1 from friend_requests
    where (requester_id = auth.uid() and recipient_id = p_user_id)
       or (requester_id = p_user_id and recipient_id = auth.uid())
  ) then
    raise exception 'A request already exists between you two.';
  end if;

  insert into friend_requests (requester_id, recipient_id, status)
  values (auth.uid(), p_user_id, 'pending');

  -- 0201
  perform notify_event(
    array[p_user_id], 'friend_request',
    coalesce((select coalesce(nullif(trim(display_name), ''), handle) from profiles where id = auth.uid()), 'Someone')
      || ' sent you a friend request',
    'Tap to answer.',
    auth.uid(), auth.uid(),
    '/add-friend', '{}'::jsonb
  );
end;
$function$;

create or replace function public.respond_friend_request(p_user_id uuid, p_accept boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_accept then
    update friend_requests
    set status = 'accepted', responded_at = now()
    where requester_id = p_user_id and recipient_id = auth.uid() and status = 'pending';
  else
    delete from friend_requests
    where requester_id = p_user_id and recipient_id = auth.uid() and status = 'pending';
  end if;

  if not found then
    raise exception 'No pending request from that person.';
  end if;

  -- 0201 — only an accept is announced. A decline tells the requester nothing, on purpose.
  if p_accept then
    perform notify_event(
      array[p_user_id], 'friend_accepted',
      coalesce((select coalesce(nullif(trim(display_name), ''), handle) from profiles where id = auth.uid()), 'Someone')
        || ' accepted your friend request',
      'You''re friends now.',
      auth.uid(), auth.uid(),
      '/friend-profile', jsonb_build_object('userId', auth.uid())
    );
  end if;
end;
$function$;

-- ═══════════════════════════════ 6 · the Flame Pass ═══════════════════════════════
--
-- Announced on the TRANSITION only. reconcile_my_forge_pass and a retried webhook both call this
-- again for someone who already owns it; they must not re-announce.

create or replace function public.grant_forge_pass(p_user uuid, p_season text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_had boolean;
begin
  -- The buyer's flag, read here — never the caller's: this runs from the webhook on the service role,
  -- where auth.uid() is null.
  if season_phase() <> 'live'
     and not coalesce((select is_dev from profiles where id = p_user), false) then
    raise exception 'The % season is not open for purchase right now.', v_season;
  end if;

  -- 0201 — read before the upsert, so only a first grant is announced.
  select owns_premium into v_had from forge_pass_state where user_id = p_user and season_id = v_season;

  insert into forge_pass_state (user_id, season_id, owns_premium, premium_granted_at)
  values (p_user, v_season, true, now())
  on conflict (user_id, season_id) do update set owns_premium = true, premium_granted_at = now();

  -- The purchase's receipt, in the same transaction as the entitlement (grant_level_zero_unlock, 0074); it is
  -- idempotent, so a webhook that retries cannot grant the flare twice.
  perform grant_level_zero_unlock(p_user);

  if not coalesce(v_had, false) then
    perform notify_event(
      array[p_user], 'pass_unlocked',
      'Flame Pass unlocked',
      coalesce(season_config() ->> 'name', 'The season') || ' is yours — your Level 0 rewards are in your inventory.',
      null, null,
      '/forge-pass', '{}'::jsonb,
      null, 'flame',
      jsonb_build_object('season', v_season)
    );
  end if;
end;
$function$;

-- ═══════════════════════════════ 7 · badges ═══════════════════════════════

create or replace function public.economy_grant_badge(p_user uuid, p_key text, p_provenance text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_new int;
begin
  insert into owned_badges (user_id, badge_key, source, provenance)
  values (p_user, p_key, 'earned', p_provenance)
  on conflict (user_id, badge_key) do nothing;

  -- 0201 — a NEW badge only, and not while a caller has said it is announcing this itself
  -- (close_season_scope's season_settled covers its participation badge).
  get diagnostics v_new = row_count;
  if v_new > 0 and coalesce(current_setting('philoi.quiet_badge', true), 'off') <> 'on' then
    perform notify_event(
      array[p_user], 'badge_earned',
      'New badge earned',
      coalesce(nullif(trim(p_provenance), ''), 'See it on your profile.'),
      null, null,
      '/(tabs)/profile', '{}'::jsonb,
      null, null,
      jsonb_build_object('badge', p_key)
    );
  end if;
end;
$function$;

-- ═══════════════════════════════ 8 · push receipts ═══════════════════════════════

create table if not exists push_dispatches (
  -- pg_net's request id — net._http_response.id once Expo has answered.
  request_id bigint primary key,
  -- The tokens in the SAME ORDER as the messages sent, so Expo's per-message tickets map back.
  tokens text[] not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  ok_count int,
  error_count int,
  pruned_count int,
  -- Non-ok tickets (and request-level failures) as Expo reported them. Tokens are not stored here.
  errors jsonb
);

-- Server-side bookkeeping only: RLS on with no policies, so no client role can read tokens from it.
alter table push_dispatches enable row level security;
revoke all on push_dispatches from public, anon, authenticated;

create or replace function public.notify_push_raw(p_user_ids uuid[], p_title text, p_body text, p_data jsonb default '{}'::jsonb, p_channel_id text default 'accountability'::text, p_image_url text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_messages jsonb;
  v_tokens text[];
  v_request bigint;
  v_pref_key text := case p_data->>'type'
    when 'check_in' then 'campfire_lockins'
    when 'reaction' then 'reactions'
    when 'message' then 'messages'
    when 'chat_batch' then 'messages'
    when 'mention' then 'messages'
    when 'lockin_still_here' then 'campfire_cold'
    when 'streak_risk' then 'streak_risk'
    when 'challenge_invite' then 'challenges'
    when 'challenge_completed' then 'challenges'
    else null
  end;
begin
  -- 0201 — messages and tokens aggregated in ONE ordered pass, so tokens[i] is the i-th message's
  -- recipient and Expo's i-th ticket can be traced back to it.
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'to', t.token,
        'title', p_title,
        'body', p_body,
        'data', p_data,
        'sound', 'default',
        'channelId', p_channel_id
      )
      || case when p_image_url is null then '{}'::jsonb
              else jsonb_build_object('richContent', jsonb_build_object('image', p_image_url)) end
      order by t.token
    ), '[]'::jsonb),
    coalesce(array_agg(t.token order by t.token), '{}')
  into v_messages, v_tokens
  from push_tokens t
  join profiles p on p.id = t.user_id
  where t.user_id = any(p_user_ids)
    and (
      v_pref_key is null
      or (
        coalesce((p.notification_prefs->>'master')::boolean, true)
        and coalesce((p.notification_prefs->>v_pref_key)::boolean, true)
        -- #150 · the category that OWNS this legacy key is authoritative over it. Pure insertion.
        and coalesce(
          (p.notification_prefs->>('cat_' || notification_category_for_pref_key(v_pref_key)))::boolean,
          true)
        and not is_in_quiet_hours(p.notification_prefs)
      )
    );

  if jsonb_array_length(v_messages) = 0 then
    return;
  end if;

  v_request := net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := v_messages
  );

  -- 0201 — remembered so process_push_receipts() can read Expo's answer back.
  insert into push_dispatches (request_id, tokens) values (v_request, v_tokens)
  on conflict (request_id) do nothing;
end;
$function$;

create or replace function public.process_push_receipts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  d record;
  v_body jsonb;
  v_tickets jsonb;
  v_ok int;
  v_err int;
  v_pruned int;
  v_errors jsonb;
  v_dead text[];
  v_done int := 0;
begin
  for d in
    select pd.request_id, pd.tokens, r.status_code, r.content, r.timed_out, r.error_msg
    from push_dispatches pd
    join net._http_response r on r.id = pd.request_id
    where pd.processed_at is null
    order by pd.request_id
    limit 500
  loop
    v_ok := 0; v_err := 0; v_pruned := 0; v_errors := '[]'::jsonb; v_dead := '{}';

    begin
      v_body := d.content::jsonb;
    exception when others then
      v_body := null;
    end;
    v_tickets := v_body -> 'data';

    if d.timed_out or d.status_code is distinct from 200 or jsonb_typeof(v_tickets) is distinct from 'array' then
      -- A request-level failure: nothing is known per token, so nothing is pruned.
      v_err := coalesce(array_length(d.tokens, 1), 0);
      v_errors := jsonb_build_array(jsonb_build_object(
        'request_error', true,
        'status', d.status_code,
        'timed_out', d.timed_out,
        'message', coalesce(d.error_msg, left(coalesce(v_body ->> 'errors', d.content, ''), 300))
      ));
    else
      select
        count(*) filter (where t.ticket ->> 'status' = 'ok'),
        count(*) filter (where t.ticket ->> 'status' is distinct from 'ok'),
        coalesce(jsonb_agg(jsonb_build_object(
          'error', t.ticket -> 'details' ->> 'error',
          'message', left(t.ticket ->> 'message', 200)
        )) filter (where t.ticket ->> 'status' is distinct from 'ok'), '[]'::jsonb),
        coalesce(array_agg(d.tokens[t.ord::int]) filter (
          where t.ticket ->> 'status' = 'error' and t.ticket -> 'details' ->> 'error' = 'DeviceNotRegistered'
        ), '{}')
      into v_ok, v_err, v_errors, v_dead
      from jsonb_array_elements(v_tickets) with ordinality as t(ticket, ord);

      if array_length(v_dead, 1) is not null then
        delete from push_tokens where token = any(v_dead);
        get diagnostics v_pruned = row_count;
      end if;
    end if;

    update push_dispatches
       set processed_at = now(), ok_count = v_ok, error_count = v_err,
           pruned_count = v_pruned, errors = v_errors
     where request_id = d.request_id;
    v_done := v_done + 1;
  end loop;

  -- pg_net keeps responses only a few hours. A dispatch whose response is gone can never be read,
  -- so it is closed out as unknown rather than left pending forever.
  update push_dispatches
     set processed_at = now(), errors = jsonb_build_array(jsonb_build_object('response_expired', true))
   where processed_at is null and created_at < now() - interval '12 hours';

  -- The summary is what makes delivery measurable; the raw rows are kept a fortnight.
  delete from push_dispatches where created_at < now() - interval '14 days';

  return v_done;
end;
$function$;

revoke all on function public.process_push_receipts() from public, anon, authenticated;

select cron.unschedule('philoi-push-receipts')
 where exists (select 1 from cron.job where jobname = 'philoi-push-receipts');
select cron.schedule('philoi-push-receipts', '*/10 * * * *',
                     $cron$select process_push_receipts();$cron$);

-- ═══════════════════════════════ assertions ═══════════════════════════════

do $assert$
declare
  f text;
begin
  if notification_category('goal_complete') <> 'challenges' then
    raise exception '0201: goal_complete is not filed under challenges';
  end if;
  if notification_category('pass_unlocked') <> 'season_rank' or notification_category('badge_earned') <> 'season_rank' then
    raise exception '0201: pass_unlocked / badge_earned are not filed under season_rank';
  end if;
  foreach f in array array['goal_complete', 'reward_ready', 'season_settled', 'friend_request',
                           'friend_accepted', 'pass_unlocked', 'badge_earned'] loop
    if not notification_push_default(f) then
      raise exception '0201: % would not push by default', f;
    end if;
  end loop;
  foreach f in array array['economy_on_goal_day_awarded', 'economy_on_challenge_completed', 'close_season_scope',
                           'send_friend_request', 'respond_friend_request', 'grant_forge_pass',
                           'economy_grant_badge'] loop
    if (select prosrc from pg_proc where proname = f) !~ 'notify_event' then
      raise exception '0201: % does not emit through notify_event', f;
    end if;
  end loop;
  if (select prosrc from pg_proc where proname = 'notify_push_raw') !~ 'insert into push_dispatches' then
    raise exception '0201: notify_push_raw does not record its dispatch';
  end if;
  if not exists (select 1 from cron.job where jobname = 'philoi-push-receipts') then
    raise exception '0201: philoi-push-receipts is not scheduled';
  end if;
  if has_table_privilege('authenticated', 'public.push_dispatches', 'select') then
    raise exception '0201: push_dispatches is readable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.process_push_receipts()', 'execute')
     or has_function_privilege('authenticated', 'public.process_push_receipts()', 'execute') then
    raise exception '0201: process_push_receipts is callable by a client role';
  end if;
end;
$assert$;
