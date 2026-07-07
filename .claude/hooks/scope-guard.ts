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
import { relative, resolve, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

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
  /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|txt|yml|yaml|css|html|sh|toml|lock|snap|diff|patch)$/;
const IGNORED_DIRS = /^(\.git|node_modules|coverage|\.task)(\/|$)/;

function expandHome(token: string): string {
  if (token === '~') return homedir();
  if (token.startsWith('~/')) return join(homedir(), token.slice(2));
  return token;
}

// Resolve a bash token (expanding a leading ~) against cwd and return its
// repo-relative path, or null if it resolves outside the repo — absolute
// paths (/dev/null, /tmp/x) and ~-expanded home paths are never in-repo
// unless the repo happens to contain the home dir, so this mirrors the
// Edit/Write out-of-repo rule below.
function resolveRepoRelative(token: string, cwd: string): string | null {
  const rel = normalize(resolve(cwd, expandHome(token)), cwd);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

// Split a (quote-stripped) command into top-level segments on control
// operators. Good enough for the accident-guard posture — quotes were
// already stripped by the caller, so operators inside them don't survive
// to be split on.
function segmentsOf(cmd: string): string[] {
  return cmd.split(/&&|\|\||[;&|]/g);
}

const WRITE_VERB = /(^|\s)(tee|mv|cp|rm|touch|truncate)\b/;
const SED_INPLACE = /\bsed\s+(-\S+\s+)*-i\b/;
const DD_OF = /\bdd\s+.*\bof=/;
const GIT_APPLY = /\bgit\s+apply\b/;
const PATCH_CMD = /(^|\s)patch\b/;
const VERB_TOKEN = /^(tee|mv|cp|rm|touch|truncate|sed|dd|git|apply|patch)$/;

// A segment "writes" only if it invokes one of the known write verbs.
// Read-only pipelines (find | sort | xargs wc -l, grep, diff, cat, ls...)
// never match, so they can't be misclassified regardless of what else is on
// the line (e.g. a trailing `2>/dev/null`).
function isWriteSegment(segment: string): boolean {
  return (
    WRITE_VERB.test(segment) ||
    SED_INPLACE.test(segment) ||
    DD_OF.test(segment) ||
    GIT_APPLY.test(segment) ||
    PATCH_CMD.test(segment)
  );
}

// Collect only the tokens that are actual write operands: redirect targets
// (checked everywhere, since `cmd > file` writes regardless of what `cmd`
// is), plus the operands of segments that invoke a write verb. This is the
// fix for the old behaviour of scanning every path-shaped token in the whole
// command once *any* indicator fired — a read-only command sharing a line
// with an exempt redirect (`ls foo 2>/dev/null`) no longer gets its own
// arguments treated as write targets.
function writeOperands(stripped: string): string[] {
  const operands: string[] = [];
  for (const m of stripped.matchAll(/>{1,2}\s*(\S+)/g)) {
    // Trim at the first control operator, same normalization the verb-token
    // path gets below — `>file;true` must yield `file` (or the always-block
    // on the scope file is trivially bypassed) and `>file&&next` must not
    // yield the false operand `file&&next`.
    const target = m[1].split(/&&|\|\||[;&|)]/)[0];
    if (target && !target.startsWith('&')) operands.push(target.replace(/^of=/, ''));
  }
  for (const segment of segmentsOf(stripped)) {
    if (!isWriteSegment(segment)) continue;
    for (const raw of segment.trim().split(/\s+/)) {
      const token = raw.replace(/^[\d]*>{1,2}/, '').replace(/[;|&)]+$/, '');
      if (!token || token.startsWith('-') || token.startsWith('&')) continue;
      if (VERB_TOKEN.test(token)) continue; // the verb name itself, not an operand
      if (token.startsWith('of=')) {
        operands.push(token.slice(3));
        continue;
      }
      if (!token.includes('/') && !KNOWN_EXT.test(token)) continue;
      operands.push(token);
    }
  }
  return operands;
}

