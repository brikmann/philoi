// @MENTIONS (mock 101 frame 5) — one definition of what a mention IS, shared by the three places
// that have to agree about it: the composer that inserts them, the bubble that highlights them,
// and the database trigger that notifies on them.
//
// ── WHY THE TOKEN IS THE HANDLE, NOT THE DISPLAY NAME ────────────────────────────────────────
//
// Mock 101 draws the token as "@Noah B2" — the display name. That is what it should LOOK like, and
// it is not what can be stored, because display names contain spaces and are not unique. Given the
// text "@Noah B2 you in for pushups?" there is no rule that recovers which of "Noah", "Noah B",
// "Noah B2" was the mention; a greedy match steals the next word, a lazy one truncates the name.
// Two members called "Noah" make it worse.
//
// The `messages` table stores one column — `body` — so there is nowhere to keep a structured
// mention list alongside the text. The choice is therefore: add a column and a write path, or make
// the token itself unambiguous. Handles are already unique, already shown in the mock's own
// autocomplete rows as the sub-label, and contain no spaces, so `@brkmnn` parses with one regex on
// the client and the same one in Postgres.
//
// This is what Discord and Slack both do underneath — they render a display name over a stable
// identifier. We render the identifier itself. If the display name is wanted on screen later, that
// is a resolve-at-render change here plus a `mentions uuid[]` column, and nothing else moves.

/**
 * A mention token in message text.
 *
 * `@all` is reserved and checked first. Handles are the app's own charset — letters, digits,
 * underscore — bounded so "email@handle" and a trailing "@" do not match. The leading boundary
 * stops `foo@bar` reading as a mention of @bar.
 */
export const MENTION_RE = /(^|[^\w@])@(all|[a-zA-Z0-9_]{2,30})\b/g;

/** The reserved token that notifies the whole campfire. */
export const MENTION_ALL = 'all';

export type MentionTarget = { handle: string; userId: string | null; isAll: boolean };

/** Every distinct token in a body, in order of first appearance. Lower-cased — handles are
 *  compared case-insensitively so "@Brkmnn" reaches the same person as "@brkmnn". */
export function parseMentionHandles(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase();
    if (!seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
}

/** True when the body mentions everyone. */
export function mentionsEveryone(body: string): boolean {
  return parseMentionHandles(body).includes(MENTION_ALL);
}

/**
 * Split a body into plain runs and mention tokens, for rendering.
 *
 * Returns the pieces in order so a <Text> can map straight over them. The leading boundary
 * character the regex had to capture is emitted as its own plain run rather than being swallowed —
 * dropping it would silently eat the space before every mention.
 */
export type MessagePiece = { text: string; mention: boolean };

export function splitMentions(body: string): MessagePiece[] {
  const pieces: MessagePiece[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    const lead = m[1] ?? '';
    if (start + lead.length > last) pieces.push({ text: body.slice(last, start + lead.length), mention: false });
    pieces.push({ text: `@${m[2]}`, mention: true });
    last = start + m[0].length;
  }
  if (last < body.length) pieces.push({ text: body.slice(last), mention: false });
  return pieces.length > 0 ? pieces : [{ text: body, mention: false }];
}

/**
 * The live "@…" the caret is currently inside, or null.
 *
 * Called on every keystroke to decide whether the autocomplete is open. Scans BACK from the caret
 * to the nearest "@" and refuses if it has crossed whitespace on the way — so the popover opens
 * while typing "@br" and closes the moment a space is typed, which is the behaviour that stops it
 * hanging over the composer for the rest of the message.
 *
 * Returns the partial handle WITHOUT the "@", plus where the token starts, so the caller can
 * splice a completion in without re-searching the string.
 */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;

  const partial = upto.slice(at + 1);
  // A handle in progress can only be handle characters. Any space, newline or punctuation means
  // the "@" behind us belongs to a finished token (or to an email), not to what we are typing.
  if (!/^[a-zA-Z0-9_]*$/.test(partial)) return null;
  // The "@" must itself start a word, or "user@example" opens the picker.
  if (at > 0 && /[\w@]/.test(text[at - 1])) return null;

  return { query: partial.toLowerCase(), start: at };
}

/** Splice a chosen handle into the draft, replacing the partial token and leaving a trailing
 *  space so the next word is not stuck to the mention. Returns the new text and caret. */
export function applyMention(text: string, start: number, caret: number, handle: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret);
  const token = `@${handle} `;
  return { text: `${before}${token}${after}`, caret: before.length + token.length };
}
