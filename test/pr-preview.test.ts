// Probes for the Vercel-preview-URL extraction used by `pnpm pr` (see
// scripts/pr.ts). extractPreviewUrl is a pure function over `gh pr view
// --json statusCheckRollup,comments` output, so these run without `gh`.
import { describe, it, expect } from 'vitest';
import { extractPreviewUrl, chooseBranch, frameworkFiles, frameworkTail } from '../scripts/pr.ts';

describe('extractPreviewUrl', () => {
  it('finds a preview URL in a check targetUrl', () => {
    const json = JSON.stringify({
      statusCheckRollup: [
        { name: 'lint', targetUrl: 'https://ci.example.com/build/1' },
        { name: 'Vercel', targetUrl: 'https://my-app-git-feat-foo.vercel.app' },
      ],
      comments: [],
    });
    expect(extractPreviewUrl(json)).toBe('https://my-app-git-feat-foo.vercel.app');
  });

  it('finds a preview URL in a check detailsUrl', () => {
    const json = JSON.stringify({
      statusCheckRollup: [{ name: 'Vercel', detailsUrl: 'https://my-app.vercel.app/details' }],
      comments: [],
    });
    expect(extractPreviewUrl(json)).toBe('https://my-app.vercel.app/details');
  });

  it('finds a preview URL in a vercel[bot] comment when checks have none', () => {
    const json = JSON.stringify({
      statusCheckRollup: [{ name: 'lint', targetUrl: 'https://ci.example.com/build/2' }],
      comments: [
        { author: { login: 'someone' }, body: 'looks good' },
        {
          author: { login: 'vercel[bot]' },
          body: 'This preview is ready! https://my-app-git-abc123.vercel.app inspect it here.',
        },
      ],
    });
    expect(extractPreviewUrl(json)).toBe('https://my-app-git-abc123.vercel.app');
  });

  it('returns null when no vercel.app URL appears anywhere', () => {
    const json = JSON.stringify({
      statusCheckRollup: [{ name: 'lint', targetUrl: 'https://ci.example.com/build/3' }],
      comments: [{ author: { login: 'someone' }, body: 'looks good, ship it' }],
    });
    expect(extractPreviewUrl(json)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractPreviewUrl('not json')).toBeNull();
  });

  it('returns null for valid JSON that is not an object', () => {
    expect(extractPreviewUrl('null')).toBeNull();
    expect(extractPreviewUrl('42')).toBeNull();
  });
});

// Branch selection for `pnpm pr` when run from the default branch (see
// chooseBranch in scripts/pr.ts). Pins the stale-state fix: `.task/branch`
// is honored only when it matches the scope file's `branch` AND the branch
// doesn't already exist in git.
describe('chooseBranch', () => {
  const base = {
    branchFlag: undefined,
    title: 'fix: tidy the docs',
    taskBranch: '',
    scopeBranch: '',
    branchExists: false,
  };

  it('--branch flag wins over everything', () => {
    expect(
      chooseBranch({
        ...base,
        branchFlag: 'feat/explicit',
        taskBranch: 'feature/from-scope',
        scopeBranch: 'feature/from-scope',
      }),
    ).toBe('feat/explicit');
  });

  it('honors a fresh scope branch (matches scope file, not yet in git)', () => {
    expect(
      chooseBranch({ ...base, taskBranch: 'feature/topic', scopeBranch: 'feature/topic' }),
    ).toBe('feature/topic');
  });

  it('ignores a stale .task/branch whose branch already exists in git', () => {
    expect(
      chooseBranch({
        ...base,
        taskBranch: 'feature/claude-md',
        scopeBranch: 'feature/claude-md',
        branchExists: true,
      }),
    ).toBe('feat/fix-tidy-the-docs');
  });

  it('ignores .task/branch that disagrees with the scope file', () => {
    expect(
      chooseBranch({ ...base, taskBranch: 'feature/orphan', scopeBranch: 'feature/other' }),
    ).toBe('feat/fix-tidy-the-docs');
  });

  it('ignores .task/branch when no scope file corroborates it', () => {
    expect(chooseBranch({ ...base, taskBranch: 'feature/usr-bin-env-node' })).toBe(
      'feat/fix-tidy-the-docs',
    );
  });

  it('slugs the title when no branch state exists: lowercased, dashed, capped at 40', () => {
    expect(
      chooseBranch({ ...base, title: 'Feat: A Very Long Title That Keeps Going On And On!' }),
    ).toBe('feat/' + 'feat-a-very-long-title-that-keeps-going-on-and-on'.slice(0, 40));
  });
});

// Framework-gate helpers in `pnpm pr` (see frameworkFiles/frameworkTail in
// scripts/pr.ts): pure functions over a changed-file list and a
// test:framework output, so these run without git or vitest spawns.
describe('frameworkFiles', () => {
  it('keeps only framework-owned paths from a mixed change list', () => {
    expect(
      frameworkFiles([
        'src/modules/pricing/index.ts',
        'scripts/pr.ts',
        'README.md',
        'test/framework-gate.test.ts',
        'lefthook.yml',
      ]),
    ).toEqual(['scripts/pr.ts', 'test/framework-gate.test.ts', 'lefthook.yml']);
  });

  it('returns an empty list for an app-only diff', () => {
    expect(frameworkFiles(['src/modules/pricing/index.ts', 'DEBT.md', 'docs/notes.md'])).toEqual(
      [],
    );
  });

  it('does not match framework-like names outside the repo-root anchors', () => {
    expect(frameworkFiles(['src/scripts/helper.ts', 'app/lefthook.yml.bak'])).toEqual([]);
  });
});

describe('frameworkTail', () => {
  it('returns everything from the " Test Files " summary line onward', () => {
    const output = [
      '✓ test/a.test.ts (3 tests)',
      '✓ test/b.test.ts (5 tests)',
      ' Test Files  19 passed (19)',
      '      Tests  120 passed (120)',
      '   Duration  85.2s',
    ].join('\n');
    expect(frameworkTail(output)).toBe(
      [' Test Files  19 passed (19)', '      Tests  120 passed (120)', '   Duration  85.2s'].join(
        '\n',
      ),
    );
  });

  it('falls back to the last 10 lines when no summary marker exists', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
    expect(frameworkTail(lines.join('\n'))).toBe(lines.slice(-10).join('\n'));
  });

  it('ignores trailing blank lines when taking the fallback tail', () => {
    expect(frameworkTail('a\nb\n\n\n')).toBe('a\nb');
  });
});
