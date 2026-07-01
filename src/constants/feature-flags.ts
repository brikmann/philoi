// Circle chat is built (schema, RLS, moderation audit log, report/block/remove). Enabled per
// explicit request — the Tier-B acceptance checklist (philoi_legal_safety_buildlist.md:
// encryption posture, CSAE reporting pipeline, a real moderator process) should still get a
// human review before this ships to real users, even though the flag is on.
export const CHAT_ENABLED = true;
