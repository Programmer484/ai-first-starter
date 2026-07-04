#!/usr/bin/env node
// PreToolUse hook. Blocks file edits that fall outside the current task's
// allowed set (.task/allowed-files.json, produced by scripts/scope.ts).
//
// No allowed-files.json => no active task scope => edits are allowed (with a
// one-time nudge for edits under src/). Exit 2 blocks the tool call and feeds
// the reason back to the agent.
//
// Design posture: this guards against ACCIDENTS, not adversaries. When a
// heuristic is unsure, allow. Logging and marker I/O must never turn into a
// crash or a spurious block.
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';

type HookInput = {
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string; command?: string };
  cwd?: string;
};

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Minimal glob -> RegExp: supports ** (any path incl. /), * (within a segment).
function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*');
  return new RegExp(`^${re}$`);
}

function normalize(target: string, cwd: string): string {
  const rel = isAbsolute(target) ? relative(cwd, target) : target;
  return rel.split('\\').join('/');
}

// Scan the tail of edit-log.jsonl for a prior block on the same path. A repeat
// block means the scope was resolved too narrow — escalate the message so the
// agent widens scope instead of working around it. Tolerates a missing log and
// corrupt lines.
function hasPriorBlock(cwd: string, file: string): boolean {
  try {
    const lines = readFileSync(resolve(cwd, 'edit-log.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-200);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.kind === 'scope-block' && rec.file === file) return true;
      } catch {
        // Corrupt line — skip it.
      }
    }
  } catch {
    // No log yet.
  }
  return false;
}

function block(
  cwd: string,
  tool: string | undefined,
  file: string,
  globs: string[],
  message: string,
  channel?: string,
): never {
  // Log every blocked attempt — repeated blocks on the same path are a
  // scoping bug (the scope was resolved too narrow), not agent misbehaviour.
  try {
    appendFileSync(
      resolve(cwd, 'edit-log.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: 'scope-block',
        tool,
        file,
        allowed: globs,
        ...(channel ? { channel } : {}),
      }) + '\n',
    );
  } catch {
    // Logging must never turn a block into a crash.
  }
  console.error(message);
  process.exit(2);
}

function blockMessage(file: string, globs: string[], repeat: boolean): string {
  if (repeat) {
    return (
      `scope-guard: repeat block on "${file}" — this path has been blocked before, ` +
      `so the task scope is likely too narrow.\n` +
      `Widen it with: pnpm scope --add ${file}\n` +
      `Do NOT re-implement the target inside scope as a workaround.`
    );
  }
  return (
    `scope-guard: "${file}" is outside the current task scope.\n` +
    `Allowed: ${globs.join(', ') || '(none)'}\n` +
    `If this edit is intended, add it with: pnpm scope --add ${file}`
  );
}

// ---- Bash write heuristic ---------------------------------------------------
// Block a Bash call only when we're confident it writes an in-repo,
// out-of-scope file. Anything ambiguous is allowed.

const NEVER_BLOCK = [/^pnpm scope\b/, /^pnpm verify\b/, /^node scripts\//];
const KNOWN_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|txt|yml|yaml|css|html|sh|toml|lock|snap)$/;
const IGNORED_DIRS = /^(\.git|node_modules|coverage|\.task)(\/|$)/;

function hasWriteIndicator(cmd: string): boolean {
  // Redirects whose target doesn't start with & (so 2>&1 is not a write).
  for (const m of cmd.matchAll(/>{1,2}\s*(\S+)/g)) {
    if (!m[1].startsWith('&')) return true;
  }
  if (/(^|[\s;|&])(tee|mv|cp|rm|touch|truncate)\b/.test(cmd)) return true;
  if (/\bsed\s+(-\S+\s+)*-i\b/.test(cmd)) return true;
  if (/\bdd\s+.*\bof=/.test(cmd)) return true;
  if (/\bgit\s+apply\b/.test(cmd)) return true;
  if (/(^|[\s;|&])patch\b/.test(cmd)) return true;
  return false;
}

