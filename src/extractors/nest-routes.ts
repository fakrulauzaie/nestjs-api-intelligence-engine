import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, EndpointRecord, HttpMethod, MethodRecord } from '../model/entities.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { makeAssertionId, makeEndpointId } from '../model/ids.js';
import { resolveSimpleString, type SimpleStringResolution } from '../ts-index/constants.js';
import {
  resolveImportedExpressionIdentity,
  type ResolvedDecoratorIdentity,
} from '../ts-index/decorators.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import {
  createClassRecord,
  createDeclarationEvidence,
  createMethodRecord,
} from './canonical-records.js';
import { isPackageDecorator, isPackageExpression } from './package-symbols.js';
import { normalizeRoutePath } from './route-paths.js';

export const NEST_ROUTE_RULE_ID = 'nest.route.standard.v1';

const NEST_COMMON_MODULE = '@nestjs/common';
export const NEST_ROUTE_DECORATOR_METHODS: Readonly<Record<string, HttpMethod>> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Options: 'OPTIONS',
  Head: 'HEAD',
  All: 'ALL',
};

export interface NestRouteExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly endpoints: readonly EndpointRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly endpointDeclarations: readonly NestEndpointDeclaration[];
}

export interface NestEndpointDeclaration {
  readonly endpointId: string;
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly indexedMethod: IndexedMethod;
}

interface PathResolution {
  readonly result: SimpleStringResolution;
  readonly evidenceIds: readonly string[];
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function callForDecorator(identity: ResolvedDecoratorIdentity): ts.CallExpression | null {
  return ts.isCallExpression(identity.node.expression) ? identity.node.expression : null;
}

function isSupportedController(identity: ResolvedDecoratorIdentity): boolean {
  return isPackageDecorator(identity, NEST_COMMON_MODULE, 'Controller');
}

function routeMethodFor(identity: ResolvedDecoratorIdentity): HttpMethod | null {
  if (
    identity.moduleSpecifier !== NEST_COMMON_MODULE ||
    identity.symbol === null ||
    identity.declarationFile === null
  ) {
    return null;
  }
  const httpMethod = NEST_ROUTE_DECORATOR_METHODS[identity.exportedName];
  return httpMethod !== undefined &&
    isPackageDecorator(identity, NEST_COMMON_MODULE, identity.exportedName)
    ? httpMethod
    : null;
}

function isCustomRouteDecorator(
  identity: ResolvedDecoratorIdentity,
  checker: ts.TypeChecker,
): boolean {
  if (routeMethodFor(identity) !== null || identity.symbol === null) return false;

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const called = resolveImportedExpressionIdentity(node.expression, checker);
      if (
        NEST_ROUTE_DECORATOR_METHODS[called.exportedName] !== undefined &&
        isPackageExpression(called, NEST_COMMON_MODULE, called.exportedName)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const declaration of identity.symbol.declarations ?? []) visit(declaration);
  return found;
}

function addEvidence(map: Map<string, EvidenceRecord>, record: EvidenceRecord): string {
  map.set(record.id, record);
  return record.id;
}

export function extractNestRoutes(input: {
  sourceIndex: SourceIndex;
  checker: ts.TypeChecker;
  repositoryRevision: string | null;
  evidenceSnippetLimit: number;
}): NestRouteExtraction {
  const classes: ClassRecord[] = [];
  const methods: MethodRecord[] = [];
  const endpointById = new Map<string, EndpointRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const diagnostics: DiagnosticRecord[] = [];
  const evidenceById = new Map<string, EvidenceRecord>();
  const endpointDeclarationById = new Map<string, NestEndpointDeclaration>();
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );

  const evidenceForResolution = (resolution: SimpleStringResolution): readonly string[] => {
    const variableDeclarations = resolution.evidenceNodes.filter(ts.isVariableDeclaration);
    return variableDeclarations.flatMap((node) => {
      const source = sourceByAbsolutePath.get(absolutePathKey(node.getSourceFile().fileName));
      if (source === undefined) return [];
      return [
        addEvidence(
          evidenceById,
          createEvidenceForNode({
            sourceFile: source.sourceFile,
            sourceFileRecord: source.inventorySource.record,
            node,
            role: 'resolution_basis',
            snippetLimit: input.evidenceSnippetLimit,
          }),
        ),
      ];
    });
  };

