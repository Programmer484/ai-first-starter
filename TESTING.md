# TESTING.md — test-generation playbook

How tests are written and generated in this repo. Vitest + v8 coverage; the
coverage floor is enforced by `pnpm verify`.

## 1. Where tests live

- One `__tests__/` folder per module: `src/modules/<name>/__tests__/`.
- File name mirrors the unit under test: `greeting.ts` → `greeting.test.ts`.
- Tests may deep-import their **own** module's `internal/` files (same-element
  imports aren't boundary crossings); they may import **other** modules only
  through `index.ts` — deep-importing another module's internals fails lint
  even from tests. There is no test exemption.

## 2. What to test (in priority order)

1. **The public surface first.** Every export from `index.ts` gets at least one
   test. This is the contract other modules depend on.
2. **Branches and edge cases.** Empty/blank input, boundaries, error paths.
   Coverage floor is 80% (lines, functions, branches, statements) — write the
   branch test, don't chase the number. (Polish-lane modules — `"gates": "polish"`
   in `module-map.json` — are excluded from the floor only; every other
   check still runs.)
3. **Internal units** only when the logic is non-trivial and hard to reach
   through the public API.

## 3. Shape of a test

```ts
import { describe, it, expect } from 'vitest';
import { greet } from '../index.ts';

describe('<module>', () => {
  it('does the expected thing', () => {
    expect(greet('Ada')).toEqual({ who: 'Ada', text: 'Hello, Ada!' });
  });
});
```

- One behaviour per `it`. Name it after the behaviour, not the function.
- Arrange / act / assert. No shared mutable state between tests.
- Assert on values, not on implementation details.

## 4. Finding existing suites (before you generate)

When the code implements a **shared spec or standard** — parsers (JSON, CSV,
semver), date/time math, protocols, encoders, Unicode handling — don't invent
cases. Someone has already written the hard ones.

1. Search for a **conformance / compliance suite** for the standard, plus the
   test suites of popular libraries that implement it.
2. **Check the license before vendoring.** Permissive (MIT/BSD/Apache) is
   fine; copyleft may not be. When in doubt, don't copy — reference.
3. Write a **thin adapter** that maps the suite's cases onto _your_ public API
   (`index.ts`). **Never fork the suite** — you want its updates, and a fork
   rots. The adapter is the only code you own.
4. **Record provenance here in TESTING.md** — source URL, version/commit,
   license, and the adapter's file path — so the next agent can audit it.

   _Provenance log (append as suites are adopted):_

   | Standard   | Source (repo @ version) | License | Adapter |
   | ---------- | ----------------------- | ------- | ------- |
   | _none yet_ |                         |         |         |

**Reality check:** product and game logic has no conformance suite — there is
no "standard" for your feature. For those, skip this section and generate
(§5).

## 5. Generating tests

`pnpm new-module <name>` scaffolds a passing starter test. Beyond that,
generation follows a strict doctrine:

- **Generate from the spec, never from the implementation.** Tests come from
  `.task/spec.md`, not from reading finished code. A test written by reading
  the implementation just blesses whatever the code already does — including
  its bugs — and asserts nothing about what it _should_ do.
- **Tests before code.** The pipeline enforces this at stage 3: the spec's
  tests exist and fail before the implementation is written, then the code
  makes them pass. This is what makes the tests a spec and not a mirror.
- **Property-based tests for logic-heavy modules.** Reach for
  [fast-check](https://fast-check.dev) when one invariant replaces dozens of
  hand-picked examples — parsers, encoders, state machines, anything with
  branches. See `src/modules/_example/__tests__/greeting.property.test.ts` for
  the pattern (and its header comment for _when_ to use it). Keep example
  tests alongside: examples document the intended shape, properties guard the
  invariants.

Then, for either style:

- Add a test per public export.
- Add an edge-case test per branch you introduce.
- Run `pnpm coverage` to see what's uncovered; fill real gaps.

## 6. Evaluating a suite

Coverage tells you a line _ran_, not that anything _checked_ its result — a
test with no assertions can execute every branch and catch nothing. The
objective metric is the **mutation score**.

- **Mutation score (Stryker).** `pnpm mutation` mutates the source (flips
  conditionals, deletes statements) and reports how many mutants your tests
  kill. It runs **CI-only** (it's slow). New modules need **≥60%** before the
  suite is trusted — the `break: 60` threshold in `stryker.config.mjs`, which
  ratchets upward like the coverage floor. A low score means assertion-free or
  vacuous tests.
- **Human review reads names and assertions, not bodies.** Scan the list of
  `it(...)` names and what each `expect` asserts. If the names don't read like
  the spec — a stranger couldn't reconstruct the requirements from them —
  reject the suite regardless of its coverage or mutation number.

## 7. No-mock default

Prefer real inputs and pure functions. Reach for a mock only at a true
boundary (network, filesystem, clock). If a unit is hard to test without heavy
mocking, that's a design smell — push side effects to the edges.

## 8. Definition of done

- New/changed public exports have tests.
- New branches have tests.
- `pnpm verify` is green, including the coverage floor.
- No `.only`, no skipped tests, no commented-out assertions.