function bashOffendingPath(command: string, cwd: string, globs: string[]): string | null {
  const trimmed = command.trimStart();
  if (NEVER_BLOCK.some((re) => re.test(trimmed))) return null;
  // All git commands pass except git apply (which writes arbitrary files).
  if (/^git\s/.test(trimmed) && !/^git\s+apply\b/.test(trimmed)) return null;

  // Strip quoted segments first so operators inside strings don't count.
  const stripped = command.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
  if (!hasWriteIndicator(stripped)) return null;

  for (const raw of stripped.split(/\s+/)) {
    const token = raw.replace(/^[\d]*>{1,2}/, '').replace(/[;|&)]+$/, '');
    if (!token || token.startsWith('-') || token.startsWith('&')) continue;
    if (!token.includes('/') && !KNOWN_EXT.test(token)) continue;
    const rel = normalize(resolve(cwd, token.replace(/^of=/, '')), cwd);
    if (rel.startsWith('..') || isAbsolute(rel)) continue; // Outside the repo — always allowed.
    // The scope file and the audit ledger are never bash-writable, even
    // though .task/ is otherwise ignored and the ledger is append-target.
    if (rel === '.task/allowed-files.json' || rel === 'edit-log.jsonl') return rel;
    if (IGNORED_DIRS.test(rel)) continue;
    if (!globs.some((g) => globToRegExp(g).test(rel))) return rel;
  }
  return null;
}

// ---- Unscoped nudge ----------------------------------------------------------
// No scope active: nudge once for edits under src/, then stay silent. If the
// marker can't be written, allow — a broken marker must not nudge forever.
function unscopedNudge(cwd: string, file: string): never {
  const marker = resolve(cwd, '.task/.unscoped-ack');
  if (existsSync(marker)) process.exit(0);
  try {
    mkdirSync(resolve(cwd, '.task'), { recursive: true });
    writeFileSync(marker, new Date().toISOString() + '\n');
  } catch {
    process.exit(0); // Marker write failures must not block.
  }
  console.error(
    `scope-guard: no task scope active. Run pnpm scope <module|path> to set one — ` +
      `or retry this edit to proceed unscoped. (Target: ${file})`,
  );
  process.exit(2);
}

function main(): void {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // Not our concern if we can't parse it.
  }

  const cwd = input.cwd ?? process.cwd();
  let allowConfig: { allow?: string[] } | null = null;
  try {
    allowConfig = JSON.parse(readFileSync(resolve(cwd, '.task/allowed-files.json'), 'utf8'));
  } catch {
    allowConfig = null; // No active scope.
  }
  const globs = allowConfig?.allow ?? [];

  if (input.tool_name === 'Bash') {
    if (!allowConfig) process.exit(0); // No scope => Bash passes untouched.
    const command = input.tool_input?.command;
    if (!command) process.exit(0);
    const offending = bashOffendingPath(command, cwd, globs);
    if (!offending) process.exit(0);
    if (offending === '.task/allowed-files.json') {
      block(
        cwd,
        input.tool_name,
        offending,
        globs,
        `scope-guard: don't hand-edit .task/allowed-files.json.\n` +
          `Widen the scope with: pnpm scope --add <module|path>`,
        'bash',
      );
    }
    if (offending === 'edit-log.jsonl') {
      block(
        cwd,
        input.tool_name,
        offending,
        globs,
        `scope-guard: edit-log.jsonl is an append-only audit ledger — don't overwrite it.\n` +
          `If you need to record something, append; to widen scope use: pnpm scope --add <module|path>`,
        'bash',
      );
    }
    const repeat = hasPriorBlock(cwd, offending);
    block(
      cwd,
      input.tool_name,
      offending,
      globs,
      repeat
        ? blockMessage(offending, globs, true)
        : `scope-guard: this Bash command appears to write "${offending}", which is outside ` +
            `the current task scope.\n` +
            `Use the Edit tool (scope-checked) or widen with: pnpm scope --add ${offending}`,
      'bash',
    );
  }

  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!target) process.exit(0); // Not a file-writing tool.
  const normalized = normalize(target, cwd);

  if (!allowConfig) {
    if (normalized.startsWith('src/')) unscopedNudge(cwd, normalized);
    process.exit(0);
  }

  // The scope file itself is never hand-editable, even though the seed allow
  // set contains .task/** — widening scope goes through the script.
  if (normalized === '.task/allowed-files.json') {
    block(
      cwd,
      input.tool_name,
      normalized,
      globs,
      `scope-guard: don't hand-edit .task/allowed-files.json.\n` +
        `Widen the scope with: pnpm scope --add <module|path>`,
    );
  }

  const permitted = globs.some((g) => globToRegExp(g).test(normalized));
  if (permitted) process.exit(0);

  const repeat = hasPriorBlock(cwd, normalized);
  block(cwd, input.tool_name, normalized, globs, blockMessage(normalized, globs, repeat));
}

main();
