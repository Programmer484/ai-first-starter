# Supervising Agents in ai-first-starter

What to learn, where to look, and what healthy vs. unhealthy looks like — so
you can tell whether the framework is working and steer agents without
reading every diff. Companion to `SYSTEM-NOTES.md` (which covers what the
system is); this covers how _you_ operate it.

---

## 1. The five artifacts to know

Everything observable about agent behavior lands in five places. Learn these
and you can reconstruct any session after the fact.

### 1.1 `edit-log.jsonl` — the ledger (your primary instrument)

Append-only JSONL at the repo root (gitignored, machine-local). Read the last
20 records with `pnpm edit-log`, or the raw file with `tail`/`jq`. One JSON
object per line; the `kind` field tells you what happened:

| `kind`         | Written by            | What it means                                                            | Supervision signal                                                                                                                    |
| -------------- | --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`       | every `pnpm verify`   | steps run, which failed, duration, per-module `apiSurface` export counts | Frequency = iteration cadence. `failed` sequences show what the agent fought with.                                                    |
| `scope-set`    | `pnpm scope`          | args, matched modules, fallbacks, whether `--add`                        | Reconstructs what the agent believed its task footprint was. Fallback entries = paths that didn't resolve to a module — eyeball them. |
| `scope-block`  | the scope-guard hook  | tool, file, allowed globs, `channel: 'bash'` for shell blocks            | **One block = working as intended. Repeats on the same path = your scope was wrong**, and the agent may be improvising.               |
| `baseline`     | `verify --baseline`   | failing steps classified pre-existing vs introduced                      | An agent that ran this was being careful. Frequent pre-existing failures = your tree/env is dirty, not the agent.                     |
| `pr-no-verify` | `pnpm pr --no-verify` | title of the skipped-gate PR                                             | Every one of these deserves a "why?". More than rarely = the gate is too slow or the agent learned a bad habit.                       |

Useful one-liners:

```bash
pnpm edit-log                                   # last 20 records
jq -r 'select(.kind=="scope-block") | .file' edit-log.jsonl | sort | uniq -c   # block hotspots
jq 'select(.kind=="verify") | {ts, failed, durationMs}' edit-log.jsonl         # gate history
jq 'select(.kind=="verify") | .apiSurface' edit-log.jsonl | tail -5            # public-surface trend
```

### 1.2 `.task/allowed-files.json` — the active scope

What the agent is currently allowed to edit. `spec` shows the arguments used
(a `+`-joined history when widened with `--add`). If this file doesn't exist,
**no scope is active and the strongest guardrail is off** — the hook will
nudge once on the first `src/` edit, then allow everything.

### 1.3 `.task/last-verify.json` — the latest failure snapshot

Written by `verify --agent`, overwritten each run. If an agent claims "tests
are failing for unrelated reasons," this file is the evidence: which steps
failed, which files, how many errors. Stale timestamp = the agent stopped
running the gate.

### 1.4 Git history — the shape of the work

Agents in this framework should produce: small commits on task branches, each
green (the pre-commit hook re-runs the full gate — a commit that exists
_proves_ the gate passed at that moment, unless `--no-verify` was used, which
you can check: `git log` commits made with `--no-verify` won't correlate with
a `verify` ledger entry seconds before the commit timestamp).

### 1.5 `module-map.json` — the architecture, at a glance

Small enough to read in full. Every module, its dependencies, its lane
(`gates: "polish"` or default full). If this file stops matching your mental
model of the system, agents have been changing architecture without you
noticing — `git log -p module-map.json` shows who added which edge and when.

## 2. The commands to be fluent in

| Command                                | When you use it                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                          | The truth. Run it yourself whenever an agent reports done.                                                                                   |
| `pnpm verify --fast`                   | The agents' inner loop — know what it skips (ratchet, knip, unchanged tests) so you don't mistake fast-green for gate-green.                 |
| `pnpm verify --agent`                  | See exactly the bounded summary an agent sees. Useful when an agent seems confused by a failure — read its actual input.                     |
| `pnpm verify --baseline`               | When red looks foreign: classifies failures as pre-existing vs introduced.                                                                   |
| `pnpm scope <mod\|path>` / `--add`     | Set/widen the fence before dispatching an agent. Setting scope _yourself_ before handing off is the single highest-leverage supervision act. |
| `pnpm edit-log`                        | The ledger tail.                                                                                                                             |
| `pnpm mutation`                        | The anti-vacuous-test check (slow; CI runs it). Run locally when reviewing a big test contribution.                                          |
| `pnpm new-module <n> [--gates polish]` | Only correct way to create modules; hand-made folders fail verify.                                                                           |
| `git worktree list` / `prune`          | When parallel agents ran: stale temp worktrees from interrupted baseline runs cause spurious test failures. Prune first, then investigate.   |

## 3. Healthy vs. unhealthy — the signal table

What "working as intended" looks like, per behavior:

| Behavior         | Healthy                                                                   | Unhealthy — and what it means                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verify cadence   | `verify`/`--fast` ledger entries every few minutes during active work     | Long gaps then one giant verify = agent batching blind; failures will be tangled.                                                                                                                |
| Scope blocks     | Zero or one per task, then a `scope-set --add`                            | Repeated blocks on one path = **your scoping bug**. Blocks followed by _no_ widening but the task still "completed" = the agent worked around the fence — inspect the diff for duplicated logic. |
| Failure recovery | A failed verify followed within minutes by a targeted fix and a green run | The same step failing 3+ consecutive runs = the agent is thrashing; intervene with context, don't let it burn retries.                                                                           |
| Test quality     | New tests assert on behavior/error-message strings; mutation job green    | Coverage up but mutation score down = vacuous tests. Tests with `expect(x).toBeDefined()` density = same.                                                                                        |
| Architecture     | `allowedImports` edges added deliberately, in the same PR as the need     | `index.ts` export counts (`apiSurface`) climbing steadily = boundary tunneling: internals being made "public" to dodge lint. The map is missing an edge — add it.                                |
| Escapes          | `pr-no-verify` ≈ never; catch-all scopes refused                          | Escapes clustering = the gate is too slow or a rule fights the actual work. Fix the check, not the agent.                                                                                        |
| Docs             | CLAUDE.md edited in the same commit as any enforcement change             | Enforcement changed, docs silent = the next agent inherits false instructions; this is the highest-priority drift to catch in review.                                                            |

## 4. What the framework cannot tell you (review these yourself)

The gate proves _conformance_, not _quality_. Human review should skip what
the machine already checked (formatting, boundaries, types, dead code) and
spend entirely on what it can't:

1. **Is the change in the right place?** A guard added at one call site
   instead of the shared function passes every check. Ask: who else calls
   this? (The framework's own history: agents fixed symptoms in-scope when
   the real fix was out of scope.)
2. **Do the tests assert the right thing?** Mutation testing catches
   assertion-free tests, not wrong-assertion tests. Read the assertions of
   any test whose name you couldn't have predicted from the task.
3. **Is the public surface honest?** New `index.ts` exports should be things
   other modules _should_ call — not internals promoted to satisfy lint.
4. **Was the simplest mechanism chosen?** Nothing gates against
   over-engineering. Speculative config, single-implementation interfaces,
   and "for later" scaffolding all pass verify.
5. **Prose claims in reports.** Agents summarize optimistically. Trust the
   ledger and the gate over the report; "verify green" is checkable — check it.

## 5. Guiding agents within the framework

How to steer without fighting the machinery:

- **Scope first, then prompt.** `pnpm scope <module>` before dispatch turns
  your intent into an enforced fence. A prompt saying "only touch X" is a
  suggestion; the scope file is a mechanism.
- **Name modules, not files.** "Change the `pricing` module so that…" lets
  the agent use `module-map.json` + the module's `AGENTS.md`; pasting file
  contents burns context and goes stale.
- **Point at the pipeline.** `/feature <description>` runs scope → implement
  → verify → PR in order. For anything non-trivial, invoking the pipeline
  beats freeform prompting because each stage's exit is machine-checked.
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

1. `pnpm verify` — is the tree actually green?
2. `pnpm edit-log` — scan kinds: any `scope-block` repeats? any `pr-no-verify`?
3. `git log --oneline -10` + `git diff main...HEAD --stat` — does the change
   footprint match the task you assigned?
4. `git diff` the files the machine can't judge: test assertions, `index.ts`
   exports, `module-map.json` edges, CLAUDE.md accuracy.
5. If anything failed mid-session: `.task/last-verify.json` for what the
   agent saw, `verify --baseline` if you suspect it wasn't their fault.

If steps 1–3 are boring, the framework did its job and step 4 is your whole
review. That's the intended division of labor: the machine checks
conformance so you can spend your attention on judgment.
