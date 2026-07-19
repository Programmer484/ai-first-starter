// Enforcement probe for the hook command wiring in .claude/settings.json.
//
// Failure mode being guarded: hook `command`s run with the SESSION's cwd, not
// the repo root. A bare relative path (`node .claude/hooks/scope-guard.ts`)
// resolves against that cwd, so when the session is rooted anywhere but the
// repo top the script is not found — node exits with a module-not-found error
// (exit code 1), and a PreToolUse hook that exits non-2 does NOT block the
// tool call. The scope guard silently stops enforcing. The fix references the
// script through $CLAUDE_PROJECT_DIR:
//   node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/scope-guard.ts"
//
// Two layers, matching the CLAUDE.md "every rule maps to a check" ethos:
//   1. Static — parse settings.json and assert every hook command that
//      references .claude/hooks/ resolves via $CLAUDE_PROJECT_DIR (no bare
//      relative path) and that the referenced script exists on disk.
//   2. Functional — spawn each command through a shell with cwd set to a repo
//      SUBDIRECTORY and CLAUDE_PROJECT_DIR set to the repo root, feeding a
//      harmless Read payload on stdin, and assert it does not die with
//      "Cannot find module".
//
// The functional layer is hermetic: the stdin payload's `cwd` (which the hooks
// resolve .task/ and edit-log.jsonl against) points at a throwaway temp dir,
// and the payload is a Read tool with no file_path — a guaranteed no-op that
// writes nothing. So the probe can never mutate the live session's scope state
// or ledger, regardless of process cwd. The settings path is read through a
// CLAUDE_SETTINGS seam (mirrors the MODULE_MAP seam other probes use) so the
// same assertions can be pointed at a fixture.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SETTINGS = process.env.CLAUDE_SETTINGS ?? join(ROOT, '.claude/settings.json');

type HookEntry = { command?: string };
type HookGroup = { hooks?: HookEntry[] };
type Settings = { hooks?: Record<string, HookGroup[]> };

// Every hook command string in settings.json, flattened across all events.
function hookCommands(): string[] {
  const settings = JSON.parse(readFileSync(SETTINGS, 'utf8')) as Settings;
  const cmds: string[] = [];
  for (const groups of Object.values(settings.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        if (typeof hook.command === 'string') cmds.push(hook.command);
      }
    }
  }
  return cmds;
}

// Commands that reference a script under .claude/hooks/ — the ones this rule
// governs.
function hookScriptCommands(): string[] {
  return hookCommands().filter((c) => c.includes('.claude/hooks/'));
}

// Pull the .claude/hooks/<file> path out of a command string.
function scriptPathOf(cmd: string): string | undefined {
  return cmd.match(/\.claude\/hooks\/[\w.-]+/)?.[0];
}

describe('hook commands reference scripts through $CLAUDE_PROJECT_DIR', () => {
  it('there is at least one hook script command to check', () => {
    expect(hookScriptCommands().length).toBeGreaterThan(0);
  });

  it('no command uses a bare relative .claude/hooks/ path', () => {
    for (const cmd of hookScriptCommands()) {
      // The script reference must be immediately preceded by the project-dir
      // variable — never a bare `node .claude/hooks/...` or a `./` relative.
      expect(cmd, `command must resolve the hook via $CLAUDE_PROJECT_DIR: ${cmd}`).toMatch(
        /\$\{?CLAUDE_PROJECT_DIR[^}]*\}?\/\.claude\/hooks\//,
      );
      expect(cmd, `command must not use a bare relative hook path: ${cmd}`).not.toMatch(
        /(^|\s|["'])\.?\/?\.claude\/hooks\//,
      );
    }
  });

  it('every referenced hook script exists on disk', () => {
    for (const cmd of hookScriptCommands()) {
      const rel = scriptPathOf(cmd);
      expect(rel, `could not extract a hook script path from: ${cmd}`).toBeTruthy();
      expect(existsSync(join(ROOT, rel!)), `missing hook script: ${rel}`).toBe(true);
    }
  });
});

describe('hook commands resolve from a subdirectory session (functional)', () => {
  let payloadCwd: string;

  beforeEach(() => {
    payloadCwd = mkdtempSync(join(tmpdir(), 'hook-path-probe-'));
  });

  afterEach(() => {
    rmSync(payloadCwd, { recursive: true, force: true });
  });

  it('does not fail with "Cannot find module" when cwd is a repo subdir', () => {
    // A Read payload with no file_path: the scope guard treats it as "not a
    // file-writing tool" and exits 0 without touching disk, and auto-format
    // sees no formattable file_path and returns. Nothing is written anywhere.
    const payload = JSON.stringify({ tool_name: 'Read', tool_input: {}, cwd: payloadCwd });
    // Process cwd is a repo SUBDIR — this is what breaks a bare relative path.
    const subdir = resolve(ROOT, 'scripts');

    for (const cmd of hookScriptCommands()) {
      const { status, out } = run('sh', ['-c', cmd], {
        cwd: subdir,
        env: { CLAUDE_PROJECT_DIR: ROOT },
        input: payload,
      });
      expect(out, `hook command could not locate its script from a subdir: ${cmd}`).not.toContain(
        'Cannot find module',
      );
      // The harmless Read payload must be a clean pass, not a crash.
      expect(status, `hook command exited non-zero on a no-op payload: ${cmd}\n${out}`).toBe(0);
    }
  });
});
