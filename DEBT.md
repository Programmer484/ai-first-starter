# Tech-debt ledger

Any bug or limitation discovered but not fixed in the current task —
including pre-existing ones found mid-task — gets an entry here, **in the
same PR** as the task that found it. The ledger is validated by the `debt`
verify step (`pnpm debt validate`); `pnpm debt` lists the open entries.

Entry format — one heading, one metadata line, one description paragraph:

```text
## DEBT-<n>: <title>
severity: low|medium|high — module: <name|-> — found: YYYY-MM-DD — status: open|fixed|wontfix

One paragraph: what is wrong, where it lives, and why it was not fixed in
the task that found it.
```

Rules: ids are unique and never reused; `module` is a module-map name, or `-`
for cross-cutting debt; entries are never deleted — flip `status` to `fixed`
(adding a `fixed-by: <ref>` line directly under the metadata line) or
`wontfix` instead, so the ledger stays a history.

## DEBT-1: Example entry showing the ledger format

severity: low — module: - — found: 2026-07-05 — status: wontfix

This entry exists so the format above stays self-documenting; it is not real
debt, which is why it is marked wontfix. Copy it (with the next free id) when
logging real debt: one heading, one metadata line, one paragraph saying what
is wrong, where it lives, and why it was left unfixed.
