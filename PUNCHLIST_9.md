# Punchlist 9 — shop opens + inventory QOL

Cosmetic render pass is landing: **flames and audios render cleanly.** Four items below.

---

## 1 · 🔴 CRITICAL — every box open fails "expected JSON array" (embers already spent)
**Repro:** buy + open any box, solo or ×10 → "expected JSON array" error, but embers ARE deducted.
The box then sits in Inventory → Unopened, and tapping it throws the same error.

**Root cause — a DEPLOY gap, not a code bug.** Migration **0069** rewrote `open_loot_box` to take
`p_pool jsonb` (a rarity→ids map) and dropped the old `open_loot_box(uuid, text[])` overload. The
client (`src/lib/api/inventory.ts:openBox`) already sends the object. But the error only occurs if the
**live database is still on 0064's `text[]` signature**: PostgREST receives a JSON *object* for
`p_pool`, tries to coerce it into `text[]`, and fails with exactly "expected JSON array." Meanwhile
`buy_loot_box` is unchanged, so the purchase succeeds and embers are spent — producing this exact
symptom (spend works, open fails, earned/bought boxes pile up unopenable).

**Fix:** deploy the pending migrations.
```
supabase migration list        # confirm 0067 + 0069 are NOT yet applied remotely
supabase db push               # applies them
```
Then re-open a box and confirm the roll resolves and rarity/salvage line up. (Same deploy-gap class as
uni verification, task #67 — worth checking whether anything else committed since the last push is
also unshipped.)

**Ember reconciliation:** anyone who hit this spent embers for boxes that did land in `loot_boxes`
(unopened), so no embers were truly lost — once 0069 is live those boxes open normally. No refund
needed; just verify the stuck boxes now open.

---

## 2 · Add a ×5 open option
Box detail (`src/app/shop/box/[boxKey].tsx`) offers Open 1 and Open 10 only. Add **Open 5** between
them. `buyAndOpen` already takes a count and loops `buyBox`; widen the type to `1 | 5 | 10` and add the
button (price `box.price * 5`, same disabled/embers guard). The open screen (`shop/open.tsx`) keys off
`ids.length` and `MultiDeal` deals any N, so no change needed there — 5 will deal a 5-card grid.

---

## 3 · Inventory — sort by rarity
The owned grid (`inventory/index.tsx`) has category chips but no sort. Add a **sort control** (e.g. a
small toggle/segmented control by the chips) with at least **Rarity (high→low)**, and keep the current
order as the default. Sort `shown` by the rarity ladder
(`common < uncommon < rare < epic < legendary < mythic`) before rendering; tie-break by name so it's
stable. Persist the choice (localStorage-equivalent / async-storage) so it sticks between visits.

---

## 4 · Inventory — condense unopened boxes by type
Today the Unopened panel renders **one tile per `loot_boxes` row** (`boxes.map((b) => …)`), so 11
Vessel boxes show as 11 separate tiles. **Group by `box_key`** and render one tile per type with a
**×N count badge** (e.g. "Vessel ×11"). Tapping a stack opens from that type — simplest is to route to
the box's open flow with one id; better, offer Open 1 / Open 5 / Open 10 (capped at how many of that
type are owned) reusing the #2 buttons, passing that many of the stack's ids to `/shop/open`. Keep
provenance readable — if a stack mixes earned + bought, show the count and let the detail explain, or
sub-group by provenance if that's cleaner.

---

## Ship
#1 is a `db push` (highest priority — it's blocking ALL box opens and silently eating embers into
unopenable boxes). #2–#4 are client JS → OTA.
