// The auto-format PostToolUse hook must only format files inside THIS repo.
// Agent sessions can write files in other repos (vendoring, cross-repo work);
// running this repo's Prettier on them imposes foreign style and churns diffs.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupProbe, plantUnformattedProbe, run } from './helpers.ts';

const UNFORMATTED = 'export const x =    1\n';

function invokeHook(filePath: string, cwd?: string): { status: number | null; out: string } {
  const payload = JSON.stringify({ tool_input: { file_path: filePath }, cwd });
  return run('node', ['.claude/hooks/auto-format.ts'], { input: payload });
}

describe('auto-format hook repo boundary', () => {
  it('leaves files outside the repo root untouched', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'autofmt-outside-'));
    const file = join(tmp, 'other-repo-file.ts');
    try {
      writeFileSync(file, UNFORMATTED);
      const { status } = invokeHook(file, tmp);
      expect(status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(UNFORMATTED);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('still formats files inside the repo', () => {
    const dir = plantUnformattedProbe('__autofmt_probe__');
    const file = join(dir, 'index.ts');
    try {
      const { status } = invokeHook(file);
      expect(status).toBe(0);
      expect(readFileSync(file, 'utf8')).not.toBe(UNFORMATTED);
    } finally {
      cleanupProbe('__autofmt_probe__');
    }
  });
});
