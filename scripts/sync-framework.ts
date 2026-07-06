#!/usr/bin/env node
// Sync framework-owned files (framework-manifest.json) from this template
// into a target repository.
//
//   node scripts/sync-framework.ts <target-repo> [--dry-run]
//
// Copy-only: never deletes target files. Prints a summary — added / updated /
// unchanged / skipped — plus, for every entry that changed and carries an
// `adapt` note in the manifest, a reminder that the file needs per-project
// reconciliation (coverage floor, project-specific CLAUDE.md text). DEBT.md
// is `skipIfExists`: a target's debt entries are its history and are never
// clobbered. Target-only files inside synced directories are listed for
// manual review (they may be stale framework files).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

type Entry = { path: string; dir?: boolean; skipIfExists?: boolean; adapt?: string };
type Manifest = { files: Entry[] };

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const targetArg = argv.find((a) => !a.startsWith('--'));
if (!targetArg) {
  console.error('Usage: node scripts/sync-framework.ts <target-repo> [--dry-run]');
  process.exit(2);
}
const TARGET = resolve(targetArg);
if (!existsSync(TARGET) || !statSync(TARGET).isDirectory()) {
  console.error(`sync-framework: target is not a directory: ${TARGET}`);
  process.exit(2);
}
if (resolve(TARGET) === resolve(ROOT)) {
  console.error('sync-framework: target is the template itself; nothing to do.');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'framework-manifest.json'), 'utf8')) as
  Manifest | { files?: unknown };
if (!Array.isArray(manifest.files)) {
  console.error('sync-framework: framework-manifest.json is missing a `files` array.');
  process.exit(2);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const added: string[] = [];
const updated: string[] = [];
const unchanged: string[] = [];
const skipped: string[] = [];
const targetOnly: string[] = [];
const adaptNotes: string[] = [];

function syncFile(rel: string, entry: Entry): void {
  const src = join(ROOT, rel);
  const dst = join(TARGET, rel);
  const exists = existsSync(dst);
  if (exists && entry.skipIfExists) {
    skipped.push(`${rel} (exists; ${entry.adapt ? 'preserved' : 'skipIfExists'})`);
    return;
  }
  const same = exists && readFileSync(src, 'utf8') === readFileSync(dst, 'utf8');
  if (same) {
    unchanged.push(rel);
    return;
  }
  if (!dryRun) {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
  (exists ? updated : added).push(rel);
  if (entry.adapt) adaptNotes.push(`${rel}: ${entry.adapt}`);
}

for (const entry of manifest.files as Entry[]) {
  const src = join(ROOT, entry.path);
  if (!existsSync(src)) {
    console.error(`sync-framework: manifest path missing in template: ${entry.path}`);
    process.exit(1);
  }
  if (entry.dir) {
    for (const file of walk(src)) syncFile(relative(ROOT, file), entry);
    const dstDir = join(TARGET, entry.path);
    if (existsSync(dstDir)) {
      for (const file of walk(dstDir)) {
        const rel = relative(TARGET, file);
        if (!existsSync(join(ROOT, rel))) targetOnly.push(rel);
      }
    }
  } else {
    syncFile(entry.path, entry);
  }
}

const label = dryRun ? ' (dry run — nothing written)' : '';
console.log(`sync-framework: ${ROOT} -> ${TARGET}${label}`);
const section = (name: string, items: string[]) => {
  console.log(`\n${name} (${items.length})`);
  for (const i of items.sort()) console.log(`  ${i}`);
};
section('added', added);
section('updated', updated);
section('skipped', skipped);
console.log(`\nunchanged (${unchanged.length})`);
if (targetOnly.length) {
  section('target-only (review manually — possibly stale framework files)', targetOnly);
}
if (adaptNotes.length) {
  console.log('\nNEEDS PER-PROJECT ADAPTATION:');
  for (const n of adaptNotes) console.log(`  - ${n}`);
}
