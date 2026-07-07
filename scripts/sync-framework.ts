#!/usr/bin/env node
// Sync framework-owned files (framework-manifest.json) from this template
// into a target repository.
//
//   node scripts/sync-framework.ts <target-repo> [--dry-run|--check]
//
// Copy-only: never deletes target files. Prints a summary — added / updated /
// unchanged / skipped — plus, for every entry that changed and carries an
// `adapt` note in the manifest, a reminder that the file needs per-project
// reconciliation (coverage floor, project-specific CLAUDE.md text). DEBT.md
// is `skipIfExists`: a target's debt entries are its history and are never
// clobbered. Target-only files inside synced directories are listed for
// manual review (they may be stale framework files).
//
// --check is a read-only sync audit, run from the template. Files whose
// manifest entry carries an `adapt` note are expected to diverge per-project
// and are reported informationally; every other difference is drift, and each
// drifted file is classified by direction using both repos' git histories:
//   target behind   — the target's version is an old template version; sync.
//   target ahead    — the template's version is an old target version; the
//                     target carries a patch owed upstream.
//   diverged        — neither version appears in the other's history.
// Exits 1 on drift, 0 when in sync (expected `adapt` divergence included).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

type Entry = { path: string; dir?: boolean; skipIfExists?: boolean; adapt?: string };
type Manifest = { files: Entry[] };

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const dryRun = argv.includes('--dry-run') || check;
const targetArg = argv.find((a) => !a.startsWith('--'));
if (!targetArg) {
  console.error('Usage: node scripts/sync-framework.ts <target-repo> [--dry-run|--check]');
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
const changed: { rel: string; entry: Entry; existed: boolean }[] = [];

// Explicit file entries override the entry of a containing `dir` — so a
// directory-wide `adapt` note can be scoped to the one file it's about.
const fileEntries = new Map<string, Entry>(
  (manifest.files as Entry[]).filter((e) => !e.dir).map((e) => [e.path, e]),
);
const seen = new Set<string>();

function syncFile(rel: string, entry: Entry): void {
  if (seen.has(rel)) return;
  seen.add(rel);
  entry = fileEntries.get(rel) ?? entry;
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
  changed.push({ rel, entry, existed: exists });
  if (entry.adapt) adaptNotes.push(`${rel}: ${entry.adapt}`);
}

function git(repo: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// Blob hashes a path has had across a repo's history (all refs).
function historicalBlobs(repo: string, rel: string): Set<string> {
  const blobs = new Set<string>();
  const commits = git(repo, ['log', '--all', '--format=%H', '--', rel]);
  for (const c of commits ? commits.split('\n') : []) {
    const blob = git(repo, ['rev-parse', `${c}:${rel}`]);
    if (blob) blobs.add(blob);
  }
  return blobs;
}

// Classify a drifted file's direction from git history. Falls back to
// "diverged" when either side has no history for the path (not a git repo,
// path untracked).
function classifyDrift(rel: string): string {
  const srcBlob = git(ROOT, ['hash-object', join(ROOT, rel)]);
  const dstBlob = git(TARGET, ['hash-object', join(TARGET, rel)]);
  if (dstBlob && historicalBlobs(ROOT, rel).has(dstBlob)) {
    return 'target behind — an old template version; sync to update';
  }
  if (srcBlob && historicalBlobs(TARGET, rel).has(srcBlob)) {
    return 'target ahead — carries a patch owed upstream to the template';
  }
  return 'diverged — neither version is in the other repo’s history; reconcile manually';
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

const section = (name: string, items: string[]) => {
  console.log(`\n${name} (${items.length})`);
  for (const i of items.sort()) console.log(`  ${i}`);
};

if (check) {
  console.log(`sync-check: ${ROOT} vs ${TARGET}`);
  const drift = changed.filter((c) => !c.entry.adapt);
  const expected = changed.filter((c) => c.entry.adapt);
  if (drift.length) {
    console.log(`\nDRIFT (${drift.length})`);
    for (const { rel, existed } of drift.sort((a, b) => a.rel.localeCompare(b.rel))) {
      const verdict = existed ? classifyDrift(rel) : 'missing in target — never synced';
      console.log(`  ${rel}\n    ${verdict}`);
    }
  }
  if (expected.length) {
    console.log(`\nexpected per-project divergence (${expected.length} — adapt files, not drift)`);
    for (const { rel } of expected.sort((a, b) => a.rel.localeCompare(b.rel))) {
      console.log(`  ${rel}`);
    }
  }
  if (targetOnly.length) {
    section('target-only (review manually — possibly stale framework files)', targetOnly);
  }
  console.log(`\nunchanged (${unchanged.length}), skipped (${skipped.length})`);
  if (drift.length) {
    console.log('\nsync-check: DRIFT — run scripts/sync-framework.ts to update the target,');
    console.log('or upstream the target-ahead files to the template first.');
    process.exit(1);
  }
  console.log('\nsync-check: in sync ✔');
  process.exit(0);
}

const label = dryRun ? ' (dry run — nothing written)' : '';
console.log(`sync-framework: ${ROOT} -> ${TARGET}${label}`);
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
