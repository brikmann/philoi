-- 0307 — Feed filters by program + patron (CODE_PROMPT_v2_fixes §7/§8, mocks 409/410).
--
-- get_gym_feed gains two filters, both with the value in a new optional p_value:
--   · 'program' — p_value = programs.id (uuid); keeps items whose AUTHOR's profiles.program_id
--                 matches. Your own program by default (§7); any program from the pulse picker (§8).
--   · 'patron'  — p_value = patron key; keeps items whose author's profiles.patron_key matches.
-- Both reuse the 'prs' page-walk exactly (global scope in pages of 50, cursor advances to each
-- page's true last row, stop at p_limit / a short page / 40 pages), so the (created_at, id) cursor
-- holds and thin slices still page correctly. 'gym' / 'following' / 'prs' are unchanged.
--
-- A parameter is added, so drop the 4-arg version first (CREATE OR REPLACE would leave two
-- overloads). p_value defaults to null, so existing get_gym_feed({p_filter,…}) calls are unchanged.
-- gym_feed_page is not touched. Only GYM_SPARK builds call this, and none has shipped.

drop function if exists public.get_gym_feed(text, timestamptz, uuid, integer);

create function public.get_gym_feed(
  p_filter text, p_before_at timestamptz, p_before_id uuid, p_limit integer, p_value text default null
)
returns table (
  item_type text, id uuid, user_id uuid, display_name text, handle text, avatar_url text,
  university text, rank_tier text, rank_division integer, visibility text, body text,
  photo_path text, attach_kind text, attach_snapshot jsonb, attachments jsonb, cheers bigint,
  cheered boolean, comments bigint, created_at timestamptz, audience text, audience_ref_id uuid,
  audience_name text, audience_emoji text,
  is_pr boolean, top_comment_name text, top_comment_body text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_at     timestamptz := p_before_at;
  v_id     uuid := p_before_id;
  v_page   integer;
  v_got    integer := 0;
  v_iter   integer := 0;
  v_prog   uuid;
  v_patron text;
  v_keep   boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_filter = 'gym' then
    return query select g.* from gym_feed_page('global', p_before_at, p_before_id, v_limit, false) g;
    return;
  elsif p_filter = 'following' then
    return query select g.* from gym_feed_page('friends', p_before_at, p_before_id, v_limit, false) g;
    return;
  elsif p_filter = 'program' then
    begin
      v_prog := nullif(btrim(p_value), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Bad program id: %', p_value using errcode = '22023';
    end;
    if v_prog is null then
      raise exception 'The program filter needs a program id.' using errcode = '22023';
    end if;
  elsif p_filter = 'patron' then
    v_patron := nullif(btrim(p_value), '');
    if v_patron is null then
      raise exception 'The patron filter needs a patron key.' using errcode = '22023';
    end if;
  elsif p_filter is distinct from 'prs' then
    raise exception 'Unknown gym feed filter: %', p_filter using errcode = '22023';
  end if;

  -- 'prs' / 'program' / 'patron' (0307): walk 'global' in pages of 50 (get_agora_feed's cap), keep the PR posts, advance the
  -- cursor to each page's LAST row (PR or not) so a sparse run of PRs pages correctly, and stop
  -- at v_limit rows, a short page (the feed is exhausted), or 40 pages (2,000 rows scanned).
  -- Rows come out in (created_at desc, id desc), so the client's (created_at, id) cursor holds.
  loop
    v_iter := v_iter + 1;
    v_page := 0;
    for item_type, id, user_id, display_name, handle, avatar_url,
        university, rank_tier, rank_division, visibility, body,
        photo_path, attach_kind, attach_snapshot, attachments, cheers,
        cheered, comments, created_at, audience, audience_ref_id,
        audience_name, audience_emoji,
        is_pr, top_comment_name, top_comment_body
      in select g.* from gym_feed_page('global', v_at, v_id, 50, p_filter = 'prs') g
    loop
      v_page := v_page + 1;
      v_at := created_at;
      v_id := id;
      v_keep := case p_filter
        when 'prs'     then item_type = 'post' and is_pr
        -- program / patron: the AUTHOR's current program_id / patron_key (profiles), any item type.
        when 'program' then exists (select 1 from profiles ap where ap.id = user_id and ap.program_id = v_prog)
        when 'patron'  then exists (select 1 from profiles ap where ap.id = user_id and ap.patron_key = v_patron)
      end;
      if v_keep and v_got < v_limit then
        return next;
        v_got := v_got + 1;
      end if;
    end loop;

    exit when v_got >= v_limit or v_page < 50 or v_iter >= 40;
  end loop;
end;
$$;

revoke all on function public.get_gym_feed(text, timestamptz, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.get_gym_feed(text, timestamptz, uuid, integer, text) to authenticated, service_role;
