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
  `pnpm new-module <name> --desc "..." [--imports a,b]` first. For a
  feel/render/UI-polish module with no meaningful test-first spec, add
  `--gates polish` — that exempts it from the coverage floor ONLY (lint,
  boundaries, typecheck, knip, scope-guard still apply). Logic modules stay
  `full`.
- Lock the scope so the scope-guard hook enforces it:

  ```bash
  pnpm scope <module-name>        # or: pnpm scope <spec-file>
  ```

  This writes `.task/allowed-files.json`. From now, edits outside that set are
  blocked by the PreToolUse hook — that is intended. Widen scope with
  `pnpm scope --add <module|path>` (a plain re-run replaces the scope), never
  by editing the JSON by hand.

## 2. Implement

- Public API goes in the module's `index.ts`. Implementation goes in
  `internal/`. Other modules import ONLY through `index.ts`.
- To depend on another module, add it to that module's `allowedImports` in
  `module-map.json`. Boundaries are generated from that file — do not touch
  `eslint.config.js`.
- Write tests under the module's `__tests__/` (see `TESTING.md`).

## 3. Verify

```bash
pnpm verify --agent
```

One exit code covers module-sync, format, lint (incl. boundaries), typecheck,
tests + coverage floor, ratchet, and dead-code. `--agent` prints a bounded,
file-grouped failure summary and writes a machine-readable snapshot to
`.task/last-verify.json` — use it as your iteration loop and fix until green.
Do not weaken thresholds to pass. If a failure looks unrelated to your change,
`pnpm verify --baseline` classifies each failing step as pre-existing (also
fails at HEAD) or introduced.

## 4. Ship

```bash
pnpm pr "feat: <concise title>"
```

Creates a branch, commits, pushes, opens a draft PR, and posts the checks link.

Report: the module(s) changed, what `pnpm verify` reported, and the PR URL.
