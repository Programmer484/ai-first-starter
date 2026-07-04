// Probe tests for scripts/scope.ts: --add merge widening, catch-all refusal,
// scope-set ledger records, and the unscoped-ack reset. Follows the
// enforcement.test.ts pattern — run the script as a subprocess, assert on
// output/exit code, and restore all touched state.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const taskFile = join(ROOT, '.task/allowed-files.json');
const logFile = join(ROOT, 'edit-log.jsonl');
const ackFile = join(ROOT, '.task/.unscoped-ack');

function scope(...args: string[]) {
  const res = spawnSync('node', ['scripts/scope.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

afterEach(() => {
  rmSync(taskFile, { force: true });
  rmSync(logFile, { force: true });
  rmSync(ackFile, { force: true });
});

describe('scope --add merges into the existing allow set', () => {
  it('union of allow, matchedModules, and a combined spec', () => {
    expect(scope('_example').status).toBe(0);
    expect(scope('zz/nonexistent.ts', '--add').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.allow).toContain('src/modules/_example/**');
    expect(payload.allow).toContain('zz/nonexistent.ts');
    expect(payload.matchedModules).toContain('_example');
    expect(payload.spec).toBe('_example + zz/nonexistent.ts');
  });
});

describe('scope without --add replaces the allow set', () => {
  it('a plain re-run drops previously allowed entries', () => {
    expect(scope('_example').status).toBe(0);
    expect(scope('zz/nonexistent.ts').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.allow).not.toContain('src/modules/_example/**');
    expect(payload.allow).toContain('zz/nonexistent.ts');
  });
});

describe('scope refuses catch-all globs', () => {
  it('exits 2 and names the fix', () => {
    const { status, out } = scope('**');
    expect(status).toBe(2);
    expect(out).toContain('refusing catch-all scope "**"');
    expect(out).toContain('pnpm scope <module|path> [--add]'); // the fix, by name
    expect(existsSync(taskFile)).toBe(false);
  });
});

describe('scope appends a ledger record', () => {
  it('a successful run logs a scope-set record with args', () => {
    expect(scope('_example').status).toBe(0);
    const logged = JSON.parse(readFileSync(logFile, 'utf8').trim().split('\n').at(-1)!);
    expect(logged.kind).toBe('scope-set');
    expect(logged.add).toBe(false);
    expect(logged.args).toEqual(['_example']);
    expect(logged.matchedModules).toEqual(['_example']);
  });
});

describe('scope resets the unscoped-ack marker', () => {
  it('deletes a pre-existing .task/.unscoped-ack', () => {
    mkdirSync(join(ROOT, '.task'), { recursive: true });
    writeFileSync(ackFile, '');
    expect(scope('_example').status).toBe(0);
    expect(existsSync(ackFile)).toBe(false);
  });
});
