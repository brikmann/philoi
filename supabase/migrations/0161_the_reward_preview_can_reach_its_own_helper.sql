-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0161 · THE REWARD PREVIEW COULD NOT CALL THE FUNCTION IT IS BUILT ON.
--
-- 🔴 `preview_challenge_reward` — the RPC §3 of DIFFICULTY_SCOPING.md puts behind the create
-- screen's "Cindy scoped this: EPIC → Vessel of Hestia" tease — fails for every real user:
--
--     ERROR: 42501: permission denied for function goal_paid_band
--     CONTEXT: PL/pgSQL function preview_challenge_reward(text,text,integer,integer) line 17
--
-- Reproduced on prod immediately after 0159/0160 landed, calling it exactly as the client does
-- (role `authenticated`, a real uid in request.jwt.claims).
--
-- ─────────────────────────── WHY IT HAPPENS ───────────────────────────
--
-- Two decisions in 0159 that are each individually right and cancel each other out:
--
--   1. `goal_paid_band` is an INTERNAL helper, so 0159 closes it to clients:
--
--          revoke all on function goal_paid_band(text, text) from public;
--          revoke all on function goal_paid_band(text, text) from authenticated;
--
--      That is the 0132 rule — "economy internals are not RPCs" — correctly applied. The place
--      the anti-cheese cap lives should not be directly callable by a client.
--
--   2. `preview_challenge_reward` is granted to `authenticated` and is SECURITY INVOKER
--      (`prosecdef = false`), so it executes AS THE CALLER.
--
-- An invoker-rights function runs its body with the caller's privileges, so the caller needs
-- EXECUTE on everything the body touches — including the helper deliberately revoked from them one
-- line earlier. The revoke is what makes the preview unreachable.
--
-- ─────────────────────────── WHY DEFINER AND NOT A GRANT ───────────────────────────
--
-- The one-line alternative is `grant execute on function goal_paid_band to authenticated`. That
-- would work and it is the WRONG fix: it undoes a deliberate decision, and it re-opens the helper
-- as a client-callable RPC. Nothing about needing an internal function makes it a public one.
--
-- SECURITY DEFINER on the preview keeps both intents: the preview stays callable, `goal_paid_band`
-- stays closed. It is safe here in a way it would not be for an arbitrary function, and the
-- specific reasons are worth stating rather than assumed:
--
--   · IT WRITES NOTHING. No economy_move_embers, no loot_boxes, no badge — 0159's own header calls
--     this out. Running it with owner rights grants no ability to change anything.
--   · IT READS NO CALLER-SCOPED DATA. The only tables it touches are two `economy_config` rows,
--     which are global configuration, identical for every user. There is no row it could return to
--     one user that belongs to another — the classic definer leak — because it reads no user rows.
--   · ITS ARGUMENTS CANNOT WIDEN IT. p_tier is looked up in the config and raises on an unknown
--     value; the rest are numbers used in arithmetic. There is no identifier interpolation and no
--     dynamic SQL.
--   · `set search_path = public` is already on the function and is preserved below, which is the
--     precondition that makes a definer function safe from search_path capture.
--   · The `auth.uid() is null` guard still works: auth.uid() reads the request's JWT claim, not the
--     executing role, so definer rights do not turn this into an anonymous endpoint.
--
-- ⚠️ RESTATED FROM 0159'S BODY, byte-for-byte, with `security definer` added and nothing else
-- changed. The signature is identical, so this REPLACES rather than adding an overload
-- (MIGRATIONS.md's trap); grants live per signature and the signature has not moved, so the
-- existing grant to `authenticated` carries over untouched and is re-asserted below only because
-- it costs nothing to be explicit.
--
-- 🔒 NOTHING HERE CHANGES A PAYOUT. This function is read-only and this migration changes only
-- who may execute it. The scoping, the bands, the discount and the caps are all exactly as 0159
-- left them — verified by the assertion at the bottom, which checks the anti-cheese cap still
-- holds after the change.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function preview_challenge_reward(
  p_tier text,
  p_verifiability text default 'honor',
  p_duration_days int default 1,
  p_scope int default 1
)
returns jsonb
language plpgsql
stable
-- THE ONLY CHANGE. See the header for why this is the safe half of the two options.
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_bands jsonb := (select value from economy_config where key = 'reward_bands');
  v_full text;
  v_paid text;
  v_sig numeric;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if v_cfg -> p_tier is null then
    raise exception 'Unknown difficulty tier.';
  end if;

  v_full := v_cfg -> p_tier ->> 'band';
  v_paid := goal_paid_band(p_tier, p_verifiability);
  v_sig  := (v_cfg -> p_tier ->> 'significance')::numeric
          * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
          * greatest(1, p_duration_days::numeric / 7);

  -- 🔒 READ ONLY. No economy_move_embers, no loot_boxes insert, no badge. This exists so the create
  -- screen can print the SERVER's figure rather than one Cindy stated — the spec's firewall is that
  -- Cindy proposes a tier and never names an ember number.
  return jsonb_build_object(
    'tier', p_tier,
    'achievement_band', v_full,
    'paid_band', v_paid,
    'discounted', v_paid is distinct from v_full,
    'box', case coalesce(v_paid, v_full)
             when 'apex' then 'promethean' when 'elite' then 'hephaestus'
             when 'impressive' then 'hestia' when 'notable' then 'furnace'
             when 'casual' then 'ignition' else null end,
    'embers', coalesce((v_bands ->> coalesce(v_paid, v_full))::int, 10),
    'drip', (v_cfg -> p_tier ->> 'drip')::int,
    'significance', v_sig,
    'verifiability', coalesce(p_verifiability, 'honor')
  );
end;
$$;

revoke all on function preview_challenge_reward(text, text, int, int) from public;
grant execute on function preview_challenge_reward(text, text, int, int) to authenticated;

-- goal_paid_band stays closed. Re-asserted so a later reader can see the pairing is intentional
-- rather than an omission, and so re-running this file restores the intended state.
revoke all on function goal_paid_band(text, text) from public;
revoke all on function goal_paid_band(text, text) from authenticated;

comment on function preview_challenge_reward(text, text, int, int) is
  '0161 — SECURITY DEFINER so it can reach goal_paid_band, which 0159 deliberately revoked from authenticated. Read-only over global config; writes nothing and reads no caller-scoped row, which is what makes definer rights safe here.';

-- ─────────────────────────── self-assertion ───────────────────────────
--
-- The claim is behavioural: a signed-in user can now get a preview, the internal helper is still
-- closed to them, and the anti-cheese cap is unchanged by the security swap. All three are checked
-- as `authenticated` with a real uid, which is the only role that reproduced the bug.
--
-- THE IMPERSONATION IS SCOPED TO A SUB-TRANSACTION on purpose. `set_config(..., true)` is SET
-- LOCAL: it lasts to the end of the TRANSACTION, not the end of this block. Setting the role
-- inline left every later statement running as `authenticated`, and the first one that needed
-- ownership failed with "must be owner of function preview_challenge_reward" — this migration's
-- own COMMENT statement. Raising inside a sub-block rolls the SET LOCAL back with it, which
-- restores the role as a side effect of unwinding rather than by remembering to undo it.
do $assert$
declare
  v_user uuid;
  v_preview jsonb;
  v_denied boolean := false;
begin
  select id into v_user from profiles order by created_at limit 1;
  if v_user is null then
    raise notice '0161: no profiles; the round trip was not exercised.';
    return;
  end if;

  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

    -- 1 · the preview works at all. This is the exact call that raised 42501.
    v_preview := preview_challenge_reward('epic', 'honor', 1, 1);
    if v_preview is null then
      raise exception '0161: preview_challenge_reward returned null for a signed-in caller.';
    end if;

    -- 2 · the anti-cheese cap survived the change. An unproven Epic must pay DOWN a band, and must
    --     not hand out the Vessel of Hestia its achievement band would earn.
    if v_preview ->> 'paid_band' <> 'notable' or v_preview ->> 'box' <> 'furnace' then
      raise exception '0161: the honor discount changed — epic/honor now pays band % / box %, expected notable / furnace.',
        v_preview ->> 'paid_band', v_preview ->> 'box';
    end if;
    if (v_preview ->> 'discounted')::boolean is not true then
      raise exception '0161: epic/honor is no longer flagged as discounted.';
    end if;

    -- 3 · the helper is STILL closed. If this ever succeeds, the fix has quietly become the wrong
    --     one — a grant — and 0159's "economy internals are not RPCs" decision has been undone.
    begin
      perform goal_paid_band('epic', 'honor');
    exception
      when insufficient_privilege then v_denied := true;
    end;

    if not v_denied then
      raise exception '0161: goal_paid_band is callable by authenticated. It is an internal helper and must stay closed.';
    end if;

    -- Unwind: rolls back both set_config calls along with everything else in this block.
    raise exception 'ok';
  exception
    when others then
      if sqlerrm <> 'ok' then
        raise;
      end if;
  end;

  raise notice '0161 ok — preview reachable, epic/honor still capped to notable/furnace, goal_paid_band still closed.';
end;
$assert$;
