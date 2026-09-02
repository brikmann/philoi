# Code Prompt — Agora: multiple media per post (+ feed spacing, done)

Two Agora bugs from Noah's device pass. #1 (feed spacing) is **already fixed inline** — verify only. #2 (one-attachment-per-post) is the real work: the composer forces media types to trample each other, and the backend only holds one attachment. Client + RPC + rendering change. All OTA-able except the migration.

Branch off the current wave/device-smoke branch.

---

## 1 · Feed post spacing — ✅ FIXED, verify only
`src/app/agora/index.tsx` rendered posts flush (no `ItemSeparatorComponent`), so consecutive cards read as one. Added `ItemSeparatorComponent` + `postSep` (16px). **Verify:** posts in the feed now have a clear gap between them; the composer header keeps its own spacing.

---

## 2 · A post can only hold ONE attachment — make media combinable (mock 162)

Noah: selecting a photo, then a reward, then a lock-in makes each **trample** the last — pick a photo and add a reward and the photo is deleted. That's by design today, and it contradicts mock 162, which scoped Photo / Achievement / Lock-in as **combinable** multimedia on one post.

### Where it's wrong now
- **Client (`src/app/agora/compose.tsx`):** state is a single `photoUri` + a single `attach` (`AchievementChoice`). `choose()` clears `photoUri` (comment: "One attachment per post… a collage"), and the Photo button clears `attach`. So the UI enforces mutual exclusivity, and there's only one `attach` slot so an achievement and a lock-in can't coexist either.
- **Backend (`create_agora_post`, migration 0130):** signature is `(body, visibility, photo_path, …, attach_kind, attach_ref_id, attach_key)` — **one** photo + **one** attachment snapshot (`agora_attachment_snapshot`). It structurally can't store two.

### Target
A post carries a photo **and** any of {achievement/reward, lock-in} together — **at most one of each kind** (one photo, one lock-in, one achievement; not two photos, no infinite collage). Render them stacked.

### Build
- **Migration (additive, wave rule — restate nothing):** move from the single attachment column to an **array of attachment snapshots**. Simplest: add `attachments jsonb` (a JSON array of the same snapshot shape `agora_attachment_snapshot` already returns) to `agora_posts`, and have the feed query return it. Keep the existing single-attachment column populated for back-compat, or backfill it into the array and read the array everywhere — pick one and be consistent. Do **not** restate existing functions; splice.
- **`create_agora_post`:** accept an **array** of `{kind, ref_id, key}` (plus the unchanged `photo_path`). Snapshot each via `agora_attachment_snapshot`, **validate ownership of every one** (it already raises rather than silently dropping — keep that), enforce **at most one per kind**, store the array. Server-authoritative; keep its current `revoke from public/authenticated` posture and the `split_part(photo_path…)=user` ownership check.
- **Feed + detail reads (`0130` feed query, `src/lib/api/agora.ts`, `agora-attachment.ts`):** return and parse the attachments array instead of the single snapshot.
- **Client compose:** independent state — `photoUri` plus a small map/set of chosen attachments keyed by kind. Selecting one **never clears another**; each has its own remove control; re-choosing a kind replaces just that kind. `canPost = body.trim() || photoUri || attachments.length`. Remove the mutual-exclusion clears in `choose()` and the Photo button.
- **Render (`AgoraCard` + post detail):** render the photo and each attachment card **stacked** in a stable order (e.g. photo → lock-in → achievement), not one-replaces-the-other. Keep the on-center card/halo rendering that already looks right in Agora.

### Guardrails
- At most one attachment per kind — the UI shouldn't offer a second photo/lock-in/achievement once one is set (toggle to replace/remove).
- Ownership validated server-side for every attachment (a crafted call must not attach someone else's relic/lock-in — the existing single-attach check already does this; preserve it per-item).
- Old posts with the single-attachment shape must still render (back-compat on the read path).

**Done =** on the composer you can add a photo AND a lock-in AND a reward in one post without any clearing the others; the post publishes with all of them; the feed and detail render them stacked; old single-attachment posts still render; ownership is enforced per attachment.

---

## Also noted (not in this prompt): profile cards/halos render OFF-center
Noah observed Agora renders cards/halos **on-center** (correct) while **profile** renders them **off-center**. Flagged as a likely separate profile-render bug — confirm and fix under its own task if wanted (`applied-art.tsx` / the profile header placement), not here.
