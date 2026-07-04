// Probes for the Vercel-preview-URL extraction used by `pnpm pr` (see
// scripts/pr.ts). extractPreviewUrl is a pure function over `gh pr view
// --json statusCheckRollup,comments` output, so these run without `gh`.
import { describe, it, expect } from 'vitest';
import { extractPreviewUrl } from '../scripts/pr.ts';

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
