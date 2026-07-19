# CLAUDE.md

Rules for agents working in this repository. Every rule below maps to a
deterministic check — break the rule and `pnpm verify` (or a hook) fails with
an actionable error. Where a check is heuristic instead (the scope guard's
shell layer), the rule says so. Rules that cannot be checked live under
**Guidance**.

## Modes

Two working modes, defined in `docs/WORKING-MODES.md`: **PRD mode** (spec-driven,
multi-slice, one scope + full verify + PR per slice) and **pair mode**
(iterative editing with the user in the loop, boundaries at turn
granularity, entered via `/feature`). **Declare your mode at session
start** — "Mode: PRD"
or "Mode: pair" — and follow that mode's contract.

## Rules (each enforced by a named check)

1. **`module-map.json` is the single source of truth.** Module boundaries,
   the scope resolver, and the module/folder registry all derive from it. To
   change architecture, edit this file — never hand-edit `eslint.config.js`.
   Its shape is documented in `module-map.schema.json`.
   — _Enforced by:_ `lint` (boundaries rules are generated from the map at
   lint time) and `module-sync` (verify step), which validates the map's
   shape with named errors (unknown keys warn; `gates` is a validated enum).

2. **Import modules only through their `index.ts`.** Everything under a
   module's `internal/` is private.
   — _Enforced by:_ `boundaries/entry-point` (`lint` step).

3. **Declare dependencies before using them.** Module A may import module B
   only if B is in A's `allowedImports` in `module-map.json`.
   — _Enforced by:_ `boundaries/element-types` (`lint` step).

   **Declare external packages too (optional allowlist).** A module may add an
   `allowedExternals` array to its `module-map.json` entry to restrict which
   npm packages it may import — keep core logic free of framework/renderer
   packages by declaring the allowlist. Absent = unrestricted (any package,
   the default). Present = the module may import ONLY those packages (subpaths
   like `pkg/sub` count as allowed); `[]` = pure module (no external packages
   at all). `node:` builtins and cross-module imports (still governed by
   `allowedImports`) are always allowed. Scaffold with
   `pnpm new-module <name> --externals a,b` (or `--pure` for `[]`).
   — _Enforced by:_ `boundaries/external` (`lint` step), generated from the
   map — a disallowed import fails with `Module '<name>' may not import
external package '<pkg>'. Add '<pkg>' to allowedExternals for '<name>' in
module-map.json`; the field's shape is validated by `module-sync` (verify
   step).

4. **Create modules with the script** (`pnpm new-module <name>`), which
   scaffolds and registers in one move. Hand-made folders drift.
   — _Enforced by:_ `module-sync` (verify step) — an unregistered folder or a
   registered-but-missing folder fails verify.

