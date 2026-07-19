// Probe tests for scripts/scope.ts: --add merge widening, catch-all refusal,
// scope-set ledger records, and the unscoped-ack reset. Follows the
// enforcement.test.ts pattern — run the script as a subprocess and assert on
// output/exit code. Runs against a mkdtemp sandbox (SCOPE_ROOT / EDIT_LOG
// overrides), never the real repo's .task or ledger.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from './helpers.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(REPO, 'scripts/scope.ts');

let root: string;
let taskFile: string;
let logFile: string;
let ackFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'scope-test-'));
  copyFileSync(join(REPO, 'module-map.json'), join(root, 'module-map.json'));
  taskFile = join(root, '.task/allowed-files.json');
  logFile = join(root, 'edit-log.jsonl');
  ackFile = join(root, '.task/.unscoped-ack');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function scope(...args: string[]) {
  return run('node', [scriptPath, ...args], {
    cwd: root,
    env: { SCOPE_ROOT: root, EDIT_LOG: logFile },
  });
}

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

  it('an existing file mentioning a module allows both the module glob and the literal path', () => {
    writeFileSync(join(root, 'blocked.ts'), '// touches _example module\n');
    expect(scope('blocked.ts', '--add').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.allow).toContain('src/modules/_example/**');
    expect(payload.allow).toContain('blocked.ts');
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

describe('scope expands a directory arg to a /** glob', () => {
  it('an existing directory yields <dir>/** in the allow list', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    expect(scope('scripts').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.allow).toContain('scripts/**');
    expect(payload.allow).not.toContain('scripts');
  });

  it('trailing-slash and no-slash forms yield the same glob', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    expect(scope('scripts/').status).toBe(0);
    const slashed = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(scope('scripts').status).toBe(0);
    const plain = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(slashed.allow).toContain('scripts/**');
    expect(slashed.allow).toEqual(plain.allow);
  });

  it('a directory that derives a catch-all is refused with exit 2', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    const { status, out } = scope('src');
    expect(status).toBe(2);
    expect(out).toContain('refusing catch-all scope "src/**"');
    expect(out).toContain('pnpm scope <module|path> [--add]');
    expect(existsSync(taskFile)).toBe(false);
  });

  it('--add <directory> widens an existing scope with the /** glob', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    expect(scope('_example').status).toBe(0);
    expect(scope('scripts', '--add').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.allow).toContain('src/modules/_example/**');
    expect(payload.allow).toContain('scripts/**');
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
    mkdirSync(join(root, '.task'), { recursive: true });
    writeFileSync(ackFile, '');
    expect(scope('_example').status).toBe(0);
    expect(existsSync(ackFile)).toBe(false);
  });
});

describe('scope derives a branch name', () => {
  it('slugs a module-name arg into feature/<slug> and writes .task/branch', () => {
    expect(scope('_example').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.branch).toBe('feature/example');
    const branchFile = join(root, '.task/branch');
    expect(readFileSync(branchFile, 'utf8')).toBe(`${payload.branch}\n`);
  });

  it('derives the slug from a spec file heading, not the file path', () => {
    writeFileSync(join(root, 'spec.md'), '# Add Widget Support\n\ntouches _example module\n');
    expect(scope('spec.md').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.branch).toBe('feature/add-widget-support');
  });

  it('slugs from the arg path, not file content, for a non-.md file with a shebang', () => {
    // DEBT-3: `/^#+\s*\S/` matched a shebang, so a .ts arg yielded a branch
    // slugged from `#!/usr/bin/env node`. Only .md files are mined now.
    writeFileSync(join(root, 'pr.ts'), '#!/usr/bin/env node\nconsole.log(1);\n');
    expect(scope('pr.ts').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.branch).toBe('feature/pr-ts');
  });

  it('falls back to the first non-empty line when a spec file has no heading', () => {
    writeFileSync(join(root, 'spec.md'), '\n  Fix login bug for real users  \nmore detail\n');
    expect(scope('spec.md').status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.branch).toBe('feature/fix-login-bug-for-real-users');
  });

  it('sanitizes punctuation/whitespace and truncates the slug to 40 chars', () => {
    const longArg = 'Add Support For The Really Long Feature Name!!!';
    expect(scope(longArg).status).toBe(0);
    const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(payload.branch.startsWith('feature/')).toBe(true);
    const slug = payload.branch.slice('feature/'.length);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).not.toMatch(/^-|-$/);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('--add keeps the existing branch instead of regenerating it', () => {
    expect(scope('_example').status).toBe(0);
    const first = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(scope('zz/nonexistent.ts', '--add').status).toBe(0);
    const second = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(second.branch).toBe(first.branch);
    const branchFile = join(root, '.task/branch');
    expect(readFileSync(branchFile, 'utf8')).toBe(`${first.branch}\n`);
  });
});
