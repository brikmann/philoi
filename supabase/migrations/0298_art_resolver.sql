-- 0298 · ART RESOLVER (ShareSpot §5, ss3). A post can carry a tagged thing with its REAL art.
--
-- Tag "Minecraft" and the card shows Minecraft's key art; an anthem shows its album cover; a film
-- its poster. The resolve-art edge function looks a (kind, query) up in the source's own API —
-- iTunes / OpenLibrary keyless, Spotify / TMDB / IGDB when their secrets exist — and writes each hit
-- into art_entities under a canonical id. A post then carries {kind: 'art', key: <canonical id>},
-- and agora_attachment_snapshot freezes that row into the post's attachments, exactly as 0294 did for
-- links. Feeds render the frozen art_url; nothing re-resolves on read.
--
-- WHY NOT art_url / canonical_id COLUMNS ON agora_posts: the snapshot already lives on the post row
-- (agora_posts.attachments), every feed read already returns it, and create_forest_post /
-- create_campfire_post (Rooms) already route through the snapshot — one branch gives the square,
-- a Room and every reader the art with no other body restated. One art tag per post falls out of
-- one-per-kind.
--
-- TRUST: art_entities is written by the service role only. A client can pick WHICH entity, never
-- what it says or which image it shows — the URL on a card is one the edge function fetched.
-- No real people: the function never searches a people index and never takes an artist photo.
--
-- INSTALLED BUILDS: attachmentView() returns null for an unknown kind, so an older client draws an
-- art post as its caption alone, never a crash.
--
-- Additive: three new tables, one CHECK widened by one value, one function restated from its LIVE
-- body (verified identical to 0294's on 2026-11-09). CREATE OR REPLACE keeps the snapshot's ACL.

begin;

-- ── the entity cache: one row per real thing, keyed by the source's own id ──
create table if not exists public.art_entities (
  canonical_id text primary key check (char_length(canonical_id) between 3 and 120),
  kind text not null check (kind in ('game', 'song', 'film', 'show', 'book')),
  title text not null check (char_length(title) between 1 and 200),
  subtitle text check (subtitle is null or char_length(subtitle) <= 200),
  art_url text not null check (art_url ~ '^https://' and char_length(art_url) <= 1024),
  source text not null check (source in ('spotify', 'itunes', 'tmdb', 'igdb', 'openlibrary')),
  external_url text check (external_url is null or (external_url ~ '^https://' and char_length(external_url) <= 1024)),
  resolved_at timestamptz not null default now()
);
alter table public.art_entities enable row level security;
-- Readable to signed-in users (the composer previews a pick; Discover / Campfire draw them). No
-- write policy: only the service role writes.
drop policy if exists "art_entities: signed-in read" on public.art_entities;
create policy "art_entities: signed-in read" on public.art_entities for select to authenticated using (true);
revoke all on public.art_entities from anon;
revoke insert, update, delete, truncate on public.art_entities from authenticated;
-- Explicit, not left to the schema's default privileges: the policy above is useless without it.
grant select on public.art_entities to authenticated;

-- ── (kind, normalized query) → ranked canonical ids. Service role only. ──
create table if not exists public.art_search_cache (
  kind text not null check (kind in ('game', 'song', 'film', 'show', 'book')),
  query text not null check (char_length(query) between 1 and 80),
  canonical_ids text[] not null default '{}',
  resolved_at timestamptz not null default now(),
  primary key (kind, query)
);
alter table public.art_search_cache enable row level security;
revoke all on public.art_search_cache from anon, authenticated;

-- ── cache misses per user, for resolve-art's per-minute limit. Service role only. ──
create table if not exists public.art_resolve_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists art_resolve_log_user_at on public.art_resolve_log (user_id, at desc);
alter table public.art_resolve_log enable row level security;
revoke all on public.art_resolve_log from anon, authenticated;

-- ── one more attach kind ──
alter table public.agora_posts drop constraint if exists agora_posts_attach_kind_check;
alter table public.agora_posts add constraint agora_posts_attach_kind_check
  check (attach_kind = any (array['milestone', 'lockin', 'rank', 'streak', 'pass', 'cosmetic', 'pr', 'video', 'link', 'art']));

CREATE OR REPLACE FUNCTION public.agora_attachment_snapshot(p_user uuid, p_kind text, p_ref_id uuid, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb;
  v_url text;
  v_host text;
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

    when 'link' then
      -- 0294 · a link shared in from another app — an Instagram Reel, a TikTok, a YouTube clip.
      -- Instagram hands third parties the Reel's URL, never its video, so the URL IS the
      -- attachment. There is nothing to own, so the check is SHAPE, not ownership: https only, no
      -- whitespace, a real dotted host, at most 2048 characters. Anything else is null, which the
      -- caller already turns into a refusal. The provider is frozen beside it so the card names
      -- "Instagram Reel" without re-parsing, and so a stale card keeps its label.
      v_url := btrim(coalesce(p_key, ''));
      if char_length(v_url) between 12 and 2048
         and v_url ~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
        v_host := regexp_replace(lower(substring(v_url from '^https://([^/:?#]+)')), '^(www|m)\.', '');
        v := jsonb_build_object(
          'url', v_url,
          'host', v_host,
          'provider', case
            when v_host in ('instagram.com', 'instagr.am') or v_host like '%.instagram.com' then 'instagram'
            when v_host = 'tiktok.com' or v_host like '%.tiktok.com' then 'tiktok'
            when v_host in ('youtube.com', 'youtu.be', 'music.youtube.com') then 'youtube'
            when v_host in ('x.com', 'twitter.com') then 'x'
            when v_host = 'spotify.com' or v_host like '%.spotify.com' then 'spotify'
            else 'web'
          end
        );
      end if;

    when 'art' then
      -- 0298 · a tagged thing with its real artwork — a game, a song, a film, a show, a book. The
      -- key is a canonical id the resolve-art edge function wrote into art_entities (service role
      -- only), so the title and the image on the card are ones that function fetched from the
      -- source's own API, never anything the client typed. Nothing to own: anyone may tag Minecraft.
      -- An id art_entities doesn't hold is null, which the caller already turns into a refusal.
      select jsonb_build_object(
        'canonical_id', a.canonical_id, 'entity_kind', a.kind, 'title', a.title,
        'subtitle', a.subtitle, 'art_url', a.art_url, 'source', a.source, 'url', a.external_url
      ) into v
      from art_entities a where a.canonical_id = p_key;

    else
      v := null;
  end case;

  return v;
end;
$function$;

commit;
