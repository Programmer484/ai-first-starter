---
description: Run the feature pipeline — scope, implement, verify, PR — for a described change.
argument-hint: <feature description>
---

You are implementing a feature in a module-first codebase. Follow the pipeline
in order. Do not skip steps.

Feature request: **$ARGUMENTS**

## 1. Scope

- Read `module-map.json` to see the modules and their allowed imports.
- Decide which module(s) this change touches. If it needs a new module, run
  `pnpm new-module <name> --desc "..." [--imports a,b]` first.
- Lock the scope so the scope-guard hook enforces it:

  ```bash
  pnpm scope <module-name>        # or: pnpm scope <spec-file>
  ```

  This writes `.task/allowed-files.json`. From now, edits outside that set are
  blocked by the PreToolUse hook — that is intended. Widen scope only by
  re-running `pnpm scope`, never by editing the JSON by hand.

## 2. Implement

- Public API goes in the module's `index.ts`. Implementation goes in
  `internal/`. Other modules import ONLY through `index.ts`.
- To depend on another module, add it to that module's `allowedImports` in
  `module-map.json`. Boundaries are generated from that file — do not touch
  `eslint.config.js`.
- Write tests under the module's `__tests__/` (see `TESTING.md`).

## 3. Verify

```bash
pnpm verify
```

One exit code covers format, lint (incl. boundaries), typecheck, tests +
coverage floor, and dead-code. Fix until green. Do not weaken thresholds to
pass.

## 4. Ship

```bash
pnpm pr "feat: <concise title>"
```

Creates a branch, commits, pushes, opens a draft PR, and posts the checks link.

Report: the module(s) changed, what `pnpm verify` reported, and the PR URL.
