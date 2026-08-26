import { stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createTemporaryDirectory } from './temp-directory.js';

describe('createTemporaryDirectory', () => {
  it('creates a uniquely named directory and removes it on cleanup', async () => {
    const temporaryDirectory = await createTemporaryDirectory();

    expect((await stat(temporaryDirectory.path)).isDirectory()).toBe(true);

    await temporaryDirectory.cleanup();

    await expect(stat(temporaryDirectory.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
