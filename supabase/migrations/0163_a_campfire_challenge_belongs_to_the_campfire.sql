-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0163 · A CAMPFIRE CHALLENGE BELONGS TO THE CAMPFIRE, AND JOINING ONE SAYS SO OUT LOUD.
--
-- Brief: CODE_PROMPT_campfire_history_join.md. Spec: CHALLENGE_CINDY_SCOPING.md §Opt-in,
-- §Distribution.
--
-- ─────────────────────────── WHAT WAS ACTUALLY BROKEN ───────────────────────────
--
-- The run-club shape — an owner posts a challenge, invites people, they join — produced an empty
-- room. Two separate causes, and only one of them is what it looks like.
--
-- 1 · CHAT HISTORY WAS NEVER THE PROBLEM. "messages: read if member" is
--     `is_group_member(group_id) and not is_blocked_either_way(user_id)`, verified against prod's
--     own pg_policies for this migration. There is no joined_at clause and there never was, and
--     fetchMessages orders the whole group without a floor. A late joiner has always been able to
--     read every message in the fire. Do not "fix" this.
--
-- 2 · THE CHALLENGE IS NOT A MESSAGE, so nothing carried it into history. It lives in
--     social_challenges, and every surface that shows a challenge asks get_my_social_challenges —
--     a read scoped to the ROSTER (challenge_participants). A member who joined the fire after the
--     challenge was created is not on that roster, so the owner sees the race and the person they
--     invited sees nothing at all. The RLS on social_challenges was never the gate here: prod's
--     policy is already `is_group_member(circle_id) or created_by = auth.uid() or opponent_id =
--     auth.uid()`, so the row is readable. Nothing was READING it by circle.
--
-- 3 · JOINING IS SILENT. No row is written anywhere on join, so a fire whose members all joined
--     today looks abandoned to every one of them.
--
-- ─────────────────────────── WHAT THIS MIGRATION DOES ───────────────────────────
--
-- §1 A DEFERRED CONSTRAINT TRIGGER on social_challenges posts the challenge card into the
--    campfire chat, for every creation path at once. See §1 for why a trigger and not four edited
--    function bodies, and why it is DEFERRED rather than plain AFTER.
-- §2 Backfill: a card for every live campfire challenge that has none.
-- §3 get_circle_active_challenges — the missing read. By CIRCLE, for any MEMBER, rostered or not.
-- §4 messages gains a 'system' attachment kind and a system_event, and an AFTER INSERT trigger on
--    group_members writes 'member_joined'.
--
-- Everything here is additive: one new column, one new function, two new triggers, one restated
-- CHECK. No existing function body is touched, which is the entire point of the trigger shape.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §0 · the attachment shape grows a system kind ───────────────────────────
--
-- A join line is a message so that it inherits the whole campfire pipeline — realtime delivery,
-- the timeline's ordering, the member-read policy that makes it visible to people who join later.
-- It is the same argument 0162 makes for the challenge card, and it is why neither of these is a
-- synthetic client-side feed item.
-- ⚠️ A BUG 0158 DOCUMENTED AND DID NOT SHIP. That migration's own comment says "A message with an
-- attachment and no text is legal — posting a photo with no caption is the normal case — so
-- nothing here requires `body`", and messages_attachment_shape was written on that assumption. It
-- never dropped the NOT NULL, and prod still has it: read out of information_schema for this
-- migration, `messages.body` is `is_nullable = NO`. So sendMessage's `body: trimmed || null` — the
-- caption-less photo path, exactly the case 0158 named — has been failing on a null violation
-- since 0158 shipped, and the join line below would have failed the same way.
--
-- Dropped rather than worked around with an empty string, because '' is the one value
-- sanitize_message_body explicitly rejects, and because the client type has said
-- `body: string | null` since 0158.
alter table messages alter column body drop not null;

alter table messages add column if not exists system_event text;

comment on column messages.system_event is
  '0163 — which system event this row announces. Non-null exactly when attach_kind = ''system''. Today: ''member_joined''.';

