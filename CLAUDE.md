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
   `pnpm scope --add <module|path>` — a plain re-run REPLACES the scope, and
   editing the JSON by hand is always blocked. Bare catch-all globs (`**`,
   `src/**`, …) are refused.
   — _Enforced by:_ `scope-guard` (PreToolUse hook). Deterministic for
   Edit/Write/MultiEdit/NotebookEdit: out-of-scope targets are blocked.
   Heuristic for Bash: quoted segments are stripped, then write-indicator +
   out-of-scope path detection (not bypassed by `pnpm exec`) — when unsure,
   it allows, except Bash writes to `.task/allowed-files.json` and
   `edit-log.jsonl`, which are always blocked. With no scope
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
   identical script, so local green and CI green cannot drift. (`pnpm verify
--fast` is the affected-only inner loop; the full gate still runs in
   pre-commit and CI.)

7. **Meet the coverage floor.** 80% lines, functions, branches, and
   statements on `src/modules/**`, ratcheting upward. Never lower it to make
   a change pass. Polish lane: a module may declare `"gates": "polish"` in
   `module-map.json` (`pnpm new-module <name> --gates polish`) to opt out of
   the coverage floor ONLY — lint, boundaries, typecheck, knip, and
   scope-guard all still apply. It is for feel/render/UI-polish modules
   where test-first has no meaningful spec; logic modules stay `full`.
   — _Enforced by:_ coverage `thresholds` in `vitest.config.ts` (`test`
   step); `ratchet` (verify step) fails any lowering of the four floors
   against origin/main (with `RATCHET_REQUIRE=1` CI fails closed rather than
   skip-passing when no baseline ref resolves; `RATCHET_BASE` /
   `RATCHET_BASE_CONTENT` override the baseline). A CI-only Stryker mutation
   gate (`pnpm mutation`, break 60) catches coverage met by assertion-free
   tests. Polish modules get per-glob zero thresholds generated from the map
   (`scripts/gates.ts`) — coverage is still measured and reported, only the
   floor is zeroed — and the `gates` value is validated by `module-sync`.

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
