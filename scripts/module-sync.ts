#!/usr/bin/env node
// Check: src/modules/ folders and module-map.json entries match 1:1.
// Enforces CLAUDE.md rule 4 (create modules with `pnpm new-module`) — a folder
// made by hand, or a map entry whose folder is gone, fails verify.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

type Module = { name: string; path: string };
const modules: Module[] = JSON.parse(readFileSync(join(ROOT, 'module-map.json'), 'utf8')).modules;

const folders = readdirSync(join(ROOT, 'src/modules'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const errors: string[] = [];

for (const folder of folders) {
  if (!modules.some((m) => m.name === folder)) {
    errors.push(
      `src/modules/${folder} exists but is not registered in module-map.json.\n` +
        `  Fix: delete the folder, or register it — next time use: pnpm new-module ${folder}`,
    );
  }
}

for (const m of modules) {
  if (!existsSync(join(ROOT, m.path))) {
    errors.push(
      `Module "${m.name}" is registered in module-map.json but ${m.path} does not exist.\n` +
        `  Fix: remove the entry from module-map.json, or restore the folder.`,
    );
  }
}

if (errors.length > 0) {
  console.error('module-sync: module-map.json and src/modules/ are out of sync:\n');
  for (const e of errors) console.error(`  ✖ ${e}\n`);
  process.exit(1);
}
console.log(`module-sync: OK (${modules.length} module${modules.length === 1 ? '' : 's'})`);
