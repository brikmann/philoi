-- Captions moved from the running lock-in session to the done screen (PHILOI_UI_SPEC.md §13's
-- redesign took the in-session caption field off mocks 51/52/53; the caption now belongs beside
-- "Post to the campfire", where the decision to publish actually happens).
--
-- That move needs a write path that didn't exist: check_ins has SELECT and INSERT policies but
-- NO update policy, so a client `update check_ins set caption = ...` is silently dropped by RLS
-- — the row comes back unchanged with no error, which is the worst possible failure mode for
-- something the user typed. Hence a security-definer RPC, the same self-write pattern as
-- set_my_auto_post_synced / set_my_helper_flag rather than opening check_ins to client updates
-- (which would also expose xp_earned, status, removed_at, ... to tampering).
create or replace function set_my_check_in_caption(p_check_in_id uuid, p_caption text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update check_ins
  -- Empty/whitespace-only collapses to null so "typed then cleared" is stored the same as
  -- "never typed"; length capped here too, not just in the client's maxLength, since an RPC is
  -- directly callable.
  set caption = nullif(btrim(left(coalesce(p_caption, ''), 140)), '')
  where id = p_check_in_id
    and user_id = auth.uid()
    -- A moderated-away lock-in stays moderated; re-captioning it isn't a thing.
    and removed_at is null;
end;
$$;
