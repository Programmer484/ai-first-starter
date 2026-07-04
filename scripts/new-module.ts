#!/usr/bin/env node
// Create a new module skeleton and register it in module-map.json.
// The registration is what makes ESLint boundaries, the scope resolver, and
// docs pick it up — module-map.json is the single source of truth.
//
// Usage: pnpm new-module <name> [--desc "what it does"] [--imports a,b]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const mapPath = ROOT + 'module-map.json';

const [name, ...rest] = process.argv.slice(2);
if (!name || !/^[a-z_][a-z0-9_-]*$/.test(name)) {
  console.error('Usage: new-module <name>  (name: /^[a-z_][a-z0-9_-]*$/)');
  process.exit(2);
}

function flag(n: string): string | undefined {
  const i = rest.indexOf(n);
  return i >= 0 ? rest[i + 1] : undefined;
}
const description = flag('--desc') ?? `TODO: describe the ${name} module.`;
const allowedImports = (flag('--imports') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
if (map.modules.some((m: { name: string }) => m.name === name)) {
  console.error(`Module "${name}" already exists in module-map.json.`);
  process.exit(1);
}

const relPath = `src/modules/${name}`;
const dir = ROOT + relPath;
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
`,
);

map.modules.push({ name, path: relPath, description, allowedImports });
map.modules.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');

console.log(`Created module "${name}" at ${relPath} and registered it in module-map.json.`);
console.log('Next: pnpm verify');

function camel(s: string): string {
  return s.replace(/^_+/, '').replace(/[-_](.)/g, (_, c) => c.toUpperCase()) || 'run';
}
