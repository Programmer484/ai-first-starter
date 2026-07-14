#!/usr/bin/env node
// Single source of truth (script-side) for "is this path framework-owned?".
// The pattern is a coordinated pair with the grep in ci.yml's "Detect
// framework changes" step — the two must stay IDENTICAL, pinned by
// test/framework-gate.test.ts. Consumers: the lefthook `3_framework`
// pre-commit gate (via the CLI mode below) and scripts/pr.ts (via import).
import { pathToFileURL } from 'node:url';

// Same pattern text as ci.yml's grep, except JavaScript regex literals
// require `/` to be escaped as `\/` — RegExp.source keeps that escape (the
// spec mandates it even when constructed from a string), so the pinning
// test compares after unescaping `\/` back to `/`.
export const FRAMEWORK_PATH_RE =
  /^(scripts\/|test\/|\.claude\/|\.github\/|eslint\.config\.js|vitest.*\.config\.ts|module-map|framework-manifest\.json|\.prettierrc\.json|\.prettierignore|package\.json|pnpm-lock\.yaml|knip\.json|stryker\.config|lefthook\.yml|tsconfig\.json)/;

// CLI predicate: reads newline-separated paths on stdin, exits 0 if any
// line matches FRAMEWORK_PATH_RE, 1 otherwise. Shell usage:
//   git diff --cached --name-only | node scripts/framework-paths.ts
function main(): void {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (c: Buffer) => chunks.push(c));
  process.stdin.on('end', () => {
    const lines = Buffer.concat(chunks).toString('utf8').split('\n');
    const hit = lines.some((line) => FRAMEWORK_PATH_RE.test(line.trim()));
    process.exit(hit ? 0 : 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
