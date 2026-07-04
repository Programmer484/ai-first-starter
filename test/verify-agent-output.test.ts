// Meta-tests for `verify --agent`: bounded failure summaries, the
// .task/last-verify.json snapshot (overwrite, never append), unchanged
// default-mode behavior, and the apiSurface ledger field. Probe pattern as in
// enforcement.test.ts, but with its own probe dir (zz_probe_agent) so the two
// files can't clobber each other when vitest runs them in parallel.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE = join(ROOT, 'src/modules/zz_probe_agent');
const SNAPSHOT = join(ROOT, '.task/last-verify.json');

function verify(args: string[]) {
  const res = spawnSync('node', ['scripts/verify.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

function plantUnformattedProbe() {
  mkdirSync(PROBE, { recursive: true });
  writeFileSync(join(PROBE, 'index.ts'), 'export const x =    1\n');
}

afterEach(() => {
  rmSync(PROBE, { recursive: true, force: true });
  rmSync(SNAPSHOT, { force: true });
});

describe('verify --agent: bounded failure output', () => {
  it('names the failing file, stays bounded, and writes the snapshot', () => {
    plantUnformattedProbe();
    const { status, out } = verify(['format', '--agent']);
    expect(status).not.toBe(0);
    expect(out).toContain('zz_probe_agent/index.ts');
    // Bounded: far under a raw prettier/vitest dump.
    expect(out.trimEnd().split('\n').length).toBeLessThan(80);

    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    expect(snap.failed).toContain('format');
    expect(snap.summaryByStep.format.totalErrors).toBeGreaterThan(0);
  });
});

describe('verify --agent: snapshot overwrite semantics', () => {
  it('two runs leave exactly one snapshot document, the latest', () => {
    plantUnformattedProbe();
    verify(['format', '--agent']);
    const first = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    verify(['format', '--agent']);
    // JSON.parse would throw on an appended second document.
    const second = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    expect(second.failed).toContain('format');
    expect(second.ts >= first.ts).toBe(true);
  });
});

describe('verify default mode is unchanged', () => {
  // retry: enforcement.test.ts plants transient unformatted probes in a
  // parallel worker; a rare overlap makes a clean-tree run fail once.
  it('exits 0 on a clean tree with no summary block', { retry: 2 }, () => {
    const { status, out } = verify(['format']);
    expect(status).toBe(0);
    expect(out).toContain('verify: PASS');
    expect(out).not.toContain('(general)');
    expect(out).not.toContain('error lines across');
  });
});

describe('apiSurface in the run ledger', () => {
  // retry: enforcement.test.ts deletes edit-log.jsonl in a parallel worker.
  it('module-sync run appends apiSurface with an _example count', { retry: 2 }, () => {
    verify(['module-sync']);
    const lastLine = readFileSync(join(ROOT, 'edit-log.jsonl'), 'utf8').trim().split('\n').at(-1)!;
    const record = JSON.parse(lastLine);
    expect(record.kind).toBe('verify');
    expect(record.apiSurface._example).toBeGreaterThanOrEqual(1);
  });
});
