---
description: Build a feature in short review-driven cycles — intake, scope once, then smallest-change turns with fast verify and visual evidence; one PR (with preview link) at ship.
argument-hint: <feature description or module/topic in plain language>
---

<!--
Acceptance criterion (for maintainers):
  /feature add daisies that bloom in spring
    → agent asks 1–3 plain-language questions ONLY if genuinely ambiguous,
      writes .task/spec.md, scopes once, branches feature/<slug>
    → each user message yields ONE smallest change + `pnpm verify --fast`
      + visual evidence + a closing RECEIPT, then the agent STOPS
    → "ship" refreshes tests, runs full `pnpm verify` to green, opens
      exactly one PR, and hands the user a PR URL + live preview link in
      plain language — never a branch name, commit hash, or diff.
Nothing merges mid-session; nothing unasked is fixed inline.
-->

You are running a **feature session** for: **$ARGUMENTS**

The person driving may be non-technical: they speak in outcomes ("daisies
that bloom in spring"), not code. Keep every message that reaches them in
plain language — Git, scope globs, coverage floors, and module maps are
internal plumbing. Sessions run in short cycles because chat-while-working
dissolves task boundaries; you re-impose them at TURN granularity (see
`docs/WORKING-MODES.md` — pair section). Follow this contract exactly.

## Session setup (once, now)

1. **Declare the mode:** "Mode: pair — <topic>".
2. **Intake.** If `$ARGUMENTS` is genuinely ambiguous (missing a detail you
   cannot reasonably assume), ask **at most 1–3** questions with
   `AskUserQuestion` — plain language only, no jargon, no file names. Then
   write `.task/spec.md` with exactly these sections:

   ```markdown
   # <short feature title>

   ## What

   <1–3 sentences describing the outcome the user wants>

   ## Done when

   - <observable, checkable conditions>

   ## Out of scope

   - <things this change deliberately does NOT do>
   ```

   Keep it to those three sections — the spec is the session's contract,
   not an essay. If the request was clear, write it from the request alone.

3. **Scope once:** `pnpm scope .task/spec.md` (or `pnpm scope <module>` when
   the target module is obvious). If the output lists **`⚠ fallback`** lines
   or **`matched modules: (none)`**, read `module-map.json` and decide which
   module(s) the change belongs in; create a missing one with
   `pnpm new-module <name> --desc "..."` (add `--gates polish` ONLY for pure
   feel/render/UI-polish modules), then re-scope. Mid-session you may widen
   with `pnpm scope --add <module|path>`; never replace the scope and never
   hand-edit `.task/allowed-files.json` — it is blocked and pointless.
4. **Session branch:** `git checkout -b feature/<topic-slug>` (or use the
   branch `pnpm scope` wrote to `.task/branch`).

## Every user message → one turn

1. **Classify.** `Q:` prefix → answer only, edit nothing, no receipt
   needed. `ship` / `park` → see Session end. Otherwise it is one intent;
   if it contains two, do the first and note the second as the next turn.
2. **Change.** Make the smallest change that satisfies the message —
   nothing more. Commit it to the session branch.
3. **Verify (minimal, per-turn).** `pnpm verify --fast`. Red → fix or roll
   the turn back; a turn never ends red. If the turn changed behavior in a
   full-gate logic module that a test could pin, that test lands in the
   **same turn** — polish/visual churn waits for `ship`.
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

6. **Stop.** Do not begin the next improvement or anticipate the next
   request.

Noticed-but-not-asked issues get one `noted:` line and a DEBT.md entry
(same commit) — never an inline fix. If the user interrupts mid-turn, roll
the turn back (`git reset --hard` to the last receipt's commit) and treat
their message as a fresh turn.

## Session end

- **`ship`** —
  1. Write or refresh tests covering the accumulated diff (logic-module
     tests should already exist per-turn; polish churn gets its coverage
     now).
  2. Run full `pnpm verify` to green. Never weaken thresholds or coverage
     floors to force a pass.
  3. Write `.task/pr-body.md` with exactly three sections — `## Technical
summary` (modules touched, what changed, tests added), `## Plain-English
summary` (for a non-technical reader, everyday analogies), and `## Spec`
     (the full `.task/spec.md`, verbatim — the spec file itself is
     git-ignored, so the PR body is where the contract survives for review).
  4. One PR: `pnpm pr "<topic title>"` — `pr.ts` picks up the body and
     branch, opens the PR, and waits for the Vercel preview URL.
  5. Report in plain language only: "Your change is ready to review here:
     `<PR URL>`" / "You can see it live at: `<preview link>`" plus a
     sentence or two from the plain-English summary. No branch names, no
     commit hashes, no Git verbs.
- **`park`** — stash the branch, log a DEBT.md entry saying where the work
  stopped and why; no PR.
- **Auto-boundary** — after ~10 turns, or when a request drifts into a
  second module, tell the user and propose shipping what's green before
  re-scoping a new session.

Never weaken thresholds, never hand-edit `.task/allowed-files.json`, never
push the default branch.
