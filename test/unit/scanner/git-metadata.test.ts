import { describe, expect, it, vi } from 'vitest';
import { readLocalGitRevision } from '../../../src/scanner/git-metadata.js';

describe('local Git metadata', () => {
  it('reads HEAD without invoking hooks or a shell', async () => {
    const revision = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const runner = vi.fn(async () => `${revision}\n`);

    await expect(readLocalGitRevision('/repo', runner)).resolves.toBe(revision.toLowerCase());
    expect(runner).toHaveBeenCalledWith('/repo', ['rev-parse', '--verify', 'HEAD']);
  });

  it('treats missing Git metadata and invalid output as absence', async () => {
    await expect(readLocalGitRevision('/repo', async () => 'not-a-revision')).resolves.toBeNull();
    await expect(
      readLocalGitRevision('/repo', async () => {
        throw new Error('git unavailable');
      }),
    ).resolves.toBeNull();
  });
});
