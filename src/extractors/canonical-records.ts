import ts from 'typescript';
import { createEvidenceForOffsets } from '../evidence/locations.js';
import { createBoundedSnippet } from '../evidence/snippets.js';
import type { ClassRole, ClassRecord, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { makeClassId, makeMethodId } from '../model/ids.js';
import type { IndexedClass, IndexedMethod, IndexedSourceFile } from '../ts-index/source-index.js';

export function declarationStart(node: ts.Node): number {
  const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
  const lastDecorator = decorators.at(-1);
  if (lastDecorator === undefined) return node.getStart(node.getSourceFile(), false);

  const sourceText = node.getSourceFile().text;
  let start = lastDecorator.getEnd();
  while (start < node.getEnd() && /\s/u.test(sourceText[start] ?? '')) start += 1;
  return start;
}

export function createDeclarationEvidence(
  source: IndexedSourceFile,
  node: ts.Node,
  snippetLimit: number,
): EvidenceRecord {
  const startOffset = declarationStart(node);
  const record = createEvidenceForOffsets({
    sourceFile: source.sourceFile,
    sourceFileRecord: source.inventorySource.record,
    startOffset,
    endOffset: node.getEnd(),
    role: 'declaration',
    snippetLimit,
  });
  const body =
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
      ? node.body
      : ts.isClassDeclaration(node) || ts.isClassExpression(node)
        ? node
        : undefined;
  if (body === undefined) return record;

  const bodyStart =
    ts.isClassDeclaration(body) || ts.isClassExpression(body)
      ? source.sourceFile.text.indexOf('{', startOffset)
      : body.getStart(source.sourceFile, false);
  if (bodyStart < startOffset || bodyStart >= node.getEnd()) return record;
  return {
    ...record,
    snippet: createBoundedSnippet(
      `${source.sourceFile.text.slice(startOffset, bodyStart).trimEnd()} { … }`,
      snippetLimit,
    ),
  };
}

export function createClassRecord(input: {
  source: IndexedSourceFile;
  indexedClass: IndexedClass;
  repositoryRevision: string | null;
  declarationEvidenceId: string;
  roles: readonly ClassRole[];
}): ClassRecord {
  return {
    id: makeClassId({
      path: input.source.inventorySource.record.path,
      qualifiedName: input.indexedClass.qualifiedName,
      repositoryRevision: input.repositoryRevision,
    }),
    sourceFileId: input.source.inventorySource.record.id,
    qualifiedName: input.indexedClass.qualifiedName,
    displayName: input.indexedClass.name,
    roles: input.roles,
    declarationEvidenceId: input.declarationEvidenceId,
  };
}

export function createMethodRecord(input: {
  source: IndexedSourceFile;
  indexedClass: IndexedClass;
  method: IndexedMethod;
  classId: string;
  repositoryRevision: string | null;
  declarationEvidenceId: string;
}): MethodRecord {
  return {
    id: makeMethodId({
      path: input.source.inventorySource.record.path,
      qualifiedClassName: input.indexedClass.qualifiedName,
      methodName: input.method.name,
      signature: input.method.signature,
      repositoryRevision: input.repositoryRevision,
    }),
    classId: input.classId,
    qualifiedName: input.method.qualifiedName,
    displayName: input.method.name,
    signature: input.method.signature,
    declarationEvidenceId: input.declarationEvidenceId,
  };
}
