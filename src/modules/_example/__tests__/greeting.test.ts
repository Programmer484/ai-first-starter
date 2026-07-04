import { describe, it, expect } from 'vitest';
import { greet } from '../index.ts';
// Tests may reach into their own module's internals.
import { formatGreeting } from '../internal/greeting.ts';

describe('_example', () => {
  it('greets a named person', () => {
    expect(greet('Ada')).toEqual({ who: 'Ada', text: 'Hello, Ada!' });
  });

  it('falls back to "world" for blank input', () => {
    expect(formatGreeting('   ')).toBe('Hello, world!');
  });
});
