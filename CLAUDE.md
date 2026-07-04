# CLAUDE.md

Rules for agents working in this repository. These are enforced by tooling
(hooks, lint, CI) wherever possible — follow them and the gates stay green.

1. **`module-map.json` is the single source of truth.** Module boundaries,
   ESLint rules, the scope resolver, and docs are all generated from it. To
   change architecture, edit this file — never hand-edit `eslint.config.js`.

2. **Import modules only through their `index.ts`.** Everything under a
   module's `internal/` is private. Deep imports are blocked by lint.

3. **Declare dependencies before using them.** Module A may import module B
   only if B is in A's `allowedImports`. Add it to `module-map.json` first.

4. **Create modules with the script.** Run `pnpm new-module <name>` — it
   scaffolds the skeleton and registers the module. Don't create module folders
   by hand.

5. **Scope every task.** Before editing, run `pnpm scope <module-or-spec>` to
   write `.task/allowed-files.json`. The scope-guard hook blocks edits outside
   it. Widen scope by re-running `pnpm scope`, not by editing the JSON.

6. **Every change ends green.** `pnpm verify` (format, lint, typecheck, tests,
   coverage floor, dead code) must pass. Don't lower thresholds or delete tests
   to pass it.

7. **Test through the public surface.** Tests live in the module's
   `__tests__/`. Prefer testing `index.ts`; see `TESTING.md`.

8. **No dead code.** `knip` runs in verify. Remove unused exports and files
   rather than leaving them "for later".

9. **Prefer reuse and the smallest change.** Check for an existing helper before
   writing one. Don't add a dependency for what a few lines cover.

10. **Ship with the script.** Use `pnpm pr "<title>"` to branch, commit, push,
    and open a draft PR. Never push straight to the default branch.
