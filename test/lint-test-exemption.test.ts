// Tests may deep-import their OWN module's internal/ (boundaries treats
// same-element imports as no crossing), but deep-importing ANOTHER module's
// internal/ must still fail entry-point — no blanket test exemption exists.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OWN_PROBE = join(ROOT, 'src/modules/_example/__tests__/zz_own_internal.test.ts');
const PROBE_MODULE = join(ROOT, 'src/modules/zz_lint_probe');

function lint(file: string) {
  const res = spawnSync('pnpm', ['exec', 'eslint', '--no-ignore', file], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

afterEach(() => {
  rmSync(OWN_PROBE, { force: true });
  rmSync(PROBE_MODULE, { recursive: true, force: true });
});

describe('test files and boundaries/entry-point', () => {
  it('a test deep-importing its OWN module internal/ lints clean', () => {
    writeFileSync(
      OWN_PROBE,
      "import { formatGreeting } from '../internal/greeting.ts';\n" +
        "export const x = formatGreeting('hi');\n",
    );
    try {
      const { status, out } = lint(OWN_PROBE);
      expect(out).not.toContain('Deep import blocked');
      expect(status).toBe(0);
    } finally {
      rmSync(OWN_PROBE, { force: true });
    }
  });

  it("a test deep-importing ANOTHER module's internal/ fails entry-point", () => {
    const file = join(PROBE_MODULE, '__tests__/probe.test.ts');
    mkdirSync(join(PROBE_MODULE, '__tests__'), { recursive: true });
    writeFileSync(
      file,
      "import { formatGreeting } from '../../_example/internal/greeting.ts';\n" +
        "export const x = formatGreeting('hi');\n",
    );
    try {
      const { status, out } = lint(file);
      expect(status).not.toBe(0);
      expect(out).toContain('Deep import blocked');
    } finally {
      rmSync(PROBE_MODULE, { recursive: true, force: true });
    }
  });
});
