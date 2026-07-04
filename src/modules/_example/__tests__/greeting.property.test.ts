import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { greet } from '../index.ts';

// WHEN TO REACH FOR A PROPERTY TEST:
// An example-based test pins one input to one expected output. A property test
// asserts an INVARIANT that must hold across a whole space of inputs, and
// fast-check generates hundreds of cases (then shrinks any failure to a
// minimal counterexample). Reach for it on logic-heavy modules — parsers,
// encoders, state machines, anything with branches and edge cases — where a
// single property replaces dozens of hand-picked examples and finds the inputs
// you didn't think of. Keep example tests too: they document the intended
// shape; properties guard the invariants.

describe('_example (property-based)', () => {
  it('echoes the original input in the who field, for any string', () => {
    fc.assert(
      fc.property(fc.string(), (who) => {
        expect(greet(who).who).toBe(who);
      }),
    );
  });

  it('contains the trimmed name whenever the input is non-blank', () => {
    fc.assert(
      fc.property(fc.string(), (who) => {
        const trimmed = who.trim();
        fc.pre(trimmed.length > 0);
        expect(greet(who).text).toContain(trimmed);
      }),
    );
  });

  it('falls back to "world" for any blank input', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\s*$/), (blank) => {
        expect(greet(blank).text).toBe('Hello, world!');
      }),
    );
  });
});
