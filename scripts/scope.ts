#!/usr/bin/env node
// Resolve a task spec to the set of files an agent is allowed to touch, and
// write it to .task/allowed-files.json (read by the scope-guard hook).
//
// Deterministic lookup first: any argument that is a known module name (or a
// spec file that mentions known module names) expands to that module's glob
// straight from module-map.json — no guessing.
//
// Agent-assist fallback: an argument that resolves to nothing recognisable is
// kept verbatim as a path glob and flagged, so a human/agent can confirm it.
//
// Usage:
//   pnpm scope _example                 # allow edits within the _example module
//   pnpm scope .task/spec.md            # scan a spec file for module names
//   pnpm scope src/modules/foo/index.ts # literal path (fallback)
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { appendRun } from './edit-log.ts';
import { readModuleMap } from './module-map.ts';

// Defaults to the real repo; SCOPE_ROOT lets tests run against a sandbox
// (same pattern as MODULE_MAP / MODULE_SRC_ROOT in module-sync.ts).
const ROOT = process.env.SCOPE_ROOT
  ? resolve(process.env.SCOPE_ROOT) + '/'
  : fileURLToPath(new URL('..', import.meta.url));
const mapPath = ROOT + 'module-map.json';
const outPath = ROOT + '.task/allowed-files.json';
const branchPath = ROOT + '.task/branch';

type Module = { name: string; path: string; allowedImports: string[] };
const modules = readModuleMap(mapPath).modules as Module[];
const byName = new Map(modules.map((m) => [m.name, m]));

const rawArgs = process.argv.slice(2);
const addMode = rawArgs.includes('--add');
const args = rawArgs.filter((a) => !a.startsWith('--'));
if (args.length === 0) {
  console.error('Usage: scope <module-name | spec-file | path> ... [--add]');
  process.exit(2);
}

// DEBT.md is seeded so logging tech debt never requires widening scope.
const SEEDED = ['.task/**', 'edit-log.jsonl', 'DEBT.md'];
const CATCH_ALLS = new Set(['**', '*', 'src/**', 'src/*']);
const allow = new Set<string>(SEEDED);
const fallbacks: string[] = [];
const matchedModules: string[] = [];

function addModule(m: Module): void {
  allow.add(`${m.path}/**`);
  matchedModules.push(m.name);
}

// Branch slug: lowercase, non-alphanumerics collapse to '-', trim leading/
// trailing '-', capped at 40 chars.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

// Prefer a spec file's first markdown heading (or first non-empty line) over
// the raw args, so `.task/spec.md` yields a readable branch name instead of
// "task-spec-md". Only `.md` files are mined for content: a non-markdown file
// (e.g. `scripts/pr.ts`) would otherwise slug its shebang or first line into
// the branch, so those fall through to the raw args below.
function slugSourceFor(specArgs: string[]): string {
  const first = specArgs[0];
  if (first && !byName.has(first) && first.endsWith('.md') && existsSync(first)) {
    const text = readFileSync(first, 'utf8');
    const lines = text.split('\n');
    const heading = lines.find((l) => /^#+\s*\S/.test(l.trim()));
    if (heading) return heading.replace(/^#+\s*/, '').trim();
    const nonEmpty = lines.find((l) => l.trim().length > 0);
    if (nonEmpty) return nonEmpty.trim();
  }
  return specArgs.join(' ');
}

for (const arg of args) {
  const mod = byName.get(arg);
  if (mod) {
    addModule(mod);
    continue;
  }
  if (existsSync(arg)) {
    // A spec file: pull out any module names it mentions (deterministic).
    const text = readFileSync(arg, 'utf8');
    const found = modules.filter((m) => new RegExp(`\\b${m.name}\\b`).test(text));
    if (found.length > 0) {
      found.forEach(addModule);
      // Additive, not exclusive: the literal path must unblock too, or
      // `pnpm scope --add <blocked-file>` loops when the file names a module.
      allow.add(arg);
    } else {
      allow.add(arg);
      fallbacks.push(arg);
    }
    continue;
  }
  // Unknown token — agent-assist fallback: treat as a literal path glob.
  allow.add(arg);
  fallbacks.push(arg);
}

for (const entry of allow) {
  if (CATCH_ALLS.has(entry)) {
    console.error(
      `refusing catch-all scope "${entry}"; name modules or paths: pnpm scope <module|path> [--add]`,
    );
    process.exit(2);
  }
}

if (!existsSync(ROOT + '.task')) mkdirSync(ROOT + '.task', { recursive: true });

let spec = args.join(' ');
let branch = `feature/${slugify(slugSourceFor(args))}`;
if (addMode && existsSync(outPath)) {
  const prev = JSON.parse(readFileSync(outPath, 'utf8'));
  for (const entry of prev.allow ?? []) allow.add(entry);
  for (const m of prev.matchedModules ?? []) {
    if (!matchedModules.includes(m)) matchedModules.push(m);
  }
  spec = `${prev.spec} + ${spec}`;
  branch = prev.branch ?? branch;
}

const payload = {
  generatedAt: new Date().toISOString(),
  spec,
  matchedModules,
  allow: [...allow].sort(),
  branch,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
writeFileSync(branchPath, branch + '\n');
rmSync(ROOT + '.task/.unscoped-ack', { force: true });

console.log(`Wrote ${outPath}`);
console.log(`  matched modules: ${matchedModules.length ? matchedModules.join(', ') : '(none)'}`);
for (const f of fallbacks) {
  console.log(`  ⚠ fallback (verify manually): ${f}`);
}

appendRun({ kind: 'scope-set', add: addMode, args, matchedModules, fallbacks, branch });
