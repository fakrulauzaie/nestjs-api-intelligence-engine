import type { CliIo } from './types.js';
import { openLocalArtifact } from './local-artifact-preview.js';

export const processIo: CliIo = {
  openLocalArtifact(absolutePath, signal) {
    return openLocalArtifact(absolutePath, { signal });
  },
  writeOut(message) {
    process.stdout.write(`${message}\n`);
  },
  writeError(message) {
    process.stderr.write(`${message}\n`);
  },
};
