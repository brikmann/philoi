-- 0294 · A POST CAN CARRY A LINK (inbound share, Phase 7 expanded).
--
-- Share → Philoi from Instagram hands the app a URL (instagram.com/reel/…), never the Reel's video:
-- Instagram gives third parties no raw media. So an inbound share is either a FILE (a photo or clip —
-- 0286's path, unchanged) or a LINK, and a link post is an ordinary Agora post carrying one `link`
-- attachment: {kind: 'link', key: <url>}. The snapshot freezes {url, host, provider}.
--
-- WHY AN ATTACHMENT KIND, NOT A source_url COLUMN: create_agora_post already loops every attachment
-- through agora_attachment_snapshot, create_forest_post / create_campfire_post call it, and every
-- feed read (get_agora_feed, get_agora_item, the channel feeds) already returns `attachments`. One
-- new branch in the snapshot gives the square, a forest and a campfire link posts — and every
-- reader the link — with no other body restated. One link per post falls out of one-per-kind.
--
-- INSTALLED BUILDS: attachmentView() returns null for a kind it doesn't know, so an older client
-- draws a link post as its caption alone, never a crash.
--
-- No storage: a link uploads nothing, so there is nothing to hard-delete. (Photos are dropped by
-- 0131's after-delete trigger; clips by 0279's agora_video_uploads purge — both unchanged.)
--
-- Additive: one CHECK widened by one value, one function restated from its live body (grants kept —
-- CREATE OR REPLACE preserves the ACL; it stays callable only through the posting RPCs' definer).

begin;

alter table public.agora_posts drop constraint if exists agora_posts_attach_kind_check;
alter table public.agora_posts add constraint agora_posts_attach_kind_check
  check (attach_kind = any (array['milestone', 'lockin', 'rank', 'streak', 'pass', 'cosmetic', 'pr', 'video', 'link']));

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

    else
      v := null;
  end case;

  return v;
end;
$function$;

commit;
