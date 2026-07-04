# ai-first-starter — Strengths, Limitations, and Operating Practices

An honest assessment of this enforcement framework: what it actually does for
agent performance, where it breaks down, and what the human operator has to do
to get the value out of it. Based on building, auditing, adversarially
reviewing (8 finder angles, 29 verified candidates), and then fixing this
system across multiple agent waves.

---

## 1. What the system is

A TypeScript template where **every rule an agent must follow is backed by a
machine check that fails with an error naming the fix**. The components:

| Layer                 | Files                                                                            | What it does at the tool-call level                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture registry | `module-map.json` (+ schema)                                                     | Single JSON file declaring modules and allowed imports. ESLint boundary rules are _generated_ from it at lint time — docs and enforcement cannot drift.                                                                                                                                                                        |
| Boundary lint         | `eslint.config.js` (generated rules)                                             | A cross-module deep import or undeclared dependency fails `lint` with a message naming the exact fix ("add it to allowedImports in module-map.json").                                                                                                                                                                          |
| Task scoping          | `scripts/scope.ts` → `.task/allowed-files.json` → `.claude/hooks/scope-guard.ts` | A PreToolUse hook intercepts every Edit/Write/Bash tool call. Out-of-scope edits are blocked (exit 2) and the error text is fed back into the agent's context — the agent literally reads "widen with `pnpm scope --add <path>`" as its next input.                                                                            |
| One gate              | `scripts/verify.ts`                                                              | `pnpm verify` = module-sync → format → lint → typecheck → test+coverage → ratchet → knip. The identical script runs locally, in pre-commit (lefthook), and in CI. `--fast` is the affected-only inner loop (changed-files lint/format, `vitest --changed`, ratchet/knip skipped); the full gate still gates pre-commit and CI. |
| Mutation gate         | `stryker.config.mjs` (`pnpm mutation`)                                           | CI-only parallel job — mutates `src/modules/**` and fails under break 60. Catches coverage satisfied by assertion-free tests; too slow for the local gate.                                                                                                                                                                     |
| Agent-tuned output    | `verify --agent`, `.task/last-verify.json`                                       | Failures are grouped by file, capped (~60 lines), deduped, and snapshotted (overwrite, never append) so a repair loop reads current state instead of accumulating stale error dumps.                                                                                                                                           |
| Failure attribution   | `verify --baseline` (`scripts/baseline.ts`)                                      | Re-runs failing steps in a temp worktree at HEAD and classifies each as _pre-existing_ vs _introduced_ — so agents stop burning retries on breakage they didn't cause.                                                                                                                                                         |
| Ratchets              | `scripts/ratchet.ts`                                                             | Coverage floors (lines/functions/branches/statements) can only go up, compared against `origin/main`; CI fails closed if the baseline can't be fetched.                                                                                                                                                                        |
| Lane control          | `"gates": "polish"` in the map                                                   | Feel/render modules opt out of the coverage floor **only** — lint, boundaries, typecheck, dead-code, and scoping all still apply.                                                                                                                                                                                              |
| Ledger                | `edit-log.jsonl`                                                                 | Append-only log of every verify run, scope change, blocked edit, and `--no-verify` escape. The telemetry that tells you whether the _framework_ (not the agent) is misbehaving.                                                                                                                                                |
| Meta-tests            | `test/*.test.ts`                                                                 | The enforcement layer is itself tested: each suite plants a violation, runs the real check as a subprocess, and asserts the error message _contains the fix string_.                                                                                                                                                           |

## 2. Why this improves agent performance (the mechanisms)

Agent performance is mostly a context-quality problem. Each component maps to
a specific failure mode of LLM agents:

- **Errors as steering, not noise.** An agent recovers from failure through
  the error text in its context window. A generic `ESLint: 14 problems` burns
  a full read-diagnose-retry cycle; `"Module 'a' may not import module 'b'.
Add it to allowedImports in module-map.json"` collapses that cycle to one
  edit. The meta-tests pin these strings, so the recovery paths can't rot.
- **One exit code kills drift loops.** "Passes locally, fails CI" is one of
  the most expensive agent loops (each iteration costs a full CI round-trip).
  Identical script in all three places removes the loop _by construction_.
- **Blocked > corrected.** The scope hook stops a wrong edit before it lands
  rather than asking a reviewer to catch it after. Prevention costs one tool
  call; correction costs a review cycle plus the agent re-deriving context.
- **Bounded failure output prevents context poisoning.** Raw vitest+coverage
  dumps are thousands of lines; three retries of that and the model's context
  is dominated by stale errors (it starts fixing error #1 repeatedly or
  reverting its own work). The `--agent` summary + overwrite-only snapshot
  keeps the repair loop reading _current, small_ state; the lint step parses
  `eslint --format json` for real file/count data instead of the free-text
  path heuristic.
