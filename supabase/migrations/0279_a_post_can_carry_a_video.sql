-- The Agora, video posts. A post can carry ONE clip (≤ 60s), next to its photo, session and reward.
--
-- SHAPE. Video is not a new kind of post; it is one more element of the 0140 attachments list —
-- `{kind: 'video', key: <object key>, snapshot: {video_key, poster_key, duration_s, ...}}` — so the
-- feed, the permalink, forests (0274) and campfires (0277) all carry it without being restated.
-- create_agora_post is NOT replaced either: it already validates every element through
-- agora_attachment_snapshot and refuses a second of any kind, which is exactly "at most one video".
--
-- WHERE THE BYTES LIVE: R2, not a Supabase bucket. Gym clips already live there (0054, 0266), and
-- R2 gives video the three things a public Supabase bucket can't:
--   * PRIVATE. Nothing is ever served unsigned. `agora-video-playback-url` signs a URL only after
--     agora_video_sources (below) has answered "may this viewer see this post" with the SAME
--     predicate as get_agora_item — friends/campus/public dial, forest gate, campfire gate (0277),
--     and blocks both ways. A pasted URL dies within the hour; a friends-only clip is friends-only.
--   * REALLY DELETED. A removed post's clip and poster are queued in gym_clip_purges, and the
--     existing cron (0266, every 10 min) drives gym-clip-purge to DeleteObjects them from R2 — the
--     bytes, not just a pointer. That is the takedown requirement (#149) met properly, rather than
--     0131's "the row is gone, the blob is billed forever" compromise.
--   * Free egress, which matters for video in a way it never did for photos.
--
-- THE UPLOAD LEDGER (agora_video_uploads). The edge function that signs an upload writes one row
-- per key. That row is what makes the client's key trustworthy and what makes cleanup total:
--   * a post may only attach a key the ledger issued TO THAT USER and nobody has claimed yet — so a
--     crafted call can't point a card at someone else's clip, or two cards at one clip;
--   * the post claims the row (post_id), and the row CASCADES off agora_posts and off profiles.
--     One AFTER DELETE trigger on the ledger enqueues the R2 purge, so every way a post can go —
--     author delete, moderation's admin_resolve_report, account deletion, forest/campfire removal,
--     an ad-hoc console delete — purges the clip with no per-path code;
--   * an upload nobody posted (composer cancelled, post refused) is swept after a day by cron.
--
-- Additive: one new table, one widened CHECK, one restated function (agora_attachment_snapshot,
-- based on the live prod body of 2026-10-26 — the only change is the new 'video' branch), two
-- triggers, one read RPC, one cron job. Needs `agora-video-upload-url`, `agora-video-playback-url`
-- and the updated `gym-clip-purge` deployed (from a clean tree) before the app ships the composer.

-- ───────────────────────────── 1. the attach_kind mirror accepts 'video' ─────────────────────────────
-- create_agora_post mirrors element [0] into 0128's single-slot columns, and attach_kind has a
-- CHECK listing the kinds. Without this a post whose first element is the video fails to insert.
alter table agora_posts drop constraint if exists agora_posts_attach_kind_check;
alter table agora_posts add constraint agora_posts_attach_kind_check
  check (attach_kind in ('milestone', 'lockin', 'rank', 'streak', 'pass', 'cosmetic', 'pr', 'video'));

-- ───────────────────────────── 2. the upload ledger ─────────────────────────────
create table if not exists agora_video_uploads (
  /** `agora/<user id>/<uuid>.mp4` — the shape agora-video-upload-url issues and nothing else. */
  video_key   text primary key
              check (video_key ~ '^agora/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'),
  poster_key  text not null unique
              check (poster_key ~ '^agora/[0-9a-f-]{36}/[0-9a-f-]{36}_poster\.jpg$'),
  user_id     uuid not null references profiles (id) on delete cascade,
  /** The exact byte count the PUT was signed for. The cap is enforced at signing; this is the receipt. */
  bytes       bigint not null check (bytes > 0 and bytes <= 52428800),
  duration_s  numeric(5, 1) not null check (duration_s > 0 and duration_s <= 60.5),
  width       int check (width is null or width > 0),
  height      int check (height is null or height > 0),
  issued_at   timestamptz not null default now(),
  /** Set when a post attaches this clip. Null = uploaded (or abandoned) but never posted. */
  post_id     uuid unique references agora_posts (id) on delete cascade,
  check (split_part(video_key, '/', 2) = user_id::text and split_part(poster_key, '/', 2) = user_id::text)
);

create index if not exists agora_video_uploads_unclaimed_idx
  on agora_video_uploads (issued_at) where post_id is null;
create index if not exists agora_video_uploads_user_idx on agora_video_uploads (user_id, issued_at);

alter table agora_video_uploads enable row level security;
-- No policies. The edge function writes with the service role; everything else goes through the
-- SECURITY DEFINER functions below. Nobody needs to enumerate clip keys.

comment on table agora_video_uploads is
  'One row per Agora video upload signed by agora-video-upload-url. Claimed by the post that attaches it; deleting the row (directly or by cascade from agora_posts/profiles) queues the R2 purge.';

-- ───────────────────────────── 3. deleting a ledger row purges the clip from R2 ─────────────────────────────
create or replace function enqueue_agora_video_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into gym_clip_purges (object_key) values (old.video_key), (old.poster_key);
  return null;
end;
$fn$;

drop trigger if exists agora_video_uploads_purge on agora_video_uploads;
create trigger agora_video_uploads_purge
  after delete on agora_video_uploads
  for each row execute function enqueue_agora_video_purge();

revoke all on function enqueue_agora_video_purge() from public, anon, authenticated;

-- ───────────────────────────── 4. the snapshot learns 'video' ─────────────────────────────
-- Live body of 2026-10-26, unchanged except the 'video' arm. Same signature: a true replacement.
create or replace function public.agora_attachment_snapshot(p_user uuid, p_kind text, p_ref_id uuid, p_key text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if p_kind is null then return null; end if;

  case p_kind

    when 'milestone' then
      -- Someone else's milestone is not yours to re-post as your own achievement. Sharing one
      -- with a caption is the same row appearing in the feed on its own; this branch is the
      -- author quoting their own.
      select jsonb_build_object(
        'milestone_id', m.id, 'kind', m.kind, 'headline', m.headline,
        'note', m.note, 'effort', m.effort
      ) into v
      from milestones m where m.id = p_ref_id and m.user_id = p_user;

    when 'lockin' then
      select jsonb_build_object(
        'check_in_id', c.id, 'goal_type', c.goal_type, 'goal_label', c.goal_label,
        'goal_detail', c.goal_detail, 'duration_seconds', c.duration_seconds,
        'distance_m', c.distance_m, 'completed_at', c.created_at
      ) || coalesce(agora_lockin_strength_snapshot(c.id), '{}'::jsonb) into v
      from check_ins c
      where c.id = p_ref_id and c.user_id = p_user
        and c.duration_seconds is not null and c.removed_at is null;

    when 'rank' then
      -- No ref id: your standing is a single row of live state. tier/division come from
      -- rank_thresholds so the numeral on the card is the server's, not a client guess at the
      -- ladder's shape.
      select jsonb_build_object('rank_index', urs.rank_index, 'tier', rt.tier, 'division', rt.division)
      into v
      from user_rank_state urs
      join rank_thresholds rt on rt.rank_index = urs.rank_index
      where urs.user_id = p_user;

    when 'streak' then
      select jsonb_build_object('days', p.current_streak, 'longest', p.longest_streak) into v
      from profiles p where p.id = p_user and p.current_streak > 0;

    when 'pass' then
      -- pass_xp, not a level: the level curve is client-side (levelFromXp). Same number, one
      -- definition.
      select jsonb_build_object('season_id', fps.season_id, 'pass_xp', fps.pass_xp,
                                'owns_premium', fps.owns_premium)
      into v
      from forge_pass_state fps
      where fps.user_id = p_user
      order by fps.season_id desc
      limit 1;

    when 'cosmetic' then
      select jsonb_build_object(
        'cosmetic_key', co.cosmetic_key, 'slot', co.slot, 'source', co.source,
        'provenance', co.provenance, 'rarity_override', co.rarity_override,
        'season_stamp', co.season_stamp, 'acquired_at', co.acquired_at
      ) into v
      from cosmetics_owned co where co.user_id = p_user and co.cosmetic_key = p_key;

    when 'pr' then
      select jsonb_build_object(
        'exercise', e.name, 'weight', pr.weight, 'reps', pr.reps,
        'e1rm', pr.e1rm, 'achieved_at', pr.achieved_at
      ) into v
      from personal_records pr
      join exercises e on e.id = pr.exercise_id
      where pr.id = p_ref_id and pr.user_id = p_user;

    when 'video' then
      -- 0279 · only a clip the ledger issued to THIS user, and only one no post has claimed. The
      -- facts come from the ledger row the edge function wrote, never from the client's payload.
      -- The keys are frozen so an old card still knows what to ask the playback function for.
      select jsonb_build_object(
        'video_key', u.video_key, 'poster_key', u.poster_key,
        'duration_s', u.duration_s, 'width', u.width, 'height', u.height
      ) into v
      from agora_video_uploads u
      where u.video_key = p_key and u.user_id = p_user and u.post_id is null;

    else
      v := null;
  end case;

  return v;
end;
$function$;

-- ───────────────────────────── 5. the post claims its clip ─────────────────────────────
-- AFTER INSERT rather than inside create_agora_post, so this file doesn't restate that function
-- (0277 is restating its neighbours in parallel). `where post_id is null` + the row lock an UPDATE
-- takes is what settles two posts racing for one key: the loser updates nothing and is refused.
create or replace function agora_post_claim_video()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text;
begin
  for v_key in
    select el.value->>'key'
      from jsonb_array_elements(coalesce(new.attachments, '[]'::jsonb)) el
     where el.value->>'kind' = 'video'
  loop
    update agora_video_uploads u
       set post_id = new.id
     where u.video_key = v_key and u.user_id = new.user_id and u.post_id is null;
    if not found then
      raise exception 'That video is already posted, or is not yours.';
    end if;
  end loop;
  return null;
end;
$fn$;

drop trigger if exists agora_posts_claim_video on agora_posts;
create trigger agora_posts_claim_video
  after insert on agora_posts
  for each row execute function agora_post_claim_video();

revoke all on function agora_post_claim_video() from public, anon, authenticated;

-- ───────────────────────────── 6. who may play which clip ─────────────────────────────
/**
 * The R2 keys behind the given posts' videos — only for posts the CALLER can open.
 *
 * Deliberately defers to get_agora_item instead of restating its predicate: that function is the
 * one place the dial, the forest gate, the campfire gate (0277) and blocks live, and it is being
 * extended in parallel. A copy here would be the first thing to fall behind, and the direction it
 * falls is "a friends-only clip plays for a stranger". Capped at 30 ids (a feed page is 20).
 */
create or replace function agora_video_sources(p_post_ids uuid[])
returns table (post_id uuid, video_key text, poster_key text)
language sql
stable
security definer
set search_path = public
as $fn$
  select u.post_id, u.video_key, u.poster_key
    from agora_video_uploads u
   where u.post_id = any (p_post_ids[1:30])
     and auth.uid() is not null
     and get_agora_item(u.post_id, 'post') is not null;
$fn$;

revoke all on function agora_video_sources(uuid[]) from public, anon;
grant execute on function agora_video_sources(uuid[]) to authenticated;

-- ───────────────────────────── 7. abandoned uploads are swept ─────────────────────────────
-- An upload the composer never posted (cancelled, refused, app killed) — deleting the row queues
-- the R2 purge through the trigger above. A day is generous for a post that takes seconds.
create or replace function sweep_agora_video_uploads()
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from agora_video_uploads where post_id is null and issued_at < now() - interval '1 day';
$fn$;

revoke all on function sweep_agora_video_uploads() from public, anon, authenticated;

select cron.unschedule('philoi-agora-video-sweep')
 where exists (select 1 from cron.job where jobname = 'philoi-agora-video-sweep');
select cron.schedule('philoi-agora-video-sweep', '17 * * * *', 'select public.sweep_agora_video_uploads()');

-- ───────────────────────────── verify ─────────────────────────────
-- Runs the real path as a real user, then undoes it by raising. Every "expect refused" is paired
-- with an "expect accepted" on the same setup, so a check that passes under the bug can't pass here.
do $verify$
declare
  v_user uuid;
  v_other uuid;
  v_key text;
  v_poster text;
  v_post uuid;
  v_n int;
begin
  perform set_config('philoi.suppress_push', 'on', true);

  select id into v_user from profiles order by created_at limit 1;
  -- Someone the poster's friends-only dial EXCLUDES, so the "refused" checks below always run.
  select id into v_other from profiles
   where id <> v_user and not can_see_agora(v_user, 'friends', id)
   order by created_at limit 1;
  if v_user is null or v_other is null then return; end if;

  begin
    v_key := 'agora/' || v_user || '/' || gen_random_uuid() || '.mp4';
    v_poster := replace(v_key, '.mp4', '_poster.jpg');
    insert into agora_video_uploads (video_key, poster_key, user_id, bytes, duration_s, width, height)
    values (v_key, v_poster, v_user, 1000000, 12.4, 720, 1280);

    -- Someone else cannot attach it.
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    begin
      perform create_agora_post('x', null, 'friends', null, null, null,
        jsonb_build_array(jsonb_build_object('kind', 'video', 'key', v_key)));
      raise exception '0279 verify: another user attached the clip';
    exception when others then
      if sqlerrm like '0279 verify:%' then raise; end if;
    end;

    -- Its owner can, as the FIRST element (the attach_kind mirror must accept it).
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    v_post := create_agora_post(null, null, 'friends', null, null, null,
      jsonb_build_array(jsonb_build_object('kind', 'video', 'key', v_key)));
    if (select attach_kind from agora_posts where id = v_post) <> 'video'
       or (select attachments->0->'snapshot'->>'poster_key' from agora_posts where id = v_post) <> v_poster then
      raise exception '0279 verify: snapshot not frozen from the ledger';
    end if;
    if (select post_id from agora_video_uploads where video_key = v_key) is distinct from v_post then
      raise exception '0279 verify: post did not claim its clip';
    end if;

    -- A claimed clip cannot go on a second post.
    begin
      perform create_agora_post(null, null, 'friends', null, null, null,
        jsonb_build_array(jsonb_build_object('kind', 'video', 'key', v_key)));
      raise exception '0279 verify: one clip went on two posts';
    exception when others then
      if sqlerrm like '0279 verify:%' then raise; end if;
    end;

    -- The owner gets the keys back; a viewer the dial excludes does not (friends-only post).
    select count(*) into v_n from agora_video_sources(array[v_post]);
    if v_n <> 1 then raise exception '0279 verify: owner got % sources, expected 1', v_n; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    select count(*) into v_n from agora_video_sources(array[v_post]);
    if v_n <> 0 then raise exception '0279 verify: a non-friend got the clip of a friends-only post'; end if;

    -- Deleting the post deletes the ledger row and queues BOTH objects for the R2 purge.
    delete from agora_posts where id = v_post;
    if exists (select 1 from agora_video_uploads where video_key = v_key) then
      raise exception '0279 verify: ledger row survived its post';
    end if;
    select count(*) into v_n from gym_clip_purges
     where object_key in (v_key, v_poster) and purged_at is null and queued_at = now();
    if v_n <> 2 then raise exception '0279 verify: % of 2 objects queued for purge', v_n; end if;

    raise exception using errcode = 'P0279', message = 'rollback';
  exception
    when sqlstate 'P0279' then null;
  end;

  if not exists (select 1 from cron.job where jobname = 'philoi-agora-video-sweep') then
    raise exception '0279 verify: sweep cron not scheduled';
  end if;
end
$verify$;
