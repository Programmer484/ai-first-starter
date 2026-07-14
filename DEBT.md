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

## DEBT-2: Quoted redirect targets bypass the bash always-block

severity: low — module: - — found: 2026-07-05 — status: fixed
fixed-by: life-game DEBT-5 patch upstreamed 2026-07-07 (quote-resolved always-block pass in scope-guard.ts)

`echo x > '.task/allowed-files.json'` escapes the scope-guard's always-block
on the scope file and the audit ledger because quote-stripping runs before
write-operand extraction, so a quoted redirect target vanishes before it can
be matched. Accepted for now: the Bash layer is an anti-accident heuristic,
not an adversary boundary (CLAUDE.md rule 5), and every escape is logged to
edit-log.jsonl; closing it would require a real shell tokenizer.

## DEBT-3: scope.ts slugs non-markdown file content into branch names

severity: low — module: - — found: 2026-07-07 — status: fixed
fixed-by: scope.ts slugSourceFor mines only `.md` files for content (2026-07-07)

`slugSourceFor` in scripts/scope.ts treats ANY existing file argument as a
spec and slugs its first "heading" or non-empty line into the branch name.
Its heading regex (`/^#+\s*\S/`) also matches a shebang, so
`pnpm scope scripts/pr.ts` yields `feature/usr-bin-env-node` — a meaningless
branch derived from `#!/usr/bin/env node`. Fix: only mine `.md` files for a
heading (fall back to the raw args otherwise), with a probe in
test/scope-resolver.test.ts. Not fixed here to keep the pr.ts branch-selection
change single-purpose.

## DEBT-4: pr.ts branch-selection has residual gaps and no stateful regression tests

severity: low — module: - — found: 2026-07-07 — status: fixed
fixed-by: branchExistsInGit ls-remote probe (a), unconditional `.task/branch` consume (b), sandboxed pr.ts integration tests (c) — 2026-07-14

Three low-severity gaps in the PR #9 branch-selection logic in scripts/pr.ts,
found by post-merge review and left unfixed as they are benign/mitigated: (a)
`branchExists` only probes fetched refs (`refs/heads/*`, `refs/remotes/origin/*`),
so an unfetched stale remote branch slips it — benign in practice because the
scope-file match plus consume-once deletion cover the reported incident and any
real collision fails loudly at `git push -u`, but the residual gap is
undocumented; (b) consume-once deletion of `.task/branch` only fires on the
`branch === taskBranch` path, so the `--branch` flag path and the
already-on-a-feature-branch path leave `.task/branch` behind (mitigated: the
next `pnpm scope` overwrites it); (c) the stateful branch logic in `main()`
(scope-JSON parse, git probes, `rmSync` ordering) has no regression tests —
only the pure `chooseBranch()` is covered.

## DEBT-5: pnpm pr shipped onto another session's checked-out branch

severity: medium — module: - — found: 2026-07-14 — status: fixed
fixed-by: checkShipBranch guard in scripts/pr.ts + sandboxed ship-branch integration tests — 2026-07-14

When `pnpm pr` ran from a non-default branch it assumed the checked-out
branch was the current task's branch and committed + pushed there
(`git add -A` on whatever HEAD the shared working tree happened to be on).
With two concurrent sessions sharing one working tree and one `.task/`,
session B's `pnpm pr` fast-forwarded its commit onto session A's freshly
created branch, mutating A's open PR (#19; restored via force-with-lease —
see PR #20's description, which surfaced the incident but did not log it).
Fixed by refusing to ship when the active scope records a different branch
than the one checked out; `--branch "<current>"` is the explicit override
and is logged to edit-log.jsonl as `pr-branch-override`.
