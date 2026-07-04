#!/usr/bin/env node
// Append-only run ledger. Every verify / scope / pr run drops a JSON line into
// edit-log.jsonl so an agent (or a human) can see what happened, when, and whether
// it passed — without trawling shell history.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LOG_PATH = fileURLToPath(new URL('../edit-log.jsonl', import.meta.url));

export type RunRecord = Record<string, unknown> & { kind: string };

export function appendRun(record: RunRecord): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
  appendFileSync(LOG_PATH, line + '\n');
}

// CLI: `edit-log.ts '{"kind":"note","msg":"hi"}'` appends a record.
//      `edit-log.ts` with no arg prints the last 20 records.
function main(): void {
  const arg = process.argv[2];
  if (arg) {
    appendRun(JSON.parse(arg) as RunRecord);
    return;
  }
  let content = '';
  try {
    content = readFileSync(LOG_PATH, 'utf8');
  } catch {
    console.log('(edit-log.jsonl is empty)');
    return;
  }
  const lines = content.trim().split('\n').filter(Boolean);
  for (const line of lines.slice(-20)) console.log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
