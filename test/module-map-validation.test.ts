// Meta-tests for the module-map.json shape validator in scripts/module-sync.ts.
// Doctored-map probe pattern (from enforcement.test.ts): start from the real
// map, write a doctored copy, run module-sync, assert on the named error.
//
// Unlike enforcement.test.ts we write the doctored copy to a TEMP file and
// point module-sync at it via MODULE_MAP, so these tests never mutate the
// shared module-map.json — safe to run in parallel with the other probes.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_MAP = JSON.parse(readFileSync(join(ROOT, 'module-map.json'), 'utf8'));

const tmp = mkdtempSync(join(tmpdir(), 'module-map-'));
const doctoredPath = join(tmp, 'module-map.json');
afterEach(() => rmSync(doctoredPath, { force: true }));

// Write a doctored copy of the real map and run module-sync against it in a
// sandboxed src root whose folders mirror the doctored map's modules — so a
// passing map is in folder-sync too, independent of the real repo's folders.
type LooseMap = { modules: Array<Record<string, unknown>> };
function runWith(mutate: (map: LooseMap) => void) {
  const map = JSON.parse(JSON.stringify(REAL_MAP));
  mutate(map);
  writeFileSync(doctoredPath, JSON.stringify(map, null, 2) + '\n');
  const srcRoot = join(tmp, 'src-root');
  rmSync(srcRoot, { recursive: true, force: true });
  for (const m of map.modules) {
    if (typeof m.name === 'string')
      mkdirSync(join(srcRoot, 'src/modules', m.name), { recursive: true });
  }
  mkdirSync(join(srcRoot, 'src/modules'), { recursive: true });
  const res = spawnSync('node', ['scripts/module-sync.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MODULE_MAP: doctoredPath, MODULE_SRC_ROOT: srcRoot },
  });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

describe('module-map.json shape validation', () => {
  it('a misspelled `allowedImport` key fails, naming `allowedImports`', () => {
    const { status, out } = runWith((map) => {
      const m = map.modules[0]!;
      m.allowedImport = m.allowedImports;
      delete m.allowedImports;
    });
    expect(status).not.toBe(0);
    expect(out).toContain('allowedImports');
  });

  it('an allowedImports entry naming a nonexistent module fails, naming it', () => {
    const { status, out } = runWith((map) => {
      map.modules[0]!.allowedImports = ['zz_nonexistent'];
    });
    expect(status).not.toBe(0);
    expect(out).toContain('zz_nonexistent');
  });

  it('a self-import fails', () => {
    const { status, out } = runWith((map) => {
      map.modules[0]!.allowedImports = [map.modules[0]!.name];
    });
    expect(status).not.toBe(0);
    expect(out).toContain('self-import');
  });

  it('a `path` not matching src/modules/<name> fails, showing the expected path', () => {
    const { status, out } = runWith((map) => {
      map.modules[0]!.path = 'src/modules/wrong';
    });
    expect(status).not.toBe(0);
    expect(out).toContain('src/modules/_example');
  });

  it('an unknown extra key passes (exit 0) with a warning naming the key', () => {
    const { status, out } = runWith((map) => {
      map.modules[0]!.gates = { coverage: 80 };
    });
    expect(status).toBe(0);
    expect(out).toContain('gates');
  });

  it('the valid map passes validation', () => {
    const { status } = runWith(() => {});
    expect(status).toBe(0);
  });
});
