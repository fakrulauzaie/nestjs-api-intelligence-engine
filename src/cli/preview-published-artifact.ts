import type { CliIo } from './types.js';

export async function previewPublishedArtifact(
  absolutePath: string,
  label: string,
  io: CliIo,
): Promise<void> {
  try {
    if (io.openLocalArtifact === undefined) {
      throw new Error('No local preview capability is available in this runtime.');
    }
    await io.openLocalArtifact(absolutePath, io.signal);
    io.writeOut(`Opened ${label} in the default browser.`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The preview launcher failed.';
    io.writeError(
      `Warning: ${label} was published at ${absolutePath}, but preview could not be opened: ${detail}`,
    );
  }
}
