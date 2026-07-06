---
description: Start a pair-mode session — iterative editing with the user in the loop, one small verified change per turn, one PR at ship. See WORKING-MODES.md.
argument-hint: <module or topic to iterate on>
---

<!--
Acceptance criterion (for maintainers):
  /pair tree sprites
    → agent declares pair mode, scopes once, branches pair/tree-sprites
    → each user message yields ONE smallest change + fast verify + visual
      evidence + a closing RECEIPT, then the agent STOPS
    → "ship" produces tests, a full green verify, and exactly one PR.
Nothing merges mid-session; nothing unasked is fixed inline.
-->

You are entering **pair mode** (see `WORKING-MODES.md` — pair section) for:
**$ARGUMENTS**

Pair mode exists because chat-while-working dissolves task boundaries; you
re-impose them at TURN granularity. Follow this contract exactly.

## Session setup (once, now)

1. Declare the mode to the user: "Mode: pair — <topic>".
2. Scope **once**: `pnpm scope <module>` for the module named or implied by
   `$ARGUMENTS` (read `module-map.json` if unsure). Mid-session you may
   widen with `pnpm scope --add <module|path>`; never replace the scope.
3. Create the session branch: `git checkout -b pair/<topic-slug>`.

## Every user message → one turn

1. **Classify.** `Q:` prefix → answer only, edit nothing, no receipt
   needed. `ship` / `park` → see below. Otherwise it is one intent; if it
   contains two, do the first and note the second as the next turn.
2. **Change.** Make the smallest change that satisfies the message. Commit
   it to the session branch.
3. **Verify.** `pnpm verify --fast`. Red → fix or roll the turn back; a
   turn never ends red.
4. **Evidence.** Produce a screenshot or preview link showing the change.
5. **Receipt.** End your reply with:

   ```text
   RECEIPT
   files: <paths touched this turn>
   verify --fast: green
   evidence: <screenshot/preview>
   noted: <anything seen but not asked — also logged to DEBT.md> (omit if none)
   awaiting feedback
   ```

6. **Stop.** Do not begin the next improvement.

Noticed-but-not-asked issues get one `noted:` line and a DEBT.md entry
(same commit) — never an inline fix.

If the user interrupts mid-turn: roll the turn back (`git reset --hard` to
the last receipt's commit) and treat their message as a fresh turn.

## Session end

- **`ship`** — write or refresh tests covering the accumulated diff
  (logic-in-full-gate-module tests should already exist per-turn; polish
  churn gets its coverage now), run full `pnpm verify` to green, then one
  PR: `pnpm pr "<topic title>"`.
- **`park`** — stash the branch, log a DEBT.md entry saying where the work
  stopped and why; no PR.
- **Auto-boundary** — after ~10 turns, or when a request drifts into a
  second module, tell the user and propose shipping what's green before
  re-scoping a new session.

Never weaken thresholds, never hand-edit `.task/allowed-files.json`, never
push the default branch.
