#!/usr/bin/env node
// Create a new module skeleton and register it in module-map.json.
// The registration is what makes ESLint boundaries, the scope resolver, and
// docs pick it up — module-map.json is the single source of truth.
//
// Usage: pnpm new-module <name> [--desc "what it does"] [--imports a,b]
//                                [--externals a,b | --pure] [--gates full|polish]
//
// --externals a,b  restricts the module to importing ONLY packages a and b
//                  (node: builtins and cross-module imports stay allowed).
// --pure  (alias for --externals "")  restricts it to NO external packages.
// Omit both  →  the module is unrestricted (may import any package).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readModuleMap, moduleMapPath } from './module-map.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Same sandbox overrides as module-sync: MODULE_MAP / MODULE_SRC_ROOT let
// tests scaffold into a temp dir. Defaults are the real repo paths.
const mapPath = moduleMapPath(undefined, true);
const SRC_ROOT = process.env.MODULE_SRC_ROOT ? resolve(process.env.MODULE_SRC_ROOT) : ROOT;

const [name, ...rest] = process.argv.slice(2);
if (!name || !/^[a-z_][a-z0-9_-]*$/.test(name)) {
  console.error('Usage: new-module <name>  (name: /^[a-z_][a-z0-9_-]*$/)');
  process.exit(2);
}

function flag(n: string): string | undefined {
  const i = rest.indexOf(n);
  return i >= 0 ? rest[i + 1] : undefined;
}
function hasFlag(n: string): boolean {
  return rest.includes(n);
}
const description = flag('--desc') ?? `TODO: describe the ${name} module.`;
const gates = flag('--gates') ?? 'full';
if (gates !== 'full' && gates !== 'polish') {
  console.error(`Invalid --gates "${gates}". Usage: new-module <name> [--gates full|polish]`);
  process.exit(2);
}
const allowedImports = (flag('--imports') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// --externals / --pure are optional. When neither is given, `allowedExternals`
// is omitted entirely so the module stays unrestricted. `--pure` is sugar for
// `--externals ""` (an empty allowlist = no external packages).
const externalsRestricted = hasFlag('--externals') || hasFlag('--pure');
const allowedExternals = (flag('--externals') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const map = readModuleMap(mapPath);
if (map.modules.some((m: { name: string }) => m.name === name)) {
  console.error(`Module "${name}" already exists in module-map.json.`);
  process.exit(1);
}

const relPath = `src/modules/${name}`;
const dir = join(SRC_ROOT, relPath);
if (existsSync(dir)) {
  console.error(`Directory ${relPath} already exists.`);
  process.exit(1);
}

mkdirSync(`${dir}/internal`, { recursive: true });
mkdirSync(`${dir}/__tests__`, { recursive: true });

writeFileSync(
  `${dir}/index.ts`,
  `// Public surface of the ${name} module. Other modules import ONLY from here.
import { greet } from './internal/${name}.ts';

export function ${camel(name)}(input: string): string {
  return greet(input);
}
`,
);

writeFileSync(
  `${dir}/internal/${name}.ts`,
  `// Internal implementation. Deep imports from other modules are blocked by lint.
export function greet(input: string): string {
  return \`[${name}] \${input}\`;
}
`,
);

writeFileSync(
  `${dir}/__tests__/${name}.test.ts`,
  `import { describe, it, expect } from 'vitest';
import { ${camel(name)} } from '../index.ts';

describe('${name}', () => {
  it('wraps its input', () => {
    expect(${camel(name)}('hi')).toBe('[${name}] hi');
  });
});
`,
);

writeFileSync(
  `${dir}/AGENTS.md`,
  `# Module: ${name}

${description}

## Public surface

Import this module only through \`index.ts\`. Everything under \`internal/\` is
private — deep imports are blocked by ESLint boundaries.

## May import

${allowedImports.length ? allowedImports.map((m) => `- \`${m}\``).join('\n') : '- (nothing — leaf module)'}

To change what this module may import, edit \`allowedImports\` for \`${name}\` in
\`module-map.json\`. Do not hand-edit ESLint config.

## May import (external packages)

${
  !externalsRestricted
    ? '- (unrestricted — any npm package)'
    : allowedExternals.length
      ? allowedExternals.map((p) => `- \`${p}\``).join('\n')
      : '- (nothing — pure module, no external packages)'
}

To change which external packages this module may import, edit
\`allowedExternals\` for \`${name}\` in \`module-map.json\` (omit the key for
unrestricted). \`node:\` builtins and cross-module imports are always allowed.
${gates === 'polish' ? '\nPolish lane: this module is exempt from the coverage floor only. Lint,\nboundaries, typecheck, and knip still apply.\n' : ''}`,
);

const entry: (typeof map.modules)[number] = { name, path: relPath, description, allowedImports };
if (externalsRestricted) entry.allowedExternals = allowedExternals;
if (gates === 'polish') entry.gates = gates;
map.modules.push(entry);
map.modules.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');

console.log(`Created module "${name}" at ${relPath} and registered it in module-map.json.`);
console.log('Next: pnpm verify');

function camel(s: string): string {
  return s.replace(/^_+/, '').replace(/[-_](.)/g, (_, c) => c.toUpperCase()) || 'run';
}