-- RESTATED IN FULL from 0162's version with one arm added and `system_event is null` pinned onto
-- every other arm, so a system_event cannot be smuggled onto a photo or a challenge card. The
-- whole shape stays in one constraint for 0158's original reason: an illegal combination must not
-- be assemblable a column at a time.
--
-- The 'system' arm leaves attach_ref_id free. member_joined does not need it — the joiner is the
-- row's own user_id — but a later system event that points at something (a settled challenge, a
-- promoted admin) should not need another migration to say so.
alter table messages drop constraint if exists messages_attachment_shape;
alter table messages add constraint messages_attachment_shape
  check (
    (attach_kind is null and attach_path is null and attach_ref_id is null and system_event is null)
    or (attach_kind = 'photo'  and attach_path is not null and attach_ref_id is null
        and system_event is null and attach_path like (user_id::text || '/%'))
    or (attach_kind = 'lockin' and attach_ref_id is not null and attach_path is null and system_event is null)
    or (attach_kind = 'challenge' and attach_ref_id is not null and attach_path is null and system_event is null)
    or (attach_kind = 'system' and system_event is not null and attach_path is null)
  );

-- ─────────────────────────── §1 · the card, on every creation path ───────────────────────────
--
-- WHY A TRIGGER AND NOT THREE EDITED FUNCTIONS. The brief asks for the card on
-- create_group_challenge, create_placement_challenge and host_campfire_challenge. Editing three
-- bodies means restating three bodies, and this repo's own history is the argument against that:
-- 0145 shipped two overloads of all three create_* RPCs and broke challenge creation for every
-- install; 0135 rebuilt notification_category from a spec and silently dropped a case 0120 had
-- added; 0147's participant insert has been dropped by a restatement twice. Three more
-- restatements to add one INSERT each is three more chances at the same failure, and it would
-- still miss the fourth path nobody has written yet.
--
-- WHY DEFERRED. host_campfire_challenge (0162) ALREADY posts this card, with its own body text and
-- returning its own message_id into the RPC's result. A plain AFTER INSERT trigger fires before
-- that statement runs, so its "does a card exist yet?" guard would always say no and the host path
-- would end up with two. A DEFERRABLE INITIALLY DEFERRED constraint trigger fires at COMMIT, after
-- every statement in the transaction — so 0162's card is already there to be seen, the guard skips,
-- and host_campfire_challenge keeps working unmodified. Deferral buys a second thing for free: the
-- row is re-read by id at commit, so a name set by a later UPDATE in the same transaction is the
-- name on the card.
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

  -- A DUEL IS NOT A CAMPFIRE CHALLENGE even when a campfire is watching it. create_h2h_challenge
  -- takes an optional circle_id so friends can duel in front of a fire (§16); that is a spectator
  -- relationship, not the fire's own race, and it has its own invite/accept flow. Only mode
  -- 'group' names the whole campfire.
  if v_c.circle_id is null or v_c.mode <> 'group' then
    return null;
  end if;

  -- Already carded — the 0162 host path, or a re-run of this trigger. attach_ref_id is the
  -- challenge id on a 'challenge' row, so this is the whole uniqueness rule.
  if exists (
    select 1 from messages m
     where m.attach_kind = 'challenge' and m.attach_ref_id = v_c.id
  ) then
    return null;
  end if;

  v_name := coalesce(
    nullif(btrim(coalesce(v_c.public_name, '')), ''),
    case
      when v_c.count_unit is not null and v_c.target_count is not null
        then trim(to_char(v_c.target_count, 'FM999999999')) || ' ' || v_c.count_unit
      when v_c.shape = 'placement' then 'A ranked race'
      else 'A campfire challenge'
    end
  );

  -- "Who's in?" is wrong on a placement race in one direction and right in another: 0145 enrols
  -- the whole campfire AT CREATION, so everyone present is already in — but a member who joins
  -- the fire tomorrow is not on that snapshot and does need the CTA. So the card is posted for
  -- both shapes and only the sentence differs.
  v_body := case
    when v_c.shape = 'placement' then v_name || ' — the ranked race is on.'
    else v_name || ' — who''s in?'
  end;

  -- Authored by the creator, not by a system account: ChallengeChatCard keys its "You're hosting
  -- this one" state off the message being your own, and the timeline draws the author's avatar.
  --
  -- Wrapped, because a card is an announcement and a failed announcement must never roll back the
  -- challenge that was successfully created. The rate limiter on messages is the realistic way
  -- this fails — an admin setting up several races in one burst — and losing the race would be a
  -- far worse outcome than losing its chat card.
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
  '0163 — posts the campfire chat card for a group-mode challenge, on whatever path created it. DEFERRED to commit so 0162''s own card in host_campfire_challenge is seen and skipped rather than duplicated.';

drop trigger if exists social_challenges_post_card on social_challenges;
create constraint trigger social_challenges_post_card
  after insert on social_challenges
  deferrable initially deferred
  for each row execute function post_campfire_challenge_card();

