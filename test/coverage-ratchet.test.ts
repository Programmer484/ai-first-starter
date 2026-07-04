// Probes for the coverage-floor ratchet (CLAUDE.md rule 7). Each test spawns
// `node scripts/ratchet.ts` directly with env overrides — no shared repo
// state is touched, so these are safe under parallel workers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Derive the repo's current floor so these probes survive future ratcheting.
const config = readFileSync(ROOT + 'vitest.config.ts', 'utf8');
const current = Number(/thresholds[\s\S]*?lines:\s*(\d+)/.exec(config)![1]);

function ratchet(env: Record<string, string>) {
  return run('node', ['scripts/ratchet.ts'], { env });
}

const base = (lines: number) => `export default { coverage: { thresholds: { lines: ${lines} } } };`;

describe('rule 7: coverage floor only ratchets upward', () => {
  it('fails when the floor is lowered, naming both numbers and the rule', () => {
    const { status, out } = ratchet({ RATCHET_BASE_CONTENT: base(current + 10) });
    expect(status).toBe(1);
    expect(out).toContain('lowered');
    expect(out).toContain(String(current + 10));
    expect(out).toContain(String(current));
    expect(out).toContain('rule 7');
  });

  it('passes when the floor is unchanged', () => {
    const { status, out } = ratchet({ RATCHET_BASE_CONTENT: base(current) });
    expect(status).toBe(0);
    expect(out).toContain('ratchet: OK');
  });

  it('passes when the floor was raised', () => {
    const { status } = ratchet({ RATCHET_BASE_CONTENT: base(current - 10) });
    expect(status).toBe(0);
  });

  it('fails when a non-lines floor is lowered or removed, naming the key', () => {
    const withBranches = `export default { coverage: { thresholds: { lines: ${current}, branches: ${current + 10} } } };`;
    const { status, out } = ratchet({ RATCHET_BASE_CONTENT: withBranches });
    expect(status).toBe(1);
    expect(out).toContain('branches');
    expect(out).toContain(String(current + 10));
  });

  it('fails under RATCHET_REQUIRE when no baseline ref resolves', () => {
    const { status, out } = ratchet({ RATCHET_BASE: 'no-such-ref-zz', RATCHET_REQUIRE: '1' });
    expect(status).toBe(1);
    expect(out).toContain('git fetch origin main');
  });

  it('skip-passes when no baseline ref resolves', () => {
    // Empty string overrides any RATCHET_REQUIRE inherited from CI's env.
    const { status, out } = ratchet({ RATCHET_BASE: 'no-such-ref-zz', RATCHET_REQUIRE: '' });
    expect(status).toBe(0);
    expect(out).toContain('no baseline ref, skipping');
  });

  it('fails when the baseline has no thresholds.lines, naming the config', () => {
    const { status, out } = ratchet({ RATCHET_BASE_CONTENT: 'export default {};' });
    expect(status).toBe(1);
    expect(out).toContain('vitest.config.ts');
  });
});
