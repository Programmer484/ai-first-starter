# FRAMEWORK.md — Directing agents on framework changes

This guide is for the **human** briefing an agent to change the framework
itself — the enforcement layer under `scripts/`, `.claude/hooks/`, `test/`,
and the config files that wire them together. App-code work is covered by
`CLAUDE.md` and `WORKING-MODES.md`; this document covers the layer those
rules run on, where the usual safety net has a hole (see "The green-verify
trap" below).

Read this before every framework task until it's familiar. The single most
important sentence in it: **a passing `pnpm verify` after a framework edit
proves nothing about the framework — only `pnpm test:framework` does.**

---

## 1. What counts as "the framework"

`framework-manifest.json` is the authoritative list — it names every
framework-owned path (it includes itself). In practice:

| Area                | Paths                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enforcement scripts | `scripts/*.ts`                                                                                                                                       |
| Runtime hooks       | `.claude/hooks/` (`scope-guard.ts`, `auto-format.ts`)                                                                                                |
| Skills              | `.claude/commands/`                                                                                                                                  |
| Agents              | `.claude/agents/` (agent definitions), `.claude/usage-guard/`                                                                                        |
| Self-tests          | `test/**`                                                                                                                                            |
| Configs             | `eslint.config.js`, `vitest.config.ts`, `vitest.framework.config.ts`, `knip.json`, `lefthook.yml`, `module-map.schema.json`, `.claude/settings.json` |
| Docs                | `CLAUDE.md`, `WORKING-MODES.md`, `TESTING.md`, this file                                                                                             |
| CI                  | `.github/workflows/ci.yml` (not in the manifest — host-side)                                                                                         |

Two consequences:

- **Everything in the manifest syncs downstream.** `scripts/sync-framework.ts`
  copies these paths into downstream projects. Files marked `adapt` in the
  manifest need per-project reconciliation after a sync; `skipIfExists`
  files (`DEBT.md`, `PREFERENCES.md`) carry the downstream user's history
  and are never overwritten. Framework edits must therefore be
  **framework-generic** — project-specific wording belongs in the
  downstream repo's delta, not here.
- **Adding a new framework file is a three-place change**: the file itself,
  a `framework-manifest.json` entry, and — if its changes should trigger
  self-tests on PRs — the path-filter regex in `.github/workflows/ci.yml`
  (see §5).
- **`package.json` is NOT in the manifest** — it never syncs downstream. A
  new framework script alias (e.g. `sync-framework`) added here does not
  propagate; each downstream repo adds the alias by hand once (or invokes
  `node scripts/sync-framework.ts` directly, since `scripts/` IS synced).
  See §8.

---

## 2. The green-verify trap

`pnpm verify` gates app code. The framework's own tests live in `test/**`
and are **deliberately excluded** from verify: they are probe tests that
plant doctored files in the live repo and spawn nested verify runs, which
would race feature work if they ran inside verify. Never "fix" this by
adding `test/**` to verify.

So after any framework edit:

```bash
pnpm test:framework   # the only check that exercises the enforcement layer
pnpm verify           # still required — framework files are also lint/format/knip targets
```

CI runs `test:framework` on a PR **only when the diff touches framework
paths** (per the `ci.yml` regex), and always on pushes to `main` as a
post-merge net. Do not rely on the post-merge net — that's discovering
breakage after it shipped.

**Standing rule for you as director: no framework PR merges without a
passing `pnpm test:framework` output pasted or linked in the PR body.**
Weaker agents will skip this step unless the briefing demands it
explicitly, because nothing in their local loop fails when they do.

---

## 3. Invariants — what must not change

Give these to the agent verbatim in the briefing. Any PR that touches one
of these needs your explicit sign-off _before_ the work starts, not at
review time.

1. **Verify is one script, run identically everywhere.** Pre-commit
   (lefthook), CI, and local all execute `scripts/verify.ts`. They must
   never diverge, and `--fast` must never be substituted into pre-commit
   or CI.
2. **`test/**` stays out of `pnpm verify`** (see §2).
3. **The ratchet is asymmetric.** Coverage floors only rise; gate profiles
   only strengthen (shell→polish→full); CI fails closed via
   `RATCHET_REQUIRE=1`. Any edit that lets the ratchet skip, soften, or
   compare against a friendlier baseline is the failure mode the framework
   exists to prevent.
4. **Single sources of truth stay single.** `COVERAGE_FLOOR` lives only in
   `scripts/gates.ts`; boundaries derive only from `module-map.json`. No
   change may reintroduce a second copy (hand-edited eslint boundary rules,
   hardcoded vitest thresholds).
5. **The scope guard's fail-direction is deliberate.** It fails open when
   unsure (it is a guardrail against accidents, not adversaries), except
   for the two always-blocked Bash targets: `.task/allowed-files.json` and
   `edit-log.jsonl`. Do not flip either direction "to be safe."
6. **Error message text is API.** Self-tests assert on messages, and
   `CLAUDE.md` quotes some verbatim (e.g. the `allowedExternals` error).
   Rewording an error is a coordinated change across the script, its test,
   and any doc that quotes it — never a drive-by.
7. **Test seams are load-bearing.** Scripts read `MODULE_MAP`,
   `MODULE_SRC_ROOT`, and `RATCHET_*` env vars so the probes can run
   hermetically against doctored inputs. An agent "simplifying away" an
   env-var read breaks the harness.
8. **The manifest's sync semantics protect downstream repos.** The manifest
   includes itself; `skipIfExists` and `adapt` annotations must survive any
   restructuring.
9. **Everything escape-hatch-shaped stays logged.** `ALLOW_MAIN_PUSH=1`,
   `pnpm pr --no-verify`, scope overrides — all write to `edit-log.jsonl`.
   New escape hatches must log too; existing logging must not be removed.

---

## 4. Triaging framework test failures — when is it safe to "ignore" one?

This is the judgement call you'll face most often: the agent changed
framework behavior on purpose, and `pnpm test:framework` now fails. The
short answer: **a failure is never ignored — it is either _expected and
updated_, _environmental and cleaned up_, or _a stop signal_.** Never
merge with a red `test:framework`, and never let an agent delete or skip a
test to get green.

### Step 1 — map the failure to the change

Test files map nearly 1:1 to the scripts they pin:

| Changed file                          | Tests that may legitimately fail                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `scripts/scope.ts`                    | `scope-resolver.test.ts`                                                                                  |
| `.claude/hooks/scope-guard.ts`        | `scope-guard-write-detection.test.ts`, `scope-guard-hardening.test.ts`                                    |
| `scripts/ratchet.ts`                  | `coverage-ratchet.test.ts`, `ratchet-gate-weakening.test.ts`                                              |
| `scripts/gates.ts`                    | `coverage-floor-per-module.test.ts`, `gate-profiles.test.ts`                                              |
| `scripts/module-sync.ts`              | `module-map-validation.test.ts`, `shell-gate-cap.test.ts`, `gate-profiles.test.ts`, `enforcement.test.ts` |
| `scripts/verify.ts`                   | `verify-agent-output.test.ts`, `verify-fast.test.ts`, `enforcement.test.ts`                               |
| `scripts/baseline.ts`                 | `verify-baseline.test.ts`                                                                                 |
| `scripts/debt.ts`                     | `debt-ledger.test.ts`                                                                                     |
| `scripts/pr.ts`                       | `pr-preview.test.ts`                                                                                      |
| `scripts/pre-push-guard.ts`           | `pre-push-guard.test.ts`                                                                                  |
| `scripts/sync-framework.ts`, manifest | `sync-framework.test.ts`                                                                                  |
| `scripts/no-stale-refs.ts`            | `no-stale-refs.test.ts`                                                                                   |
| `eslint.config.js`                    | `lint-test-exemption.test.ts`, `enforcement.test.ts`                                                      |

**A failing test that maps to a file the agent did NOT change is a stop
signal.** It means the blast radius exceeded the stated intent. Do not let
the agent "fix the test while we're here" — halt, understand, then either
widen the task deliberately or shrink the change.

### Step 2 — classify the failure

**(a) Expected: the test pins the old behavior you intentionally changed.**
Confirm the assertion that failed describes exactly the behavior in the
task brief — not something adjacent. Then the test is **updated in the
same PR** to pin the _new_ behavior, with the same strength of assertion.
Red flags that it's being gamed rather than updated:

- The assertion got weaker (`toContain` where `toBe` was; a message check
  deleted; an exit-code check dropped).
- The test was deleted, `.skip`ped, or its probe removed.
- The diff to the test is larger than the diff to the script — the agent
  is rewriting the spec to fit the code instead of checking the code
  against the spec.

**(b) Environmental: the run itself is polluted.** Safe to disregard only
after cleanup **and a green rerun**. Known pollution sources:

- **Leaked probes** — an interrupted `test:framework` run leaves probe
  dirs under `src/modules/` (unfamiliar module names, often unformatted
  single-file stubs). Symptom: `module-sync` or `format` failures naming a
  module nobody created. Fix: delete the probe dir, rerun.
- **Inherited env** — `RATCHET_*` vars set in your shell (the harness
  strips them, but scripts run outside the harness don't). Fix: unset,
  rerun.
- **Stale task state** — leftover `.task/allowed-files.json` pointing at a
  dead branch, or a dirty worktree the probes trip over. Fix: clean up,
  rerun.
- **Missing baseline** — ratchet tests needing `origin/main` in a shallow
  or offline checkout. Fix: `git fetch origin main`, rerun.

If cleanup + rerun is green, the failure was environmental; nothing to
update. If it recurs, it's not environmental — reclassify.

**(c) Everything else: a genuine regression.** The change broke behavior
it wasn't supposed to touch. The change gets fixed, not the test.

### Step 3 — the circularity caveat

The framework tests itself by spawning its own scripts, so _format_
changes count as behavior: rewording an error message, changing verify's
`--agent` summary layout, or reshaping `.task/last-verify.json` all
legitimately fail meta-tests. That is the system working. A weaker agent
will read these as "flaky tests" and try to loosen assertions — the
correct move is Step 2(a): update the pinned text to the new text, same
assertion strength, and update any doc (`CLAUDE.md`) that quotes it.

---

## 5. Foot-guns checklist

Things that go wrong even when everyone means well:

- **CI path-filter drift.** The regex in `ci.yml` decides which PRs run
  `test:framework`. A new framework config file not matched by it ships
  with its self-tests silently skipped until the post-merge run. When a PR
  adds a framework file, check the regex.
- **Downstream clobbering.** Edits to `adapt`-marked files (`CLAUDE.md`
  especially) create reconciliation work in every downstream repo on the
  next sync. Batch doc edits; keep them generic.
- **Coverage floor round-trips.** `COVERAGE_FLOOR` is per-project; a sync
  or a careless edit that changes it in `scripts/gates.ts` alters the gate
  for the whole repo. The ratchet will catch a _lowering_, but confirm the
  number in review anyway.
- **Scope for framework work.** `pnpm scope` resolves modules, and
  framework files aren't a module — agents typically work framework tasks
  with path-based scope (`pnpm scope --add scripts/ratchet.ts` style) or
  unscoped-with-nudge. Watch `pnpm edit-log` for repeated blocks: repeated
  blocks mean the scoping was wrong for the task, not that the agent
  should get creative.
- **Half-updated coordinated changes.** The recurring shape of framework
  bugs is a change that lands in the script but not its schema/validator/
  doc partner: `module-map.schema.json` vs `module-sync.ts` validation,
  error text vs `CLAUDE.md` quote, manifest entry vs actual file.

---

## 6. Briefing template

Paste-and-fill for the agent, per task:

```
Mode: PRD. Framework task — read FRAMEWORK.md §3 (invariants) first.

Change: <one sentence: the behavior to change and why>
Files you may touch: <scripts/x.ts, its test file(s) per the §4 table,
  and docs that quote its messages — nothing else>
Expected test impact: <which test/*.test.ts files should fail before your
  fix to them, per FRAMEWORK.md §4 — any other failure is a stop signal:
  report it and halt>

Non-negotiable:
- Run `pnpm test:framework` AND `pnpm verify`; both green before PR.
- Paste the test:framework output in the PR body.
- Update failing tests to pin the new behavior at the SAME assertion
  strength. Never delete, skip, or loosen a test.
- If you touch an error message, update its test and any CLAUDE.md quote
  in the same PR.
- Log anything you notice but don't fix in DEBT.md; do not fix it inline.
- Ship with `pnpm pr "<title>"`. Never push main; never use --no-verify
  or ALLOW_MAIN_PUSH.
```

## 7. Your review checklist

Before merging any framework PR:

- [ ] `pnpm test:framework` output in the PR body, green, and recent
      (matches the final commit).
- [ ] Every changed test maps to a changed script (§4 table) and the task
      brief predicted it.
- [ ] No test deleted, skipped, or weakened (diff the assertions, not just
      the pass/fail).
- [ ] Coordinated-change partners updated: schema ↔ validator, error text
      ↔ test ↔ CLAUDE.md quote, new file ↔ manifest ↔ `ci.yml` regex.
- [ ] `scripts/gates.ts` floor unchanged (unless raising it was the task).
- [ ] No new unlogged escape hatch; no logging removed.
- [ ] `pnpm edit-log` shows no repeated scope blocks or overrides during
      the task.
- [ ] Change is framework-generic (safe to sync downstream); `adapt` notes
      updated if the reconciliation story changed.

---

## 8. Pulling framework updates (downstream sync)

This section is for the reverse direction: you maintain a **downstream**
repo (one that was instantiated from this template) and want the latest
framework improvements pulled into it. The sync runs FROM the template,
copying framework-owned paths (per `framework-manifest.json`) INTO your
target repo. It never deletes target files and never touches app code.

**`FRAMEWORK.md`, `SUPERVISOR.md`, `WORKING-MODES.md`, and `TESTING.md` are
fully framework-owned** — a sync silently overwrites them. Do NOT customize
them in a downstream repo; any local prose edit is lost on the next sync.
Downstream-specific guidance belongs in the target's own docs (its `README`
or `PREFERENCES.md`), never in these files. (`SUPERVISOR.md` carries an
`adapt` note only so its doc/tool routing can be re-pointed at the target's
skills after a sync — that reconciliation, not free-form customization.)

Follow these steps in order:

1. **Dry-run from the template.** In the TEMPLATE repo, on a clean,
   up-to-date `main`:

   ```bash
   pnpm sync-framework <path-to-target> --dry-run
   ```

   Read the `added` / `updated` / `skipped` summary and the
   `NEEDS PER-PROJECT ADAPTATION:` list. Nothing is written yet.

2. **Run it for real.** Same command, without `--dry-run`:

   ```bash
   pnpm sync-framework <path-to-target>
   ```

3. **Reconcile every adapt-flagged file in the TARGET.** The sync
   overwrites these with the template's versions, so the target's
   per-project deltas must be restored by hand. Use `git diff` in the
   target to see exactly what the sync changed, then:
   - **`scripts/gates.ts`** — restore the target's `COVERAGE_FLOOR`. Never
     let a sync raise OR lower the floor silently.
   - **`CLAUDE.md`** — reapply the target's project-specific passages on top
     of the template's new base.
   - **`knip.json`** — MERGE: keep the target's extra entry/project globs
     and `ignoreDependencies` AND take the template's additions.
   - Any other file in the `NEEDS PER-PROJECT ADAPTATION:` list — reconcile
     per its `adapt` note.

   If a flagged file's only differences were the target's per-project deltas,
   its net `git diff` after you reapply them is EMPTY — the sync brought no
   new framework content for that file this round. That's expected, not a
   mistake: the flag marks files that _may_ need reconciliation, not files
   that always changed.

   > **⚠️ The #1 failure mode is shipping a sync without step 3.**
   > `pnpm verify` will NOT catch a silently raised coverage floor or
   > clobbered knip globs — a raised floor still passes verify (it's
   > stricter, not broken), and lost knip globs surface as unrelated
   > failures later. Do the reconciliation by hand, every time.

4. **Gate in the TARGET.** Both must be green:

   ```bash
   pnpm test:framework   # exercises the synced enforcement layer
   pnpm verify           # the app-code gate
   ```

5. **Ship from the TARGET.** Never push `main`:

   ```bash
   pnpm pr "framework: sync <summary> from template"
   ```

   `pnpm pr` re-runs the full `pnpm verify` before it pushes, so expect this
   step to take a minute or two even though you already ran the gate in
   step 4.

Note: `package.json` is not framework-synced (it is not in the manifest).
A downstream repo must add the `"sync-framework": "node
scripts/sync-framework.ts"` script alias once by hand — or just invoke
`node scripts/sync-framework.ts <target>` directly, which IS synced.
