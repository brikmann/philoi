# Feature concept — Class Goal Tracker + Grade Calculator

**Status:** logged pre-launch (Noah, today's flow). Not yet specced for build — this captures the
idea + the design gotchas so it's ready to spec when prioritized.

## The idea
Let a student set a **target grade for a whole class** (not per-assignment) and **lock in for that
class specifically**, so effort is anchored to a real academic objective. Then a **grade calculator**
tells them whether they're actually on pace to hit it.

Two parts:

1. **Class + target-grade goal.**
   - A toggle/goal: *"I want an 80% in BU111."* Pick a class, pick a target (70 / 75 / 80 / 85 / 90…).
   - **Lock in for that class** — study lock-ins can be attributed to a class, so each class
     accumulates its own locked-in time. ("You've locked in 14h for BU111 this term.")
   - The class becomes a first-class goal you track against, alongside the existing goal types.

2. **Grade calculator + on-pace.**
   - Enter assignments with **weights + grades** (some graded, some still pending).
   - Auto-compute **current standing** (weighted average of what's graded) and the **projected final**.
   - The killer output: **"on pace?"** — e.g. *"You're at 76%. To finish at 80% you need 84% on the
     remaining 45%."* So they KNOW if the objective is still reachable.
   - Optional **GPA** roll-up across classes.

## Why it fits Philoi
The whole app is accountability toward a goal. Right now goals are generic (study time, steps…).
Anchoring lock-ins to *a specific class with a grade target* makes the accountability concrete and
deeply student-native — it answers "am I actually going to hit my goal in this class?", which is the
question students actually stress about. Strong retention + word-of-mouth hook.

## Design gotchas / decisions to make (important)
- **Grades are self-reported → personal utility only.** They CANNOT feed XP, rank, or leaderboards —
  that violates the one rule ("never sell/fake effort"; unverifiable = unfarmable-only). Verified
  **lock-in time** still earns XP as today; the grade goal is a private motivational overlay on top,
  not part of the competitive economy.
- **Privacy — grades stay private.** Never post a grade to a campfire or feed. Lock-in *time* for a
  class can be shareable (opt-in), but the number itself is private by default. Grades are sensitive.
- **GPA is school-specific and messy.** % → GPA scales differ per institution (Laurier's 12-point vs
  Waterloo's %, etc.). Recommend: **MVP tracks % target + on-pace only**; GPA as a later, per-school
  configurable layer rather than blocking launch on it.
- **On-pace math** is the valuable core — weighted current %, projected final, and "needed on
  remaining." That's a self-contained calculator; ship it well before worrying about GPA.
- **Ties into the lock-in flow** — the goal picker (mock 07 / lockin-goal-picker) would gain a
  "class" option; the done screen could credit the class. Keep it optional so non-students aren't
  forced into it.

## Rough data model (sketch, for later)
- `classes` (user_id, name/code, term, target_grade, color) — a per-user course.
- `assignments` (class_id, name, weight, grade_earned nullable, due_at) — for the calculator.
- Link `check_ins` → optional `class_id` so study lock-ins accrue to a class.
- Derived: current % (weighted graded), projected final, needed-on-remaining, term GPA.

## MVP vs later
- **MVP:** set a class + target %, lock in for a class (time accrues), the grade calculator with
  on-pace ("you need X% on what's left"). All private, no XP coupling.
- **Later:** GPA roll-up (per-school scales), reminders when a class falls off pace, sharing locked-in
  *time* per class, semester overview.

## Open questions
- Is this in scope for the Sept launch, or a fast-follow? (It's a meaty add — own data model + screens.)
- Do we want lock-in time per class to show anywhere social (opt-in), or keep the whole feature private?
- GPA at launch or defer?
