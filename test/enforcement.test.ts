// Enforcement fixtures: one probe per enforceable CLAUDE.md rule. Each test
// plants a violation, runs the exact check that CLAUDE.md names for that rule,
// and asserts it fails WITH A READABLE MESSAGE — agents read these errors, so
// the message text is part of the contract.
//
// Not probed here: rule 1 (proven transitively — rules 2/3/4 pass only because
// the config is generated from the map), rule 6 (verify IS the check), and
// rule 7 (coverage floor — probing it means running vitest inside vitest;
// the threshold config in vitest.config.ts is exercised on every verify run).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, plantUnformattedProbe } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE = join(ROOT, 'src/modules/zz_probe');

afterEach(() => {
  rmSync(PROBE, { recursive: true, force: true });
  rmSync(join(ROOT, 'src/modules/_example/internal/zz_unused.ts'), { force: true });
});

describe.skipIf(process.env.ZZ_FAST_META)('rule 2: imports only via index.ts', () => {
  it('a deep import into another module internal/ fails lint, readably', () => {
    mkdirSync(PROBE, { recursive: true });
    const file = join(PROBE, 'index.ts');
    writeFileSync(
      file,
      "import { formatGreeting } from '../_example/internal/greeting.ts';\n" +
        "export const x = formatGreeting('hi');\n",
    );
    const { status, out } = run('pnpm', ['exec', 'eslint', '--no-ignore', file]);
    expect(status).not.toBe(0);
    expect(out).toContain('Deep import blocked');
    expect(out).toContain('index.ts'); // tells the agent the fix
  });
});

describe.skipIf(process.env.ZZ_FAST_META)(
  'rule 3: dependencies must be declared in module-map.json',
  () => {
    it('an undeclared cross-module import fails lint, naming the fix', () => {
      mkdirSync(PROBE, { recursive: true });
      const file = join(PROBE, 'index.ts');
      writeFileSync(
        file,
        "import { greet } from '../_example/index.ts';\nexport const x = greet('hi');\n",
      );
      const { status, out } = run('pnpm', ['exec', 'eslint', '--no-ignore', file]);
      expect(status).not.toBe(0);
      expect(out).toContain("may not import module '_example'");
      expect(out).toContain('allowedImports'); // the fix, by name
    });
  },
);

