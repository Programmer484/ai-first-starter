// Hardening probes for the scope-guard hook: self-edit deny, repeat-block
// escalation, the Bash write heuristic, and the one-time unscoped nudge.
// Each test spawns the hook as a subprocess with a JSON payload on stdin
// (same pattern as enforcement.test.ts rule 5), but points the payload's cwd
// at a scratch temp dir — the hook resolves .task/allowed-files.json,
// edit-log.jsonl, and the ack marker against cwd, so this avoids racing
// enforcement.test.ts (vitest runs files in parallel) and can never leave a
// lingering scope file that would make the live hook block real edits.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let cwd: string;
let taskFile: string;
let logFile: string;
let marker: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'scope-guard-probe-'));
  mkdirSync(join(cwd, '.task'), { recursive: true });
  taskFile = join(cwd, '.task/allowed-files.json');
  logFile = join(cwd, 'edit-log.jsonl');
  marker = join(cwd, '.task/.unscoped-ack');
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runHook(payload: object) {
  const res = spawnSync('node', ['.claude/hooks/scope-guard.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify(payload),
  });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

function setScope(allow: string[]) {
  writeFileSync(taskFile, JSON.stringify({ allow }, null, 2) + '\n');
}

describe('self-edit deny: the scope file itself is never hand-editable', () => {
  it('blocks editing .task/allowed-files.json even though .task/** is allowed', () => {
    setScope(['.task/**', 'src/modules/_example/**']);
    const { status, out } = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: taskFile },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain('pnpm scope --add'); // the fix, by name
  });
});

describe('repeat-block escalation', () => {
  it('second block on the same path warns against re-implementing in scope', () => {
    setScope(['src/modules/_example/**']);
    const payload = {
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'scripts/verify.ts') },
      cwd,
    };
    const first = runHook(payload);
    expect(first.status).toBe(2);
    expect(first.out).not.toContain('re-implement');

    const second = runHook(payload);
    expect(second.status).toBe(2);
    expect(second.out).toContain('Do NOT re-implement the target inside scope as a workaround.');
    expect(second.out).toContain('pnpm scope --add'); // the fix, by name
  });
});

describe('bash write heuristic', () => {
  it('blocks a redirect that writes an in-repo, out-of-scope file', () => {
    setScope(['src/modules/other/**']);
    const { status, out } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo x > src/modules/_example/internal/zz.ts' },
      cwd,
    });
    expect(status).toBe(2);
    expect(out).toContain('pnpm scope --add'); // the fix, by name
  });

  it('allows a command whose > lives only inside quotes', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: "grep '>' README.md" },
      cwd,
    });
    expect(status).toBe(0);
  });

  it('allows writes outside the repo root', () => {
    setScope(['src/modules/other/**']);
    const { status } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo hi > /tmp/zz-scope-probe' },
      cwd,
    });
    expect(status).toBe(0);
  });
});

describe('unscoped nudge, once', () => {
  it('first unscoped src/ edit blocks and names pnpm scope; second passes', () => {
    const payload = {
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/modules/_example/index.ts') },
      cwd,
    };
    const first = runHook(payload);
    expect(first.status).toBe(2);
    expect(first.out).toContain('pnpm scope'); // the fix, by name
    expect(existsSync(marker)).toBe(true);

    const second = runHook(payload);
    expect(second.status).toBe(0);
    expect(existsSync(logFile)).toBe(false); // nudge is not a scope-block
  });
});
