# .task/

Per-task working state for the agent pipeline.

- `allowed-files.json` — the set of paths the current task may edit, written by
  `pnpm scope <module-or-spec>` and enforced by the scope-guard PreToolUse hook.
  Git-ignored (machine-local). Regenerate it; don't hand-edit it.

Put a task spec here (e.g. `spec.md`) and run `pnpm scope .task/spec.md` to
derive the scope from the modules it mentions.
