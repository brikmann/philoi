# Code Prompt — Cindy "How am I doing?" answers inline on the lock-in screen

QoL fix. During a lock-in, tapping the flame opens Cindy's quick-sheet; picking **"How am I doing?"** currently `router.push('/cindy?ask=…')` — it yanks you out of the session into the full chat. It should **answer inline on the lock-in screen** instead, so a status check stays a glance, not a detour (which is the whole point of §C's mid-session design).

Client-only, OTA-able. Touches `src/app/lock-in/index.tsx` (and reuses existing coach + bubble infra). **Scope to the `status` action only** — leave `note` and `chat` as they are.

## Current
`handleCindyQuickAction` (~`lock-in/index.tsx:428`) routes all three actions to chat:
```ts
const ask = action === 'status' ? 'how am I doing this session?'
          : action === 'note'   ? 'add a note to my current lock-in' : null;
router.push(ask ? `/cindy?ask=${encodeURIComponent(ask)}` : '/cindy');
```

## Change
- **`status`** → do **not** navigate. Call `sendToCindy('how am I doing this session?')` (already exists in `src/lib/api/coach.ts`, one-shot, returns a `CoachReply`) and render her reply **inline in a `CindyBubble` above the flame** — the same spot the proactive line already uses (mock 117 §C, the `cindyLine` bubble at ~`:984` study / ~`:848` gym). Show a brief **loading state** in the bubble while it's in flight (e.g. "Checking your session…"), then the answer. Dismissable like the existing bubble.
- **`note`** and **`chat`** → unchanged, still `router.push('/cindy…')`. "Add a note" is deliberately conversational (§C — she takes the note in chat); chat is chat. Only the read-only status check comes inline.

## Implementation notes
- Add local state for the asked answer (e.g. `statusReply` + `statusPending`), separate from or reusing the `useCindyLockInLine` bubble — but **only one bubble shows at a time** (an inline status answer should take precedence over / replace the proactive line while it's up, not stack a second bubble over the flame).
- Render it in **both** the study and gym branches (the two `CindyBubble` mounts), so it works whichever session type you're in. The bubble already sits above the flame and doesn't cover the timer — keep that.
- **Failure/offline:** if `sendToCindy` rejects, degrade gracefully — a short "Couldn't reach Cindy right now" in the bubble, or fall back to opening the chat with the prefilled ask (the old behaviour) so the action is never a dead tap. Don't leave a spinner stuck.
- Keep the `track('cindy_lockin_quick_action', { action })` analytics; optionally add whether it was answered inline vs fell back.
- Close the quick-sheet first (as it does now), then show the loading bubble.

## Done =
On the lock-in screen, "How am I doing?" shows Cindy's answer in the bubble above the flame without leaving the session (loading → answer, dismissable), in both study and gym sessions; "Add a note" and "Chat" still open the full chat; a failed fetch degrades gracefully instead of hanging or dead-tapping.
