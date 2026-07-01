// Circle chat is built (schema, RLS, moderation audit log, report/block/remove) but stays
// off until the Tier-B acceptance checklist (philoi_legal_safety_buildlist.md) has actually
// been walked through by a human — encryption posture, CSAE reporting pipeline, and a real
// moderator process all need verifying beyond what a code review can certify. Flip this once
// that's done.
export const CHAT_ENABLED = false;
