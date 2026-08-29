import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import {
  AUTHORIZATION_RULE_IDS,
  type AuthorizationAnalysisConfiguration,
  type AuthorizationDecoratorIdentity,
  type AuthorizationEnforcementRecord,
  type AuthorizationMetadataRecord,
  type AuthorizationSymbolReference,
  type AuthorizationValueShape,
} from '../model/authorization.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type {
  ClassRecord,
  GlobalGuardRegistrationRecord,
  GuardRecord,
  ModuleRecord,
} from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  makeAssertionId,
  makeAuthorizationEnforcementId,
  makeAuthorizationMetadataId,
  makeClassId,
  makeGuardId,
} from '../model/ids.js';
import { resolveSimpleString } from '../ts-index/constants.js';
import { resolveImportedExpressionIdentity } from '../ts-index/decorators.js';
import { resolvedSymbolAt } from '../ts-index/symbols.js';
import type { IndexedClass, IndexedSourceFile, SourceIndex } from '../ts-index/source-index.js';
import { createClassRecord, createDeclarationEvidence } from './canonical-records.js';
import type { NestEndpointDeclaration } from './nest-routes.js';
import { isPackageDecorator, isPackageExpression } from './package-symbols.js';

const NEST_COMMON_MODULE = '@nestjs/common';

export interface NestAuthorizationExtraction {
  readonly classes: readonly ClassRecord[];
  readonly guards: readonly GuardRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly metadata: readonly AuthorizationMetadataRecord[];
  readonly enforcements: readonly AuthorizationEnforcementRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

interface ClassLocation {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
}

interface WrapperDescriptor {
  readonly source: IndexedSourceFile;
  readonly declaration: ts.Declaration;
  readonly metadataKey: string;
  readonly valueExpression: ts.Expression;
  readonly parameters: readonly ts.ParameterDeclaration[];
  readonly guardExpressions: readonly ts.Expression[];
  readonly composite: boolean;
}

function absolutePathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function addEvidence(map: Map<string, EvidenceRecord>, record: EvidenceRecord): string {
  map.set(record.id, record);
  return record.id;
}

function scalarType(expression: ts.Expression): 'string' | 'number' | 'boolean' | 'null' | null {
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return 'string';
  }
  if (ts.isNumericLiteral(expression)) return 'number';
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return 'boolean';
  }
  return expression.kind === ts.SyntaxKind.NullKeyword ? 'null' : null;
}

function valueShape(expression: ts.Expression | undefined): AuthorizationValueShape {
  if (expression === undefined) return { kind: 'unknown', redacted: true };
  const scalar = scalarType(expression);
  if (scalar !== null) return { kind: 'scalar', scalarType: scalar, redacted: true };
  if (ts.isArrayLiteralExpression(expression)) {
    const types = expression.elements.flatMap((item) => {
      if (ts.isSpreadElement(item)) return [];
      const type = scalarType(item);
      return type === null ? [] : [type];
    });
    return {
      kind: 'array',
      itemCount: expression.elements.length,
      itemTypes: [...new Set(types)].sort(),
      dynamicItems: expression.elements.some(
        (item) => ts.isSpreadElement(item) || scalarType(item) === null,
      ),
      redacted: true,
    };
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const keys: string[] = [];
    let dynamicKeys = false;
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property) || property.name === undefined) {
        dynamicKeys = true;
        continue;
      }
      if (
        ts.isIdentifier(property.name) ||
        ts.isStringLiteral(property.name) ||
        ts.isNumericLiteral(property.name)
      ) {
        keys.push(property.name.text);
      } else {
        dynamicKeys = true;
      }
    }
    return {
      kind: 'object',
      keys: [...new Set(keys)].sort(),
      dynamicKeys,
      redacted: true,
    };
  }
  return { kind: 'unknown', redacted: true };
}

function wrapperResultExpression(declaration: ts.Declaration): {
  readonly expression: ts.Expression;
  readonly parameters: readonly ts.ParameterDeclaration[];
} | null {
  let functionLike: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | null = null;
  if (ts.isFunctionDeclaration(declaration)) functionLike = declaration;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    functionLike = declaration.initializer;
  }
  if (functionLike === null || functionLike.body === undefined) return null;
  if (!ts.isBlock(functionLike.body)) {
    return { expression: functionLike.body, parameters: functionLike.parameters };
  }
  if (functionLike.body.statements.length !== 1) return null;
  const statement = functionLike.body.statements[0]!;
  return ts.isReturnStatement(statement) && statement.expression !== undefined
    ? { expression: statement.expression, parameters: functionLike.parameters }
    : null;
}

