-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0173 · TWO TEAMS, A SCOREKEEPER, AND ONE FLAT REWARD PER SIDE.
--
-- Spec: CODE_PROMPT_team_mode.md, mock design-mocks/177-team-mode-ref.html.
-- Builds on 0162 (a campfire challenge is hosted by an admin) and 0163 (it belongs to the
-- campfire, and posts its own card into chat).
--
-- ─────────────────────────── WHAT THIS SHAPE IS, AND WHAT IT DELIBERATELY IS NOT ───────────────
--
-- A `team_match` is the fourth shape on social_challenges. Two named, coloured teams; one score
-- each; a roster that says only WHICH SIDE you are on. On full time the whole winning team is
-- paid one tier and the whole losing team one tier below it.
--
-- 🔴 THERE IS NO PER-PLAYER NUMBER ANYWHERE, and that is a constraint rather than an omission.
-- 0162's header is the reason: a campfire count race measured the wrong quantity because
-- challenge_racer_score had to guess what a race with no metric was counting. A team match has no
-- race_metric, no target_count, no target_value and no per-racer score — challenge_racer_score is
-- never called on one, because the only two numbers in the feature live on the challenge row
-- itself (score_a, score_b) and they belong to teams, not to people.
--
-- WHICH MEANS THE SETTLE SWEEP MUST NEVER SEE ONE. finalize_social_challenges loops
-- `challenge_is_live(status) and ends_at <= now()` and then scores every racer. A team match that
-- fell into that loop would settle itself at 0-0 against a metric it does not have.
--
--   · The mechanism is `ends_at is null`. `null <= now()` is NULL, never true, so the sweep's own
--     predicate excludes the row without the sweep being touched. This is not a trick — a team
--     match genuinely has no deadline. It ends when the score is agreed or the scorekeeper ends
--     it, and a column that said otherwise would be a lie the sweep would act on.
--   · It is held there by a CHECK (§1) rather than by the convention of the RPCs that write it,
--     so a later write path cannot re-open the hole.
--   · By the time ends_at IS set (settlement, for the reveal's ordering) status is 'completed',
--     which challenge_is_live already excludes. Both guards hold at once, never neither.
--
-- ─────────────────────────── §1b · TWO WAYS TO KEEP SCORE, AND THE DEFAULT MATTERS ────────────
--
-- Intramural referees already keep score on the league's own system. Asking them to run a second
-- live scoreboard in Philoi is double entry, and double entry is how a feature goes unused. So
-- Philoi is the rewards layer on top of the real game and never the system of record:
--
--   'confirm' (DEFAULT) — nobody tracks anything live. After the game one player reports the
--     final score and a player ON THE OTHER SIDE confirms it. Confirm settles; disagree marks it
--     disputed and it stays pending until they agree or a campfire admin resolves it.
--   'live' — the +/- scorekeeper screen, for pickup games with no official board, or for hype.
--
-- WHO THE "CAPTAIN" IS. The spec asks for dual captain confirmation. There is no captain role in
-- this app and inventing one costs a column, a picker, and a failure mode where the captain is not
-- at the game. What dual confirmation actually buys is that A SCORE CANNOT BE SET BY ONE SIDE
-- ALONE, and that is enforced here by side, not by rank: whoever reports must be rostered on one
-- team and whoever confirms must be rostered on the other. Same anti-cheese, no new role.
--
-- "Ref" is `ref_user_id` and the copy calls them the scorekeeper. It can be a captain, a
-- spectator, or a player — the trust comes from dual confirmation ('confirm') or from being the
-- single appointed scorekeeper ('live'), not from officiating the real game.
--
-- ─────────────────────────── WHAT IS PAID, AND WHAT STOPS IT BEING MINTED ─────────────────────
--
-- One grant_reward per rostered player at their TEAM's tier — 0159's six-name tier vocabulary,
-- resolved through economy_config.tier_payout exactly as economy_on_challenge_completed does. The
-- client sends two tier NAMES and the server prices both; nothing here trusts an ember figure.
--
-- Three rails, because a scorekeeper who can mint boxes by posting matches is a faucet:
--   1. Only rostered players on a side are paid. Watching is not playing.
--   2. A match with an empty side pays nobody. Two teams is the shape; one team is a photo.
--   3. A rolling 7-day ceiling on how many team matches may PAY one person
--      (economy_config.team_match.weekly_paid_matches, default 6). Counted off ember_ledger's own
--      ref_id joined back to shape='team_match', so it measures what was actually paid rather
--      than what was played, and it cannot drift from the ledger.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · the shape, its columns, and its constraints ───────────────────

alter table social_challenges
  add column if not exists sport_key text,
  add column if not exists sport_label text,
  add column if not exists sport_emoji text,
  add column if not exists team_a_name text,
  add column if not exists team_b_name text,
  add column if not exists team_a_color text,
  add column if not exists team_b_color text,
  add column if not exists score_a int not null default 0,
  add column if not exists score_b int not null default 0,
  add column if not exists ref_user_id uuid references profiles (id) on delete set null,
  add column if not exists winner_reward_tier text,
  add column if not exists loser_reward_tier text,
  add column if not exists match_state text,
  add column if not exists score_mode text,
  add column if not exists clock_started_at timestamptz,
  add column if not exists clock_elapsed_s int not null default 0,
  add column if not exists reported_score_a int,
  add column if not exists reported_score_b int,
  add column if not exists reported_by uuid references profiles (id) on delete set null,
  add column if not exists reported_at timestamptz,
  add column if not exists score_disputed boolean not null default false;

comment on column social_challenges.score_a is
  '0173 — team A''s score. A TEAM number, not a sum of player numbers: a team match has no per-player metric at all.';
comment on column social_challenges.ref_user_id is
  '0173 — the appointed SCOREKEEPER. Only this user may move the score in ''live'' mode. Reassignable by a campfire admin; one at a time.';
comment on column social_challenges.match_state is
  '0173 — draft (posted, not started) -> live (playing) -> final (settled and paid). Distinct from status, which stays the challenge lifecycle every other reader matches on.';
comment on column social_challenges.score_mode is
  '0173 — ''confirm'' (default; a final score reported by one side and confirmed by the other, so Philoi never competes with the league''s own scoreboard) or ''live'' (the +/- scorekeeper screen).';
comment on column social_challenges.clock_elapsed_s is
  '0173 — seconds banked from previous running stretches. Live elapsed = clock_elapsed_s + (now() - clock_started_at) when clock_started_at is non-null.';
comment on column social_challenges.score_disputed is
  '0173 — the other side rejected the reported score. The match stays unsettled until both sides agree or a campfire admin resolves it. Nothing is paid on a disputed match.';

/** The sport a match is played in. A TABLE rather than an enum so a sport can be added without a
 *  migration, and so each one can carry HOW ITS SCORE STEPS — "+1 goal" for soccer, +1/+2/+3 for
 *  basketball. The scorekeeper view labels its buttons from these rows. */
create table if not exists match_sports (
  key text primary key,
  label text not null,
  emoji text not null,
  /** "+1 goal", "+1 point" — the singular step, for the big button. */
  score_step_label text not null,
  /** Every step the sport offers, smallest first. One entry means one button. */
  step_values int[] not null default '{1}',
  sort_order int not null default 100
);

alter table match_sports enable row level security;
drop policy if exists "match_sports: read for all" on match_sports;
create policy "match_sports: read for all" on match_sports for select to authenticated using (true);

insert into match_sports (key, label, emoji, score_step_label, step_values, sort_order) values
  ('soccer',        'Soccer',     '⚽', '+1 goal',  '{1}',     10),
  ('basketball',    'Basketball', '🏀', '+1 point', '{1,2,3}', 20),
  ('volleyball',    'Volleyball', '🏐', '+1 point', '{1}',     30),
  ('hockey',        'Hockey',     '🏒', '+1 goal',  '{1}',     40),
  ('flag_football', 'Flag FB',    '🏈', '+1 point', '{1,6}',   50),
  ('ultimate',      'Ultimate',   '🥏', '+1 point', '{1}',     60),
  ('tennis',        'Tennis',     '🎾', '+1 point', '{1}',     70),
  ('table_tennis',  'Table T.',   '🏓', '+1 point', '{1}',     80),
  ('dodgeball',     'Dodgeball',  '🥅', '+1 point', '{1}',     90),
  ('badminton',     'Badminton',  '🏸', '+1 point', '{1}',    100),
  ('cricket',       'Cricket',    '🏏', '+1 run',   '{1,4,6}',110),
  ('softball',      'Softball',   '⚾', '+1 run',   '{1}',    120),
  ('rugby',         'Rugby',      '🏉', '+1 point', '{3,5,7}',130),
  ('handball',      'Handball',   '🤾', '+1 goal',  '{1}',    140),
  ('spikeball',     'Spikeball',  '🟡', '+1 point', '{1}',    150),
  -- The escape hatch. A custom sport carries the creator's own label on the challenge row and
  -- steps by one, because a sport nobody has written down has no known scoring system either.
  ('custom',        'Custom',     '✳️', '+1 point', '{1}',    999)
on conflict (key) do update
  set label = excluded.label,
      emoji = excluded.emoji,
      score_step_label = excluded.score_step_label,
      step_values = excluded.step_values,
      sort_order = excluded.sort_order;

comment on table match_sports is
  '0173 — the sport catalog behind team mode''s picker (mock 177 §A). step_values is what the scorekeeper''s buttons offer: {1} is one big "+1 goal", {1,2,3} is basketball''s three.';

/** Which side you are on, and the ONLY per-user fact a team match records. Not a score, not a
 *  position, not a stat line — the flat reward needs to know your side and nothing else. */
alter table challenge_participants add column if not exists team text;
alter table challenge_participants drop constraint if exists challenge_participants_team_valid;
alter table challenge_participants add constraint challenge_participants_team_valid
  check (team is null or team in ('a', 'b'));

comment on column challenge_participants.team is
  '0173 — ''a'' or ''b'' on a team_match roster; null on every other shape. The only per-user data team mode keeps: which side you played for, which is what picks your flat reward tier.';

create index if not exists challenge_participants_team_idx
  on challenge_participants (challenge_id, team)
  where team is not null;

-- 0096 declared the shape check inline on its ADD COLUMN, so on a database that applied 0096 its
-- name is whatever Postgres generated. Found by DEFINITION, the way 0126 found 0019's — guessing
-- the name would either drop the wrong constraint or fail on a differently-shaped database.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'social_challenges'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%shape%'
       and pg_get_constraintdef(con.oid) like '%collective%'
       and pg_get_constraintdef(con.oid) like '%placement%'
       and pg_get_constraintdef(con.oid) not like '%target%'
  loop
    execute format('alter table social_challenges drop constraint %I', v_name);
  end loop;
end $$;

do $$
begin
  alter table social_challenges add constraint social_challenges_shape_check
    check (shape is null or shape in ('duel', 'collective', 'placement', 'team_match'));

  -- ⚠️ A TEAM MATCH HAS NO BAR, and 0169's constraint requires a group row to have exactly one.
  -- Restated with a team_match arm ahead of the group arm; every other arm is byte-for-byte
  -- 0169's, so no existing row changes validity.
  alter table social_challenges drop constraint if exists social_challenges_mode_target_check;
  alter table social_challenges add constraint social_challenges_mode_target_check check (
    case
      when shape = 'team_match' then
        target_count is null and target_value is null and grade_target is null
      when shape = 'placement' then target_count is null and target_value is null
      when mode = 'group' then
        (target_count is not null)::int
      + (grade_target is not null)::int
      + (target_value is not null)::int = 1
      else target_count is null and target_value is null
    end
  );

  -- Everything a team_match row must be, and everything every other shape must not be. The
  -- `ends_at is null` clause is the one that keeps finalize_social_challenges away — see header.
  alter table social_challenges drop constraint if exists social_challenges_team_match_shape;
  alter table social_challenges add constraint social_challenges_team_match_shape check (
    case when shape = 'team_match' then
      mode = 'group'
      and race_metric is null
      and match_state in ('draft', 'live', 'final')
      and score_mode in ('confirm', 'live')
      and score_a >= 0 and score_b >= 0
      and team_a_name is not null and team_b_name is not null
      and sport_key is not null and sport_label is not null and sport_emoji is not null
      and winner_reward_tier in ('common','uncommon','rare','epic','legendary','mythic')
      and loser_reward_tier  in ('common','uncommon','rare','epic','legendary','mythic')
      -- 🔴 No deadline until it is over. This is what the settle sweep's own predicate reads.
      and (ends_at is null or status = 'completed')
      and (match_state = 'final') = (status = 'completed')
    else
      match_state is null and score_mode is null and sport_key is null
      and team_a_name is null and team_b_name is null and ref_user_id is null
      and winner_reward_tier is null and loser_reward_tier is null
    end
  );

  alter table social_challenges drop constraint if exists social_challenges_team_colors;
  alter table social_challenges add constraint social_challenges_team_colors check (
    (team_a_color is null or team_a_color ~ '^#[0-9A-Fa-f]{6}$')
    and (team_b_color is null or team_b_color ~ '^#[0-9A-Fa-f]{6}$')
  );

  alter table social_challenges drop constraint if exists social_challenges_team_names_len;
  alter table social_challenges add constraint social_challenges_team_names_len check (
    (team_a_name is null or char_length(btrim(team_a_name)) between 1 and 24)
    and (team_b_name is null or char_length(btrim(team_b_name)) between 1 and 24)
    and (sport_label is null or char_length(btrim(sport_label)) between 1 and 24)
  );
end $$;

create index if not exists social_challenges_team_match_circle_idx
  on social_challenges (circle_id, match_state)
  where shape = 'team_match';

-- The rewards rail, as server config rather than a constant in a function body — the rule
-- CHALLENGE_REWARD_ALGO.md §5 applies to every other amount in the economy.
insert into economy_config (key, value)
values ('team_match', jsonb_build_object(
  -- How many team matches may PAY one person in a rolling 7 days. Six is two a week per sport for
  -- three sports, which no real intramural schedule exceeds, and which a scorekeeper posting
  -- matches at their friends cannot profitably beat.
  'weekly_paid_matches', 6,
  'default_winner_tier', 'uncommon',
  'default_loser_tier', 'common',
  -- A draw pays BOTH sides the winner tier. Two teams that went the distance and could not be
  -- separated did the thing; docking both of them for it is the wrong lesson.
  'draw_pays_winner_tier', true,
  -- XP is the abundant currency (CHALLENGE_REWARD_ALGO §Guardrails), so it is the one that can be
  -- flat and generous. Losers get half.
  'winner_xp', 200,
  'loser_xp', 100
))
on conflict (key) do update set value = excluded.value;

-- Realtime: the scorekeeper's edits reach the campfire card through postgres_changes on this
-- table, the way message_reactions reaches the timeline (0171). Guarded identically — the
-- publication does not exist on a bare local database.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'social_challenges')
  then
    alter publication supabase_realtime add table social_challenges;
  end if;
