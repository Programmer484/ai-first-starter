# CLAUDE.md

Rules for agents working in this repository. Every rule below maps to a
deterministic check — break the rule and `pnpm verify` (or a hook) fails with
an actionable error. Where a check is heuristic instead (the scope guard's
shell layer), the rule says so. Rules that cannot be checked live under
**Guidance**.

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

4. **Create modules with the script** (`pnpm new-module <name>`), which
   scaffolds and registers in one move. Hand-made folders drift.
   — _Enforced by:_ `module-sync` (verify step) — an unregistered folder or a
   registered-but-missing folder fails verify.

5. **Scope every task.** Run `pnpm scope <module-or-spec>` before editing;
   it writes `.task/allowed-files.json`. Widen scope with
   `pnpm scope --add <module|path>` — a plain re-run REPLACES the scope, and
   editing the JSON by hand is always blocked. Bare catch-all globs (`**`,
   `src/**`, …) are refused.
   — _Enforced by:_ `scope-guard` (PreToolUse hook). Deterministic for
   Edit/Write/MultiEdit/NotebookEdit: out-of-scope targets are blocked.
   Heuristic for Bash: quoted segments are stripped, then write-indicator +
   out-of-scope path detection — when unsure, it allows. With no scope
   active, edits under `src/` get a one-time nudge (`.task/.unscoped-ack`
   marker). Repeat blocks on the same path escalate with explicit
   don't-work-around wording. Every scope set and every block is logged to
   `edit-log.jsonl` (repeated blocks = scoping bug). This layer is a
   guardrail against accidents, not adversaries — escapes exist and are
   logged.

6. **Every change ends green.** `pnpm verify` must pass before shipping.
   Not sure a failure is yours? `pnpm verify --baseline` re-runs the failing
   steps against a clean checkout of HEAD and classifies each as
   pre-existing or introduced. `pnpm pr --no-verify` skips the pre-PR run,
   but the skip is logged to `edit-log.jsonl`.
   — _Enforced by:_ `verify` itself — pre-commit (lefthook) and CI run the
   identical script, so local green and CI green cannot drift.

7. **Meet the coverage floor.** 80% lines, functions, and branches on
   `src/modules/**`, ratcheting upward. Never lower it to make a change
   pass. Polish lane: a module may declare `"gates": "polish"` in
   `module-map.json` (`pnpm new-module <name> --gates polish`) to opt out of
   the coverage floor ONLY — lint, boundaries, typecheck, knip, and
   scope-guard all still apply. It is for feel/render/UI-polish modules
   where test-first has no meaningful spec; logic modules stay `full`.
   — _Enforced by:_ coverage `thresholds` in `vitest.config.ts` (`test`
   step); `ratchet` (verify step) fails any lowering of the `lines` floor
   against origin/main (skip-passes when no baseline ref resolves;
   `RATCHET_BASE` / `RATCHET_BASE_CONTENT` override the baseline). Polish
   excludes are generated from the map (`scripts/gates.ts`) and the `gates`
   value is validated by `module-sync`.

8. **No dead code.** Remove unused exports and files rather than keeping
   them "for later".
   — _Enforced by:_ `knip` (verify step).

9. **Keep formatting canonical.** Don't argue with the formatter.
   — _Enforced by:_ `format` (verify step) + the `auto-format` PostToolUse
   hook, which formats every formattable file an agent writes.

## Guidance (no deterministic check — judgement calls)

- **Prefer reuse and the smallest change.** Check for an existing helper
  before writing one; don't add a dependency for what a few lines cover.
- **Test through the public surface** (`index.ts`); reach into your own
  module's `internal/` only when logic is unreachable from the public API.
  (Deep-importing ANOTHER module's internals fails lint even from tests —
  there is no test exemption.) See `TESTING.md`.
- **Ship with `pnpm pr "<title>"`** — branch, commit, push, draft PR. Never
  push directly to the default branch (enforce with branch protection on the
  host, not in this repo).