function nestCall(call: ts.CallExpression, checker: ts.TypeChecker, exportedName: string): boolean {
  const identity = resolveImportedExpressionIdentity(call.expression, checker);
  return isPackageExpression(identity, NEST_COMMON_MODULE, exportedName);
}

function metadataCall(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): {
  readonly key: string;
  readonly value: ts.Expression;
  readonly call: ts.CallExpression;
} | null {
  if (!ts.isCallExpression(expression) || !nestCall(expression, checker, 'SetMetadata'))
    return null;
  if (expression.arguments.length !== 2) return null;
  const key = resolveSimpleString(expression.arguments[0]!, checker);
  return key.status === 'resolved'
    ? { key: key.value, value: expression.arguments[1]!, call: expression }
    : null;
}

function wrapperDescriptor(input: {
  symbol: ts.Symbol;
  checker: ts.TypeChecker;
  sourceByAbsolutePath: ReadonlyMap<string, IndexedSourceFile>;
}): WrapperDescriptor | null {
  const declarations = (input.symbol.declarations ?? []).filter(
    (declaration) => ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration),
  );
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  const source = input.sourceByAbsolutePath.get(
    absolutePathKey(declaration.getSourceFile().fileName),
  );
  if (source === undefined) return null;
  const result = wrapperResultExpression(declaration);
  if (result === null) return null;

  const directMetadata = metadataCall(result.expression, input.checker);
  if (directMetadata !== null) {
    return {
      source,
      declaration,
      metadataKey: directMetadata.key,
      valueExpression: directMetadata.value,
      parameters: result.parameters,
      guardExpressions: [],
      composite: false,
    };
  }
  if (
    !ts.isCallExpression(result.expression) ||
    !nestCall(result.expression, input.checker, 'applyDecorators')
  ) {
    return null;
  }
  const metadata = result.expression.arguments.flatMap((argument) => {
    const resolved = metadataCall(argument, input.checker);
    return resolved === null ? [] : [resolved];
  });
  if (metadata.length !== 1) return null;
  const guardExpressions = result.expression.arguments.flatMap((argument) =>
    ts.isCallExpression(argument) && nestCall(argument, input.checker, 'UseGuards')
      ? [...argument.arguments]
      : [],
  );
  return {
    source,
    declaration,
    metadataKey: metadata[0]!.key,
    valueExpression: metadata[0]!.value,
    parameters: result.parameters,
    guardExpressions,
    composite: guardExpressions.length > 0,
  };
}

function configuredSymbolMatches(input: {
  reference: AuthorizationSymbolReference;
  decorator: NestEndpointDeclaration['indexedClass']['decorators'][number];
  sourceByAbsolutePath: ReadonlyMap<string, IndexedSourceFile>;
}): boolean {
  if (input.reference.kind === 'package_export') {
    return isPackageDecorator(
      input.decorator,
      input.reference.moduleSpecifier,
      input.reference.exportedName,
    );
  }
  const declaration = input.decorator.symbol?.declarations?.[0];
  if (declaration === undefined || input.decorator.symbol?.name !== input.reference.exportedName) {
    return false;
  }
  const source = input.sourceByAbsolutePath.get(
    absolutePathKey(declaration.getSourceFile().fileName),
  );
  return source?.inventorySource.record.path === input.reference.sourceFile;
}