end $$;

-- ─────────────────────────── §2 · "is this person in that campfire?" ───────────────────────────
--
-- `is_group_member` answers this for auth.uid() and every caller in the repo passes it one
-- argument. Team mode has to ask it about SOMEBODY ELSE twice — the appointed scorekeeper at
-- create, and the member a host hands the role to later — and a check that silently asked about
-- the caller instead would let an admin appoint a stranger as scorekeeper.
--
-- Defined as its own function rather than inlined at those two sites so the definition of
-- membership lives in one place, and mirrored from is_campfire_admin (0094) minus the role filter:
-- the campfire OWNER may not have a group_members row, which is exactly why that function tests
-- both and why testing only group_members here would lock an owner out of their own match.
create or replace function campfire_has_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select p_user_id is not null and (
    exists (select 1 from groups g where g.id = p_group_id and g.owner_id = p_user_id)
    or exists (select 1 from group_members gm
                where gm.group_id = p_group_id and gm.user_id = p_user_id)
  );
$fn$;

grant execute on function campfire_has_member(uuid, uuid) to authenticated;
comment on function campfire_has_member(uuid, uuid) is
  '0173 — is THIS user in that campfire. is_group_member answers the same question about auth.uid() only; team mode has to ask it about the scorekeeper it is appointing. Owner-or-member, mirroring is_campfire_admin (0094) without the role filter.';

