// Probe tests for the tech-debt ledger (DEBT.md + scripts/debt.ts) and its
// wiring: the `debt` verify step and the DEBT.md scope seeding. Sandboxed via
// DEBT_ROOT / SCOPE_ROOT so no probe touches the real ledger.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function validate(debtText: string): { status: number | null; out: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'debt-'));
  writeFileSync(join(tmp, 'DEBT.md'), debtText);
  return run('node', ['scripts/debt.ts', 'validate'], { env: { DEBT_ROOT: tmp } });
}

const GOOD_ENTRY = `## DEBT-7: Something is broken
severity: high — module: - — found: 2026-07-05 — status: open

A paragraph describing the problem.
`;

describe('debt validate', () => {
  it('passes on the real seeded DEBT.md', () => {
    const { status, out } = run('node', ['scripts/debt.ts', 'validate']);
    expect(out).toContain('debt: OK');
    expect(status).toBe(0);
  });

  it('passes on a minimal well-formed entry', () => {
    const { status } = validate(GOOD_ENTRY);
    expect(status).toBe(0);
  });

  it('fails on duplicate ids with a named error', () => {
    const { status, out } = validate(GOOD_ENTRY + '\n' + GOOD_ENTRY);
    expect(status).toBe(1);
    expect(out).toContain('duplicate-id');
    expect(out).toContain('DEBT-7');
  });

  it('fails on an invalid status with a named error', () => {
    const bad = GOOD_ENTRY.replace('status: open', 'status: maybe');
    const { status, out } = validate(bad);
    expect(status).toBe(1);
    expect(out).toContain('invalid-status');
  });

  it('fails on an invalid severity with a named error', () => {
    const bad = GOOD_ENTRY.replace('severity: high', 'severity: catastrophic');
    const { status, out } = validate(bad);
    expect(status).toBe(1);
    expect(out).toContain('invalid-severity');
  });

  it('fails on status fixed without a fixed-by line', () => {
    const bad = GOOD_ENTRY.replace('status: open', 'status: fixed');
    const { status, out } = validate(bad);
    expect(status).toBe(1);
    expect(out).toContain('missing-fixed-by');
  });

  it('accepts status fixed when fixed-by follows the metadata line', () => {
    const good = GOOD_ENTRY.replace('status: open\n', 'status: fixed\nfixed-by: #99\n');
    const { status } = validate(good);
    expect(status).toBe(0);
  });

  it('fails on a malformed heading', () => {
    const { status, out } = validate('## DEBT-x: no numeric id\n');
    expect(status).toBe(1);
    expect(out).toContain('bad-heading');
  });

  it('lists open entries in default mode', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'debt-'));
    writeFileSync(join(tmp, 'DEBT.md'), GOOD_ENTRY);
    const { status, out } = run('node', ['scripts/debt.ts'], { env: { DEBT_ROOT: tmp } });
    expect(status).toBe(0);
    expect(out).toContain('DEBT-7');
    expect(out).toContain('1 open');
  });
});

describe('debt wiring', () => {
  it('verify.ts includes a debt step', () => {
    // The unknown-step error prints the authoritative step list.
    const { status, out } = run('node', ['scripts/verify.ts', 'zz-no-such-step']);
    expect(status).toBe(2);
    expect(out).toMatch(/Known: .*\bdebt\b/);
  });

  it('scope output seeds DEBT.md into every allow-set', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'scope-debt-'));
    copyFileSync(join(ROOT, 'module-map.json'), join(tmp, 'module-map.json'));
    mkdirSync(join(tmp, '.task'), { recursive: true });
    const { status } = run('node', ['scripts/scope.ts', 'zz-nonexistent-path'], {
      env: { SCOPE_ROOT: tmp },
    });
    expect(status).toBe(0);
    const payload = JSON.parse(readFileSync(join(tmp, '.task/allowed-files.json'), 'utf8'));
    expect(payload.allow).toContain('DEBT.md');
  });
});