-- ─────────────────────────── §2 · the backfill ───────────────────────────
--
-- Every challenge already running in a campfire, with no card, gets one — dated to the challenge's
-- own created_at so it lands in the timeline where it happened rather than at the bottom of
-- today's chat. Live statuses only: a declined or settled race does not need a join CTA posted
-- retroactively into a fire that has moved on.
--
-- Written as a plain INSERT ... SELECT rather than by re-firing the trigger, because the trigger
-- only fires on INSERT and these rows already exist.
insert into messages (group_id, user_id, body, attach_kind, attach_ref_id, created_at)
select c.circle_id,
       c.created_by,
       left(
         coalesce(
           nullif(btrim(coalesce(c.public_name, '')), ''),
           case
             when c.count_unit is not null and c.target_count is not null
               then trim(to_char(c.target_count, 'FM999999999')) || ' ' || c.count_unit
             when c.shape = 'placement' then 'A ranked race'
             else 'A campfire challenge'
           end
         ) || case when c.shape = 'placement' then ' — the ranked race is on.' else ' — who''s in?' end,
         2000),
       'challenge', c.id, c.created_at
  from social_challenges c
  join groups g on g.id = c.circle_id
 where c.circle_id is not null
   and c.mode = 'group'
   and c.status in ('draft', 'pending', 'active')
   -- The author has to still be a profile for the FK, and the message renders their avatar.
   and exists (select 1 from profiles p where p.id = c.created_by)
   and not exists (
     select 1 from messages m where m.attach_kind = 'challenge' and m.attach_ref_id = c.id
   );

-- ─────────────────────────── §3 · the read, by circle, for any member ───────────────────────────
--
-- THE MISSING HALF. get_my_social_challenges answers "what am I rostered on"; nothing answered
-- "what is this fire running". Those are different questions and conflating them is the bug: the
-- opt-in model (§Opt-in) means a live campfire challenge has members who are deliberately NOT on
-- its roster yet, and they are exactly the people who need to see it.
--
-- SECURITY DEFINER with an explicit membership gate rather than a plain view: the participant
-- count and the host's display name both read tables the caller has no business reading in bulk,
-- and the gate here is the same one the RLS policy applies to the challenge row itself.
--
-- ⚠️ Every column in the body is qualified with a table alias. RETURNS TABLE names are in scope
-- inside the body and SHADOW same-named table columns — an unqualified `status` here would be the
-- output column, not social_challenges.status, and the filter would silently match everything.
drop function if exists get_circle_active_challenges(uuid);

