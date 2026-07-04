// Probes for the coverage-floor ratchet (CLAUDE.md rule 7). Each test spawns
// `node scripts/ratchet.ts` directly with env overrides — no shared repo
// state is touched, so these are safe under parallel workers.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function ratchet(env: Record<string, string>) {
  const res = spawnSync('node', ['scripts/ratchet.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

const base = (lines: number) => `export default { coverage: { thresholds: { lines: ${lines} } } };`;

describe('rule 7: coverage floor only ratchets upward', () => {
  it('fails when the floor is lowered, naming both numbers and the rule', () => {
    const { status, out } = ratchet({ RATCHET_BASE_CONTENT: base(80) });
    expect(status).toBe(1);
    expect(out).toContain('lowered');
    expect(out).toContain('80');
    expect(out).toContain('70');
    expect(out).toContain('rule 7');
  });

  it('passes when the floor is unchanged', () => {
    const { status, out } = ratchet({ RATCHET_BASE_CONTENT: base(70) });
    expect(status).toBe(0);
    expect(out).toContain('ratchet: OK');
  });

  it('passes when the floor was raised', () => {
    const { status } = ratchet({ RATCHET_BASE_CONTENT: base(60) });
    expect(status).toBe(0);
  });

  it('skip-passes when no baseline ref resolves', () => {
    const { status, out } = ratchet({ RATCHET_BASE: 'no-such-ref-zz' });
    expect(status).toBe(0);
    expect(out).toContain('no baseline ref, skipping');
  });

  it('fails when the baseline has no thresholds.lines, naming the config', () => {
    const { status, out } = ratchet({ RATCHET_BASE_CONTENT: 'export default {};' });
    expect(status).toBe(1);
    expect(out).toContain('vitest.config.ts');
  });
});
