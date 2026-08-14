# Punchlist 12 — rescope the SFX slot: "stop lock-in" sting, not a rank-up override

**The mistake in the current build:** the equipped SFX cosmetic *replaces* the rank-up sound.
`equippedRankUpCue()` (src/lib/economy/equipped-audio.ts) returns the equipped SFX's cue and the
rank-up path plays it instead of the stock per-tier cue.

**What it should be:** the rank-up audio is the layered, per-tier system we built on purpose — it stays
exactly as is and is NEVER overridden by a cosmetic. The SFX cosmetic slot is instead the sound your
session ends on: a **"stop lock-in" sting** that fires when you end a lock-in.

## 1 · Wiring
- **Rank-up path:** remove the cosmetic override. Wherever `equippedRankUpCue()` feeds the rank-up
  sound, drop it — rank-up always plays the stock layered per-tier cues (RANKUP_SPEC), full stop.
- **equipped-audio.ts:** rename `equippedRankUpCue()` → `equippedStopLockInCue()`. Keep the mechanic
  (cue name == catalog id, guarded by `hasRewardSound`); only the trigger point changes.
- **Stop lock-in:** in `src/app/lock-in/index.tsx`, at the `stopLockInSession({...})` call (~line 419),
  play `equippedStopLockInCue()` on session end — honoring the user's sound preference, and no-op when
  nothing is equipped or the mix hasn't shipped (same guards as the ambient loop).
- One-shot only (it's a sting), and it must not collide with the session's ambient loop teardown —
  stop the ambient first, then play the sting.

## 2 · Catalog / copy rescope
- **ITEM_CATALOG.md §3b** — retitle "Rank-Up & Challenge SFX" → **"Stop Lock-In SFX"** and reframe the
  intro: this is the sound that punctuates *finishing* a session. The existing lore already fits
  ("One strike. It means the thing is finished," "Zero to gone").
- `catalog.ts` SFX entries: no id changes needed; the `SFX` type tag now means "session-end sting."

## 3 · Remove Victory Anthem from the SFX set
`sfx-victory-anthem` is an 83-second anthem — impossible as a session-end sting — and it's already
Hero's Champions Anthem on rank-up. Pull it out of the cosmetic set:
- Remove the `sfx-victory-anthem` entry from `catalog.ts` (`SFX[]`).
- Remove `'sfx-victory-anthem'` from the `RewardCue` union and `SOURCES` in `src/lib/sound.ts`.
- Delete `assets/audio/cosmetic/sfx-victory-anthem.mp3` and the stale
  `assets/audio/cosmetic/preview/sfx-victory-anthem-preview.mp3`.
- Drop its row from ITEM_CATALOG §3b.

(If you'd rather keep it as an earnable Hero-tier flourish instead of deleting, flag it — but it should
not be a purchasable stop-lock-in SFX.)

## Result
The SFX slot is 4 stop-lock-in stings (Anvil 2s · Sub-Bass Drop 7.6s · Jet Engine 5.6s · Foghorn 8.3s),
each auditionable via its preview (PUNCHLIST_11). Rank-up audio is untouched and never overridden.
All JS + asset removals → OTA.