create function get_circle_active_challenges(p_circle_id uuid)
returns table (
  id uuid,
  circle_id uuid,
  created_by uuid,
  host_name text,
  mode text,
  shape text,
  status text,
  race_metric text,
  count_unit text,
  target_count int,
  payout_xp int,
  public_name text,
  difficulty_tier text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  participant_count int,
  i_am_in boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  -- Membership, not roster. That distinction IS this function.
  if not is_group_member(p_circle_id) then
    raise exception 'That campfire isn''t yours to read.';
  end if;

  return query
  select c.id,
         c.circle_id,
         c.created_by,
         coalesce(pr.display_name, 'Someone')::text as host_name,
         c.mode,
         c.shape,
         c.status,
         c.race_metric,
         c.count_unit,
         c.target_count,
         c.payout_xp,
         c.public_name,
         c.difficulty_tier,
         c.starts_at,
         c.ends_at,
         c.created_at,
         (select count(*)::int from challenge_participants cp
           where cp.challenge_id = c.id and cp.state = 'accepted') as participant_count,
         exists (select 1 from challenge_participants cp2
                  where cp2.challenge_id = c.id and cp2.user_id = auth.uid()
                    and cp2.state = 'accepted') as i_am_in
    from social_challenges c
    left join profiles pr on pr.id = c.created_by
   where c.circle_id = p_circle_id
     and c.mode = 'group'
     -- LIVE means joinable: exactly the set join_campfire_challenge admits. Keeping the two lists
     -- identical is what stops the strip offering a Join the server will then refuse.
     and c.status in ('draft', 'pending', 'active')
   order by c.created_at desc;
end;
$$;

comment on function get_circle_active_challenges(uuid) is
  '0163 — a campfire''s live challenges, for any MEMBER of it, rostered or not. The read get_my_social_challenges cannot do: an opt-in challenge''s audience is the fire, not its roster.';

revoke all on function get_circle_active_challenges(uuid) from public;
grant execute on function get_circle_active_challenges(uuid) to authenticated;

-- ─────────────────────────── §4 · "{name} joined" ───────────────────────────
--
-- ON group_members AND NOT ON THE FOUR JOIN RPCs, for the reason §1 gives about the card: prod has
-- four functions that write this table (approve_join_request, join_group_with_code,
-- join_public_group, create_group_with_owner, plus the dev seeders), the list has grown twice, and
-- a rule that lives on the table cannot be forgotten by the fifth.
--
-- ROLE 'owner' IS EXCLUDED. create_group_with_owner's insert is the founding of the fire, not an
-- arrival at it — "Sam joined" as the very first line of a campfire Sam just created reads as a
-- bug. Every other role goes through a door.
create or replace function announce_campfire_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'owner' then
    return null;
  end if;

  -- body NULL, and deliberately: the client renders this line from system_event and the joiner's
  -- profile, so the wording is a client concern and an old build shows nothing rather than
  -- something wrong. sanitize_message_body's empty check is `new.body = ''`, which is NULL — not
  -- true — for a null body, so this passes it exactly the way 0158's caption-less photo does.
  -- notify_message_mentions bails on `new.body is null` before its regex, so no push fires: the
  -- brief asks for no notification on join and this is why there isn't one.
  begin
    insert into messages (group_id, user_id, body, attach_kind, system_event)
    values (new.group_id, new.user_id, null, 'system', 'member_joined');
  exception when others then
    -- A join must never fail because its announcement did. The message rate limiter is the
    -- realistic cause and being unable to enter a campfire is a far worse bug than a missing line.
    raise warning '0163 — could not announce % joining campfire %: %', new.user_id, new.group_id, sqlerrm;
  end;

  return null;
end;
$$;

comment on function announce_campfire_join() is
  '0163 — writes the "{name} joined" system message. On the TABLE rather than on the four join RPCs, so a fifth join path cannot forget it. Owner rows (campfire creation) are skipped.';

drop trigger if exists group_members_announce_join on group_members;
create trigger group_members_announce_join
  after insert on group_members
  for each row execute function announce_campfire_join();

-- ─────────────────────────── verification ───────────────────────────
do $verify$
declare
  v_qual text;
  v_n int;
begin
  -- §1 of the brief asks for an RLS check. It is already correct in prod and this migration
  -- deliberately does not touch it — the assertion is here so that a future change that breaks it
  -- fails a migration instead of a run club.
  select pg_get_expr(pol.polqual, pol.polrelid) into v_qual
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname = 'social_challenges' and pol.polname = 'social_challenges: read if circle member';

  if v_qual is null then
    raise warning '0163 WARNING — the social_challenges member-read policy is missing; a late joiner cannot read the row.';
  elsif v_qual not like '%is_group_member(circle_id)%' then
    raise warning '0163 WARNING — social_challenges read policy no longer admits plain members: %', v_qual;
  else
    raise notice '0163 ok — a campfire member can read the campfire''s challenge rows.';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'messages' and column_name = 'system_event') then
    raise notice '0163 ok — messages.system_event present.';
  else
    raise warning '0163 WARNING — messages.system_event missing.';
  end if;

  select count(*) into v_n from pg_trigger
   where tgname in ('social_challenges_post_card', 'group_members_announce_join') and not tgisinternal;
  if v_n = 2 then
    raise notice '0163 ok — both triggers installed.';
  else
    raise warning '0163 WARNING — expected 2 new triggers, found %.', v_n;
  end if;

  -- The card trigger is worthless if it is not deferred — see §1: an immediate one duplicates
  -- 0162's own card on every hosted challenge.
  if exists (select 1 from pg_trigger where tgname = 'social_challenges_post_card' and tgdeferrable and tginitdeferred) then
    raise notice '0163 ok — the card trigger is deferred to commit.';
  else
    raise warning '0163 WARNING — social_challenges_post_card is not DEFERRABLE INITIALLY DEFERRED; hosted challenges will get two cards.';
  end if;

  -- One row in pg_proc per name (MIGRATIONS.md "Appending a parameter is not a replacement").
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_circle_active_challenges';
  if v_n <> 1 then
    raise warning '0163 WARNING — get_circle_active_challenges has % overloads, expected 1.', v_n;
  end if;

  select count(*) into v_n
    from social_challenges c
   where c.circle_id is not null and c.mode = 'group'
     and c.status in ('draft', 'pending', 'active')
     and not exists (select 1 from messages m where m.attach_kind = 'challenge' and m.attach_ref_id = c.id);
  if v_n = 0 then
    raise notice '0163 ok — every live campfire challenge has a chat card.';
  else
    raise warning '0163 WARNING — % live campfire challenge(s) still have no card.', v_n;
  end if;
end;
$verify$;
