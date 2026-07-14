# SUPERVISOR.md — Operating the framework

What to learn, where to look, and what healthy vs. unhealthy looks like — so
you can tell whether the framework is working and steer agents without
reading every diff. `CLAUDE.md` is what agents follow; `FRAMEWORK.md` is how
to direct changes to the framework itself; this covers how _you_ operate the
system day to day.

---

## 0. Which doc / tool for what

| You want to…                                 | Go to                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Assign app work to an agent                  | `pnpm scope` the module, then `/feature <description>` (pair mode) or a PRD brief per `WORKING-MODES.md` |
| Change the framework (scripts, hooks, gates) | `FRAMEWORK.md` — invariants, briefing template, test-failure triage                                      |
| Check whether a session went well            | §6 below — the 5-minute review ritual                                                                    |
| Change agent _behavior_ (not enforcement)    | `/customize` → `PREFERENCES.md`                                                                          |
| Change architecture                          | Edit `module-map.json` (shape: `module-map.schema.json`) — never `eslint.config.js`                      |
| See what wasn't fixed                        | `DEBT.md` (append-only ledger; entries flip status, never disappear)                                     |
| Understand the test rules                    | `TESTING.md`                                                                                             |

---

## 1. The artifacts to know

Everything observable about agent behavior lands in six places. Learn these
and you can reconstruct any session after the fact.

### 1.1 `edit-log.jsonl` — the ledger (your primary instrument)

Append-only JSONL at the repo root (gitignored, machine-local). Read the last
20 records with `pnpm edit-log`, or the raw file with `tail`/`jq`. One JSON
object per line; the `kind` field tells you what happened:

| `kind`               | Written by               | What it means                                                                          | Supervision signal                                                                                                                       |
| -------------------- | ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`             | every `pnpm verify`      | steps run, which failed, duration, per-module `apiSurface` export counts               | Frequency = iteration cadence. `failed` sequences show what the agent fought with.                                                       |
| `scope-set`          | `pnpm scope`             | args, matched modules, fallbacks, `add` flag, and the **branch the scope is bound to** | Reconstructs what the agent believed its task footprint was. `fallbacks` entries = paths that didn't resolve to a module — eyeball them. |
| `scope-block`        | the scope-guard hook     | tool, file, allowed globs, `channel: 'bash'` for shell blocks                          | **One block = working as intended. Repeats on the same path = your scope was wrong**, and the agent may be improvising.                  |
| `baseline`           | `verify --baseline`      | failing steps classified pre-existing vs introduced                                    | An agent that ran this was being careful. Frequent pre-existing failures = your tree/env is dirty, not the agent.                        |
| `pr`                 | `pnpm pr`                | title, branch, PR URL, preview URL                                                     | The normal end of a task. A session with edits but no `pr` record ended unshipped — ask why.                                             |
| `pr-no-verify`       | `pnpm pr --no-verify`    | title of the skipped-gate PR                                                           | Every one of these deserves a "why?". More than rarely = the gate is too slow or the agent learned a bad habit.                          |
| `main-push-override` | `ALLOW_MAIN_PUSH=1` push | direct push to the default branch                                                      | Should be ~never. Each one is an incident to understand.                                                                                 |

Useful one-liners:

```bash
pnpm edit-log                                   # last 20 records
jq -r 'select(.kind=="scope-block") | .file' edit-log.jsonl | sort | uniq -c   # block hotspots
jq 'select(.kind=="verify") | {ts, failed, durationMs}' edit-log.jsonl         # gate history
jq 'select(.kind=="verify") | .apiSurface' edit-log.jsonl | tail -5            # public-surface trend
jq -c 'select(.kind|test("pr|override"))' edit-log.jsonl                       # ship + escape history
```

### 1.2 `.task/allowed-files.json` — the active scope

What the agent is currently allowed to edit. `spec` shows the arguments used
(a `+`-joined history when widened with `--add`). Two ways the fence can be
off without anyone noticing:

- The file doesn't exist — **no scope is active**: the hook nudges once on
  the first `src/` edit, then allows everything.
- The recorded `branch` no longer matches the current git branch — the scope
  is treated as **inactive**, not enforced. An agent that switches branches
  mid-task silently drops its fence. Check: does the branch in the scope
  record match `git branch --show-current`?

`DEBT.md` is seeded into every scope, so debt logging never requires
widening — "I couldn't log it" is not a valid excuse.

### 1.3 `.task/last-verify.json` — the latest failure snapshot

Written by `verify --agent`, overwritten each run. If an agent claims "tests
are failing for unrelated reasons," this file is the evidence: which steps
failed, which files, how many errors. Stale timestamp = the agent stopped
running the gate.

### 1.4 Git history — the shape of the work

Agents in this framework should produce: small commits on task branches,
each green (the pre-commit hook re-runs the full gate — a commit that exists
_proves_ the gate passed at that moment, unless `git commit --no-verify` was
used, which you can spot: a commit with no `verify` ledger entry seconds
before its timestamp didn't run the gate).

### 1.5 `module-map.json` — the architecture, at a glance

Small enough to read in full. Every module, its dependencies
(`allowedImports`), its external-package allowlist (`allowedExternals`,
absent = unrestricted, `[]` = pure), and its lane (`gates: full | polish |
shell`). If this file stops matching your mental model of the system, agents
have been changing architecture without you noticing — `git log -p
module-map.json` shows who added which edge and when.

### 1.6 `DEBT.md` — the deferred-work ledger

Append-only history: entries flip `status` to `fixed`/`wontfix`, never
disappear. Healthy sessions add entries (agents noticing things they
correctly didn't fix); a long run of sessions adding _nothing_ means agents
are either fixing unasked things inline (pair-mode boundary violation) or
not looking. The PR body's `## Debt` section diffs new entries per PR.