  const resolveDecoratorPath = (identity: ResolvedDecoratorIdentity): PathResolution => {
    const call = callForDecorator(identity);
    if (call === null || call.arguments.length > 1) {
      return {
        result: {
          status: 'unsupported',
          reason: 'dynamic_expression',
          evidenceNodes: [identity.node],
        },
        evidenceIds: [],
      };
    }
    if (call.arguments.length === 0) {
      return {
        result: { status: 'resolved', value: '', evidenceNodes: [identity.node] },
        evidenceIds: [],
      };
    }
    const result = resolveSimpleString(call.arguments[0]!, input.checker);
    return { result, evidenceIds: evidenceForResolution(result) };
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const controllerDecorators = indexedClass.decorators.filter(isSupportedController);
      if (controllerDecorators.length === 0) continue;

      const classDeclarationEvidenceId = addEvidence(
        evidenceById,
        createDeclarationEvidence(source, indexedClass.node, input.evidenceSnippetLimit),
      );
      const classRecord = createClassRecord({
        source,
        indexedClass,
        repositoryRevision: input.repositoryRevision,
        declarationEvidenceId: classDeclarationEvidenceId,
        roles: ['controller'],
      });
      classes.push(classRecord);

      const controllerDecorator = controllerDecorators[0]!;
      const controllerDecoratorEvidenceId = addEvidence(
        evidenceById,
        createEvidenceForNode({
          sourceFile: source.sourceFile,
          sourceFileRecord: source.inventorySource.record,
          node: controllerDecorator.node,
          role: 'decorator',
          snippetLimit: input.evidenceSnippetLimit,
        }),
      );
      const controllerPath = resolveDecoratorPath(controllerDecorator);
      if (controllerPath.result.status === 'unsupported' || controllerDecorators.length > 1) {
        diagnostics.push(
          createDiagnostic({
            code: 'NEST_ROUTE_DYNAMIC',
            subjectId: classRecord.id,
            message:
              controllerDecorators.length > 1
                ? `Multiple controller route decorators on ${indexedClass.qualifiedName} are unsupported.`
                : `Unsupported computed controller route path on ${indexedClass.qualifiedName}.`,
            evidenceIds: [controllerDecoratorEvidenceId, ...controllerPath.evidenceIds],
          }),
        );
      }

      for (const indexedMethod of indexedClass.methods) {
        const routeDecorators = indexedMethod.decorators.filter(
          (decorator) => routeMethodFor(decorator) !== null,
        );
        const customRouteDecorators = indexedMethod.decorators.filter((decorator) =>
          isCustomRouteDecorator(decorator, input.checker),
        );
        if (routeDecorators.length === 0 && customRouteDecorators.length === 0) continue;

        const methodDeclarationEvidenceId = addEvidence(
          evidenceById,
          createDeclarationEvidence(source, indexedMethod.node, input.evidenceSnippetLimit),
        );
        const methodRecord = createMethodRecord({
          source,
          indexedClass,
          method: indexedMethod,
          classId: classRecord.id,
          repositoryRevision: input.repositoryRevision,
          declarationEvidenceId: methodDeclarationEvidenceId,
        });
        methods.push(methodRecord);

        for (const customDecorator of customRouteDecorators) {
          const customEvidenceId = addEvidence(
            evidenceById,
            createEvidenceForNode({
              sourceFile: source.sourceFile,
              sourceFileRecord: source.inventorySource.record,
              node: customDecorator.node,
              role: 'decorator',
              snippetLimit: input.evidenceSnippetLimit,
            }),
          );
          diagnostics.push(
            createDiagnostic({
              code: 'NEST_CUSTOM_ROUTE_DECORATOR',
              subjectId: methodRecord.id,
              message: `Custom route decorator ${customDecorator.localName} on ${indexedMethod.qualifiedName} is unsupported.`,
              evidenceIds: [customEvidenceId],
            }),
          );
        }

        for (const routeDecorator of routeDecorators) {
          const httpMethod = routeMethodFor(routeDecorator)!;
          const routeDecoratorEvidenceId = addEvidence(
            evidenceById,
            createEvidenceForNode({
              sourceFile: source.sourceFile,
              sourceFileRecord: source.inventorySource.record,
              node: routeDecorator.node,
              role: 'decorator',
              snippetLimit: input.evidenceSnippetLimit,
            }),
          );
          const methodPath = resolveDecoratorPath(routeDecorator);
          if (methodPath.result.status === 'unsupported') {
            diagnostics.push(
              createDiagnostic({
                code: 'NEST_ROUTE_DYNAMIC',
                subjectId: methodRecord.id,
                message: `Unsupported computed route path on ${indexedMethod.qualifiedName}.`,
                evidenceIds: [routeDecoratorEvidenceId, ...methodPath.evidenceIds],
              }),
            );
            continue;
          }
          if (controllerPath.result.status === 'unsupported' || controllerDecorators.length > 1) {
            continue;
          }

          const path = normalizeRoutePath(controllerPath.result.value, methodPath.result.value);
          const endpointId = makeEndpointId({
            httpMethod,
            path,
            handlerMethodId: methodRecord.id,
            repositoryRevision: input.repositoryRevision,
          });
          endpointById.set(endpointId, { id: endpointId, httpMethod, path });
          endpointDeclarationById.set(endpointId, {
            endpointId,
            source,
            indexedClass,
            indexedMethod,
          });
          const assertionId = makeAssertionId({
            subjectId: endpointId,
            predicate: 'ENDPOINT_IMPLEMENTED_BY',
            objectId: methodRecord.id,
            ruleId: NEST_ROUTE_RULE_ID,
          });
          const assertionEvidenceIds = [
            ...new Set([
              controllerDecoratorEvidenceId,
              routeDecoratorEvidenceId,
              methodDeclarationEvidenceId,
              ...controllerPath.evidenceIds,
              ...methodPath.evidenceIds,
            ]),
          ];
          const existingAssertion = assertionById.get(assertionId);
          assertionById.set(assertionId, {
            id: assertionId,
            subjectId: endpointId,
            predicate: 'ENDPOINT_IMPLEMENTED_BY',
            objectId: methodRecord.id,
            status: 'resolved',
            ruleId: NEST_ROUTE_RULE_ID,
            evidenceIds:
              existingAssertion === undefined
                ? assertionEvidenceIds
                : [...new Set([...existingAssertion.evidenceIds, ...assertionEvidenceIds])],
          });
        }
      }
    }
  }

  return {
    classes,
    methods,
    endpoints: [...endpointById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics,
    endpointDeclarations: [...endpointDeclarationById.values()],
  };
}