// `enforceScope: false` (no scope active, or scope drift-deactivated) still
// checks the two always-protected files — the "never bash-writable" rule on
// the scope file and the audit ledger must not vanish with the scope.
function bashOffendingPath(
  command: string,
  cwd: string,
  globs: string[],
  enforceScope: boolean,
): string | null {
  const trimmed = command.trimStart();
  if (NEVER_BLOCK.some((re) => re.test(trimmed))) return null;
  // All git commands pass except git apply (which writes arbitrary files).
  if (/^git\s/.test(trimmed) && !/^git\s+apply\b/.test(trimmed)) return null;

  // Always-block first, against a quote-RESOLVED copy (quotes replaced by
  // their inner content, not deleted). Quote-stripping below erases quoted
  // write targets before they can match, so `echo x > '.task/allowed-files.json'`
  // used to escape the always-block (DEBT-5). Resolving quotes keeps the
  // target visible while still confining the check to real write operands —
  // read-only commands (`cat`, `grep foo '.task/allowed-files.json'`) produce
  // no write operands and remain unblockable. Conservative by design: a
  // protected path quoted as DATA inside a genuine write operand may still
  // match, which is an acceptable false positive for these two files only.
  const quoteResolved = command.replace(/'([^']*)'/g, '$1').replace(/"([^"]*)"/g, '$1');
  for (const token of writeOperands(quoteResolved)) {
    const rel = resolveRepoRelative(token, cwd);
    if (rel === '.task/allowed-files.json' || rel === 'edit-log.jsonl') return rel;
  }

  // Strip quoted segments first so operators/paths inside strings don't count.
  const stripped = command.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');

  for (const token of writeOperands(stripped)) {
    const rel = resolveRepoRelative(token, cwd);
    if (rel === null) continue; // Outside the repo (or ~-expanded elsewhere) — always allowed.
    // The scope file and the audit ledger are never bash-writable, even
    // though .task/ is otherwise ignored and the ledger is append-target.
    if (rel === '.task/allowed-files.json' || rel === 'edit-log.jsonl') return rel;
    if (!enforceScope) continue; // Only the protected files matter without a scope.
    if (IGNORED_DIRS.test(rel)) continue;
    if (!globs.some((g) => globToRegExp(g).test(rel))) return rel;
  }
  return null;
}

// ---- Unscoped nudge ----------------------------------------------------------
// No scope active: nudge once for edits under src/, then stay silent. If the
// marker can't be written, allow — a broken marker must not nudge forever.
// `note` carries a one-line reason the scope was treated as inactive (e.g.
// branch drift) and, when present, is printed ahead of the usual message.
function unscopedNudge(cwd: string, file: string, note?: string | null): never {
  const marker = resolve(cwd, '.task/.unscoped-ack');
  if (existsSync(marker)) process.exit(0);
  try {
    mkdirSync(resolve(cwd, '.task'), { recursive: true });
    writeFileSync(marker, new Date().toISOString() + '\n');
  } catch {
    process.exit(0); // Marker write failures must not block.
  }
  if (note) console.error(note);
  console.error(
    `scope-guard: no task scope active. Run pnpm scope <module|path> to set one — ` +
      `or retry this edit to proceed unscoped. (Target: ${file})`,
  );
  process.exit(2);
}

// Current git branch, or null if it can't be determined (not a repo, no
// commits yet, detached HEAD weirdness, git missing). Crash-safe by design —
// callers treat null the same as "can't tell, so don't act on it".
function currentGitBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
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
  let allowConfig: { allow?: string[]; branch?: string } | null = null;
  try {
    allowConfig = JSON.parse(readFileSync(resolve(cwd, '.task/allowed-files.json'), 'utf8'));
  } catch {
    allowConfig = null; // No active scope.
  }

  // Branch drift: a scope recorded for another branch (via `branch` in
  // allowed-files.json) no longer describes the task at hand — enforcing it
  // here would block edits a `pnpm scope` run on the current branch was
  // never asked about. Treat it as inactive and fall through to the
  // unscoped path, with a one-line note so the agent knows why. Crash-safe:
  // any failure to resolve the current branch leaves the scope enforced,
  // same as before this fix.
  let branchNote: string | null = null;
  if (allowConfig?.branch) {
    const current = currentGitBranch(cwd);
    if (current && current !== allowConfig.branch) {
      branchNote =
        `scope-guard: task scope was recorded for branch "${allowConfig.branch}", current ` +
        `branch is "${current}" — treating the scope as inactive.`;
      allowConfig = null;
    }
  }

  const globs = allowConfig?.allow ?? [];

  if (input.tool_name === 'Bash') {
    const command = input.tool_input?.command;
    if (!command) process.exit(0);
    // No scope (or drift-deactivated scope): Bash passes untouched EXCEPT
    // for the two always-protected files, which bashOffendingPath still
    // reports when enforceScope is false.
    const offending = bashOffendingPath(command, cwd, globs, allowConfig !== null);
    if (!offending) {
      if (!allowConfig && branchNote) console.error(branchNote);
      process.exit(0);
    }
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

  // Scope governs in-repo files only. A target outside the repo — a relative
  // path escaping cwd, or an absolute path elsewhere — is not something task
  // scope covers, so allow it. Mirrors the Bash write heuristic
  // (bashOffendingPath), which already skips out-of-repo targets. This is what
  // lets an agent write to its sanctioned scratch dir ($CLAUDE_JOB_DIR/tmp,
  // which resolves outside the repo) without having to widen scope every task.
  if (normalized.startsWith('..') || isAbsolute(normalized)) process.exit(0);

  // The scope file itself is never hand-editable — with or without an active
  // scope (widening goes through the script) — even though the seed allow set
  // contains .task/**.
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

  if (!allowConfig) {
    if (normalized.startsWith('src/')) unscopedNudge(cwd, normalized, branchNote);
    if (branchNote) console.error(branchNote);
    process.exit(0);
  }

  const permitted = globs.some((g) => globToRegExp(g).test(normalized));
  if (permitted) process.exit(0);

  const repeat = hasPriorBlock(cwd, normalized);
  block(cwd, input.tool_name, normalized, globs, blockMessage(normalized, globs, repeat));
}

main();
