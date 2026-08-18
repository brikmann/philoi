# Working together — Code ↔ design (read before editing)

We're both writing to this branch live, and three times now uncommitted design edits have been wiped or
silently retuned (last: the flare intensities got cranched back to the old `~0.14` mid-session). This note
stops that. It's about **coordination**, not territory.

## Who owns what
- **Design (Claude/Noah) owns the intent + reference files** — `design-mocks/**`, and the spec/handoff docs:
  `DESIGN_LANGUAGE_EMBER.md`, `FLARES_SPEC.md`, `FEATURE_*.md`, `PUNCHLIST_*.md`, `CODE_PROMPT_*.md`,
  `CODE_HANDOFF_ember_pass.md`, `NATIVE_BUILD_CONFIG.md`. **These are the source of truth for what to build
  and how it should look.**
- **Code owns the implementation** — `src/**`, `supabase/**`, `modules/**`, `targets/**`, `app.config.*`,
  native + build config.

## Rules
1. **Code: don't edit the design mocks or spec docs.** If a value there looks wrong (e.g. a flare opacity, a
   colour, a threshold), **flag it in chat / a report — don't silently change the mock.** The mock is the
   reference; if code and mock drift, we lose the single source of truth. (The `~0.14` flare retune is the
   example: those numbers were for the retired app-wide scope; the mock + PUNCHLIST_15 §2 now say **visible,
   err bright** — build to that.)
2. **Commit before you edit, commit when you pause.** Loose working-tree changes are what got wiped. Small,
   frequent commits keep everyone's work in history.
3. **Never `git checkout` / `reset --hard` / stash the shared branch while the other is mid-edit.** That's
   what erased uncommitted design work. If you must (e.g. cutting a build), commit or stash-and-restore
   deliberately, and say so.
4. **One writer per branch at a time.** Don't run two Code/Cowork sessions committing to the same branch. If
   a build needs a clean tree, call a short "freeze" so design isn't editing simultaneously.

## Right now
- The **flare intensities in mock 88 are the intended visible values** — do not re-lower to `~0.14`.
- Everything from today's Ember pass lives in `CODE_HANDOFF_ember_pass.md` (+ `PUNCHLIST_16.md` for the
  round-2 reskin gaps). Build against those; flag disagreements rather than editing them.
