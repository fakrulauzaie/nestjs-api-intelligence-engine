import { EXIT_CODE } from './errors.js';

export function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

export function reportCancellation(io: { writeError(message: string): void }): number {
  io.writeError('Operation canceled. No partial canonical analysis was published.');
  return EXIT_CODE.canceled;
}
