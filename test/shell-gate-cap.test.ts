// Meta-tests for the `shell` gate profile (module-sync.ts): like `polish`, a
// `"gates": "shell"` module opts out of the coverage floor — but it is
// additionally capped at 200 non-test source lines, so a shell stays thin or
// gets promoted to a full module. Same doctored-map + sandboxed src-root
// pattern as gate-profiles.test.ts: nothing here touches the real
// module-map.json or src/modules/.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run, runModuleSyncWith } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_MAP = JSON.parse(readFileSync(join(ROOT, 'module-map.json'), 'utf8'));

type LooseMap = { modules: Array<Record<string, unknown>> };

const tmp = mkdtempSync(join(tmpdir(), 'shell-gate-cap-'));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// Build a sandboxed map + src root with a single `zz_shell` module (gates:
// "shell") whose index.ts has exactly `lines` lines (counting a trailing
// newline as terminating the last line, not starting a new one — the same
// convention module-sync.ts uses), then run module-sync against it.
function runShellProbe(lines: number, testFileLines = 0) {
  const map: LooseMap = JSON.parse(JSON.stringify(REAL_MAP));
  map.modules.push({
    name: 'zz_shell',
    path: 'src/modules/zz_shell',
    description: 'probe',
    allowedImports: [],
    gates: 'shell',
  });
  // afterEach removes the whole tmp dir; recreate it so every test gets a
  // fresh, existing dir (mkdtempSync ran only once at module scope).
  mkdirSync(tmp, { recursive: true });
  const mapPath = join(tmp, 'module-map.json');
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');

  const srcRoot = join(tmp, 'src-root');
  for (const m of map.modules) {
    mkdirSync(join(srcRoot, 'src/modules', m.name as string), { recursive: true });
  }
  const moduleDir = join(srcRoot, 'src/modules/zz_shell');
  const body = Array.from({ length: lines }, (_, i) => `export const zz_${i} = ${i};`).join('\n');
  writeFileSync(join(moduleDir, 'index.ts'), lines === 0 ? '' : body + '\n');

  if (testFileLines > 0) {
    mkdirSync(join(moduleDir, '__tests__'), { recursive: true });
    const testBody = Array.from({ length: testFileLines }, (_, i) => `// line ${i}`).join('\n');
    writeFileSync(join(moduleDir, '__tests__/zz_shell.test.ts'), testBody + '\n');
  }

  return run('node', ['scripts/module-sync.ts'], {
    env: { MODULE_MAP: mapPath, MODULE_SRC_ROOT: srcRoot },
  });
}

describe('module-sync: gates "shell" size cap', () => {
  it('accepts a shell module at exactly the 200-line cap', () => {
    const { status } = runShellProbe(200);
    expect(status).toBe(0);
  });

  it('rejects a shell module over the 200-line cap, naming the count and the fix', () => {
    const { status, out } = runShellProbe(201);
    expect(status).not.toBe(0);
    expect(out).toContain('zz_shell');
    expect(out).toContain('gates: "shell"');
    expect(out).toContain('201');
    expect(out).toContain('200');
    expect(out).toContain('gates: "full"');
  });

  it('does not count lines under __tests__/ against the cap', () => {
    const { status } = runShellProbe(150, 5000);
    expect(status).toBe(0);
  });
});

describe('module-sync gates validation: "shell" profile', () => {
  it('accepts `"gates": "shell"` with no unknown-key warning', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.gates = 'shell';
    });
    expect(status).toBe(0);
    expect(out).not.toContain('unknown key');
  });

  it('rejects an invalid gates value, naming full | polish | shell', () => {
    const { status, out } = runModuleSyncWith((map) => {
      map.modules[0]!.gates = 'sometimes';
    });
    expect(status).toBe(1);
    expect(out).toContain('full | polish | shell');
  });
});
