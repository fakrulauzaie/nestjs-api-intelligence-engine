import type { RecordId } from './entities.js';

export const EVIDENCE_ROLES = [
  'declaration',
  'decorator',
  'call_site',
  'type_reference',
  'resolution_basis',
] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/**
 * Evidence coordinates are one-based. The start is inclusive and the end is
 * exclusive, matching TypeScript node offsets after conversion to line/column pairs.
 */
export interface EvidenceRecord {
  readonly id: RecordId;
  readonly fileId: RecordId;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly role: EvidenceRole;
  readonly snippet?: string | undefined;
  readonly contentHash: string;
}

export interface SourceRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}
