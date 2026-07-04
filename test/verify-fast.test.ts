// Meta-tests for `verify --fast` (affected-only inner loop) and the
// structured eslint summary in `--agent` mode. Own probe prefix (zz_fast_*)
// so parallel test files can't clobber each other.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FMT_PROBE = join(ROOT, 'src/modules/zz_fast_fmt');
const LINT_PROBE = join(ROOT, 'src/modules/zz_fast_lint');

function verify(args: string[]) {
  const res = spawnSync('node', ['scripts/verify.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // Marker so a nested `vitest --changed` (spawned by the full --fast run
    // below) skips the recursive test instead of forking forever.
    env: { ...process.env, ZZ_FAST_META: '1' },
  });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

afterEach(() => {
  rmSync(FMT_PROBE, { recursive: true, force: true });
  rmSync(LINT_PROBE, { recursive: true, force: true });
});

describe('verify --fast', () => {
  // retry: parallel test files plant transient probes that --fast picks up.
  it.skipIf(process.env.ZZ_FAST_META)(
    'exits 0 on a clean tree and prints the skipped-step notes',
    { retry: 2 },
    () => {
      const { status, out } = verify(['--fast']);
      expect(out).toContain('skipped in --fast');
      expect(status).toBe(0);
    },
  );

  it('fails format on an untracked unformatted probe, naming the file', () => {
    mkdirSync(FMT_PROBE, { recursive: true });
    writeFileSync(join(FMT_PROBE, 'index.ts'), 'export const zzFastFmt =    1\n');
    const { status, out } = verify(['format', '--fast']);
    expect(status).not.toBe(0);
    expect(out).toContain('zz_fast_fmt/index.ts');
  });
});

describe('verify --agent lint uses structured eslint output', () => {
  it('names the real file with the lint error, never node_modules', { retry: 2 }, () => {
    mkdirSync(LINT_PROBE, { recursive: true });
    // Prettier-clean but lint-dirty: unused variable.
    writeFileSync(join(LINT_PROBE, 'index.ts'), 'const zzFastUnused = 1;\nexport {};\n');
    const { status, out } = verify(['lint', '--agent']);
    expect(status).not.toBe(0);
    expect(out).toContain('zz_fast_lint/index.ts');
    expect(out).toContain('zzFastUnused');
    expect(out).not.toContain('node_modules');
  });
});
