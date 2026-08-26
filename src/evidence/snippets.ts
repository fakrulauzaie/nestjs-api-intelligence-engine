import { redactSecrets } from './redact.js';

export const DEFAULT_EVIDENCE_SNIPPET_LIMIT = 240;

export function createBoundedSnippet(
  sourceFragment: string,
  maximumCodePoints = DEFAULT_EVIDENCE_SNIPPET_LIMIT,
): string {
  if (!Number.isInteger(maximumCodePoints) || maximumCodePoints < 1) {
    throw new RangeError('Evidence snippet limit must be a positive integer.');
  }

  const redacted = redactSecrets(sourceFragment.trim());
  const codePoints = [...redacted];
  if (codePoints.length <= maximumCodePoints) {
    return redacted;
  }

  if (maximumCodePoints === 1) {
    return '…';
  }

  return `${codePoints.slice(0, maximumCodePoints - 1).join('')}…`;
}