function invocationValueShape(input: {
  call: ts.CallExpression | null;
  wrapper: WrapperDescriptor | null;
  directValue?: ts.Expression | undefined;
}): AuthorizationValueShape {
  if (input.directValue !== undefined) return valueShape(input.directValue);
  if (input.call === null) return { kind: 'unknown', redacted: true };
  if (input.wrapper === null) {
    return {
      kind: 'array',
      itemCount: input.call.arguments.length,
      itemTypes: [
        ...new Set(input.call.arguments.flatMap((argument) => scalarType(argument) ?? [])),
      ].sort(),
      dynamicItems: input.call.arguments.some((argument) => scalarType(argument) === null),
      redacted: true,
    };
  }
  if (ts.isIdentifier(input.wrapper.valueExpression)) {
    const valueParameterName = input.wrapper.valueExpression.text;
    const parameterIndex = input.wrapper.parameters.findIndex(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === valueParameterName,
    );
    if (parameterIndex >= 0) {
      const parameter = input.wrapper.parameters[parameterIndex]!;
      if (parameter.dotDotDotToken !== undefined) {
        return {
          kind: 'array',
          itemCount: Math.max(0, input.call.arguments.length - parameterIndex),
          itemTypes: [
            ...new Set(
              input.call.arguments
                .slice(parameterIndex)
                .flatMap((argument) => scalarType(argument) ?? []),
            ),
          ].sort(),
          dynamicItems: input.call.arguments
            .slice(parameterIndex)
            .some((argument) => scalarType(argument) === null),
          redacted: true,
        };
      }
      return valueShape(input.call.arguments[parameterIndex]);
    }
  }
  return valueShape(input.wrapper.valueExpression);
}

function decoratorKey(identity: AuthorizationDecoratorIdentity): string {
  return `${identity.kind}:${identity.moduleSpecifier ?? ''}:${identity.sourceFileId ?? ''}:${identity.exportedName}`;
}