-- ─────────────────────────── §2b · reading a match ───────────────────────────
--
-- ONE READ FOR EVERY SURFACE — the chat card, the watch view, the scorekeeper view and the result
-- screen are four presentations of the same row and they must not disagree about the score. It
-- also answers the two questions the client would otherwise derive and could get wrong:
-- `am_i_ref` (who may edit) and `my_team` (which reward you are looking at).
--
-- Membership-gated, not roster-gated, and that is 0163's lesson: a member who has not picked a
-- side yet is exactly the person the Join CTA is for, so a read scoped to the roster would render
-- blank for them.
create or replace function get_team_match(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_c social_challenges;
  v_me uuid := auth.uid();
  v_sport match_sports;
begin
  select * into v_c from social_challenges where id = p_challenge_id;
  if v_c.id is null or v_c.shape <> 'team_match' then
    return null;
  end if;
  if not campfire_has_member(v_c.circle_id, v_me) then
    return null;
  end if;

  select * into v_sport from match_sports where key = v_c.sport_key;

  return jsonb_build_object(
    'id', v_c.id,
    'circle_id', v_c.circle_id,
    'circle_name', (select name from groups where id = v_c.circle_id),
    'created_by', v_c.created_by,
    'public_name', v_c.public_name,
    'sport_key', v_c.sport_key,
    'sport_label', v_c.sport_label,
    'sport_emoji', v_c.sport_emoji,
    -- The scorekeeper's buttons. From the catalog, so basketball gets its three and soccer its
    -- one, and a client that has never heard of a newly added sport still labels them correctly.
    'score_step_label', coalesce(v_sport.score_step_label, '+1 point'),
    'step_values', to_jsonb(coalesce(v_sport.step_values, '{1}'::int[])),
    'team_a_name', v_c.team_a_name,
    'team_b_name', v_c.team_b_name,
    'team_a_color', v_c.team_a_color,
    'team_b_color', v_c.team_b_color,
    'score_a', v_c.score_a,
    'score_b', v_c.score_b,
    'match_state', v_c.match_state,
    'score_mode', v_c.score_mode,
    'status', v_c.status,
    'ref_user_id', v_c.ref_user_id,
    'ref_name', (select display_name from profiles where id = v_c.ref_user_id),
    'winner_reward_tier', v_c.winner_reward_tier,
    'loser_reward_tier', v_c.loser_reward_tier,
    'clock_started_at', v_c.clock_started_at,
    'clock_elapsed_s', v_c.clock_elapsed_s,
    'reported_score_a', v_c.reported_score_a,
    'reported_score_b', v_c.reported_score_b,
    'reported_by', v_c.reported_by,
    'reported_by_name', (select display_name from profiles where id = v_c.reported_by),
    'reported_team', (select p.team from challenge_participants p
                       where p.challenge_id = v_c.id and p.user_id = v_c.reported_by),
    'reported_at', v_c.reported_at,
    'score_disputed', v_c.score_disputed,
    'am_i_ref', v_me is not null and v_c.ref_user_id = v_me,
    'am_i_admin', is_campfire_admin(v_c.circle_id, v_me),
    'my_team', (select p.team from challenge_participants p
                 where p.challenge_id = v_c.id and p.user_id = v_me),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id,
               'display_name', pr.display_name,
               'avatar_url', pr.avatar_url,
               'team', p.team)
             order by p.team, pr.display_name)
        from challenge_participants p
        join profiles pr on pr.id = p.user_id
       where p.challenge_id = v_c.id and p.team is not null and p.state = 'accepted'
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function get_team_match(uuid) to authenticated;
comment on function get_team_match(uuid) is
  '0173 — the whole match in one read, for all four of its surfaces. Gated on CAMPFIRE MEMBERSHIP, not on the roster: someone who has not picked a side yet is who the Join CTA is for.';

