# Moderation — App Store Guideline 1.2

Philoi carries user-generated content, so App Store Review Guideline 1.2 asks for four things. Here is where each one lives.

| 1.2 requires | Where it lives |
|---|---|
| **A filter** that keeps objectionable material from being posted | `blocked_terms` + `ugc_*` triggers, migration `0242_ugc_content_filter.sql`. It is server-side, so a patched client cannot bypass it. |
| **Report** objectionable content | `moderation_reports`, reached via `src/app/report.tsx` (check-in, message, profile, campfire) and `reportAgora()` (Agora post or comment). The DM report goes to report.tsx with the user. |
| **Block** abusive users | `blocked_users`, via `blockUser()` in `src/lib/api/agora.ts`. Reachable from campfire chat, DMs, the Agora (posts and comments) and profiles. Enforced by RLS with `is_blocked_either_way()`: the blocked person's chat, DMs, posts and comments disappear for the blocker, and DMs are refused in both directions. |
| **Contact** information | support@philoi.app, in-app feedback (`support.tsx`), and the Terms §12. |

Two more pieces back these up:
- **Terms:** `site/terms.html` §4 states zero tolerance for objectionable content and abusive users. The signup consent checkbox in `setup-handle.tsx` names that rule.
- **Review notes:** they can truthfully say that all user-generated content is filtered server-side, and that users can report, block and contact us.

## 24-hour triage commitment

Every report is reviewed **within 24 hours**. The in-app confirmation promises this, and so does the Terms §5.

New reports email the moderation inbox through the `report_alert` edge function. That email names the reporter, the reported user and the campfire, but not Agora post or comment ids. Use the query below for the full picture.

```sql
-- Open reports, newest first. Run with: npx supabase db query --linked -f <file>
select r.created_at, r.reason, r.status,
       reporter.handle as reporter, reported.handle as reported,
       coalesce(m.body, ap.body, ac.body) as content,
       r.reported_content_snapshot,
       r.id, r.reported_user_id, r.reported_message_id, r.reported_agora_post_id,
       r.reported_agora_comment_id, r.reported_check_in_id, coalesce(r.reported_group_id, r.circle_id) as campfire_id
from moderation_reports r
left join profiles reporter on reporter.id = r.reporter_id
left join profiles reported on reported.id = r.reported_user_id
left join messages m        on m.id  = r.reported_message_id
left join agora_posts ap    on ap.id = r.reported_agora_post_id
left join agora_comments ac on ac.id = r.reported_agora_comment_id
where r.status = 'pending'
order by r.created_at desc;
```

To act on a report:
- **Remove the content:** delete the row.
- **Disable the account:** `select admin_disable_account('<user id>', '<reason>');`
- **Close the report:** `update moderation_reports set status = 'actioned' | 'dismissed' | 'reviewed' where id = '…';`

## The filter

**One source of truth.** The term list, the normalization and the matcher all live in migration 0242. Nothing is hardcoded in the app, and the client just shows the server's message.

**What it covers.** It rejects on insert or edit of:
- campfire chat (`messages`; system rows are skipped)
- DMs (`dm_messages`)
- Agora posts and comments
- profile `handle` / `display_name` / `bio`
- campfire names (`groups.name`)

**The error.** A rejection raises:

> That may break our community rules — edit it and try again.

It comes with `hint = 'ugc_blocked'`. Each composer already shows the server's message inline. Posting too fast returns `hint = 'ugc_rate_limited'`. The limits are:

| Content | Limit |
|---|---|
| DMs | 8 per 10 s |
| Agora posts | 5 per min |
| Agora comments | 10 per min |
| Chat (existing trigger) | 8 per 10 s |
| Campfires (existing trigger) | 10 per day |

**Edit the list with no build or deploy.**

```sql
insert into blocked_terms (term, category, mode) values ('newterm', 'profanity', 'stem');
delete from blocked_terms where term = 'oldterm';
select ugc_violation('text to test');   -- run as postgres: returns the category, or null
```

- **term** is lowercase letters, with single spaces for phrases.
- **category** is one of `hate | sexual | violence | profanity`.
- **mode** is `stem` (whole word plus common suffixes; the default) or `anywhere` (also inside other words). Use `anywhere` only for strings no innocent word contains.
- The matcher catches leetspeak, repeated letters, `*`/`#` masking, punctuation and `f u c k` spacing automatically.
- **Check for false positives before adding a short term.** The 0242 assertions list the near-misses that must stay clean: class, assignment, Essex, Scunthorpe, spicy, therapist, cum laude…

**Upgrade path (post-launch).** Add a hosted moderation model (OpenAI moderation or Perspective) behind the same trigger for context-aware detection. Also worth adding:
- Unicode-confusable folding (Cyrillic look-alikes)
- Filtering on challenge titles and milestone text, which are user-written but not yet filtered