5. **Scope every task.** Run `pnpm scope <module-or-spec>` before editing;
   it writes `.task/allowed-files.json`. Widen scope with
   `pnpm scope add <module|path>` (`--add` also works under pnpm, but `npm
run` swallows `--add`, so prefer the subcommand; a path may be a file or
   a directory — a directory expands to `<dir>/**`) — a plain re-run
   REPLACES the scope, and
   editing the JSON by hand is always blocked. Bare catch-all globs (`**`,
   `src/**`, …) are refused.
   — _Enforced by:_ `scope-guard` (PreToolUse hook). Deterministic for
   Edit/Write/MultiEdit/NotebookEdit: out-of-scope, in-repo targets are
   blocked; targets outside the repo root (e.g. the agent's scratch dir) are
   allowed, since scope governs repo files only.
   Heuristic for Bash: quoted segments are stripped, then write detection
   scans only **real write operands** — in-repo redirect targets and the
   arguments of write verbs (`tee`, `mv`, `cp`, `rm`, `touch`, `truncate`,
   `sed -i`, `dd of=`, `patch`, `git apply`) — so a read-only command
   (`grep`, `cat`, `ls`, …) can never be misclassified as a write, and the
   detection is not bypassed by `pnpm exec`. `~` is expanded to the home
   directory before the in-repo check. When unsure, the hook allows —
   except Bash writes to `.task/allowed-files.json` and `edit-log.jsonl`,
   which are always blocked (this always-block runs first against a
   quote-RESOLVED copy of the command, so quoting the path doesn't slip
   past it). A scope whose recorded `branch` no longer
   matches the current git branch is treated as **inactive** (you get the
   unscoped nudge with a note saying why) rather than enforced. With no
   scope active, edits under `src/` get a one-time nudge
   (`.task/.unscoped-ack` marker). Repeat blocks on the same path escalate
   with explicit don't-work-around wording. Every scope set and every block
   is logged to `edit-log.jsonl` (repeated blocks = scoping bug). This
   layer is a guardrail against accidents, not adversaries — escapes exist
   and are logged.

6. **Every change ends green.** `pnpm verify` must pass before shipping.
   Not sure a failure is yours? `pnpm verify --baseline` re-runs the failing
   steps against a clean checkout of HEAD and classifies each as
   pre-existing or introduced. `pnpm pr --no-verify` skips the pre-PR run,
   but the skip is logged to `edit-log.jsonl`.
   — _Enforced by:_ `verify` itself — pre-commit (lefthook) and CI run the
   identical script, so local green and CI green cannot drift. (`pnpm verify
--fast` is the affected-only inner loop; the full gate still runs in
   pre-commit and CI.) The framework's own self-tests (`test/**` — enforcement
   probes and verify meta-tests) are NOT part of verify: they run via
   `pnpm test:framework`, executed in CI only when framework files change.
   Run them locally after editing `scripts/`, hooks, or configs.

7. **Meet your module's coverage gate.** The floor lives in exactly one
   place: `COVERAGE_FLOOR` in `scripts/gates.ts` (currently 80% lines,
   functions, branches, statements); `vitest.config.ts` imports it — never
   hand-edit thresholds there. Per-module thresholds are generated for
   EVERY module from its `gates` profile in `module-map.json`:
   - `full` (default) → the floor. For logic modules; tests first.
   - `polish` → 0 (coverage still measured and reported, floor zeroed).
     For feel/render/UI-polish modules where test-first has no meaningful
     spec. Lint, boundaries, typecheck, knip, and scope-guard all still
     apply.
   - `shell` → 0, and additionally capped at **200 non-test source lines**
     by `module-sync`. For thin pass-through modules (wiring, DOM shells).
     Outgrow the cap → promote the module to `full`.

   New modules may start at any profile (`pnpm new-module <name> --gates
polish|shell`). Never lower the floor or weaken a gate to make a change
   pass — but note the asymmetry the ratchet enforces is against the
   _baseline_, so strengthening (shell→polish→full) is always fine.
   — _Enforced by:_ coverage `thresholds` generated by `scripts/gates.ts`
   (`test` step); `ratchet` (verify step) fails BOTH any lowering of the
   four floors AND any gate weakening (full→polish/shell, polish→shell)
   against origin/main (with `RATCHET_REQUIRE=1` CI fails closed rather
   than skip-passing when no baseline ref resolves; `RATCHET_BASE` /
   `RATCHET_BASE_CONTENT` override the baseline); the shell line cap by
   `module-sync` (verify step); the `gates` enum by `module-sync`. A
   CI-only Stryker mutation gate (`pnpm mutation`, break 60) catches
   coverage met by assertion-free tests; PRs run it only when
   mutation-relevant paths change (pushes to main always run it).

8. **No dead code.** Remove unused exports and files rather than keeping
   them "for later".
   — _Enforced by:_ `knip` (verify step).

