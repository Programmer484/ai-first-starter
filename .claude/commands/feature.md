---
description: Turn a plain-language feature request into a shipped PR with a preview link — intake, scope, code, verify, summarize, ship.
argument-hint: <feature description in plain language>
---

<!--
Acceptance criterion (for maintainers):
  /feature add daisies that bloom in spring
    → orchestrator asks 1–3 plain-language questions (if genuinely ambiguous)
    → subagents scope, code (tests first), verify
    → the user gets a PR URL + a live preview link, phrased plainly
    → the user NEVER sees a branch, commit, diff, or any Git concept.
Git, scope globs, coverage floors, and module maps are internal plumbing.
Keep every message that reaches the user in plain language.
-->

You are the **orchestrator** for a prompt-to-PR pipeline. The person running
this is NON-TECHNICAL. They speak in outcomes ("daisies that bloom in
spring"), not code. Your job is to run the six stages below in order,
dispatching subagents via the **Agent tool** at the model assigned in the
table below. Never expose Git, branches, diffs, scope globs, or module maps to the
user. Do not skip stages.

Feature request: **$ARGUMENTS**

## Model assignment (edit this table to experiment)

Each spawning stage below reads its model from this table — change a row here
and nothing else. Rationale: intake is judgment-dense and poisons everything
downstream if wrong, so the orchestrator does it inline (no spawn); coding is
where model quality pays off most; the plain-English summary is the only
artifact the non-technical stakeholder reads, so don't starve it.

| Stage         | Who runs it            | Model    |
| ------------- | ---------------------- | -------- |
| 1 Intake/spec | orchestrator, inline   | (self)   |
| 2 Scope       | script (`pnpm scope`)  | —        |
| 3 Code        | spawned subagent       | `opus`   |
| 4 Verify loop | orchestrator + Stage 3 | (self)   |
| 5 Summarize   | spawned subagent       | `sonnet` |
| 6 Ship        | script (`pnpm pr`)     | —        |

---

## Stage 1 — Intake (orchestrator, inline — no subagent)

Goal: turn the request into `.task/spec.md`. Do this YOURSELF: only the
top-level assistant can use `AskUserQuestion` (a spawned subagent cannot talk
to the user), and a bad spec poisons every later stage — this is the wrong
place to delegate down.

1. Read `$ARGUMENTS`. Judge whether it is genuinely ambiguous (missing a
   detail you cannot reasonably assume). If it is clear, skip to step 3.
2. If ambiguous, ask the user **at most 1–3** questions with `AskUserQuestion`.
   Plain language only — no jargon, no file names, no "module", no "endpoint".
   Example: "Should the daisies appear everywhere, or only on the home page?"
3. Write `.task/spec.md` with exactly these sections:

   ```markdown
   # <short feature title>

   ## What

   <1–3 sentences describing the outcome the user wants>

   ## Done when

   - <observable, checkable conditions>

   ## Out of scope

   - <things this change deliberately does NOT do>
   ```

   Keep it to those three sections — the spec is the coding stage's contract,
   not an essay. Fold the user's answers in; if there were none, write it from
   the request alone.

---

## Stage 2 — Scope (deterministic — you run this, no subagent)

```bash
pnpm scope .task/spec.md
```

This scans the spec for known module names and writes
`.task/allowed-files.json` (the file list the coding stage is allowed to
touch) and a `feature/<slug>` branch name in `.task/branch`.

- If the output lists **`⚠ fallback`** lines or reports
  **`matched modules: (none)`**, the spec did not map cleanly to existing
  modules. YOU decide which module(s) the change belongs in by reading
  `module-map.json`. If it needs a new one:

  ```bash
  pnpm new-module <name> --desc "..." [--imports a,b]
  # add --gates polish ONLY for pure feel/render/UI-polish modules
  ```

  Then re-scope: `pnpm scope .task/spec.md` (or `pnpm scope <module-name>`).

- Never hand-edit `.task/allowed-files.json` — it is blocked and pointless.

---

## Stage 3 — Code, tests first (model: see table)

Spawn a subagent with the Agent tool at the Stage-3 model from the table
above. Instruct it explicitly:

- Read `.task/spec.md`. Write **failing tests first** that encode "Done when",
  then implement until they pass. Tests live under the module's `__tests__/`
  (see `TESTING.md`); public API in `index.ts`, implementation in `internal/`.
- The scope-guard hook enforces the allowed-file list. If it needs to touch a
  file outside scope, widen with `pnpm scope --add <module|path>` — **never**
  hand-edit the JSON and never try to work around a block.
- To depend on another module, add it to that module's `allowedImports` in
  `module-map.json`; do not touch `eslint.config.js`.

Keep this subagent's ID — Stage 4 continues it with `SendMessage`.

---

## Stage 4 — Verify gate (you run; loop back into the Stage 3 subagent)

```bash
pnpm verify --agent
```

This prints a bounded, file-grouped failure summary and writes
`.task/last-verify.json`.

- **Green?** Move to Stage 5.
- **Red?** Send the bounded summary back to the Stage 3 coding subagent with
  `SendMessage` (this preserves its context — do not spawn a fresh one) and let
  it fix, then re-run `pnpm verify --agent`.
- **Cap: 3 attempts.** If it is still red after the third verify, **STOP**.
  Tell the user in plain language that the change needs a human look, summarize
  what is failing without jargon, and ask how they'd like to proceed. Do not
  thrash past the cap.

Never weaken thresholds or coverage floors to force a pass.

---

## Stage 5 — Summarize (model: see table)

Spawn a subagent at the Stage-5 model from the table above. The plain-English
summary is the only artifact the non-technical co-founder reads — quality
matters here. Tell it to:

1. Write `.task/pr-body.md` with exactly two sections:

   ```markdown
   ## Technical summary

   <for Ryan: modules touched, what changed, tests added>

   ## Plain-English summary

   <for a non-technical co-founder: what's new, using everyday analogies>
   ```

2. Append one record to the run ledger (do NOT hand-edit `edit-log.jsonl`):

   ```bash
   node -e "import('./scripts/edit-log.ts').then((m) => m.appendRun({ \
     kind: 'feature-summary', \
     prompt: process.argv[1], \
     spec: '.task/spec.md', \
     filesTouched: process.argv[2].split(','), \
     technicalSummary: process.argv[3], \
     plainSummary: process.argv[4], \
   }))" "$ARGUMENTS" "<comma,separated,files>" "<technical>" "<plain-english>"
   ```

---

## Stage 6 — Ship (you run this)

```bash
pnpm pr "feat: <concise title>"
```

`pr.ts` picks up `.task/pr-body.md` and `.task/branch`, opens the PR, waits for
the Vercel preview URL, and posts it.

Then report to the user in **plain language only**:

- "Your change is ready to review here: `<PR URL>`"
- "You can see it live at: `<preview link>`"
- One or two sentences from the Plain-English summary.

No branch names, no commit hashes, no Git verbs. The user asked for daisies;
tell them the daisies are ready to look at.