export function extractNestAuthorization(input: {
  sourceIndex: SourceIndex;
  checker: ts.TypeChecker;
  endpointDeclarations: readonly NestEndpointDeclaration[];
  repositoryRevision: string | null;
  evidenceSnippetLimit: number;
  configuration: AuthorizationAnalysisConfiguration;
  existingClasses: readonly ClassRecord[];
  existingGuards: readonly GuardRecord[];
  existingAssertions: readonly AssertionRecord[];
  modules: readonly ModuleRecord[];
  moduleAssertions: readonly AssertionRecord[];
  applicationRootModuleIds: readonly string[];
  globalGuardRegistrations: readonly GlobalGuardRegistrationRecord[];
}): NestAuthorizationExtraction {
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );
  const classLocationsBySymbol = new Map<ts.Symbol, ClassLocation[]>();
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      if (indexedClass.symbol === null) continue;
      classLocationsBySymbol.set(indexedClass.symbol, [
        ...(classLocationsBySymbol.get(indexedClass.symbol) ?? []),
        { source, indexedClass },
      ]);
    }
  }

  const classById = new Map(input.existingClasses.map((record) => [record.id, record]));
  const guardById = new Map(input.existingGuards.map((record) => [record.id, record]));
  const assertionById = new Map(input.existingAssertions.map((record) => [record.id, record]));
  const ownClassIds = new Set<string>();
  const ownGuardIds = new Set<string>();
  const ownAssertionIds = new Set<string>();
  const metadataById = new Map<string, AuthorizationMetadataRecord>();
  const enforcementById = new Map<string, AuthorizationEnforcementRecord>();
  const compositeAssertionsByMetadata = new Map<string, string[]>();
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticById = new Map<string, DiagnosticRecord>();
  const configuredKeys = new Set(input.configuration.metadataKeys);

  const guardForExpression = (
    expression: ts.Expression,
    endpointId: string,
    decoratorEvidenceId: string,
    scope: 'controller' | 'method',
  ): { readonly guardId: string; readonly assertionId: string } | null => {
    const expressionEvidenceId = addEvidence(
      evidenceById,
      createEvidenceForNode({
        sourceFile: expression.getSourceFile(),
        sourceFileRecord: sourceByAbsolutePath.get(
          absolutePathKey(expression.getSourceFile().fileName),
        )!.inventorySource.record,
        node: expression,
        role: 'resolution_basis',
        snippetLimit: input.evidenceSnippetLimit,
      }),
    );
    const symbol = resolvedSymbolAt(input.checker, expression);
    const candidates = symbol === null ? [] : (classLocationsBySymbol.get(symbol) ?? []);
    if (candidates.length !== 1) {
      const diagnostic = createDiagnostic({
        code: 'NEST_GUARD_UNRESOLVED',
        subjectId: endpointId,
        message: `Composite ${scope} guard expression could not be resolved to exactly one repository class.`,
        evidenceIds: [decoratorEvidenceId, expressionEvidenceId],
      });
      diagnosticById.set(diagnostic.id, diagnostic);
      return null;
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
    ownClassIds.add(classRecord.id);
    const guardId = makeGuardId(classRecord.id);
    guardById.set(guardId, {
      id: guardId,
      classId: classRecord.id,
      displayName: classRecord.displayName,
    });
    ownGuardIds.add(guardId);
    const ruleId =
      scope === 'controller'
        ? AUTHORIZATION_RULE_IDS.compositeControllerGuard
        : AUTHORIZATION_RULE_IDS.compositeMethodGuard;
    const assertionId = makeAssertionId({
      subjectId: endpointId,
      predicate: 'ENDPOINT_USES_GUARD',
      objectId: guardId,
      ruleId,
    });
    assertionById.set(assertionId, {
      id: assertionId,
      subjectId: endpointId,
      predicate: 'ENDPOINT_USES_GUARD',
      objectId: guardId,
      status: 'resolved',
      ruleId,
      evidenceIds: [decoratorEvidenceId, expressionEvidenceId],
    });
    ownAssertionIds.add(assertionId);
    return { guardId, assertionId };
  };

  for (const declaration of input.endpointDeclarations) {
    for (const scope of ['controller', 'method'] as const) {
      const decorators =
        scope === 'controller'
          ? declaration.indexedClass.decorators
          : declaration.indexedMethod.decorators;
      for (const decorator of decorators) {
        const call = ts.isCallExpression(decorator.node.expression)
          ? decorator.node.expression
          : null;
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

        let metadataKey: string | null = null;
        let source: AuthorizationMetadataRecord['source'] | null = null;
        let identity: AuthorizationDecoratorIdentity | null = null;
        let wrapper: WrapperDescriptor | null = null;
        let directValue: ts.Expression | undefined;

        if (isPackageDecorator(decorator, NEST_COMMON_MODULE, 'SetMetadata') && call !== null) {
          const direct = metadataCall(call, input.checker);
          if (direct !== null && configuredKeys.has(direct.key)) {
            metadataKey = direct.key;
            directValue = direct.value;
            source = 'direct_set_metadata';
            identity = {
              kind: 'direct_set_metadata',
              moduleSpecifier: NEST_COMMON_MODULE,
              exportedName: 'SetMetadata',
              sourceFileId: null,
            };
          }
        } else if (decorator.symbol !== null) {
          wrapper = wrapperDescriptor({
            symbol: decorator.symbol,
            checker: input.checker,
            sourceByAbsolutePath,
          });
          if (wrapper !== null && (wrapper.composite || configuredKeys.has(wrapper.metadataKey))) {
            metadataKey = wrapper.metadataKey;
            source = 'repository_wrapper';
            identity = {
              kind: 'repository_symbol',
              moduleSpecifier: null,
              exportedName: decorator.symbol.name,
              sourceFileId: wrapper.source.inventorySource.record.id,
            };
          }
        }

        if (metadataKey === null) {
          const configured = input.configuration.decoratorSymbols.find(({ symbol }) =>
            configuredSymbolMatches({ reference: symbol, decorator, sourceByAbsolutePath }),
          );
          if (configured !== undefined) {
            metadataKey = configured.metadataKey;
            source = 'configured_decorator';
            identity = {
              kind: 'configured_symbol',
              moduleSpecifier:
                configured.symbol.kind === 'package_export'
                  ? configured.symbol.moduleSpecifier
                  : null,
              exportedName: configured.symbol.exportedName,
              sourceFileId:
                configured.symbol.kind === 'repository_export'
                  ? (input.sourceIndex.sourceByPath.get(configured.symbol.sourceFile)
                      ?.inventorySource.record.id ?? null)
                  : null,
            };
          }
        }

        if (metadataKey === null || source === null || identity === null) continue;
        const shape = invocationValueShape({ call, wrapper, directValue });
        const ruleId =
          source === 'direct_set_metadata'
            ? AUTHORIZATION_RULE_IDS.directMetadata
            : source === 'repository_wrapper'
              ? AUTHORIZATION_RULE_IDS.repositoryWrapper
              : AUTHORIZATION_RULE_IDS.configuredDecorator;
        const metadataId = makeAuthorizationMetadataId({
          endpointId: declaration.endpointId,
          scope,
          metadataKey,
          decoratorKey: decoratorKey(identity),
          decoratorEvidenceId,
          ruleId,
        });
        const metadata: AuthorizationMetadataRecord = {
          id: metadataId,
          endpointId: declaration.endpointId,
          scope,
          metadataKey,
          source,
          decorator: identity,
          valueShape: shape,
          ruleId,
          evidenceIds: [decoratorEvidenceId],
        };
        metadataById.set(metadata.id, metadata);
        if (shape.kind === 'unknown') {
          const diagnostic = createDiagnostic({
            code: 'AUTHORIZATION_METADATA_VALUE_DYNAMIC',
            subjectId: metadata.id,
            evidenceIds: metadata.evidenceIds,
          });
          diagnosticById.set(diagnostic.id, diagnostic);
        }
        if (wrapper?.composite === true) {
          for (const guardExpression of wrapper.guardExpressions) {
            const guard = guardForExpression(
              guardExpression,
              declaration.endpointId,
              decoratorEvidenceId,
              scope,
            );
            if (guard === null) continue;
            compositeAssertionsByMetadata.set(metadata.id, [
              ...(compositeAssertionsByMetadata.get(metadata.id) ?? []),
              guard.assertionId,
            ]);
          }
        }
      }
    }
  }

  const sourcePathById = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      source.inventorySource.record.id,
      source.inventorySource.record.path,
    ]),
  );
  const effectiveGuardAssertions = new Map<string, AssertionRecord[]>();
  for (const assertion of assertionById.values()) {
    if (assertion.predicate !== 'ENDPOINT_USES_GUARD' || assertion.objectId === null) continue;
    effectiveGuardAssertions.set(assertion.subjectId, [
      ...(effectiveGuardAssertions.get(assertion.subjectId) ?? []),
      assertion,
    ]);
  }
  const importsByModule = new Map<string, string[]>();
  const declaringModulesByClass = new Map<string, string[]>();
  for (const assertion of input.moduleAssertions) {
    if (assertion.status !== 'resolved' || assertion.objectId === null) continue;
    if (assertion.predicate === 'MODULE_IMPORTS_MODULE') {
      importsByModule.set(assertion.subjectId, [
        ...(importsByModule.get(assertion.subjectId) ?? []),
        assertion.objectId,
      ]);
    } else if (assertion.predicate === 'MODULE_DECLARES_CONTROLLER') {
      declaringModulesByClass.set(assertion.objectId, [
        ...(declaringModulesByClass.get(assertion.objectId) ?? []),
        assertion.subjectId,
      ]);
    }
  }
  const knownModuleIds = new Set(input.modules.map(({ id }) => id));
  const reachableModulesByRoot = new Map<string, ReadonlySet<string>>();
  for (const rootModuleId of input.applicationRootModuleIds) {
    if (!knownModuleIds.has(rootModuleId)) continue;
    const reachable = new Set<string>();
    const queue = [rootModuleId];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const moduleId = queue[cursor]!;
      if (reachable.has(moduleId)) continue;
      reachable.add(moduleId);
      queue.push(...(importsByModule.get(moduleId) ?? []));
    }
    reachableModulesByRoot.set(rootModuleId, reachable);
  }
  const globalAssertionsForEndpoint = (declaration: NestEndpointDeclaration): AssertionRecord[] => {
    const controllerClassId = makeClassId({
      path: declaration.source.inventorySource.record.path,
      qualifiedName: declaration.indexedClass.qualifiedName,
      repositoryRevision: input.repositoryRevision,
    });
    const declaringModules = new Set(declaringModulesByClass.get(controllerClassId) ?? []);
    return input.globalGuardRegistrations.flatMap((registration) => {
      const sameModule = declaringModules.has(registration.moduleId);
      const sharesApplicationRoot = [...reachableModulesByRoot.values()].some(
        (reachable) =>
          reachable.has(registration.moduleId) &&
          [...declaringModules].some((moduleId) => reachable.has(moduleId)),
      );
      if (!sameModule && !sharesApplicationRoot) return [];
      const assertion = assertionById.get(registration.assertionId);
      return assertion === undefined ? [] : [assertion];
    });
  };

  const exactGuardConfigurationMatches = (
    metadata: AuthorizationMetadataRecord,
    assertion: AssertionRecord,
  ): boolean => {
    if (assertion.objectId === null) return false;
    const guard = guardById.get(assertion.objectId);
    const guardClass = guard === undefined ? undefined : classById.get(guard.classId);
    if (guardClass === undefined) return false;
    const sourcePath = sourcePathById.get(guardClass.sourceFileId);
    return input.configuration.enforcementRelationships.some(
      (relationship) =>
        relationship.metadataKey === metadata.metadataKey &&
        relationship.guard.sourceFile === sourcePath &&
        relationship.guard.exportedName === guardClass.displayName,
    );
  };

  for (const metadata of metadataById.values()) {
    const compositeAssertionIds = compositeAssertionsByMetadata.get(metadata.id) ?? [];
    for (const assertionId of compositeAssertionIds) {
      const assertion = assertionById.get(assertionId)!;
      const id = makeAuthorizationEnforcementId({
        metadataId: metadata.id,
        state: 'proven_enforced',
        guardId: assertion.objectId,
        guardAssertionId: assertion.id,
        ruleId: AUTHORIZATION_RULE_IDS.compositeEnforcement,
      });
      enforcementById.set(id, {
        id,
        metadataId: metadata.id,
        endpointId: metadata.endpointId,
        state: 'proven_enforced',
        guardId: assertion.objectId,
        guardAssertionId: assertion.id,
        ruleId: AUTHORIZATION_RULE_IDS.compositeEnforcement,
        evidenceIds: [...new Set([...metadata.evidenceIds, ...assertion.evidenceIds])],
      });
    }
    if (compositeAssertionIds.length > 0) continue;

    const declaration = input.endpointDeclarations.find(
      ({ endpointId }) => endpointId === metadata.endpointId,
    );
    const configuredAssertion = [
      ...(effectiveGuardAssertions.get(metadata.endpointId) ?? []),
      ...(declaration === undefined ? [] : globalAssertionsForEndpoint(declaration)),
    ].find((assertion) => exactGuardConfigurationMatches(metadata, assertion));
    if (configuredAssertion !== undefined) {
      const id = makeAuthorizationEnforcementId({
        metadataId: metadata.id,
        state: 'configured_relationship',
        guardId: configuredAssertion.objectId,
        guardAssertionId: configuredAssertion.id,
        ruleId: AUTHORIZATION_RULE_IDS.configuredEnforcement,
      });
      enforcementById.set(id, {
        id,
        metadataId: metadata.id,
        endpointId: metadata.endpointId,
        state: 'configured_relationship',
        guardId: configuredAssertion.objectId,
        guardAssertionId: configuredAssertion.id,
        ruleId: AUTHORIZATION_RULE_IDS.configuredEnforcement,
        evidenceIds: [...new Set([...metadata.evidenceIds, ...configuredAssertion.evidenceIds])],
      });
      continue;
    }

    const id = makeAuthorizationEnforcementId({
      metadataId: metadata.id,
      state: 'enforcement_unknown',
      guardId: null,
      guardAssertionId: null,
      ruleId: AUTHORIZATION_RULE_IDS.unknownEnforcement,
    });
    enforcementById.set(id, {
      id,
      metadataId: metadata.id,
      endpointId: metadata.endpointId,
      state: 'enforcement_unknown',
      guardId: null,
      guardAssertionId: null,
      ruleId: AUTHORIZATION_RULE_IDS.unknownEnforcement,
      evidenceIds: metadata.evidenceIds,
    });
    const diagnostic = createDiagnostic({
      code: 'AUTHORIZATION_ENFORCEMENT_UNKNOWN',
      subjectId: metadata.id,
      evidenceIds: metadata.evidenceIds,
    });
    diagnosticById.set(diagnostic.id, diagnostic);
  }

  return {
    classes: [...ownClassIds].map((id) => classById.get(id)!),
    guards: [...ownGuardIds].map((id) => guardById.get(id)!),
    assertions: [...ownAssertionIds].map((id) => assertionById.get(id)!),
    metadata: [...metadataById.values()],
    enforcements: [...enforcementById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
  };
}