9. **Keep formatting canonical.** Don't argue with the formatter.
   — _Enforced by:_ `format` (verify step) + the `auto-format` PostToolUse
   hook, which formats every formattable file an agent writes inside this
   repo (files outside the repo root are left to their own repo's style).

10. **No stale per-task references.** Files under `src/**` must never
    mention `.task/` — per-task working state (specs, scopes, branch
    names) is ephemeral and must not leak into shipped code or comments.
    — _Enforced by:_ `no-stale-refs` (verify step).

11. **Log the debt you don't fix.** Any bug or limitation discovered but
    not fixed in the current task — including pre-existing ones found
    mid-task — gets a `DEBT.md` entry **in the same PR**. Entries are never
    deleted: flip `status` to `fixed` (with a `fixed-by:` line) or
    `wontfix`, so the ledger stays a history. `DEBT.md` is seeded into
    every scope, so logging debt never requires widening.
    — _Enforced by:_ `debt` (verify step — format only; whether something
    _should_ have been logged is a judgement call) + the PR body's
    `## Debt` diff section, which surfaces new entries for reviewer
    visibility.

12. **Never push the default branch directly.** Ship with
    `pnpm pr "<title>"` — branch, commit, push, draft PR.
    `ALLOW_MAIN_PUSH=1` is the emergency override; it works, but the
    override is logged to `edit-log.jsonl`.
    — _Enforced by:_ `pre-push-guard` (lefthook pre-push) locally + host
    branch protection (enabled by `init` via `gh api`), which also catches
    refspec pushes (`git push origin HEAD:main` from another branch) the
    local hook can't see.

13. **Framework changes gate on the framework's own tests.** A change to
    any framework-owned path (`scripts/`, `test/`, `.claude/`, or the
    configs matched by `FRAMEWORK_PATH_RE` in `scripts/framework-paths.ts`)
    must pass `pnpm test:framework` in addition to `pnpm verify` — run them
    serially, never concurrently (the self-tests plant probe modules that
    race a concurrent verify).
    — _Enforced by:_ the lefthook `3_framework` pre-commit command (runs the
    suite when staged files match), CI's path-filtered `framework` job, and
    `pnpm pr`, which re-runs the suite for framework diffs and appends its
    summary tail to the PR body under `## Framework self-tests` (a red
    suite aborts the PR; `--no-verify` skips the gate but is logged to
    `edit-log.jsonl`). `FRAMEWORK_PATH_RE` and ci.yml's path-filter regex
    are a coordinated pair pinned identical by `test/framework-gate.test.ts`.

14. **Hook commands must be cwd-robust.** Hook commands in
    `.claude/settings.json` that reference `.claude/hooks/` scripts must
    resolve the path via `$CLAUDE_PROJECT_DIR` (quoted, e.g.
    `node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/scope-guard.ts"`) — never
    a bare relative path. Hooks run with the session's cwd, so a relative
    path breaks when the session isn't rooted at the repo top, and a hook
    that errors does NOT block the tool call — the guard silently stops
    enforcing.
    — _Enforced by:_ `hook-command-path` probe (`pnpm test:framework`) —
    static path-form check plus a functional spawn-from-subdirectory check.

## Guidance (no deterministic check — judgement calls)

- **Prefer reuse and the smallest change.** Check for an existing helper
  before writing one; don't add a dependency for what a few lines cover.
- **Test through the public surface** (`index.ts`); reach into your own
  module's `internal/` only when logic is unreachable from the public API.
  (Deep-importing ANOTHER module's internals fails lint even from tests —
  there is no test exemption.) See `docs/TESTING.md`.
- **Read `PREFERENCES.md` at session start and honor it.** It holds the
  user's plain-language agent-behavior preferences; `/customize` maintains
  it (and routes enforcement-worthy requests to real checks instead).
- **Before editing framework files, read `docs/FRAMEWORK.md`** — §3 invariants
  first, then §4's file→test table to predict which self-tests should fail.
  An unexpectedly failing self-test (one not mapped to a file you changed)
  is a stop signal: halt and report rather than fixing it. Update failing
  self-tests at the same assertion strength — never delete, skip, or weaken
  one. Land coordinated changes atomically: error text ↔ its test ↔ any doc
  quoting it; schema ↔ validator; new framework file ↔ manifest entry ↔
  ci.yml regex.
- **Follow your declared mode's contract** (`docs/WORKING-MODES.md`). The pair-mode
  turn contract — smallest change per message, receipt, stop — is a working
  agreement, not a named check; the deterministic layer (scope-guard,
  verify) still runs underneath it.
