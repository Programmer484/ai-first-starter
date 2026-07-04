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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendRun } from './edit-log.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const mapPath = ROOT + 'module-map.json';
const outPath = ROOT + '.task/allowed-files.json';

type Module = { name: string; path: string; allowedImports: string[] };
const modules: Module[] = JSON.parse(readFileSync(mapPath, 'utf8')).modules;
const byName = new Map(modules.map((m) => [m.name, m]));

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: scope <module-name | spec-file | path> ...');
  process.exit(2);
}

const allow = new Set<string>(['.task/**', 'edit-log.jsonl']);
const fallbacks: string[] = [];
const matchedModules: string[] = [];

function addModule(m: Module): void {
  allow.add(`${m.path}/**`);
  matchedModules.push(m.name);
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

if (!existsSync(ROOT + '.task')) mkdirSync(ROOT + '.task', { recursive: true });

const payload = {
  generatedAt: new Date().toISOString(),
  spec: args.join(' '),
  matchedModules,
  allow: [...allow].sort(),
};
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log(`Wrote ${outPath}`);
console.log(`  matched modules: ${matchedModules.length ? matchedModules.join(', ') : '(none)'}`);
for (const f of fallbacks) {
  console.log(`  ⚠ fallback (verify manually): ${f}`);
}

appendRun({ kind: 'scope', spec: args.join(' '), matchedModules, fallbacks });