-- ─────────────────────────── §3 · creating one (mock 177 §A) ───────────────────────────
--
-- 🔒 ADMIN-GATED SERVER-SIDE, same rule and same reason as host_campfire_challenge (0162): the
-- caller's role is re-read out of group_members at the moment of the write, so a forged campfire
-- id fails at the database and the refusal names the campfire.
--
-- ENROLS NOBODY. Every other create path puts the creator on the roster, and doing that here would
-- be wrong twice over: the creator is usually the SCOREKEEPER rather than a player, and a roster
-- entry with no side cannot be paid a side's tier. Players pick a side afterwards, which is what
-- join_team_match is for and what the card's two buttons do.
create or replace function create_team_match(
  p_circle_id uuid,
  p_sport_key text,
  p_team_a_name text,
  p_team_b_name text,
  p_team_a_color text default '#FF6B5C',
  p_team_b_color text default '#6BB8FF',
  p_ref_user_id uuid default null,
  p_score_mode text default 'confirm',
  p_winner_tier text default null,
  p_loser_tier text default null,
  p_custom_sport_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_sport match_sports;
  v_tiers jsonb := (select value from economy_config where key = 'tier_payout');
  v_cfg jsonb := (select value from economy_config where key = 'team_match');
  v_a text := nullif(btrim(coalesce(p_team_a_name, '')), '');
  v_b text := nullif(btrim(coalesce(p_team_b_name, '')), '');
  v_label text;
  v_win_tier text := coalesce(nullif(btrim(coalesce(p_winner_tier, '')), ''),
                              v_cfg ->> 'default_winner_tier', 'uncommon');
  v_lose_tier text := coalesce(nullif(btrim(coalesce(p_loser_tier, '')), ''),
                               v_cfg ->> 'default_loser_tier', 'common');
  v_ref uuid := coalesce(p_ref_user_id, auth.uid());
  v_mode text := coalesce(nullif(btrim(coalesce(p_score_mode, '')), ''), 'confirm');
  v_c social_challenges;
  v_name text;
  v_members uuid[];
  v_host text;
  v_notified int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_group from groups where id = p_circle_id;
  if v_group.id is null then
    raise exception 'That campfire does not exist.';
  end if;
  if not is_campfire_admin(p_circle_id, auth.uid()) then
    raise exception 'You are not an admin of %, so I cannot post a match there.', v_group.name;
  end if;

  select * into v_sport from match_sports where key = p_sport_key;
  if v_sport.key is null then
    raise exception 'Unknown sport.';
  end if;
  -- A custom sport carries the creator's own words; every other one carries the catalog's, so two
  -- matches in the same sport are never labelled two different ways.
  v_label := case
    when v_sport.key = 'custom'
      then coalesce(nullif(btrim(coalesce(p_custom_sport_label, '')), ''), 'Match')
    else v_sport.label
  end;

  if v_a is null or v_b is null then
    raise exception 'A match needs two named teams.';
  end if;
  if lower(v_a) = lower(v_b) then
    raise exception 'The two teams need different names.';
  end if;
  if v_mode not in ('confirm', 'live') then
    raise exception 'Unknown scorekeeping mode.';
  end if;
  if v_win_tier not in ('common','uncommon','rare','epic','legendary','mythic')
     or v_lose_tier not in ('common','uncommon','rare','epic','legendary','mythic') then
    raise exception 'Unknown reward tier.';
  end if;
  -- The winning side must not be paid LESS than the losing side. Nothing else about the two tiers
  -- is constrained — equal tiers are a legitimate "everybody gets the same for turning up".
  if reward_band_rank(v_tiers -> v_win_tier ->> 'band')
     < reward_band_rank(v_tiers -> v_lose_tier ->> 'band') then
    raise exception 'The winning side cannot be paid less than the losing side.';
  end if;
  -- The scorekeeper has to be in the campfire, or nobody can reach the screen they are given.
  if not campfire_has_member(p_circle_id, v_ref) then
    raise exception 'The scorekeeper has to be in this campfire.';
  end if;

  v_name := v_sport.emoji || ' ' || v_a || ' vs ' || v_b;

  insert into social_challenges (
    circle_id, created_by, mode, shape, race_metric,
    sport_key, sport_label, sport_emoji,
    team_a_name, team_b_name, team_a_color, team_b_color,
    ref_user_id, score_mode, match_state,
    winner_reward_tier, loser_reward_tier,
    -- ⚠️ window_hours IS MEANINGLESS HERE and is set only because the column is NOT NULL and
    -- CHECK (> 0) since 0019. ends_at stays null — the match has no deadline, and that null is
    -- what keeps finalize_social_challenges away from it (see header).
    window_hours, payout_xp,
    status, starts_at, ends_at, public_name
  )
  values (
    p_circle_id, auth.uid(), 'group', 'team_match', null,
    v_sport.key, left(v_label, 24), v_sport.emoji,
    left(v_a, 24), left(v_b, 24), upper(p_team_a_color), upper(p_team_b_color),
    v_ref, v_mode, 'draft',
    v_win_tier, v_lose_tier,
    24, greatest(1, coalesce((v_cfg ->> 'winner_xp')::int, 200)),
    'active', now(), null, left(v_name, 60)
  )
  returning * into v_c;

  select coalesce(array_agg(gm.user_id), '{}') into v_members
    from group_members gm where gm.group_id = p_circle_id;
  select display_name into v_host from profiles where id = auth.uid();

  v_notified := notify_event(
    v_members,
    'campfire_challenge_started',
    v_sport.emoji || ' ' || v_a || ' vs ' || v_b,
    coalesce(v_host, 'Someone') || ' set a ' || lower(v_label) || ' match for ' || v_group.name
      || '. Pick a side.',
    auth.uid(), p_circle_id,
    '/challenge/match/[matchId]', jsonb_build_object('matchId', v_c.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_c.id, 'shape', 'team_match', 'circle_id', p_circle_id)
  );

  -- The chat card is posted by post_campfire_challenge_card (0163), which fires DEFERRED at
  -- commit and knows this shape after §8 below. Nothing to insert here — and deliberately so,
  -- because two card writers is how 0163's own header says a challenge ends up carded twice.

  return jsonb_build_object(
    'challenge_id', v_c.id,
    'circle_id', p_circle_id,
    'circle_name', v_group.name,
    'name', v_name,
    'sport_key', v_sport.key,
    'score_mode', v_mode,
    'notified', coalesce(v_notified, 0)
  );
end;
$$;

revoke all on function create_team_match(uuid, text, text, text, text, text, uuid, text, text, text, text) from public;
grant execute on function create_team_match(uuid, text, text, text, text, text, uuid, text, text, text, text) to authenticated;
comment on function create_team_match(uuid, text, text, text, text, text, uuid, text, text, text, text) is
  '0173 — posts a two-team match into a campfire. OWNER/ADMIN ONLY, re-read from group_members. Enrols nobody: the creator is usually the scorekeeper, and players pick a side through join_team_match.';

-- ─────────────────────────── §4 · picking a side ───────────────────────────
--
-- ANY MEMBER MAY JOIN — the same asymmetry 0162 established and for the same reason: hosting is
-- the admin act, joining is not. Switching sides stays open right up to full time, because a
-- pickup game reshuffles and a roster that hardened at kickoff would pay the wrong people.
create or replace function join_team_match(p_challenge_id uuid, p_team text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if p_team is null or p_team not in ('a', 'b') then
    raise exception 'Pick one of the two teams.';
  end if;

  select * into v_c from social_challenges where id = p_challenge_id for update;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if not campfire_has_member(v_c.circle_id, auth.uid()) then
    raise exception 'That match belongs to a campfire you are not in.';
  end if;
  if v_c.match_state = 'final' then
    raise exception 'That match is over.';
  end if;

  insert into challenge_participants (challenge_id, user_id, state, responded_at, team, baseline)
  values (p_challenge_id, auth.uid(), 'accepted', now(), p_team, 0)
  on conflict (challenge_id, user_id) do update
    set team = excluded.team,
        state = 'accepted',
        responded_at = coalesce(challenge_participants.responded_at, now());

  return jsonb_build_object(
    'challenge_id', p_challenge_id,
    'team', p_team,
    'team_name', case when p_team = 'a' then v_c.team_a_name else v_c.team_b_name end
  );
end;
$$;

grant execute on function join_team_match(uuid, text) to authenticated;
comment on function join_team_match(uuid, text) is
  '0173 — puts the caller on one side of a team match, or moves them to the other. Any campfire member; open until full time, because a pickup game reshuffles.';

-- ─────────────────────────── §5 · full time, and the flat reward (mock 177 §D) ───────────────────
--
-- THE ONE PLACE A TEAM MATCH IS PAID. Both routes into it — the scorekeeper's End match and the
-- second side's confirm — land here, so "how a team match settles" has exactly one definition and
-- the two doors cannot drift.
--
-- 🔒 INTERNAL. Not granted to authenticated: every caller below has already decided the caller is
-- allowed to end this match and at what score. A client that could reach this could name its own
-- final score, which is the whole thing §1b's dual confirmation exists to prevent.
--
-- IT IS A STRAIGHT ROSTER LOOP, because there is nothing per-person to compute. Everyone on the
-- winning side gets the winner tier; everyone on the losing side gets the loser tier. No ranking
-- pass, no percentile curve, no per-racer score — the reason the spec asks for team-flat rewards
-- is that a team sport has no honest per-player number and inventing one is how 0162 happened.
create or replace function settle_team_match(p_challenge_id uuid, p_score_a int, p_score_b int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_cfg jsonb := (select value from economy_config where key = 'team_match');
  v_tiers jsonb := (select value from economy_config where key = 'tier_payout');
  v_cap int := greatest(0, coalesce((v_cfg ->> 'weekly_paid_matches')::int, 6));
  v_draw_wins boolean := coalesce((v_cfg ->> 'draw_pays_winner_tier')::boolean, true);
  v_win_xp numeric := greatest(1, coalesce((v_cfg ->> 'winner_xp')::int, 200));
  v_lose_xp numeric := greatest(1, coalesce((v_cfg ->> 'loser_xp')::int, 100));
  v_a int := greatest(0, coalesce(p_score_a, 0));
  v_b int := greatest(0, coalesce(p_score_b, 0));
  v_count_a int;
  v_count_b int;
  v_field int;
  v_winning text;
  v_paid int := 0;
  v_pays boolean;
  r record;
  v_tier text;
  v_sig numeric;
  v_band text;
  v_payload jsonb;
  v_recent int;
  v_line text;
  v_members uuid[];
begin
  select * into v_c from social_challenges where id = p_challenge_id for update;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  -- Idempotent rather than an error. Two people can tap the last button at once, and the second
  -- one has not done anything wrong.
  if v_c.match_state = 'final' then
    return jsonb_build_object('challenge_id', v_c.id, 'already_final', true,
                              'score_a', v_c.score_a, 'score_b', v_c.score_b);
  end if;

  select count(*) filter (where p.team = 'a'),
         count(*) filter (where p.team = 'b')
    into v_count_a, v_count_b
    from challenge_participants p
   where p.challenge_id = v_c.id and p.state = 'accepted' and p.team is not null;
  v_field := v_count_a + v_count_b;

  v_winning := case when v_a > v_b then 'a' when v_b > v_a then 'b' else null end;

  -- ── the row, in one statement, so the shape CHECK is never briefly false ──
  -- ends_at is set HERE and only here: up to this moment it is null and the settle sweep cannot
  -- see the row; from this moment status is 'completed' and challenge_is_live excludes it. The
  -- reveal queue orders on coalesce(ends_at, created_at), which is why it is worth setting at all.
  update social_challenges
     set score_a = v_a,
         score_b = v_b,
         match_state = 'final',
         status = 'completed',
         ends_at = now(),
         clock_started_at = null,
         clock_elapsed_s = clock_elapsed_s
           + case when clock_started_at is null then 0
                  else greatest(0, extract(epoch from (now() - clock_started_at))::int) end,
         score_disputed = false
   where id = v_c.id;

  -- ── 🔒 RAIL 2 · a match with an empty side pays nobody ──
  -- Two teams is the shape. One team is a photo of a team, and paying it would make "post a match,
  -- join it alone, collect a crate" the cheapest box in the game.
  if v_count_a = 0 or v_count_b = 0 then
    v_line := 'Full time · ' || v_c.team_a_name || ' ' || v_a || ' – ' || v_b || ' ' || v_c.team_b_name
              || ' · no reward: a match needs players on both sides.';
  else
    for r in
      select p.user_id, p.team
        from challenge_participants p
       where p.challenge_id = v_c.id and p.state = 'accepted' and p.team is not null
    loop
      -- Team-flat: your side, not your contribution, picks your tier. A draw pays both sides the
      -- winner tier by default (economy_config.team_match.draw_pays_winner_tier) — two teams that
      -- could not be separated both did the thing.
      v_tier := case
        when v_winning is null then case when v_draw_wins then v_c.winner_reward_tier
                                         else v_c.loser_reward_tier end
        when r.team = v_winning then v_c.winner_reward_tier
        else v_c.loser_reward_tier
      end;

      -- ── 🔒 RAIL 3 · the rolling ceiling, read off the ledger itself ──
      -- Counted from ember_ledger.ref_id joined back to shape='team_match', so it measures what
      -- was actually PAID rather than what was played, and it cannot drift from the ledger the way
      -- a separate counter column would.
      select count(distinct el.ref_id) into v_recent
        from ember_ledger el
        join social_challenges sc2 on sc2.id = el.ref_id
       where el.user_id = r.user_id
         and el.created_at >= now() - interval '7 days'
         and sc2.shape = 'team_match'
         and sc2.id <> v_c.id;
      v_pays := v_recent < v_cap;

      if v_pays then
        -- Priced by the SERVER from the tier name, exactly as economy_on_challenge_completed does
        -- (0159/0162): significance picks the band, and the tier's own band caps it so a big
        -- roster cannot inflate a common crate into a Hestia box through grant_reward's scope
        -- term. The client sends two tier names and never a figure.
        v_sig := coalesce((v_tiers -> v_tier ->> 'significance')::numeric, 1.0);
        v_band := v_tiers -> v_tier ->> 'band';
        select grant_reward(
                 r.user_id, 'team_match', v_sig,
                 1, greatest(v_field, 1), 0.0, true, v_c.id,
                 v_band
               )
          into v_payload;
        v_paid := v_paid + 1;
      else
        -- Capped. The match still settles and still shows in the standings; it simply does not
        -- mint. Nothing is celebrated for a payout that did not happen, so reward_seen_at is
        -- stamped below and the reveal never fires.
        v_payload := jsonb_build_object(
          'embers', 0, 'box', null, 'box_id', null, 'badge', null,
          'band', 'completion', 'significance', 0, 'capped', true);
      end if;

      update challenge_participants p
         set reward_payload = v_payload
               || jsonb_build_object(
                    'shape', 'team_match',
                    'tier', v_tier,
                    'team', r.team,
                    'team_name', case when r.team = 'a' then v_c.team_a_name else v_c.team_b_name end,
                    'won', v_winning is null or r.team = v_winning,
                    'draw', v_winning is null,
                    'score_a', v_a, 'score_b', v_b),
             -- 1 and 2 are the TEAM's placing, copied flat onto every member of that side. It is
             -- what get_my_unseen_challenge_rewards filters on (final_rank is not null) and what
             -- makes the reveal reachable at all. final_value stays NULL on purpose: there is no
             -- per-player number in this feature and a column holding one would invite a screen
             -- to render it.
             final_rank = case when v_winning is null then 1
                               when p.team = v_winning then 1 else 2 end,
             final_percentile = case when v_winning is null then 1.0
                                     when p.team = v_winning then 1.0 else 0.0 end,
             reward_seen_at = case when v_pays then p.reward_seen_at else now() end
       where p.challenge_id = v_c.id and p.user_id = r.user_id;

      -- XP is the abundant currency (CHALLENGE_REWARD_ALGO §Guardrails), so it is the half that
      -- stays flat and is NOT withheld by the ceiling — the ceiling is an EMBER rail.
      insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
      values (r.user_id,
              case when v_winning is null or r.team = v_winning then v_win_xp else v_lose_xp end,
              'team_match_' || case when v_winning is null then 'draw'
                                    when r.team = v_winning then 'win' else 'loss' end,
              v_c.id);
    end loop;

    v_line := 'Full time · ' || v_c.team_a_name || ' ' || v_a || ' – ' || v_b || ' ' || v_c.team_b_name
              || case when v_winning is null then ' · a draw — both sides paid.'
                      else ' · ' || case when v_winning = 'a' then v_c.team_a_name else v_c.team_b_name end
                           || ' take it. Everyone who played earns something.' end;
  end if;

  -- ── the result card, in the chat where the match card is ──
  -- Wrapped for 0163's reason: a result that failed to announce itself must never roll back a
  -- settlement that has already moved embers.
  begin
    insert into messages (group_id, user_id, body)
    values (v_c.circle_id, coalesce(v_c.ref_user_id, v_c.created_by), left(v_line, 2000));
  exception when others then
    raise warning '0173 — could not post the full-time line for % into campfire %: %',
      v_c.id, v_c.circle_id, sqlerrm;
  end;

  select coalesce(array_agg(p.user_id), '{}') into v_members
    from challenge_participants p
   where p.challenge_id = v_c.id and p.state = 'accepted' and p.team is not null;

  perform notify_event(
    v_members,
    'campfire_settled',
    v_c.sport_emoji || ' Full time',
    v_c.team_a_name || ' ' || v_a || ' – ' || v_b || ' ' || v_c.team_b_name,
    null, v_c.circle_id,
    '/challenge/match/[matchId]', jsonb_build_object('matchId', v_c.id::text),
    null, 'rounded',
    jsonb_build_object('challenge_id', v_c.id, 'shape', 'team_match')
  );

  return jsonb_build_object(
    'challenge_id', v_c.id,
    'score_a', v_a,
    'score_b', v_b,
    'winning_team', v_winning,
    'players_paid', v_paid,
    'roster_a', v_count_a,
    'roster_b', v_count_b
  );
end;
$$;

revoke all on function settle_team_match(uuid, int, int) from public;
revoke all on function settle_team_match(uuid, int, int) from authenticated;
comment on function settle_team_match(uuid, int, int) is
  '0173 — the ONE place a team match is paid: flat winner/loser tier over the roster, one grant_reward each, XP for both sides, a full-time line in chat. INTERNAL — a client that could call it could name its own final score.';

-- ─────────────────────────── §6 · the live scorekeeper (mock 177 §C) ───────────────────────────
--
-- 🔒 GATED TO ref_user_id, SERVER-SIDE, in all three functions. The mock's "Only the ref can edit"
-- is not a hidden button — a non-ref who calls this is refused at the database, which is the only
-- version of that sentence that is true.
create or replace function ref_set_score(p_challenge_id uuid, p_team text, p_delta int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  if p_team is null or p_team not in ('a', 'b') then
    raise exception 'Which team?';
  end if;

  select * into v_c from social_challenges where id = p_challenge_id for update;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if v_c.ref_user_id is distinct from auth.uid() then
    raise exception 'Only the scorekeeper can change the score.';
  end if;
  if v_c.score_mode <> 'live' then
    raise exception 'This match is settled by a reported final score, not a live scoreboard.';
  end if;
  if v_c.match_state = 'final' then
    raise exception 'That match is over.';
  end if;

  -- The first touch of the score is kick-off: it flips draft -> live and starts the clock, so the
  -- LIVE dot on the campfire card is true the instant the first goal goes in. Nobody has to
  -- remember to press start, and Undo below cannot un-start a match that has visibly begun.
  update social_challenges
     set score_a = case when p_team = 'a' then greatest(0, score_a + coalesce(p_delta, 0)) else score_a end,
         score_b = case when p_team = 'b' then greatest(0, score_b + coalesce(p_delta, 0)) else score_b end,
         match_state = 'live',
         clock_started_at = coalesce(clock_started_at, case when match_state = 'draft' then now() end)
   where id = v_c.id
   returning * into v_c;

  return jsonb_build_object('challenge_id', v_c.id, 'score_a', v_c.score_a, 'score_b', v_c.score_b,
                            'match_state', v_c.match_state);
end;
$$;

grant execute on function ref_set_score(uuid, text, int) to authenticated;
comment on function ref_set_score(uuid, text, int) is
  '0173 — the scorekeeper moves one team''s score by a delta (Undo is a negative one). Scorekeeper only, server-checked; live mode only; clamps at zero and starts the match on the first touch.';

create or replace function ref_set_clock(p_challenge_id uuid, p_running boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  select * into v_c from social_challenges where id = p_challenge_id for update;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if v_c.ref_user_id is distinct from auth.uid() then
    raise exception 'Only the scorekeeper can run the clock.';
  end if;
  if v_c.match_state = 'final' then
    raise exception 'That match is over.';
  end if;

  -- Elapsed is BANKED on pause rather than tracked as a running total, so a client that is asleep
  -- through half of it still renders the right number: elapsed = banked + (now - started).
  update social_challenges
     set clock_started_at = case when p_running then coalesce(clock_started_at, now()) else null end,
         clock_elapsed_s = clock_elapsed_s
           + case when p_running or clock_started_at is null then 0
                  else greatest(0, extract(epoch from (now() - clock_started_at))::int) end,
         match_state = case when p_running then 'live' else match_state end
   where id = v_c.id
   returning * into v_c;

  return jsonb_build_object('challenge_id', v_c.id, 'clock_started_at', v_c.clock_started_at,
                            'clock_elapsed_s', v_c.clock_elapsed_s, 'match_state', v_c.match_state);
end;
$$;

grant execute on function ref_set_clock(uuid, boolean) to authenticated;
comment on function ref_set_clock(uuid, boolean) is
  '0173 — start/pause the match clock. Scorekeeper only. Elapsed is banked on pause so a sleeping client still renders the right number.';

create or replace function ref_end_match(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  select * into v_c from social_challenges where id = p_challenge_id;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if v_c.ref_user_id is distinct from auth.uid() then
    raise exception 'Only the scorekeeper can end the match.';
  end if;
  if v_c.score_mode <> 'live' then
    raise exception 'This match ends when both sides agree the final score.';
  end if;

  return settle_team_match(p_challenge_id, v_c.score_a, v_c.score_b);
end;
$$;

grant execute on function ref_end_match(uuid) to authenticated;
comment on function ref_end_match(uuid) is
  '0173 — full time on a live-scored match. Scorekeeper only; settles at whatever the board says.';

-- ─────────────────────────── §7 · the default route: report, then the OTHER side confirms ───────
--
-- §1b's whole point. An intramural referee keeps score on the league's system; this asks nobody to
-- duplicate that. One player types the final score afterwards and a player on the opposite side
-- agrees with it.
--
-- 🔒 THE ANTI-CHEESE IS THE SIDE, NOT THE RANK. There is no captain role in this app. What dual
-- confirmation actually buys is that one side cannot set a score alone, and `p.team <> reporter's
-- team` is exactly that property with no new role, no picker, and no failure mode where the
-- nominated captain did not come to the game.
create or replace function report_team_match_score(p_challenge_id uuid, p_score_a int, p_score_b int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_team text;
begin
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then
    raise exception 'A final score is two numbers, neither of them negative.';
  end if;

  select * into v_c from social_challenges where id = p_challenge_id for update;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if v_c.match_state = 'final' then
    raise exception 'That match is already settled.';
  end if;
  if v_c.score_mode <> 'confirm' then
    raise exception 'This match is scored live — the scorekeeper ends it.';
  end if;

  select p.team into v_team
    from challenge_participants p
   where p.challenge_id = v_c.id and p.user_id = auth.uid()
     and p.state = 'accepted' and p.team is not null;
  if v_team is null then
    raise exception 'Only someone who played can report the score.';
  end if;

  update social_challenges
     set reported_score_a = p_score_a,
         reported_score_b = p_score_b,
         reported_by = auth.uid(),
         reported_at = now(),
         -- A fresh report clears a previous dispute: that is what re-entering after a
         -- disagreement means, and leaving the flag up would make the second attempt look
         -- rejected before anyone had looked at it.
         score_disputed = false,
         match_state = case when match_state = 'draft' then 'live' else match_state end
   where id = v_c.id;

  return jsonb_build_object('challenge_id', v_c.id, 'reported_score_a', p_score_a,
                            'reported_score_b', p_score_b, 'reported_team', v_team,
                            'awaiting', case when v_team = 'a' then 'b' else 'a' end);
end;
$$;

grant execute on function report_team_match_score(uuid, int, int) to authenticated;
comment on function report_team_match_score(uuid, int, int) is
  '0173 — a player reports the final score of a real game. Settles nothing on its own: the other side has to confirm it (confirm_team_match_score).';

create or replace function confirm_team_match_score(p_challenge_id uuid, p_agree boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_my_team text;
  v_their_team text;
begin
  select * into v_c from social_challenges where id = p_challenge_id for update;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if v_c.match_state = 'final' then
    return jsonb_build_object('challenge_id', v_c.id, 'already_final', true);
  end if;
  if v_c.reported_by is null then
    raise exception 'Nobody has reported a final score yet.';
  end if;

  select p.team into v_my_team
    from challenge_participants p
   where p.challenge_id = v_c.id and p.user_id = auth.uid()
     and p.state = 'accepted' and p.team is not null;
  select p.team into v_their_team
    from challenge_participants p
   where p.challenge_id = v_c.id and p.user_id = v_c.reported_by;

  if v_my_team is null then
    raise exception 'Only someone who played can confirm the score.';
  end if;
  -- 🔒 The whole rail. One side cannot both report and confirm.
  if v_my_team = v_their_team then
    raise exception 'The other team has to confirm this one.';
  end if;

  if not coalesce(p_agree, true) then
    update social_challenges
       set score_disputed = true,
           reported_score_a = null,
           reported_score_b = null,
           reported_by = null,
           reported_at = null
     where id = v_c.id;

    begin
      insert into messages (group_id, user_id, body)
      values (v_c.circle_id, auth.uid(),
              left(v_c.sport_emoji || ' ' || v_c.team_a_name || ' vs ' || v_c.team_b_name
                   || ' — the reported score was disputed. Re-enter it, or ask an admin to settle it.', 2000));
    exception when others then
      raise warning '0173 — could not post the dispute line for %: %', v_c.id, sqlerrm;
    end;

    return jsonb_build_object('challenge_id', v_c.id, 'disputed', true);
  end if;

  return settle_team_match(v_c.id, v_c.reported_score_a, v_c.reported_score_b);
end;
$$;

grant execute on function confirm_team_match_score(uuid, boolean) to authenticated;
comment on function confirm_team_match_score(uuid, boolean) is
  '0173 — the OTHER side agrees (settles and pays) or disagrees (marks it disputed and clears the report). Refuses anyone on the reporting side: that refusal is the anti-cheese.';

-- The host's tiebreak. A disputed score cannot sit forever, and the campfire admin is the person
-- who already owns "this fire's races" everywhere else in the app.
create or replace function resolve_team_match(p_challenge_id uuid, p_score_a int, p_score_b int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  select * into v_c from social_challenges where id = p_challenge_id;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if not is_campfire_admin(v_c.circle_id, auth.uid()) then
    raise exception 'Only a campfire admin can settle a disputed match.';
  end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then
    raise exception 'A final score is two numbers, neither of them negative.';
  end if;

  return settle_team_match(p_challenge_id, p_score_a, p_score_b);
end;
$$;

grant execute on function resolve_team_match(uuid, int, int) to authenticated;
comment on function resolve_team_match(uuid, int, int) is
  '0173 — a campfire admin settles a disputed match at a score they name. The only path that does not need both sides to agree, and it is deliberately the host''s.';

-- One scorekeeper at a time, reassignable by a host — the person who was going to ref did not turn
-- up, and the match should not be stuck.
create or replace function reassign_team_match_ref(p_challenge_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  select * into v_c from social_challenges where id = p_challenge_id for update;
  if v_c.id is null or v_c.shape <> 'team_match' then
    raise exception 'That match does not exist.';
  end if;
  if not is_campfire_admin(v_c.circle_id, auth.uid()) then
    raise exception 'Only a campfire admin can change the scorekeeper.';
  end if;
  if v_c.match_state = 'final' then
    raise exception 'That match is over.';
  end if;
  if not campfire_has_member(v_c.circle_id, p_user_id) then
    raise exception 'The scorekeeper has to be in this campfire.';
  end if;

  update social_challenges set ref_user_id = p_user_id where id = v_c.id;
  return jsonb_build_object('challenge_id', v_c.id, 'ref_user_id', p_user_id);
end;
$$;

grant execute on function reassign_team_match_ref(uuid, uuid) to authenticated;
comment on function reassign_team_match_ref(uuid, uuid) is
  '0173 — hand the scorekeeper role to another member. Campfire admin only; one scorekeeper at a time.';

-- ─────────────────────────── §8 · the card in the chat (mock 177 §B) ───────────────────────────
--
-- 0163's trigger already posts a card for every group-mode challenge in a campfire, on whatever
-- path created it, and a team match is a group-mode challenge in a campfire. So there is nothing
-- to add — only a sentence to fix: "— who's in?" is the collective goal's CTA, and a team match
-- asks something different. You do not join a match, you pick a side.
--
-- ⚠️ RESTATED FROM 0163's BODY with one new arm in v_body and nothing else changed. plpgsql has no
-- way to replace one line, and the signature is identical, so `create or replace` replaces the one
-- function rather than creating an overload.
create or replace function post_campfire_challenge_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_name text;
  v_body text;
begin
  -- Re-read rather than trusting NEW: this runs at commit, and NEW is the row as it was inserted.
  select * into v_c from social_challenges c where c.id = new.id;

  -- Created and deleted inside one transaction, or rolled back to nothing. Not an error.
  if v_c.id is null then
    return null;
  end if;

  -- A DUEL IS NOT A CAMPFIRE CHALLENGE even when a campfire is watching it (§16).
  if v_c.circle_id is null or v_c.mode <> 'group' then
    return null;
  end if;

  -- Already carded — the 0162 host path, or a re-run of this trigger.
  if exists (
    select 1 from messages m
     where m.attach_kind = 'challenge' and m.attach_ref_id = v_c.id
  ) then
    return null;
  end if;

  v_name := coalesce(
    nullif(btrim(coalesce(v_c.public_name, '')), ''),
    case
      -- 0173 — a match names itself off its teams, not off a metric it does not have.
      when v_c.shape = 'team_match'
        then coalesce(v_c.sport_emoji || ' ', '') || v_c.team_a_name || ' vs ' || v_c.team_b_name
      when v_c.count_unit is not null and v_c.target_count is not null
        then trim(to_char(v_c.target_count, 'FM999999999')) || ' ' || v_c.count_unit
      when v_c.shape = 'placement' then 'A ranked race'
      else 'A campfire challenge'
    end
  );

  v_body := case
    -- 0173 — you do not JOIN a match, you pick a side. Same card, one honest sentence.
    when v_c.shape = 'team_match' then v_name || ' — pick a side.'
    when v_c.shape = 'placement' then v_name || ' — the ranked race is on.'
    else v_name || ' — who''s in?'
  end;

  -- Authored by the creator, not by a system account, and wrapped: a card is an announcement and a
  -- failed announcement must never roll back the challenge that was successfully created.
  begin
    insert into messages (group_id, user_id, body, attach_kind, attach_ref_id)
    values (v_c.circle_id, v_c.created_by, left(v_body, 2000), 'challenge', v_c.id);
  exception when others then
    raise warning '0163 — could not post the challenge card for % into campfire %: %',
      v_c.id, v_c.circle_id, sqlerrm;
  end;

  return null;
end;
$$;

comment on function post_campfire_challenge_card() is
  '0163/0173 — posts the campfire chat card for a group-mode challenge on whatever path created it. DEFERRED to commit so 0162''s own card is seen and skipped rather than duplicated. 0173 adds the team_match arm: a match is named off its two teams and its CTA is "pick a side", not "who''s in?".';


-- ─────────────── §9 · settlement pays ONCE, and the sweep trigger has to be told ───────────────
--
-- 🔴 THE BUG THIS SECTION EXISTS FOR, found by playing a match rather than by reading the file.
--
-- settle_team_match ends with `status = 'completed'`. That is an UPDATE OF status on
-- social_challenges, and there has been an AFTER UPDATE OF status trigger on that table since the
-- economy landed: economy_on_social_challenge_closed. It branches h2h / placement / everything
-- else, and a team match is mode 'group' with shape 'team_match', so it fell straight through into
-- the COLLECTIVE arm — which paid every member of challenge_field a second grant_reward at the
-- collective band and then OVERWROTE challenge_participants.reward_payload with it.
--
-- So every player was paid twice, and the reveal showed the wrong one: the flat team tier the
-- match actually decided, replaced on its way out the door by a generic collective payout. The
-- functional probe caught it as "expected 2 ember rows, got 4".
--
-- ⚠️ RESTATED FROM PROD'S OWN pg_get_functiondef AT THE MOMENT 0173 WAS WRITTEN, with exactly one
-- guard inserted and nothing else touched — not retyped, extracted and patched programmatically,
-- because this is a ~250-line function with six grant_reward calls in four arms and a
-- transcription slip in any of them silently changes what a duel or a placement race pays. The
-- assertion below counts those six calls back.
--
-- 🔒 IF A SIBLING LANE REPLACED THIS FUNCTION BETWEEN THAT READ AND THIS PUSH, THIS RESTATEMENT
-- WOULD REVERT THEM. That is the clobber this repo has been bitten by. Before applying, diff the
-- live prosrc against this body and confirm the only difference is the team_match guard.

create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $econ$
declare
  v_days int;
  v_scope int;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
  v_field uuid[];
  v_uid uuid;
  v_payload jsonb;
  -- The per-racer standings row the placement arm reads back (0127).
  v_row record;
  -- The two sides' scores in the draw branch, restored from 0122.
  v_a numeric;
  v_b numeric;
  v_a_name text;
  v_b_name text;
  -- ── the honour knobs (0145) ──
  --
  -- Mock 140: "It's honor-based, so I drop the box a tier and trim the rest — no grade-reading,
  -- just your word." Both are existing grant_reward parameters, not a second reward formula:
  -- `p_difficulty` scales the significance that picks the band, and `p_max_band` ceilings it. An
  -- auto-tracked race is unchanged at 1.0 and whatever ceiling its shape already carried.
  --
  -- WHY IT IS PRICED DOWN AT ALL: 0093 refused self-reported grades any currency whatsoever,
  -- because the moment a claimed mark pays, claiming becomes the game. A challenge is a softer
  -- case — the target is declared in advance, in front of people — but the discount is what keeps
  -- lying about it from being the efficient play.
  --
  -- 'impressive' IS THE HONOUR CEILING, and the band it stops short of is the point rather than an
  -- arbitrary notch. grant_reward mints an un-buyable prestige badge at 'elite' and above ("the
  -- biggest wins are actually for" exactly that, per its own comment). A badge nobody can buy must
  -- not be obtainable by typing a number into a text field, so honour-scored races stop one band
  -- below the badge line. They still pay embers and a box; they cannot mint prestige.
  --
  -- The band vocabulary is grant_reward's: apex > elite > impressive > notable > casual >
  -- completion. reward_band_rank ignores anything outside it, so a name invented here would
  -- silently apply no ceiling at all.
  v_honour boolean;
  v_intensity numeric;
  v_cap text;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  -- ─────────────────────────── 0173 · A TEAM MATCH PAYS ITSELF ───────────────────────────
  --
  -- 🔴 THE ONE LINE THIS RESTATEMENT EXISTS FOR. Everything else in this function is byte-for-byte
  -- what was live on prod when 0173 was written.
  --
  -- WHAT WENT WRONG WITHOUT IT. settle_team_match pays each side its flat tier and writes the
  -- payload, and its very last act is `status = 'completed'` — which fires this trigger. A team
  -- match is mode 'group' and shape 'team_match', so it fell past the h2h arm and past the
  -- placement arm into the COLLECTIVE arm, which paid every member of challenge_field a SECOND
  -- reward at the collective band and overwrote reward_payload with it. Two payouts per player,
  -- and the reveal then showed the wrong one — the flat tier the match actually decided was
  -- replaced by a flat 0.75-placement collective payout on its way out the door.
  --
  -- Found by playing a whole match inside a rolled-back transaction against real prod data. A DDL
  -- dry-run could not have found it: `create function` only syntax-checks a plpgsql body, so
  -- nothing here runs until somebody calls it, and the double payout only exists at the moment
  -- the two functions meet.
  --
  -- THE GUARD IS AT THE TOP, not inside the else-arm, deliberately. A team match must never reach
  -- ANY arm of this function — not the collective one it falls into today, and not a future arm
  -- that a later migration adds ahead of it. settle_team_match is the only thing that may pay a
  -- match, which is what makes "how a team match settles" have exactly one definition.
  if new.shape = 'team_match' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  -- coalesce, not a bare comparison: race_metric is NULL on a collective lock-in goal, and a
  -- NULL here would flow into every `case when v_honour` below as "not true" by accident rather
  -- than by decision.
  v_honour := coalesce(new.race_metric, '') = 'grade';
  v_intensity := case when v_honour then 0.8 else 1.0 end;
  v_cap := case when v_honour then 'impressive' else null end;

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      v_payload := grant_reward(new.winner_id, 'friend_h2h', v_intensity, v_days, v_scope, 0.0, true, new.id, v_cap);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = new.winner_id;

      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      v_loser := case when new.winner_id = new.created_by then new.opponent_id else new.created_by end;
      v_payload := grant_reward(v_loser, 'friend_h2h', v_intensity, v_days, v_scope, 1.0, true, new.id, v_cap);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_loser;

      select display_name into v_winner_name from profiles where id = new.winner_id;
      select display_name into v_loser_name from profiles where id = v_loser;

      -- Two events, not one broadcast: the copy differs, and more importantly the ACTOR differs.
      -- Each side's leading art is the OTHER person's face.
      perform notify_event(
        array[new.winner_id], 'challenge_won',
        'You won',
        case when v_loser_name is not null then 'You beat ' || v_loser_name || '.' else 'You took the challenge.' end,
        v_loser, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'won')
      );

      perform notify_event(
        array[v_loser], 'challenge_lost',
        'Challenge over',
        case when v_winner_name is not null then v_winner_name || ' edged it. Rematch?' else 'Rematch?' end,
        new.winner_id, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'lost')
      );

    elsif new.opponent_id is not null then
      -- 0122's draw branch. Without it the sweep pays a tie its XP and this trigger pays it
      -- nothing: no box, no embers, no notification, and no reward_payload for the reveal screen.
      select
        max(case when p.user_id = new.created_by  then p.final_value end),
        max(case when p.user_id = new.opponent_id then p.final_value end)
        into v_a, v_b
      from challenge_participants p
      where p.challenge_id = new.id;

      if v_a is null or v_b is null then
        v_a := social_challenge_score(new.created_by,  new.race_metric, new.starts_at, new.ends_at);
        v_b := social_challenge_score(new.opponent_id, new.race_metric, new.starts_at, new.ends_at);
      end if;

      if v_a = v_b and v_a > 0 then
        -- Both get the WINNER's placement (0.0 = first), not the loser's completion band. That is
        -- the whole point: a dead heat is two firsts, not two consolation prizes.
        v_payload := grant_reward(new.created_by, 'friend_h2h', v_intensity, v_days, v_scope, 0.0, true, new.id, v_cap);
        update challenge_participants
           set reward_payload = v_payload
         where challenge_id = new.id and user_id = new.created_by;

        v_payload := grant_reward(new.opponent_id, 'friend_h2h', v_intensity, v_days, v_scope, 0.0, true, new.id, v_cap);
        update challenge_participants
           set reward_payload = v_payload
         where challenge_id = new.id and user_id = new.opponent_id;

        select display_name into v_a_name from profiles where id = new.created_by;
        select display_name into v_b_name from profiles where id = new.opponent_id;

        -- Same event TYPE as a win so it files under Challenges and renders with the win's art;
        -- the payload says `draw`, which is what the reveal screen branches on.
        perform notify_event(
          array[new.created_by], 'challenge_won',
          'Dead even',
          case when v_b_name is not null
               then 'You and ' || v_b_name || ' finished level. You both get the win.'
               else 'You finished level. You both get the win.' end,
          new.opponent_id, new.id,
          '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
          null, null,
          jsonb_build_object('mode', new.mode, 'outcome', 'draw')
        );

        perform notify_event(
          array[new.opponent_id], 'challenge_won',
          'Dead even',
          case when v_a_name is not null
               then 'You and ' || v_a_name || ' finished level. You both get the win.'
               else 'You finished level. You both get the win.' end,
          new.created_by, new.id,
          '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
          null, null,
          jsonb_build_object('mode', new.mode, 'outcome', 'draw')
        );
      end if;
    end if;
  elsif new.shape = 'placement' then
    -- ─────────────── PLACEMENT: paid by the band actually finished in (0127) ───────────────
    --
    -- 🔒 THE FIREWALL IS INTACT. grant_reward is still the only thing that decides or moves a
    -- reward; this passes it a truer input than the collective arm's flat 0.75 and captures what
    -- it returns.
    --
    -- INVERTED: final_percentile is stored top-is-1.0 (0111), grant_reward's p_placement_pct is
    -- top-is-0.0. Passing it through unturned would pay the champion the last-place band.
    if new.circle_id is null then return new; end if;

    select coalesce(array_agg(p.user_id), '{}') into v_field
    from challenge_participants p
    where p.challenge_id = new.id and p.state = 'accepted';

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    for v_row in
      select p.user_id, p.final_percentile, p.final_value
      from challenge_participants p
      where p.challenge_id = new.id and p.state = 'accepted'
        and p.final_rank is not null and p.final_value > 0
    loop
      -- Scope is the WHOLE field, not just the movers: placing 5th out of 48 is a bigger result
      -- than placing 5th out of 6, and that is exactly what grant_reward's log(scope) term is for.
      --
      -- CAPPED AT 'elite' (#148): that same log(scope) term, multiplied by a duration measured in
      -- weeks, is what makes the ceiling necessary — a semester-long race across a large campfire
      -- clears the apex threshold on scale alone, and would pay a Promethean Vault for winning
      -- among people who mostly did not compete. An honour-scored board stops a band lower still,
      -- for the badge reason above.
      v_payload := grant_reward(
        v_row.user_id, 'campfire_group', v_intensity, v_days, greatest(v_scope, 1),
        greatest(0, least(1, 1 - coalesce(v_row.final_percentile, 0))),
        true, new.id, case when v_honour then 'impressive' else 'elite' end);
      update challenge_participants p
         set reward_payload = v_payload
       where p.challenge_id = new.id and p.user_id = v_row.user_id;
    end loop;

    -- Every racer is told, including the ones who did not move — their result is a rank, and a
    -- ranked board that only notifies its top half is a leaderboard people stop believing.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Placement race settled',
      'The board is final — see where you landed.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode, 'shape', 'placement')
    );

  else
    if new.circle_id is null then return new; end if;

    if exists (select 1 from challenge_participants p where p.challenge_id = new.id) then
      select coalesce(array_agg(f.user_id), '{}') into v_field
      from challenge_field(new.id, new.circle_id) f;
    else
      select coalesce(array_agg(distinct s.user_id), '{}') into v_field
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds');
    end if;

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    -- Real percentile placement needs the per-member standings 0111 now writes; wiring
    -- grant_reward to final_percentile is a reward-tuning change and stays out of a bugfix pass,
    -- so everyone still lands on the completion band rather than being handed a guessed rank.
    foreach v_uid in array v_field
    loop
      v_payload := grant_reward(v_uid, 'campfire_group', v_intensity, v_days, greatest(v_scope, 1), 0.75, true, new.id, v_cap);
      -- A no-op for a pre-0096 challenge with no roster: v_field was derived from lock-in sessions
      -- there, and the reward is still paid — there is simply no row to record it on, which is
      -- exactly the case get_challenge_reward's empty return already covers.
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_uid;
    end loop;

    -- One event to every participant. No actor: a campfire challenge settling is the campfire's
    -- doing, not any one member's, so it leads with the campfire rather than a face.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Campfire challenge settled',
      'Your rewards are ready to collect.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode)
    );
  end if;

  return new;
end;
$econ$;

-- ─────────────────────────── asserted at deploy ───────────────────────────
--
-- Dry-run this whole file against real prod state before pushing (MIGRATIONS.md §Assertions must
-- be reachable) — every branch below runs against the POST-migration state, which is the state a
-- pre-flight against the old schema cannot reach.
do $assert$
declare
  v_sports int;
  v_overloads int;
  v_shape_checks int;
  v_grants int;
begin
  -- 1 · the fourth shape is legal, and the three constraints that gate it exist.
  if not exists (select 1 from pg_constraint where conname = 'social_challenges_shape_check') then
    raise exception '0173: social_challenges_shape_check is missing — the shape vocabulary is unguarded.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_challenges_team_match_shape') then
    raise exception '0173: social_challenges_team_match_shape is missing.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenge_participants_team_valid') then
    raise exception '0173: challenge_participants_team_valid is missing.';
  end if;

  -- 2 · 🔴 THE TWO PROBES, AND WHY THERE HAVE TO BE TWO.
  --
  -- A NEGATIVE PROBE ALONE PROVES NOTHING HERE, and this is the trap MIGRATIONS.md's "assertions
  -- must be reachable" section is about wearing a different face. 0096 declared the shape check
  -- INLINE, so its name is whatever Postgres generated, and §1 drops it by matching its
  -- definition. If those LIKE patterns ever miss, the three-value check survives alongside the new
  -- four-value one and 'team_match' is rejected at every insert — the feature is dead on arrival.
  --
  -- A negative probe cannot see that. "Insert a bad match, expect check_violation" passes
  -- identically whether the sweep guard caught it or a stale shape check did. The two failures are
  -- indistinguishable from inside the exception handler, so the probe would go green on a database
  -- where nothing works. It needs a positive control beside it.
  select count(*) into v_shape_checks
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'social_challenges'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%collective%'
     and pg_get_constraintdef(con.oid) like '%placement%';
  if v_shape_checks <> 1 then
    raise exception
      '0173: expected exactly ONE shape CHECK on social_challenges, found % — 0096''s inline check was not dropped and will reject every team match.',
      v_shape_checks;
  end if;

  -- Both probes need a campfire to hang off. On an empty database there is nothing to prove and
  -- nothing that can break, so they are skipped rather than faked.
  if exists (select 1 from groups) then
    -- 2a · POSITIVE. A well-formed live match must be ACCEPTED. This is what proves the shape
    --      vocabulary actually widened, rather than that something rejected a row for some reason.
    begin
      insert into social_challenges (
        circle_id, created_by, mode, shape, sport_key, sport_label, sport_emoji,
        team_a_name, team_b_name, ref_user_id, score_mode, match_state,
        winner_reward_tier, loser_reward_tier, window_hours, payout_xp,
        status, starts_at, ends_at
      )
      select g.id, g.owner_id, 'group', 'team_match', 'soccer', 'Soccer', '⚽',
             'A', 'B', null, 'confirm', 'live',
             'uncommon', 'common', 24, 200,
             'active', now(), null
        from groups g limit 1;

      -- Undo the probe. Raising is what rolls the subtransaction back — including the DEFERRED
      -- card trigger's queued event, which would otherwise post a chat card for a match that never
      -- existed. A plain DELETE would leave that event armed until commit.
      raise exception 'PROBE_OK_0173';
    exception
      when others then
        if sqlerrm not like 'PROBE_OK_0173%' then
          raise exception
            '0173: a VALID team match was refused (%) — the shape widening did not take, and nothing could ever create a match.',
            sqlerrm;
        end if;
    end;

    -- 2b · NEGATIVE, THE SWEEP GUARD. The one that matters most in this file: a team match whose
    --      ends_at could be set while it is still running would be settled at 0-0 by
    --      finalize_social_challenges against a metric it does not have. Identical to the row
    --      above in every field but `ends_at`, so the only thing that can separate the two
    --      outcomes is the guard itself.
    begin
      insert into social_challenges (
        circle_id, created_by, mode, shape, sport_key, sport_label, sport_emoji,
        team_a_name, team_b_name, ref_user_id, score_mode, match_state,
        winner_reward_tier, loser_reward_tier, window_hours, payout_xp,
        status, starts_at, ends_at
      )
      select g.id, g.owner_id, 'group', 'team_match', 'soccer', 'Soccer', '⚽',
             'A', 'B', null, 'confirm', 'live',
             'uncommon', 'common', 24, 200,
             'active', now(), now() + interval '1 hour'
        from groups g limit 1;
      raise exception
        '0173: a LIVE team match accepted an ends_at — finalize_social_challenges would settle it at 0-0.';
    exception
      when check_violation then null;  -- the guard held, which is the pass condition
      when others then
        if sqlerrm like '0173:%' then raise; end if;
    end;
  end if;

  -- 3 · the catalog is seeded, and basketball still has its three steps (the one sport whose
  --     buttons are not "+1", and therefore the one that proves step_values is being read).
  select count(*) into v_sports from match_sports;
  if v_sports < 10 then
    raise exception '0173: the sport catalog has only % rows.', v_sports;
  end if;
  if (select step_values from match_sports where key = 'basketball') is distinct from '{1,2,3}'::int[] then
    raise exception '0173: basketball lost its +1/+2/+3 steps.';
  end if;

  -- 4 · the rails are configured. A missing team_match config would silently fall back to the
  --     in-body defaults, which is survivable — a missing tier_payout would not, because the whole
  --     payout is priced off it.
  if not exists (select 1 from economy_config where key = 'team_match') then
    raise exception '0173: economy_config.team_match was not written.';
  end if;
  if (select value -> 'uncommon' ->> 'band' from economy_config where key = 'tier_payout') is null then
    raise exception '0173: economy_config.tier_payout has lost its tiers — a team match cannot be priced.';
  end if;

  -- 5 · 🔒 the settle door is shut to clients. A caller who could reach settle_team_match could
  --     name their own final score, which is exactly what §1b's dual confirmation prevents.
  if has_function_privilege('authenticated', 'settle_team_match(uuid, int, int)', 'execute') then
    raise exception '0173: settle_team_match is callable by authenticated — a client could name its own final score.';
  end if;
  if not has_function_privilege('authenticated', 'confirm_team_match_score(uuid, boolean)', 'execute') then
    raise exception '0173: confirm_team_match_score is not callable — the default settle route is unreachable.';
  end if;

  -- 6 · one definition each. MIGRATIONS.md's overload trap has reached prod three times; these are
  --     new names so there is nothing to collide with yet, and this is what keeps it that way.
  select count(*) into v_overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_team_match', 'join_team_match', 'ref_set_score', 'ref_set_clock',
                       'ref_end_match', 'report_team_match_score', 'confirm_team_match_score',
                       'resolve_team_match', 'reassign_team_match_ref', 'settle_team_match',
                       'get_team_match', 'campfire_has_member', 'post_campfire_challenge_card');
  if v_overloads <> 13 then
    raise exception '0173: expected 13 team-mode functions, found % — something gained an overload.', v_overloads;
  end if;


  -- 7 · 🔴 the double-payout guard, and the arms it must not have eaten. Six grant_reward calls
  --     across four arms is what was live when this was restated; five means an arm was lost in
  --     the restatement and some other shape silently stopped being paid.
  select count(*) into v_grants
    from regexp_matches(
      (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'economy_on_social_challenge_closed'),
      'grant_reward\(', 'g');
  if v_grants <> 6 then
    raise exception '0173: economy_on_social_challenge_closed has % grant_reward calls, expected 6 — an arm was lost restating it.', v_grants;
  end if;
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'economy_on_social_challenge_closed')
     not like '%team_match%' then
    raise exception '0173: the settle trigger has no team_match guard — every match would be paid twice.';
  end if;

  raise notice '0173 ok — team mode is live: % sports, the sweep guard holds, and settlement is server-only.', v_sports;
end
$assert$;
