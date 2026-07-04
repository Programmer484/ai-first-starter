// Meta-tests for the module-map.json shape validator in scripts/module-sync.ts.
// Doctored-map probe pattern (from enforcement.test.ts): start from the real
// map, write a doctored copy, run module-sync, assert on the named error.
//
// Unlike enforcement.test.ts we write the doctored copy to a TEMP file and
// point module-sync at it via MODULE_MAP, so these tests never mutate the
// shared module-map.json — safe to run in parallel with the other probes.
import { describe, it, expect } from 'vitest';
import { runModuleSyncWith } from './helpers.ts';

describe('module-map.json shape validation', () => {
  it('a misspelled `allowedImport` key fails, naming `allowedImports`', () => {
    const { status, out } = runModuleSyncWith((map) => {
      const m = map.modules[0]!;
      m.allowedImport = m.allowedImports;
      delete m.allowedImports;
    });
    expect(status).not.toBe(0);
    expect(out).toContain('allowedImports');
  });

  it('an allowedImports entry naming a nonexistent module fails, naming it', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.allowedImports = ['zz_nonexistent'];
    });
    expect(status).not.toBe(0);
    expect(out).toContain('zz_nonexistent');
  });

  it('a self-import fails', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.allowedImports = [map.modules[0]!.name];
    });
    expect(status).not.toBe(0);
    expect(out).toContain('self-import');
  });

  it('a `path` not matching src/modules/<name> fails, showing the expected path', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.path = 'src/modules/wrong';
    });
    expect(status).not.toBe(0);
    expect(out).toContain('src/modules/_example');
  });

  it('an unknown extra key passes (exit 0) with a warning naming the key', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.zz_unknown_key = { coverage: 80 };
    });
    expect(status).toBe(0);
    expect(out).toContain('zz_unknown_key');
  });

  it('the valid map passes validation', () => {
    const { status } = runModuleSyncWith(() => {});
    expect(status).toBe(0);
  });
});
