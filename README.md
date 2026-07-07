# ai-first-starter

A TypeScript template built for agent-driven development. Architecture is
declared once in `module-map.json`; everything else — module boundaries,
scope enforcement, docs — follows from it.

## Quick start

```bash
pnpm install
pnpm verify          # lint + typecheck + test + boundaries + coverage + dead-code, one exit code
```

Setup checklist:

- **Protect the default branch.** `pnpm init:project` tries to enable GitHub
  branch protection (PRs required) via `gh api` — non-fatal if `gh` is missing
  or unauthenticated, so confirm it on the host. Locally, a lefthook `pre-push`
  guard (`scripts/pre-push-guard.ts`) refuses direct pushes of the default
  branch — ship with `pnpm pr` instead (`ALLOW_MAIN_PUSH=1` is the logged
  escape hatch).

## The idea

- **`module-map.json` is the single source of truth.** ESLint boundary rules,
  the scope resolver, and module docs are all generated from it. Change
  architecture in one file.
- **Modules have a public surface.** Other modules import a module only through
  its `index.ts`; `internal/` is private and deep imports fail lint.
- **Tasks are scoped.** `pnpm scope <module>` writes `.task/allowed-files.json`;
  a Claude Code hook blocks file-tool edits outside it and heuristically
  catches shell writes — a guardrail against accidents, not adversaries.
- **One gate.** `pnpm verify` runs locally and in CI and reports the same result.

## Common commands

| Command                           | What it does                                                        |
| --------------------------------- | ------------------------------------------------------------------- |
| `pnpm new-module <name>`          | Scaffold + register a module (`--gates polish` skips coverage only) |
| `pnpm scope <module\|spec>`       | Write the allowed-files scope for a task (replaces any prior scope) |
| `pnpm scope --add <module\|path>` | Widen the current scope                                             |
| `pnpm verify`                     | Full quality gate, one exit code                                    |
| `pnpm verify --agent`             | Same gate, bounded failure summary + `.task/last-verify.json`       |
| `pnpm verify --baseline`          | On failure, classify each step as pre-existing vs introduced        |
| `pnpm pr "<title>"`               | Branch, commit, push, open a draft PR (runs verify first)           |
| `pnpm edit-log`                   | Print the last 20 run-ledger records from `edit-log.jsonl`          |
| `pnpm init:project <name>`        | Re-instantiate this template for a new project                      |

## Agent pipeline

Run `/feature <description>` in Claude Code, or follow the pipeline in
`.claude/commands/feature.md` manually: **scope → implement →
verify --agent → PR**. Agents should iterate with `pnpm verify --agent` —
same checks, bounded file-grouped output, machine-readable snapshot.

## Documentation map

This README is the entry point; each doc below owns one concern. Agents read
the first group; humans supervising agents read the second.

**For agents (loaded or referenced every session):**

| Doc                      | Owns                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`              | The rules. Every rule maps to a named deterministic check; break it and verify or a hook fails with an actionable error.                                      |
| `WORKING-MODES.md`       | The two working modes — PRD (spec-driven, one scope + verify + PR per slice) and pair (turn-granularity iteration via `/feature`) — and each mode's contract. |
| `TESTING.md`             | The test playbook: what to test, through which surface, per gate profile.                                                                                     |
| `PREFERENCES.md`         | The user's plain-language agent-behavior preferences. Read at session start; maintained via `/customize`.                                                     |
| `module-map.schema.json` | The shape of `module-map.json` — modules, `allowedImports`, `allowedExternals`, `gates`.                                                                      |

**For the human operating the system:**

| Doc             | Owns                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPERVISOR.md` | Day-to-day operation: the observable artifacts (ledger, scope, verify snapshot), healthy-vs-unhealthy signals, how to steer agents, the 5-minute session review.                                    |
| `FRAMEWORK.md`  | Changing the framework itself (`scripts/`, hooks, configs): invariants that must not change, the `test:framework` rule, triaging framework test failures, agent briefing template, merge checklist. |
| `DEBT.md`       | The deferred-work ledger. Append-only history — entries flip status (`fixed`/`wontfix`), never disappear.                                                                                           |

`framework-manifest.json` defines which of these files are framework-owned
and sync to downstream projects (`scripts/sync-framework.ts`).
