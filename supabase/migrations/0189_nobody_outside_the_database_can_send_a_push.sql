-- NOBODY OUTSIDE THE DATABASE CAN SEND A PUSH
--
-- notify_push(p_user_ids, p_title, p_body, p_data, p_channel_id, p_image_url) is SECURITY DEFINER
-- and was executable by anon and authenticated with no auth.uid() check. Anyone holding the anon
-- key (it ships in every build) could write a bell row and send a push with any title, body and
-- route to any user id. 0185 closed the grant functions; this is the same class on the push path.
--
-- Safe to revoke from every client role:
--   · no client code calls it (only comments in src/ name it);
--   · all 16 callers are SECURITY DEFINER owned by postgres, so they run with postgres's EXECUTE;
--   · probed in begin/rollback on prod 2026-09-15: after the revoke anon=false, authenticated=false,
--     and send_test_notification() called as an authenticated user still enqueued its net.http_post.
--
-- public, anon AND authenticated: revoking only public+authenticated leaves anon's explicit grant.

revoke execute on function public.notify_push(uuid[], text, text, jsonb, text, text)
  from public, anon, authenticated;

-- ─────────────────────────── verification ───────────────────────────
do $verify$
begin
  -- The hole is closed for both client roles.
  if has_function_privilege('anon', 'public.notify_push(uuid[],text,text,jsonb,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.notify_push(uuid[],text,text,jsonb,text,text)', 'execute') then
    raise exception '0189: a client role can still execute notify_push';
  end if;

  -- Positive control: the owner every trusted caller runs as still can. Without this, a revoke that
  -- also took postgres's EXECUTE would pass the check above and silently stop every server push.
  if not has_function_privilege('postgres', 'public.notify_push(uuid[],text,text,jsonb,text,text)', 'execute') then
    raise exception '0189: postgres lost EXECUTE on notify_push; every server-side push would fail';
  end if;

  -- One signature, so the revoke above cannot have missed an overload.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'notify_push') <> 1 then
    raise exception '0189: notify_push has more than one overload; revoke each signature';
  end if;

  raise notice '0189: notify_push closed to anon and authenticated, still callable by its owner';
end
$verify$;
