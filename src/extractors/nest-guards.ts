import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { GuardScope } from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, GuardRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { DIRECT_GUARD_RULE_IDS } from '../model/guard-rules.js';
import { makeAssertionId, makeGuardId } from '../model/ids.js';
import { resolvedSymbolAt } from '../ts-index/symbols.js';
import type { IndexedClass, IndexedSourceFile, SourceIndex } from '../ts-index/source-index.js';
import { createClassRecord, createDeclarationEvidence } from './canonical-records.js';
import type { NestEndpointDeclaration } from './nest-routes.js';
import { isPackageDecorator } from './package-symbols.js';

const NEST_COMMON_MODULE = '@nestjs/common';

export interface NestGuardExtraction {
  readonly classes: readonly ClassRecord[];
  readonly guards: readonly GuardRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

interface IndexedClassLocation {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
}

function useGuardsDecorator(
  decorator: NestEndpointDeclaration['indexedClass']['decorators'][number],
): boolean {
  return isPackageDecorator(decorator, NEST_COMMON_MODULE, 'UseGuards');
}

function addEvidence(map: Map<string, EvidenceRecord>, record: EvidenceRecord): string {
  map.set(record.id, record);
  return record.id;
}

export function extractNestGuards(input: {
  sourceIndex: SourceIndex;
  checker: ts.TypeChecker;
  endpointDeclarations: readonly NestEndpointDeclaration[];
  repositoryRevision: string | null;
  evidenceSnippetLimit: number;
}): NestGuardExtraction {
  const classBySymbol = new Map<ts.Symbol, IndexedClassLocation[]>();
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      if (indexedClass.symbol === null) continue;
      const locations = classBySymbol.get(indexedClass.symbol) ?? [];
      locations.push({ source, indexedClass });
      classBySymbol.set(indexedClass.symbol, locations);
    }
  }

  const classById = new Map<string, ClassRecord>();
  const guardById = new Map<string, GuardRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticById = new Map<string, DiagnosticRecord>();

  const extractForScope = (
    declaration: NestEndpointDeclaration,
    scope: Extract<GuardScope, 'controller' | 'method'>,
  ): void => {
    const decorators = (
      scope === 'controller'
        ? declaration.indexedClass.decorators
        : declaration.indexedMethod.decorators
    ).filter(useGuardsDecorator);

    for (const decorator of decorators) {
      const decoratorEvidenceId = addEvidence(
        evidenceById,
        createEvidenceForNode({
          sourceFile: declaration.source.sourceFile,
          sourceFileRecord: declaration.source.inventorySource.record,
          node: decorator.node,
          role: 'decorator',
          snippetLimit: input.evidenceSnippetLimit,
        }),
      );
      const call = ts.isCallExpression(decorator.node.expression)
        ? decorator.node.expression
        : null;
      const argumentsToResolve = call?.arguments ?? [];

      if (call === null || argumentsToResolve.length === 0) {
        const diagnostic = createDiagnostic({
          code: 'NEST_GUARD_UNRESOLVED',
          subjectId: declaration.endpointId,
          message: `Direct ${scope} @UseGuards declaration has no supported guard class argument.`,
          evidenceIds: [decoratorEvidenceId],
        });
        diagnosticById.set(diagnostic.id, diagnostic);
        continue;
      }

      for (const guardExpression of argumentsToResolve) {
        const expressionEvidenceId = addEvidence(
          evidenceById,
          createEvidenceForNode({
            sourceFile: declaration.source.sourceFile,
            sourceFileRecord: declaration.source.inventorySource.record,
            node: guardExpression,
            role: 'resolution_basis',
            snippetLimit: input.evidenceSnippetLimit,
          }),
        );
        const symbol = resolvedSymbolAt(input.checker, guardExpression);
        const candidates = symbol === null ? [] : (classBySymbol.get(symbol) ?? []);
        if (candidates.length !== 1) {
          const diagnostic = createDiagnostic({
            code: 'NEST_GUARD_UNRESOLVED',
            subjectId: declaration.endpointId,
            message: `Direct ${scope} guard expression ${guardExpression.getText()} could not be resolved to exactly one repository class.`,
            evidenceIds: [decoratorEvidenceId, expressionEvidenceId],
          });
          diagnosticById.set(diagnostic.id, diagnostic);
          continue;
        }

        const candidate = candidates[0]!;
        const declarationEvidenceId = addEvidence(
          evidenceById,
          createDeclarationEvidence(
            candidate.source,
            candidate.indexedClass.node,
            input.evidenceSnippetLimit,
          ),
        );
        const classRecord = createClassRecord({
          source: candidate.source,
          indexedClass: candidate.indexedClass,
          repositoryRevision: input.repositoryRevision,
          declarationEvidenceId,
          roles: ['guard'],
        });
        classById.set(classRecord.id, classRecord);
        const guardId = makeGuardId(classRecord.id);
        guardById.set(guardId, {
          id: guardId,
          classId: classRecord.id,
          displayName: classRecord.displayName,
        });
        const ruleId = DIRECT_GUARD_RULE_IDS[scope];
        const assertionId = makeAssertionId({
          subjectId: declaration.endpointId,
          predicate: 'ENDPOINT_USES_GUARD',
          objectId: guardId,
          ruleId,
        });
        assertionById.set(assertionId, {
          id: assertionId,
          subjectId: declaration.endpointId,
          predicate: 'ENDPOINT_USES_GUARD',
          objectId: guardId,
          status: 'resolved',
          ruleId,
          evidenceIds: [decoratorEvidenceId],
        });
      }
    }
  };

  for (const declaration of input.endpointDeclarations) {
    extractForScope(declaration, 'controller');
    extractForScope(declaration, 'method');
  }

  return {
    classes: [...classById.values()],
    guards: [...guardById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
  };
}
