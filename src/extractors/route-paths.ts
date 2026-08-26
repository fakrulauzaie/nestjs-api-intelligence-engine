export function normalizeRoutePath(...parts: readonly string[]): string {
  const segments = parts
    .flatMap((part) => part.normalize('NFC').split('/'))
    .filter((segment) => segment.length > 0);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}