- **Anti-Goodhart circuit breakers.** When an agent can't reach the right
  file, its natural failure mode is re-implementing the logic in-scope
  (passes every check, worse architecture). A repeated block on the same path
  escalates with explicit "do NOT re-implement the target inside scope as a
  workaround" wording — instruction injected exactly at the moment of
  temptation.
- **Escapes exist and are logged, not denied.** `pnpm pr --no-verify`,
  scope widening, ratchet overrides — all present, all recorded in the
  ledger. Hooks are guardrails against accidents, not adversaries; pretending
  otherwise just teaches agents to route around them silently.

## 3. Strengths

1. **The docs never overclaim.** CLAUDE.md's claims were audited line-by-line
   against the code (the "truth pass"). This matters more than it sounds: an
   agent that catches its instructions being wrong once discounts all of
   them. Deterministic vs heuristic enforcement is labeled as such.
2. **Self-testing enforcement.** The checks that gate the agent are
   themselves under test, including the exact error strings. A refactor that
   silently breaks a recovery path fails the suite.
3. **Single source of truth with generated enforcement.** Architecture is one
   small JSON file an agent can hold in context; the lint rules derive from
   it mechanically. There is nothing to keep in sync by discipline.
4. **The system catches its own regressions.** During its own development the
   ratchet caught a silently-lowered coverage floor introduced by the very
   commit that built the enforcement layer, and the review found (and fixes
   closed) real bypasses in the scope guard. That's the feedback loop working.
5. **Failure attribution.** `verify --baseline` is rare in practice and
   valuable: "is this red mine?" is the question that otherwise wastes an
   agent's entire retry budget.
6. **Cheap, fast inner loop.** Full gate ≈ 20s on the template. Agents can
   afford to run it after every meaningful change instead of batching.

## 4. Limitations and failure modes

Be clear-eyed about these; several were demonstrated live during development.

### 4.1 The scope guard is a heuristic at the shell boundary

Edit/Write tool calls are checked deterministically, but Bash is parsed with
a quoted-segment-stripping, write-indicator + path heuristic that _allows
when unsure_. Interpreters (`python -c`, heredocs), exotic write flags
(`awk -i inplace`, `sort -o`), and creative quoting will get through. This is
by design — a full shell parser is a losing arms race — but it means scope
enforcement is a guardrail, not a boundary. Don't build a security story on it.

### 4.2 The machine's ground truth can be wrong

Every layer assumes the encoded spec is correct. When it isn't, enforcement
actively degrades performance instead of improving it:

- **Wrong scope** → the agent, biased toward task completion, solves the
  problem _inside_ the fence: duplicated logic, hacky indirection. Passes
  verify, looks done, is worse than unconstrained output. The escalating
  block message and `--add` widening reduce this; they don't eliminate it.
- **Gameable proxy metrics** → the coverage floor can be satisfied by tests
  that execute code without asserting anything. Coverage is a floor against
  _nothing_, not a proof of _something_. The CI-only Stryker mutation gate
  (`pnpm mutation`, break 60) now closes most of this hole; local coverage
  still can't.
- **Boundary tunneling** → when the map is missing a genuinely needed edge,
  agents route data through permitted intermediaries or bloat `index.ts` to
  expose internals "publicly". Every check stays green while the dependency
  graph rots. Watch the `apiSurface` counts in the ledger — a module whose
  export count keeps climbing is the tell.
- **Spec-shaped gates on spec-less work** → test-first on "make it feel
  alive" produces brittle junk tests. That's what the polish lane is for; if
  people aren't using it, they'll fight the gate instead.

### 4.3 Shared global state is the recurring bug factory

Nearly every real defect found in this system was some form of _two things
sharing state they didn't know they shared_: tests deleting the live scope
file, `prettier --check .` scanning sibling agents' worktrees, repo-global
`git worktree list` seeing other sessions' temp worktrees, parallel vitest
workers racing on probe files. The fixes were all the same shape — sandbox
into temp dirs, ignore sibling checkouts, delta-based assertions. Expect the
next flaky failure to be this class again, and reach for sandboxing first.

### 4.4 Costs that scale with the repo

The full gate on every commit is fine at 20s and one module; it grows
linearly. `pnpm verify --fast` now gives an affected-only inner loop
(changed-files lint/format, `vitest --changed`, ratchet/knip skipped), but
there is still no caching and the full gate — the one that ships — is
unchanged. The baseline integration test materializes a real git worktree
inside the default suite. When the full gate crosses ~1–2 minutes, agents
(and humans) will start batching commits and reaching for `--no-verify` —
revisit before that point.

