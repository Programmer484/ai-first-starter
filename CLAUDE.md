# CLAUDE.md

Rules for agents working in this repository. Every rule below maps to a
deterministic check — break the rule and `pnpm verify` (or a hook) fails with
an actionable error. Rules that cannot be checked live under **Guidance**.

## Rules (each enforced by a named check)

1. **`module-map.json` is the single source of truth.** Module boundaries,
   the scope resolver, and the module/folder registry all derive from it. To
   change architecture, edit this file — never hand-edit `eslint.config.js`.
   — _Enforced by:_ `lint` (boundaries rules are generated from the map at
   lint time) and `module-sync` (verify step).

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
   it writes `.task/allowed-files.json`. Widen scope by re-running
   `pnpm scope`, not by editing the JSON.
   — _Enforced by:_ `scope-guard` (PreToolUse hook) — blocks the edit and
   logs the attempt to `edit-log.jsonl` (repeated blocks = scoping bug).

6. **Every change ends green.** `pnpm verify` must pass before shipping.
   — _Enforced by:_ `verify` itself — pre-commit (lefthook) and CI run the
   identical script, so local green and CI green cannot drift.

7. **Meet the coverage floor.** 70% lines on `src/modules/**`, ratcheting
   upward. Never lower it to make a change pass.
   — _Enforced by:_ coverage `thresholds` in `vitest.config.ts` (`test` step).

8. **No dead code.** Remove unused exports and files rather than keeping
   them "for later".
   — _Enforced by:_ `knip` (verify step).

9. **Keep formatting canonical.** Don't argue with the formatter.
   — _Enforced by:_ `format` (verify step) + the `auto-format` PostToolUse
   hook, which formats every file an agent writes.

## Guidance (no deterministic check — judgement calls)

- **Prefer reuse and the smallest change.** Check for an existing helper
  before writing one; don't add a dependency for what a few lines cover.
- **Test through the public surface** (`index.ts`); reach into `internal/`
  only when logic is unreachable from the public API. See `TESTING.md`.
- **Ship with `pnpm pr "<title>"`** — branch, commit, push, draft PR. Never
  push directly to the default branch (enforce with branch protection on the
  host, not in this repo).