describe.skipIf(process.env.ZZ_FAST_META)(
  'rule 3 (external): allowedExternals restricts npm imports',
  () => {
    // Register the probe module in a DOCTORED map in tmp and point eslint at it
    // via the MODULE_MAP env seam (never mutate the real map — a live rewrite
    // races the parallel test files that lint/verify against the real repo).
    // Only the probe FILE is transient in the real tree, like the rule-3 probes.
    function lintProbe(
      allowedExternals: string[] | undefined,
      source: string,
    ): { status: number | null; out: string } {
      const map = JSON.parse(readFileSync(join(ROOT, 'module-map.json'), 'utf8'));
      const entry: Record<string, unknown> = {
        name: 'zz_probe',
        path: 'src/modules/zz_probe',
        description: 'probe',
        allowedImports: [],
      };
      if (allowedExternals !== undefined) entry.allowedExternals = allowedExternals;
      map.modules.push(entry);
      const tmp = mkdtempSync(join(tmpdir(), 'external-probe-'));
      const mapPath = join(tmp, 'module-map.json');
      writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
      mkdirSync(PROBE, { recursive: true });
      const file = join(PROBE, 'index.ts');
      writeFileSync(file, source);
      try {
        return run('pnpm', ['exec', 'eslint', '--no-ignore', file], {
          env: { MODULE_MAP: mapPath },
        });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }

    it('a pure module ([]) importing an npm package fails lint, naming the fix', () => {
      const { status, out } = lintProbe(
        [],
        "import react from 'react';\nexport const x = react;\n",
      );
      expect(status).not.toBe(0);
      expect(out).toContain("may not import external package 'react'");
      expect(out).toContain('allowedExternals'); // the fix, by name
    });

    it('importing a package on the allowlist passes lint', () => {
      const { status } = lintProbe(
        ['pixi.js'],
        "import * as PIXI from 'pixi.js';\nexport const x = PIXI;\n",
      );
      expect(status).toBe(0);
    });

    it('a module WITHOUT allowedExternals is unrestricted', () => {
      const { status } = lintProbe(
        undefined,
        "import react from 'react';\nexport const x = react;\n",
      );
      expect(status).toBe(0);
    });
  },
);

describe.skipIf(process.env.ZZ_FAST_META)(
  'rule 4: modules are created via new-module (map ↔ folders in sync)',
  () => {
    it('an unregistered module folder fails module-sync, readably', () => {
      mkdirSync(PROBE, { recursive: true });
      const { status, out } = run('node', ['scripts/module-sync.ts']);
      expect(status).not.toBe(0);
      expect(out).toContain('zz_probe exists but is not registered');
      expect(out).toContain('pnpm new-module'); // the fix, by name
    });

    it('a registered module whose folder is missing fails module-sync', () => {
      // Point module-sync at a doctored map via a probe copy? No — simplest
      // deterministic probe: temporarily register a ghost module.
      const mapPath = join(ROOT, 'module-map.json');
      const original = readFileSync(mapPath, 'utf8');
      const map = JSON.parse(original);
      map.modules.push({
        name: 'zz_ghost',
        path: 'src/modules/zz_ghost',
        description: 'probe',
        allowedImports: [],
      });
      writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
      try {
        const { status, out } = run('node', ['scripts/module-sync.ts']);
        expect(status).not.toBe(0);
        expect(out).toContain('zz_ghost');
        expect(out).toContain('does not exist');
      } finally {
        writeFileSync(mapPath, original);
      }
    });
  },
);

describe.skipIf(process.env.ZZ_FAST_META)(
  'rule 5: scope-guard blocks and logs out-of-scope edits',
  () => {
    // The hook resolves .task/ and edit-log.jsonl from the payload cwd, so a
    // scratch dir exercises the same code paths without touching the real
    // ledger — parallel test workers legitimately append to the real one.
    let scratch: string;
    let taskFile: string;
    let logFile: string;

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'zz-rule5-'));
      mkdirSync(join(scratch, '.task'), { recursive: true });
      taskFile = join(scratch, '.task/allowed-files.json');
      logFile = join(scratch, 'edit-log.jsonl');
    });

    afterEach(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    it('blocks with exit 2, explains scope, and appends to edit-log.jsonl', () => {
      writeFileSync(
        taskFile,
        JSON.stringify({ allow: ['src/modules/_example/**'] }, null, 2) + '\n',
      );
      const payload = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: join(scratch, 'scripts/verify.ts') },
        cwd: scratch,
      });
      const { status, out } = run('node', ['.claude/hooks/scope-guard.ts'], { input: payload });
      expect(status).toBe(2);
      expect(out).toContain('outside the current task scope');
      expect(out).toContain('pnpm scope'); // the fix, by name

      const logged = JSON.parse(readFileSync(logFile, 'utf8').trim().split('\n').at(-1)!);
      expect(logged.kind).toBe('scope-block');
      expect(logged.file).toBe('scripts/verify.ts');
    });

    it('allows in-scope edits with exit 0 and logs nothing', () => {
      writeFileSync(
        taskFile,
        JSON.stringify({ allow: ['src/modules/_example/**'] }, null, 2) + '\n',
      );
      const payload = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: join(scratch, 'src/modules/_example/index.ts') },
        cwd: scratch,
      });
      const { status } = run('node', ['.claude/hooks/scope-guard.ts'], { input: payload });
      expect(status).toBe(0);
      expect(existsSync(logFile)).toBe(false);
    });
  },
);

describe.skipIf(process.env.ZZ_FAST_META)('rule 9: canonical formatting', () => {
  it('an unformatted file fails the format check, naming the file', () => {
    const file = join(plantUnformattedProbe('zz_probe'), 'index.ts');
    const { status, out } = run('pnpm', ['exec', 'prettier', '--check', file]);
    expect(status).not.toBe(0);
    expect(out).toContain('zz_probe/index.ts');
  });
});

describe.skipIf(process.env.ZZ_FAST_META)('rule 8: no dead code', () => {
  it('an unused exported file fails knip, naming the file', () => {
    const file = join(ROOT, 'src/modules/_example/internal/zz_unused.ts');
    writeFileSync(file, 'export const zzUnused = 1;\n');
    const { status, out } = run('pnpm', ['exec', 'knip']);
    expect(status).not.toBe(0);
    expect(out).toContain('zz_unused.ts');
  });
});