## 2. The commands to be fluent in

| Command                                                                 | When you use it                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                                                           | The truth. Run it yourself whenever an agent reports done.                                                                                                                                |
| `pnpm verify --fast`                                                    | The agents' inner loop — know what it skips (ratchet, knip, coverage, unchanged tests) so you don't mistake fast-green for gate-green.                                                    |
| `pnpm verify --agent`                                                   | See exactly the bounded summary an agent sees. Useful when an agent seems confused by a failure — read its actual input.                                                                  |
| `pnpm verify --baseline`                                                | When red looks foreign: classifies failures as pre-existing vs introduced.                                                                                                                |
| `pnpm scope <mod\|path>` / `--add`                                      | Set/widen the fence before dispatching an agent. Setting scope _yourself_ before handing off is the single highest-leverage supervision act. Remember: a plain re-run REPLACES the scope. |
| `pnpm edit-log`                                                         | The ledger tail.                                                                                                                                                                          |
| `pnpm test:framework`                                                   | The framework's own self-tests. Mandatory after any change to `scripts/`, hooks, or configs — `pnpm verify` does NOT cover these (see `FRAMEWORK.md`).                                    |
| `pnpm mutation`                                                         | The anti-vacuous-test check (slow; CI runs it). Run locally when reviewing a big test contribution. (PRs run it only when mutation-relevant paths change.)                                |
| `pnpm new-module <n> [--gates polish\|shell] [--externals a,b\|--pure]` | Only correct way to create modules; hand-made folders fail verify. Pick the gate lane up front.                                                                                           |
| `pnpm pr "<title>"`                                                     | The only sanctioned route to main: branch, commit, push, draft PR, verify first.                                                                                                          |
| `git worktree list` / `prune`                                           | When parallel agents ran: stale temp worktrees from interrupted baseline runs cause spurious test failures. Prune first, then investigate.                                                |

## 3. Healthy vs. unhealthy — the signal table

What "working as intended" looks like, per behavior:

| Behavior         | Healthy                                                                        | Unhealthy — and what it means                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode discipline  | Session opens with "Mode: PRD" or "Mode: pair" and follows that contract       | No declaration, or pair-mode turns without receipts = the agent is freelancing; re-anchor it to `WORKING-MODES.md`.                                                                                         |
| Verify cadence   | `verify`/`--fast` ledger entries every few minutes during active work          | Long gaps then one giant verify = agent batching blind; failures will be tangled.                                                                                                                           |
| Scope blocks     | Zero or one per task, then a `scope-set` with `add: true`                      | Repeated blocks on one path = **your scoping bug**. Blocks followed by _no_ widening but the task still "completed" = the agent worked around the fence — inspect the diff for duplicated logic.            |
| Scope↔branch     | Scope branch matches the working branch all session                            | Branch switched mid-task = fence silently off (§1.2); treat everything after the switch as unscoped work.                                                                                                   |
| Failure recovery | A failed verify followed within minutes by a targeted fix and a green run      | The same step failing 3+ consecutive runs = the agent is thrashing; intervene with context, don't let it burn retries.                                                                                      |
| Test quality     | New tests assert on behavior/error-message strings; mutation job green         | Coverage up but mutation score down = vacuous tests. High `expect(x).toBeDefined()` density = same.                                                                                                         |
| Architecture     | `allowedImports` edges added deliberately, in the same PR as the need          | `index.ts` export counts (`apiSurface`) climbing steadily = boundary tunneling: internals made "public" to dodge lint. The map is missing an edge — add it.                                                 |
| Gate lanes       | `polish`/`shell` chosen up front for feel/wiring modules                       | A `full` module suddenly full of trivial snapshot tests = the floor is being fed, not used — the module probably belongs in `polish`. A `shell` module near its 200-line cap = promote it before it bursts. |
| Escapes          | `pr-no-verify` ≈ never; `main-push-override` = never; catch-all scopes refused | Escapes clustering = the gate is too slow or a rule fights the actual work. Fix the check, not the agent.                                                                                                   |
| Debt flow        | A trickle of new `DEBT.md` entries; pair receipts carry `noted:` lines         | Zero debt ever = agents fixing unasked things inline, or not looking. Debt logged but never flipped `fixed` = the ledger is a graveyard; schedule a debt-burn session.                                      |
| Docs             | CLAUDE.md edited in the same commit as any enforcement change                  | Enforcement changed, docs silent = the next agent inherits false instructions; this is the highest-priority drift to catch in review.                                                                       |