### 4.5 What has no check at all

"Never hand-edit `eslint.config.js`" is convention (nothing hashes it against
the map). Per-module `AGENTS.md` docs have no freshness check. The
`ponytail:` shortcut comments are tracked by grep, not tooling. These live in
Guidance for a reason — treat them as review items, not guarantees.

## 5. Practices for the human operator

The framework automates enforcement, not judgment. These are the behaviors
that determine whether it compounds or decays.

### Per-task hygiene

- **Scope before you (or an agent) edit.** `pnpm scope <module|spec>` first;
  widen with `pnpm scope --add`, never by hand-editing the JSON. An unscoped
  session is a session where the strongest guardrail is off.
- **Give agents the map, not the tour.** A task prompt that names the target
  module(s) plus `module-map.json` beats pasting file contents. The
  architecture is designed to be held in context; use that.
- **Prefer `pnpm verify --agent` in agent loops** and plain `verify` for
  yourself. When a failure looks foreign, `verify --baseline` before letting
  anyone "fix" it.
- **Treat repeated scope-blocks as a scoping bug, not agent misbehavior.**
  Check `pnpm edit-log` — two blocks on the same path mean _you_ scoped too
  narrow. Widen; don't let the agent improvise around the fence.

### Tending the enforcement layer (weekly-ish)

- **Read the ledger.** `edit-log.jsonl` records every block, every
  `--no-verify`, every scope change. Escapes clustering around one rule mean
  the rule (or its check) is wrong for how work actually flows — fix the
  check, don't lecture the agent.
- **Ratchet deliberately.** When coverage sits comfortably above the floor,
  raise the floor. The ratchet only prevents backsliding; forward motion is
  manual.
- **Watch `apiSurface` trends** for boundary tunneling (§4.2). A widening
  public surface is the map telling you it's missing an edge — add the edge
  in `module-map.json` rather than letting the workaround calcify.
- **Keep the docs true.** Any change to enforcement behavior gets a matching
  CLAUDE.md edit in the same PR. One overclaim poisons agent trust in all of
  the rules; it's the cheapest high-leverage maintenance there is.
- **New rule ⇒ new check ⇒ new meta-test, or it goes in Guidance.** Never add
  a numbered rule you can't enforce; that's the contract that makes the rest
  work.

### Running multiple agents

- **One worktree per agent, file-disjoint task splits, merge in waves.**
  Parallel agents in one checkout will race on probe files, the ledger, and
  coverage output. Anything global (format scan scope, `git worktree list`,
  the pnpm store) is shared across _all_ worktrees — partition or ignore it
  explicitly (`.prettierignore` already excludes `.claude/worktrees/`).
- **Sequence dependent waves.** A docs/truth task must run _after_ the code
  it documents merges; a task extending a validator must follow the task
  that created it. Pre-resolve known collisions (e.g., rename a test's probe
  key) before dispatch instead of letting two agents fight over it.
- **Size the model to the spec, not the task's prestige.** Fully-specified
  mechanical fixes run fine on small/cheap models; spend the strong model on
  judgment-heavy work (heuristics, output design, anything touching the
  worktree/git machinery). A precise prompt downgrades the model you need.
- **Make each agent finish with the gate.** "Commit on your own branch,
  verify green, report in 3 lines" turns integration into clean `git merge`s
  plus one final verify — and the pre-commit hook re-checks each agent's
  claim automatically.

### When the framework fights you

- If an agent is looping on blocks: widen scope, or check whether the true
  fix lives outside the module map's current edges.
- If verify is red on a clean-looking tree: `git worktree prune` (stale temp
  worktrees from interrupted baseline runs) and rerun once before digging.
- If a gate is producing junk work (vacuous tests, tunnel imports): the gate
  is mis-specified for that work — change the encoding (polish lane, new map
  edge, raised/rescoped rule) rather than pressuring the agent to comply
  harder. The system's core principle cuts both ways: **anything the machine
  enforces must be at least as correct as the agent is capable of being.**

## 6. Bottom line

The system's real product is _trustworthy feedback_: fast, deterministic,
fix-naming, identical everywhere, and honest about its own limits. Agents
iterate against that feedback loop far more efficiently than against prose
instructions or human review latency. Its weaknesses are the mirror image —
wherever the encoded ground truth is wrong, stale, or gameable, the same
machinery efficiently produces well-formed bad outcomes. The human's job is
not to supervise the agent; it's to keep the encoding true: tend the map,
read the ledger, ratchet the floors, and never let the docs promise a check
that doesn't exist.
