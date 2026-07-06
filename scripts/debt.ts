#!/usr/bin/env node
// Tech-debt ledger tooling for DEBT.md.
//
//   node scripts/debt.ts           # list open entries
//   node scripts/debt.ts validate  # validate the ledger (verify step `debt`)
//
// Entry format (see DEBT.md header):
//   ## DEBT-<n>: <title>
//   severity: low|medium|high — module: <name|-> — found: YYYY-MM-DD — status: open|fixed|wontfix
//   [fixed-by: <ref>]            (required when status is fixed)
//   One paragraph description.
//
// Validation errors are named and line-numbered so an agent can fix them
// without re-deriving the format. Fenced code blocks are ignored, so the
// self-documenting template in the header does not trip the parser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.DEBT_ROOT
  ? resolve(process.env.DEBT_ROOT) + '/'
  : fileURLToPath(new URL('..', import.meta.url));
const DEBT_PATH = ROOT + 'DEBT.md';

const HEADING_RE = /^## (.+)$/;
const ID_RE = /^DEBT-(\d+): (.+)$/;
const META_RE = /^severity: (\S+) — module: (\S+) — found: (\d{4}-\d{2}-\d{2}) — status: (\S+)$/;
const SEVERITIES = new Set(['low', 'medium', 'high']);
const STATUSES = new Set(['open', 'fixed', 'wontfix']);

type DebtEntry = {
  id: number;
  title: string;
  severity: string;
  module: string;
  found: string;
  status: string;
  fixedBy: string | null;
  line: number;
};

type ParseResult = { entries: DebtEntry[]; errors: string[] };

function parseDebt(text: string): ParseResult {
  const entries: DebtEntry[] = [];
  const errors: string[] = [];
  const seen = new Map<number, number>(); // id -> first line
  const lines = text.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = line.match(HEADING_RE);
    if (!h) continue;
    const lineNo = i + 1;
    const heading = h[1] ?? '';
    const id = heading.match(ID_RE);
    if (!id) {
      errors.push(
        `bad-heading (line ${lineNo}): "## ${heading}" — expected "## DEBT-<n>: <title>"`,
      );
      continue;
    }
    const entryId = Number(id[1]);
    const first = seen.get(entryId);
    if (first !== undefined) {
      errors.push(
        `duplicate-id (line ${lineNo}): DEBT-${entryId} already defined at line ${first}`,
      );
    } else {
      seen.set(entryId, lineNo);
    }

    // Metadata must be the first non-empty line after the heading.
    let j = i + 1;
    while (j < lines.length && (lines[j] ?? '').trim() === '') j++;
    const meta = (lines[j] ?? '').trim().match(META_RE);
    if (!meta) {
      errors.push(
        `bad-metadata (line ${j + 1}): DEBT-${entryId} — expected "severity: low|medium|high — module: <name|-> — found: YYYY-MM-DD — status: open|fixed|wontfix"`,
      );
      continue;
    }
    const [, severity = '', module_ = '', found = '', status = ''] = meta;
    if (!SEVERITIES.has(severity)) {
      errors.push(
        `invalid-severity (line ${j + 1}): DEBT-${entryId} — "${severity}" is not one of low|medium|high`,
      );
    }
    if (!STATUSES.has(status)) {
      errors.push(
        `invalid-status (line ${j + 1}): DEBT-${entryId} — "${status}" is not one of open|fixed|wontfix`,
      );
    }

    // fixed-by line directly under the metadata line (blank lines allowed).
    let k = j + 1;
    while (k < lines.length && (lines[k] ?? '').trim() === '') k++;
    const fixedByMatch = (lines[k] ?? '').trim().match(/^fixed-by: (\S.*)$/);
    const fixedBy = fixedByMatch ? (fixedByMatch[1] ?? '').trim() : null;
    if (status === 'fixed' && !fixedBy) {
      errors.push(
        `missing-fixed-by (line ${j + 1}): DEBT-${entryId} is status: fixed but has no "fixed-by: <ref>" line under its metadata`,
      );
    }

    entries.push({
      id: entryId,
      title: (id[2] ?? '').trim(),
      severity,
      module: module_,
      found,
      status,
      fixedBy,
      line: lineNo,
    });
  }
  return { entries, errors };
}

function main(): void {
  const mode = process.argv[2] ?? 'list';
  let text: string;
  try {
    text = readFileSync(DEBT_PATH, 'utf8');
  } catch {
    console.error(`debt: DEBT.md not found at ${DEBT_PATH}`);
    process.exit(1);
  }
  const { entries, errors } = parseDebt(text!);

  if (mode === 'validate') {
    if (errors.length > 0) {
      for (const e of errors) console.error(`debt: ${e}`);
      console.error(`debt: ${errors.length} error(s) in DEBT.md`);
      process.exit(1);
    }
    console.log(`debt: OK (${entries.length} entries)`);
    return;
  }

  const open = entries.filter((e) => e.status === 'open');
  if (open.length === 0) {
    console.log('debt: no open entries');
    return;
  }
  for (const e of open) {
    console.log(`DEBT-${e.id} [${e.severity}] (${e.module}) ${e.title}`);
  }
  console.log(`debt: ${open.length} open of ${entries.length} total`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
