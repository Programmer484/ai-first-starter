// Probe tests for the framework sync tooling (framework-manifest.json +
// scripts/sync-framework.ts): the manifest points at real files, and a sync
// into a sandbox target copies framework files without clobbering the
// target's DEBT.md entries.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

type Entry = { path: string; dir?: boolean; skipIfExists?: boolean; adapt?: string };
const manifest = JSON.parse(readFileSync(join(ROOT, 'framework-manifest.json'), 'utf8')) as {
  files: Entry[];
};

describe('framework-manifest.json', () => {
  it('every listed path exists in the template', () => {
    for (const entry of manifest.files) {
      expect(existsSync(join(ROOT, entry.path)), entry.path).toBe(true);
    }
  });

  it('DEBT.md is skipIfExists so target entries are never clobbered', () => {
    const debt = manifest.files.find((e) => e.path === 'DEBT.md');
    expect(debt?.skipIfExists).toBe(true);
  });

  it('PREFERENCES.md is skipIfExists so user customizations are never clobbered', () => {
    const prefs = manifest.files.find((e) => e.path === 'PREFERENCES.md');
    expect(prefs?.skipIfExists).toBe(true);
  });
});

describe('sync-framework', () => {
  it('copies framework files into a target and preserves an existing DEBT.md', () => {
    const target = mkdtempSync(join(tmpdir(), 'sync-fw-'));
    const targetDebt = '# Tech-debt ledger\n\n## DEBT-1: Real target debt\n';
    writeFileSync(join(target, 'DEBT.md'), targetDebt);

    const { status, out } = run('node', ['scripts/sync-framework.ts', target]);
    expect(status).toBe(0);
    expect(existsSync(join(target, 'scripts/verify.ts'))).toBe(true);
    expect(existsSync(join(target, '.claude/hooks/scope-guard.ts'))).toBe(true);
    expect(readFileSync(join(target, 'CLAUDE.md'), 'utf8')).toBe(
      readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'),
    );
    // DEBT.md untouched
    expect(readFileSync(join(target, 'DEBT.md'), 'utf8')).toBe(targetDebt);
    expect(out).toContain('DEBT.md');
    expect(out).toContain('NEEDS PER-PROJECT ADAPTATION');
  });

  it('refuses a missing target with a usage error', () => {
    const { status } = run('node', ['scripts/sync-framework.ts']);
    expect(status).toBe(2);
  });
});
