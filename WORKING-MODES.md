# WORKING-MODES

Two ways of working in this repo. **Declare your mode in your first message
of every session** ("Mode: PRD" or "Mode: pair") and stay in it until the
session ends or the work clearly crosses into the other mode's entry
criteria — say so and switch explicitly.

Why two modes: the framework's guarantees (scope guard, verify gate, PR
review) assume a task has a boundary — a start, a diff, and a green check at
the end. PRD-style work has natural boundaries, so scope and verify align
with them for free. Iterative chat-while-working (graphics tuning, feel
passes, "a bit more to the left") dissolves those boundaries: the diff never
ends and verify never fires. Pair mode re-imposes the boundary at **turn**
granularity instead of task granularity.

---

## PRD mode — multi-feature, spec-driven

**Enter when:** a spec document exists, or the ask spans more than one
module or more than one PR.

**Flow** (this already works; it's the default the tooling was built for):

1. Decompose the spec into slices (use `/orchestrate-slices` for parallel
   work, or work the slices yourself in order).
2. `pnpm scope <module-or-spec>` per slice — each slice gets its own scope.
3. Code the slice: tests first for logic modules, public API through
   `index.ts`.
4. Full `pnpm verify` per slice; fix until green (`pnpm verify --baseline`
   to classify inherited failures).
5. Ship each slice with `pnpm pr "<title>"` — the result is a PR stack that
   merges in order.

Everything in CLAUDE.md applies as written; PRD mode is just its normal
operation.

---

## Pair mode — iterative editing with user feedback

**Enter when:** the user wants to iterate with feedback in the loop —
graphics, tuning, copy, small UI things. One module, many small turns.

### Agent turn contract

Session setup, once:

- Set scope **once** per session (`pnpm scope <module>`); widening
  mid-session with `pnpm scope --add` is allowed, replacing it is not.
- One session branch: `pair/<topic>`. All turns commit here; nothing merges
  until `ship`.

Then, for **each user message**:

1. Make the **smallest change that satisfies the message** — nothing more.
2. Run `pnpm verify --fast`.
3. Produce visual evidence — a screenshot or preview link showing the
   change.
4. Close with a **RECEIPT**: files touched, fast-verify status, the
   evidence, and the literal line "awaiting feedback".
5. **Stop.** Do not start the next improvement, do not anticipate the next
   request.

Anything you notice but weren't asked to change gets exactly one `noted:`
line in the receipt plus a DEBT.md entry — **never** an inline fix. Fixing
unasked things inside a turn is the boundary-dissolving behavior this mode
exists to prevent.

### User rules (one screen)

- **One intent per message.** "Bigger and bluer" is fine; "bigger, and also
  refactor the loader" is two turns.
- **Don't steer mid-turn.** Wait for the receipt. Interrupting rolls the
  whole turn back — a half-turn never merges.
- **`Q:` prefix** = question only. The agent answers and edits nothing.
- **`ship`** = end the session: the agent writes/refreshes tests for the
  accumulated diff, runs full `pnpm verify`, and opens one PR via
  `pnpm pr`.
- **`park`** = stash the work and log a DEBT.md entry describing where it
  stopped; no PR.
- **Session length:** after ~10 turns, or when the work drifts into a
  second module, ship what's green and start a new session with a fresh
  scope.

### Test policy — three tiers

1. **Every turn:** `pnpm verify --fast` runs the affected _existing_ tests.
   A turn that breaks them doesn't get a receipt; it gets fixed or rolled
   back.
2. **Logic changes in full-gate modules pay for their test in the same
   turn.** If a turn changes behavior a test could pin, the test lands in
   that turn — not at ship time.
3. **Polish/visual churn is tested at the `ship` boundary.** Per-turn, the
   user's review of the visual evidence _is_ the test. At `ship`, full
   `pnpm verify` — per-module coverage floors, ratchet, the works — gates
   the accumulated diff before it becomes a PR.

The contract lines above are working agreements, not fake checks: the
deterministic layer underneath is unchanged (scope-guard still blocks
out-of-scope writes every turn, verify still gates every merge). Pair mode
adds discipline where the tooling can't see — turn size, stopping, and not
fixing the unasked.
