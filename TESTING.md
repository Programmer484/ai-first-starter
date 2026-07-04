# TESTING.md — test-generation playbook

How tests are written and generated in this repo. Vitest + v8 coverage; the
coverage floor is enforced by `pnpm verify`.

## 1. Where tests live

- One `__tests__/` folder per module: `src/modules/<name>/__tests__/`.
- File name mirrors the unit under test: `greeting.ts` → `greeting.test.ts`.
- Tests may import their **own** module's `internal/` files; they may import
  **other** modules only through `index.ts`.

## 2. What to test (in priority order)

1. **The public surface first.** Every export from `index.ts` gets at least one
   test. This is the contract other modules depend on.
2. **Branches and edge cases.** Empty/blank input, boundaries, error paths.
   Coverage floor is 80% (lines, branches, functions, statements) — write the
   branch test, don't chase the number.
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

## 4. Generating tests for a new module

`pnpm new-module <name>` scaffolds a passing starter test. Then:

- Add a test per public export.
- Add an edge-case test per branch you introduce.
- Run `pnpm coverage` to see what's uncovered; fill real gaps.

## 5. No-mock default

Prefer real inputs and pure functions. Reach for a mock only at a true
boundary (network, filesystem, clock). If a unit is hard to test without heavy
mocking, that's a design smell — push side effects to the edges.

## 6. Definition of done

- New/changed public exports have tests.
- New branches have tests.
- `pnpm verify` is green, including the coverage floor.
- No `.only`, no skipped tests, no commented-out assertions.
