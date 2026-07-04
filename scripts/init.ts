#!/usr/bin/env node
// Instantiate this template for a new project: rename it, pick a stack preset,
// and reset the per-project state (edit log). Run once, right after cloning.
//
// Usage: pnpm init:project <project-name> [--preset node|web]
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const [rawName, ...rest] = process.argv.slice(2);
if (!rawName) {
  console.error('Usage: init:project <project-name> [--preset node|web]');
  process.exit(2);
}
const name = rawName
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-');

const presets: Record<string, string> = {
  node: 'A TypeScript Node project scaffolded from ai-first-starter.',
  web: 'A TypeScript web project scaffolded from ai-first-starter (add Vite entry under src/).',
};
const presetKey = (rest[rest.indexOf('--preset') + 1] as string) || 'node';
const preset = presets[presetKey];
if (!preset) {
  console.error(`Unknown preset "${presetKey}". Known: ${Object.keys(presets).join(', ')}`);
  process.exit(2);
}

// package.json: set the name.
const pkgPath = ROOT + 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = name;
pkg.version = '0.1.0';
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// README: fresh, project-specific.
writeFileSync(
  ROOT + 'README.md',
  `# ${name}

${preset}

## Getting started

\`\`\`bash
pnpm install
pnpm verify        # lint + typecheck + test + boundaries + coverage
pnpm new-module x  # scaffold a registered module
\`\`\`

Architecture lives in \`module-map.json\` — the single source of truth for
module boundaries. See \`CLAUDE.md\` for the rules agents follow here.
`,
);

// Reset per-project run state.
const log = ROOT + 'edit-log.jsonl';
if (existsSync(log)) rmSync(log);

console.log(`Initialised "${name}" (preset: ${presetKey}).`);
console.log('Next: pnpm install && pnpm verify');
