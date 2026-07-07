// Probe for the "no-stale-refs" verify step (scripts/no-stale-refs.ts):
// src/** must not reference `.task/` — that directory is gitignored and
// per-task, so a comment pointing at it rots the moment the task ends.
// Same live-tree probe pattern as test/enforcement.test.ts (plant a zz_*
// probe directly under src/modules/, run the real check, clean up in
// afterEach) — this check only reads files, so it is safe alongside
// sibling probes under parallel workers.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE = join(ROOT, 'src/modules/zz_stale_refs_probe');

afterEach(() => {
  rmSync(PROBE, { recursive: true, force: true });
});

function noStaleRefs() {
  return run('node', ['scripts/no-stale-refs.ts']);
}

describe('no-stale-refs', () => {
  it('fails when a file under src/** contains a `.task/` reference, naming the file', () => {
    mkdirSync(PROBE, { recursive: true });
    const file = join(PROBE, 'index.ts');
    writeFileSync(
      file,
      "// see .task/last-verify.json for the last run's summary\n" + 'export const x = 1;\n',
    );
    const { status, out } = noStaleRefs();
    expect(status).not.toBe(0);
    expect(out).toContain('zz_stale_refs_probe/index.ts');
    expect(out).toContain('.task/');
  });

  it('finds a `.task/` reference nested under a subdirectory too', () => {
    mkdirSync(join(PROBE, 'internal'), { recursive: true });
    const file = join(PROBE, 'internal/thing.ts');
    writeFileSync(file, "const stale = '.task/allowed-files.json';\n");
    const { status, out } = noStaleRefs();
    expect(status).not.toBe(0);
    expect(out).toContain('zz_stale_refs_probe/internal/thing.ts');
  });

  it('passes when nothing under src/** mentions `.task/`', () => {
    mkdirSync(PROBE, { recursive: true });
    writeFileSync(join(PROBE, 'index.ts'), 'export const x = 1;\n');
    const { status, out } = noStaleRefs();
    expect(status).toBe(0);
    expect(out).toContain('OK');
  });
});