## 4. What the framework cannot tell you (review these yourself)

The gate proves _conformance_, not _quality_. Human review should skip what
the machine already checked (formatting, boundaries, types, dead code) and
spend entirely on what it can't:

1. **Is the change in the right place?** A guard added at one call site
   instead of the shared function passes every check. Ask: who else calls
   this?
2. **Do the tests assert the right thing?** Mutation testing catches
   assertion-free tests, not wrong-assertion tests. Read the assertions of
   any test whose name you couldn't have predicted from the task.
3. **Is the public surface honest?** New `index.ts` exports should be things
   other modules _should_ call — not internals promoted to satisfy lint.
4. **Was the simplest mechanism chosen?** Nothing gates against
   over-engineering. Speculative config, single-implementation interfaces,
   and "for later" scaffolding all pass verify.
5. **Should something have been logged as debt?** The `debt` check validates
   format only; whether a discovered limitation _deserved_ an entry is your
   call at review time.
6. **Prose claims in reports.** Agents summarize optimistically. Trust the
   ledger and the gate over the report; "verify green" is checkable — check
   it.

## 5. Guiding agents within the framework

How to steer without fighting the machinery:

- **Scope first, then prompt.** `pnpm scope <module>` before dispatch turns
  your intent into an enforced fence. A prompt saying "only touch X" is a
  suggestion; the scope file is a mechanism.
- **Pick the mode explicitly.** Spec-shaped, multi-slice work → PRD mode.
  Iterative feel/UI work with you in the loop → pair mode via `/feature`.
  The modes exist because scope+verify assume task boundaries; pair mode
  re-imposes them per turn (`WORKING-MODES.md`).
- **Name modules, not files.** "Change the `pricing` module so that…" lets
  the agent use `module-map.json` + the module's `AGENTS.md`; pasting file
  contents burns context and goes stale.
- **Point at the pipeline.** `/feature <description>` runs intake → scope →
  implement → verify → PR in order. For anything non-trivial, invoking the
  pipeline beats freeform prompting because each stage's exit is
  machine-checked.
- **Route around gates deliberately, never silently.** Feel/render work →
  create the module with `--gates polish` up front, so the agent doesn't
  write junk tests to satisfy a floor that shouldn't apply. Never tell an
  agent to "just make the check pass" — that instruction is a Goodhart
  request and you will get exactly what you asked for.
- **When an agent is stuck, feed it attribution, not encouragement.** The
  useful interventions are: widen the scope (`--add`), run `--baseline` and
  tell it which failures to ignore, or point at the specific file the fix
  belongs in. "Try again" re-runs the same failure with less context budget.
- **Instruct agents to end with the gate.** "Finish with `pnpm verify` green
  and commit" makes the pre-commit hook re-check their claim automatically —
  your review starts from a proven-green tree.
- **Framework tasks get the FRAMEWORK.md briefing.** Different layer,
  different rules: predicted test impact up front, `pnpm test:framework`
  output in the PR body, invariants pasted into the brief.
- **Preferences go through `/customize`, not ad-hoc prompting.** A behavior
  you want every session belongs in `PREFERENCES.md` (or, if it's
  enforcement-worthy, a real check); repeating it per-session is how
  preferences get lost.
- **Parallel agents: one worktree each, file-disjoint tasks, you merge.**
  Never point two agents at one checkout; they race on probes, the ledger,
  and coverage output. Anything git-global (worktree list, locks) is shared
  even across worktrees.
- **Correct the encoding, not the agent.** When agents repeatedly misbehave
  in the same way, the cause is almost always a wrong fence: a missing map
  edge, a too-narrow scope, a gate applied to spec-less work. Agents are
  aggressive task-completers; they optimize against whatever is encoded.
  Keeping the encoding true _is_ the supervision job.

## 6. A 5-minute session review ritual

After any agent session, in order:

1. `pnpm verify` — is the tree actually green? (Framework session:
   `pnpm test:framework` too.)
2. `pnpm edit-log` — scan kinds: any `scope-block` repeats? any
   `pr-no-verify` or `main-push-override`? does the scope's branch match the
   work's branch?
3. `git log --oneline -10` + `git diff main...HEAD --stat` — does the change
   footprint match the task you assigned?
4. `git diff` the files the machine can't judge: test assertions, `index.ts`
   exports, `module-map.json` edges, CLAUDE.md accuracy, new `DEBT.md`
   entries.
5. If anything failed mid-session: `.task/last-verify.json` for what the
   agent saw, `verify --baseline` if you suspect it wasn't their fault.

If steps 1–3 are boring, the framework did its job and step 4 is your whole
review. That's the intended division of labor: the machine checks
conformance so you can spend your attention on judgment.
