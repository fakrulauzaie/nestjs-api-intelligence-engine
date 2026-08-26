import type ts from 'typescript';
import type { SourceFileRecord } from '../model/entities.js';
import type { EvidenceRecord, EvidenceRole, SourceRange } from '../model/evidence.js';
import { hashContent } from '../model/hashing.js';
import { makeEvidenceId } from '../model/ids.js';
import { createBoundedSnippet, DEFAULT_EVIDENCE_SNIPPET_LIMIT } from './snippets.js';

export function sourceRangeFromOffsets(
  sourceFile: ts.SourceFile,
  startOffset: number,
  endOffset: number,
): SourceRange {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset < startOffset ||
    endOffset > sourceFile.text.length
  ) {
    throw new RangeError(`Invalid source offsets: ${startOffset}-${endOffset}.`);
  }

  const start = sourceFile.getLineAndCharacterOfPosition(startOffset);
  const end = sourceFile.getLineAndCharacterOfPosition(endOffset);

  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function sourceRangeForNode(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  return sourceRangeFromOffsets(sourceFile, node.getStart(sourceFile, false), node.getEnd());
}

export function createEvidenceForNode(input: {
  sourceFile: ts.SourceFile;
  sourceFileRecord: SourceFileRecord;
  node: ts.Node;
  role: EvidenceRole;
  snippetLimit?: number;
}): EvidenceRecord {
  return createEvidenceForOffsets({
    ...input,
    startOffset: input.node.getStart(input.sourceFile, false),
    endOffset: input.node.getEnd(),
  });
}

export function createEvidenceForOffsets(input: {
  sourceFile: ts.SourceFile;
  sourceFileRecord: SourceFileRecord;
  startOffset: number;
  endOffset: number;
  role: EvidenceRole;
  snippetLimit?: number;
}): EvidenceRecord {
  const currentHash = hashContent(input.sourceFile.text);
  if (currentHash !== input.sourceFileRecord.contentHash) {
    throw new Error(
      `Source content hash does not match indexed file ${input.sourceFileRecord.path}.`,
    );
  }

  const range = sourceRangeFromOffsets(input.sourceFile, input.startOffset, input.endOffset);
  const snippet = createBoundedSnippet(
    input.sourceFile.text.slice(input.startOffset, input.endOffset),
    input.snippetLimit ?? DEFAULT_EVIDENCE_SNIPPET_LIMIT,
  );

  return {
    id: makeEvidenceId({
      fileId: input.sourceFileRecord.id,
      range,
      role: input.role,
      contentHash: input.sourceFileRecord.contentHash,
    }),
    fileId: input.sourceFileRecord.id,
    ...range,
    role: input.role,
    snippet,
    contentHash: input.sourceFileRecord.contentHash,
  };
}
