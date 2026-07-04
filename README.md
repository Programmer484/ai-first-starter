# ai-first-starter

A TypeScript template built for agent-driven development. Architecture is
declared once in `module-map.json`; everything else — module boundaries,
scope enforcement, docs — follows from it.

## Quick start

```bash
pnpm install
pnpm verify          # lint + typecheck + test + boundaries + coverage + dead-code, one exit code
```

## The idea

- **`module-map.json` is the single source of truth.** ESLint boundary rules,
  the scope resolver, and module docs are all generated from it. Change
  architecture in one file.
- **Modules have a public surface.** Other modules import a module only through
  its `index.ts`; `internal/` is private and deep imports fail lint.
- **Tasks are scoped.** `pnpm scope <module>` writes `.task/allowed-files.json`;
  a Claude Code hook blocks edits outside it.
- **One gate.** `pnpm verify` runs locally and in CI and reports the same result.

## Common commands

| Command                     | What it does                                      |
| --------------------------- | ------------------------------------------------- |
| `pnpm new-module <name>`    | Scaffold + register a module in `module-map.json` |
| `pnpm scope <module\|spec>` | Write the allowed-files scope for a task          |
| `pnpm verify`               | Full quality gate, one exit code                  |
| `pnpm pr "<title>"`         | Branch, commit, push, open a draft PR             |
| `pnpm init:project <name>`  | Re-instantiate this template for a new project    |

## Agent pipeline

Run `/feature <description>` in Claude Code, or follow the pipeline in
`.claude/commands/feature.md` manually: **scope → implement → verify → PR**.

See `CLAUDE.md` for the rules and `TESTING.md` for the test playbook.
