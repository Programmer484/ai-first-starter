#!/usr/bin/env node
// Check: src/modules/ folders and module-map.json entries match 1:1.
// Enforces CLAUDE.md rule 4 (create modules with `pnpm new-module`) — a folder
// made by hand, or a map entry whose folder is gone, fails verify.
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readModuleMap } from './module-map.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Paths default to the real repo. MODULE_MAP / MODULE_SRC_ROOT let tests run
// this check against a doctored copy in an isolated sandbox, so they never
// mutate the shared map or src/modules (parallel test-safe).
const SRC_ROOT = process.env.MODULE_SRC_ROOT ? resolve(process.env.MODULE_SRC_ROOT) : ROOT;

type Module = { name: string; path: string };
const map = readModuleMap(undefined, true);

// Validate the SHAPE of module-map.json before anything derives from it, so a
// hand-edit typo (e.g. `allowedImport`) fails here with a named, actionable
// error instead of crashing later inside eslint.config.js.
const KNOWN_KEYS = new Set([
  'name',
  'path',
  'description',
  'allowedImports',
  'allowedExternals',
  'gates',
]);
const GATE_PROFILES = ['full', 'polish'];
const REQUIRED_KEYS = ['name', 'path', 'description', 'allowedImports'];
const shapeErrors: string[] = [];
const warnings: string[] = [];

if (!Array.isArray(map.modules)) {
  console.error('module-sync: module-map.json is invalid:\n');
  console.error(
    '  ✖ `modules` must be an array.\n' +
      '  Fix: set the top-level `modules` key to an array of module entries.\n',
  );
  process.exit(1);
}

const seenNames = new Set<string>();
for (let i = 0; i < map.modules.length; i++) {
  const m = map.modules[i]!;
  const label = typeof m?.name === 'string' ? `"${m.name}"` : `at index ${i}`;

  for (const key of REQUIRED_KEYS) {
    if (!(key in m)) {
      shapeErrors.push(
        `Module ${label} is missing required key \`${key}\`.\n` +
          `  Fix: add a \`${key}\` key (check for a misspelling like \`${key}s\` or \`${key.slice(0, -1)}\`).`,
      );
    }
  }
  for (const key of Object.keys(m)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(
        `Module ${label} has unknown key \`${key}\` (ignored — forward compatibility).`,
      );
    }
  }

  if ('name' in m) {
    if (typeof m.name !== 'string' || !/^[a-z_][a-z0-9_-]*$/.test(m.name)) {
      shapeErrors.push(
        `Module ${label} has invalid \`name\` ${JSON.stringify(m.name)}.\n` +
          `  Fix: \`name\` must match /^[a-z_][a-z0-9_-]*$/.`,
      );
    } else if (seenNames.has(m.name)) {
      shapeErrors.push(
        `Duplicate module \`name\` "${m.name}".\n  Fix: module names must be unique across the map.`,
      );
    } else {
      seenNames.add(m.name);
    }
  }

  if ('name' in m && 'path' in m) {
    const expected = `src/modules/${m.name}`;
    if (m.path !== expected) {
      shapeErrors.push(
        `Module ${label} has \`path\` ${JSON.stringify(m.path)}, expected "${expected}".\n` +
          `  Fix: set \`path\` to "${expected}".`,
      );
    }
  }

  if ('description' in m && (typeof m.description !== 'string' || m.description.trim() === '')) {
    shapeErrors.push(
      `Module ${label} has an empty or non-string \`description\`.\n` +
        `  Fix: set \`description\` to a non-empty string.`,
    );
  }

  if ('gates' in m && !GATE_PROFILES.includes(m.gates as string)) {
    shapeErrors.push(
      `Module ${label} has invalid \`gates\` ${JSON.stringify(m.gates)}.\n` +
        `  Fix: \`gates\` must be one of full | polish (or omit the key for full).`,
    );
  }

  if ('allowedImports' in m) {
    if (!Array.isArray(m.allowedImports)) {
      shapeErrors.push(
        `Module ${label} has a non-array \`allowedImports\`.\n` +
          `  Fix: set \`allowedImports\` to an array of module names.`,
      );
    } else {
      for (const dep of m.allowedImports) {
        if (typeof dep !== 'string') {
          shapeErrors.push(
            `Module ${label} has a non-string entry in \`allowedImports\`.\n` +
              `  Fix: every \`allowedImports\` entry must be a module name string.`,
          );
        } else if (dep === m.name) {
          shapeErrors.push(
            `Module ${label} lists itself in \`allowedImports\`.\n` +
              `  Fix: remove the self-import "${dep}".`,
          );
        }
      }
    }
  }

  // allowedExternals is optional. Absent = unrestricted. When present it must
  // be an array of package-name strings (empty = pure module). Validate the
  // shape here so a hand-edit typo fails with a named error before eslint
  // derives the boundaries/external rules from it.
  if ('allowedExternals' in m) {
    if (!Array.isArray(m.allowedExternals)) {
      shapeErrors.push(
        `Module ${label} has a non-array \`allowedExternals\`.\n` +
          `  Fix: set \`allowedExternals\` to an array of package names ([] = pure module, no external packages), or omit the key for unrestricted.`,
      );
    } else {
      for (const pkg of m.allowedExternals) {
        if (typeof pkg !== 'string' || pkg.trim() === '') {
          shapeErrors.push(
            `Module ${label} has a non-string or empty entry in \`allowedExternals\`.\n` +
              `  Fix: every \`allowedExternals\` entry must be a non-empty package-name string (e.g. "pixi.js").`,
          );
        }
      }
    }
  }
}

// Cross-reference allowedImports against known module names (second pass so all
// names are collected first).
for (const m of map.modules) {
  if (Array.isArray(m.allowedImports)) {
    const label = typeof m?.name === 'string' ? `"${m.name}"` : 'a module';
    for (const dep of m.allowedImports) {
      if (typeof dep === 'string' && dep !== m.name && !seenNames.has(dep)) {
        shapeErrors.push(
          `Module ${label} lists \`allowedImports\` entry "${dep}", which is not a module in the map.\n` +
            `  Fix: add module "${dep}", or remove it from \`allowedImports\`.`,
        );
      }
    }
  }
}

for (const w of warnings) console.warn(`  ⚠ ${w}`);

if (shapeErrors.length > 0) {
  console.error('module-sync: module-map.json is invalid:\n');
  for (const e of shapeErrors) console.error(`  ✖ ${e}\n`);
  process.exit(1);
}

const modules: Module[] = map.modules;

const folders = readdirSync(join(SRC_ROOT, 'src/modules'), { withFileTypes: true })
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
  if (!existsSync(join(SRC_ROOT, m.path))) {
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
