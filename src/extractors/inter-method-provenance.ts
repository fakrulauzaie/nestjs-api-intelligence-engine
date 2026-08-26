import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord, AssertionStatus } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type {
  ColumnInfluenceRecord,
  ContractFieldRecord,
  EntityColumnRecord,
  ProvenanceCallStep,
  RequestFieldOriginRecord,
  RequestParameterRecord,
} from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { makeAssertionId, makeColumnInfluenceId, makeRequestFieldOriginId } from '../model/ids.js';
import type { IndexedClass, IndexedMethod, IndexedSourceFile } from '../ts-index/source-index.js';
import type { DirectMethodCallObservation } from './class-relationships.js';
import {
  createProvenanceExpressionTracer,
  downgradeOrigins,
  MAX_PROVENANCE_ORIGINS_PER_VALUE,
  sortedUnique,
  type SymbolicOrigin,
} from './provenance-expression.js';
import { REQUEST_FIELD_ORIGIN_RULE_ID } from './request-provenance.js';
import type { TypeOrmObjectWriteSink } from './typeorm-persistence.js';

export const REQUEST_INTER_METHOD_INFLUENCE_RULE_ID =
  'request.provenance.inter-method-object-write.v1';

const MAX_CALL_FRAMES = 128;
const MAX_ORIGINS_PER_FRAME = 64;

interface MethodLocation {
  readonly methodId: string;
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly indexedMethod: IndexedMethod;
}

interface ProvenanceFrame extends MethodLocation {
  readonly parameterOrigins: ReadonlyMap<ts.Symbol, readonly SymbolicOrigin[]>;
  readonly callPath: readonly ProvenanceCallStep[];
  readonly visitedMethodIds: ReadonlySet<string>;
}

export interface InterMethodProvenanceExtraction {
  readonly requestFieldOrigins: readonly RequestFieldOriginRecord[];
  readonly columnInfluences: readonly ColumnInfluenceRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (
    ts.isSpreadAssignment(node) ||
    node.name === undefined ||
    ts.isComputedPropertyName(node.name)
  ) {
    return null;
  }
  return ts.isIdentifier(node.name) ||
    ts.isStringLiteralLike(node.name) ||
    ts.isNumericLiteral(node.name)
    ? node.name.text
    : null;
}

function containsFunctionLike(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionLike(current)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function enclosingUncertainBoundary(
  expression: ts.Expression,
  method: ts.MethodDeclaration,
): ts.Node | null {
  let current: ts.Node | undefined = expression.parent;
  while (current !== undefined && current !== method) {
    if (
      (ts.isFunctionLike(current) && current !== method) ||
      ts.isIfStatement(current) ||
      ts.isSwitchStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isTryStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function frameKey(frame: ProvenanceFrame): string {
  const origins = [...frame.parameterOrigins.entries()]
    .flatMap(([symbol, values]) =>
      values.map(
        (origin) =>
          `${symbol.getName()}:${origin.requestParameter.id}:${origin.propertyPath.join('.')}:${origin.state}`,
      ),
    )
    .sort();
  return `${frame.methodId}:${origins.join('|')}`;
}

export function extractInterMethodRequestProvenance(input: {
  checker: ts.TypeChecker;
  requestParameters: readonly RequestParameterRecord[];
  contractFields: readonly ContractFieldRecord[];
  entityColumns: readonly EntityColumnRecord[];
  writeSinks: readonly TypeOrmObjectWriteSink[];
  directMethodCalls: readonly DirectMethodCallObservation[];
  maxCallDepth: number;
  evidenceSnippetLimit: number;
}): InterMethodProvenanceExtraction {
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticById = new Map<string, DiagnosticRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const originById = new Map<string, RequestFieldOriginRecord>();
  const influenceById = new Map<string, ColumnInfluenceRecord>();
  const fieldsByTypeAndName = new Map<string, ContractFieldRecord[]>();
  const columnsByEntityAndProperty = new Map<string, EntityColumnRecord[]>();
  const methodLocationById = new Map<string, MethodLocation>();
  const callsBySourceMethod = new Map<string, DirectMethodCallObservation[]>();
  const sinksByMethod = new Map<string, TypeOrmObjectWriteSink[]>();

  for (const field of input.contractFields) {
    const key = `${field.contractTypeId}:${field.name}`;
    fieldsByTypeAndName.set(key, [...(fieldsByTypeAndName.get(key) ?? []), field]);
  }
  for (const column of input.entityColumns) {
    const key = `${column.entityId}:${column.propertyName}`;
    columnsByEntityAndProperty.set(key, [...(columnsByEntityAndProperty.get(key) ?? []), column]);
  }
  for (const call of input.directMethodCalls) {
    methodLocationById.set(call.sourceMethodId, {
      methodId: call.sourceMethodId,
      source: call.source,
      indexedClass: call.sourceClass,
      indexedMethod: call.sourceMethod,
    });
    methodLocationById.set(call.targetMethodId, {
      methodId: call.targetMethodId,
      source: call.targetSource,
      indexedClass: call.targetClass,
      indexedMethod: call.targetMethod,
    });
    callsBySourceMethod.set(call.sourceMethodId, [
      ...(callsBySourceMethod.get(call.sourceMethodId) ?? []),
      call,
    ]);
  }
  for (const sink of input.writeSinks) {
    methodLocationById.set(sink.methodId, {
      methodId: sink.methodId,
      source: sink.source,
      indexedClass: sink.indexedClass,
      indexedMethod: sink.indexedMethod,
    });
    sinksByMethod.set(sink.methodId, [...(sinksByMethod.get(sink.methodId) ?? []), sink]);
  }

  const resolveField = (
    parameter: RequestParameterRecord,
    path: readonly string[],
  ): Pick<SymbolicOrigin, 'contractFieldIds' | 'resolution'> => {
    if (parameter.selectorState === 'literal') {
      return { contractFieldIds: [], resolution: 'resolved' };
    }
    const name = path[0];
    if (name === undefined) return { contractFieldIds: [], resolution: 'unknown' };
    const candidates = parameter.declaredType.contractTypeIds.flatMap(
      (typeId) => fieldsByTypeAndName.get(`${typeId}:${name}`) ?? [],
    );
    const contractFieldIds = sortedUnique(candidates.map(({ id }) => id));
    return {
      contractFieldIds,
      resolution:
        contractFieldIds.length === 0
          ? 'unknown'
          : contractFieldIds.length === 1
            ? 'resolved'
            : 'ambiguous',
    };
  };

  const addDiagnostic = (
    code: Extract<
      DiagnosticCode,
      | 'REQUEST_PROVENANCE_UNSUPPORTED'
      | 'REQUEST_PROVENANCE_LIMIT_EXCEEDED'
      | 'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED'
      | 'REQUEST_PROVENANCE_CALL_DEPTH_LIMIT'
    >,
    methodId: string,
    message: string,
    evidenceIds: readonly string[],
  ): void => {
    const diagnostic = createDiagnostic({ code, subjectId: methodId, message, evidenceIds });
    diagnosticById.set(diagnostic.id, diagnostic);
  };

  const addAssertion = (record: AssertionRecord): void => {
    const existing = assertionById.get(record.id);
    assertionById.set(
      record.id,
      existing === undefined
        ? record
        : {
            ...existing,
            status:
              existing.status === 'resolved' || record.status === 'resolved'
                ? 'resolved'
                : existing.status === 'ambiguous' || record.status === 'ambiguous'
                  ? 'ambiguous'
                  : record.status,
            evidenceIds: sortedUnique([...existing.evidenceIds, ...record.evidenceIds]),
          },
    );
  };

  const evidenceFor = (
    location: MethodLocation,
    node: ts.Node,
    role: EvidenceRecord['role'],
  ): string => {
    const evidence = createEvidenceForNode({
      sourceFile: location.source.sourceFile,
      sourceFileRecord: location.source.inventorySource.record,
      node,
      role,
      snippetLimit: input.evidenceSnippetLimit,
    });
    evidenceById.set(evidence.id, evidence);
    return evidence.id;
  };

  const createTracer = (
    frame: ProvenanceFrame,
    contextEvidenceIds: readonly string[],
    interMethod: boolean,
  ) =>
    createProvenanceExpressionTracer({
      checker: input.checker,
      method: frame.indexedMethod.node,
      parameterOrigins(symbol) {
        return frame.parameterOrigins.get(symbol);
      },
      resolveField,
      evidenceFor(node, role) {
        return evidenceFor(frame, node, role);
      },
      addUnsupportedDiagnostic(message, evidenceIds) {
        addDiagnostic(
          interMethod
            ? 'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED'
            : 'REQUEST_PROVENANCE_UNSUPPORTED',
          frame.methodId,
          message,
          evidenceIds,
        );
      },
      addLimitDiagnostic(message, evidenceIds) {
        addDiagnostic('REQUEST_PROVENANCE_LIMIT_EXCEEDED', frame.methodId, message, evidenceIds);
      },
      contextEvidenceIds,
    });

  const initialFrames: ProvenanceFrame[] = [];
  const parametersByMethod = new Map<string, RequestParameterRecord[]>();
  for (const parameter of input.requestParameters) {
    parametersByMethod.set(parameter.methodId, [
      ...(parametersByMethod.get(parameter.methodId) ?? []),
      parameter,
    ]);
  }
  for (const [methodId, parameters] of parametersByMethod) {
    const location = methodLocationById.get(methodId);
    if (location === undefined) continue;
    const parameterOrigins = new Map<ts.Symbol, readonly SymbolicOrigin[]>();
    for (const parameter of parameters) {
      const declaration = location.indexedMethod.node.parameters[parameter.parameterIndex];
      const symbol =
        declaration === undefined ? undefined : input.checker.getSymbolAtLocation(declaration.name);
      if (symbol === undefined) continue;
      const propertyPath =
        parameter.selectorState === 'literal' && parameter.selector !== null
          ? [parameter.selector]
          : [];
      const field = resolveField(parameter, propertyPath);
      parameterOrigins.set(symbol, [
        {
          requestParameter: parameter,
          propertyPath,
          ...field,
          state: field.resolution === 'unknown' && propertyPath.length > 0 ? 'unknown' : 'direct',
          evidenceIds: [parameter.declarationEvidenceId, parameter.decoratorEvidenceId],
        },
      ]);
    }
    if (parameterOrigins.size > 0) {
      initialFrames.push({
        ...location,
        parameterOrigins,
        callPath: [],
        visitedMethodIds: new Set([methodId]),
      });
    }
  }

  const analyzeSink = (frame: ProvenanceFrame, sink: TypeOrmObjectWriteSink): void => {
    const tracer = createTracer(frame, [sink.operationEvidenceId], false);
    const valueExpression = sink.valueExpression;
    if (!ts.isObjectLiteralExpression(valueExpression)) {
      if (tracer.trace(valueExpression).length > 0) {
        const evidenceId = evidenceFor(frame, valueExpression, 'resolution_basis');
        addDiagnostic(
          'REQUEST_PROVENANCE_UNSUPPORTED',
          frame.methodId,
          'Only an inline object literal is supported for inter-method request-to-column provenance.',
          [evidenceId, sink.operationEvidenceId],
        );
      }
      return;
    }
    const boundary = enclosingUncertainBoundary(valueExpression, frame.indexedMethod.node);
    const boundaryEvidenceId =
      boundary === null ? null : evidenceFor(frame, boundary, 'resolution_basis');

    for (const property of valueExpression.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (tracer.trace(property.expression).length > 0) {
          const evidenceId = evidenceFor(frame, property, 'resolution_basis');
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            frame.methodId,
            'Spread write objects do not prove individual entity-column assignments.',
            [evidenceId, sink.operationEvidenceId],
          );
        }
        continue;
      }
      const name = propertyName(property);
      const propertyValue = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : null;
      if (name === null || propertyValue === null) {
        const dependencies =
          ts.isPropertyAssignment(property) && propertyValue !== null
            ? tracer.trace(propertyValue)
            : [];
        if (dependencies.length > 0) {
          const evidenceId = evidenceFor(frame, property, 'resolution_basis');
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            frame.methodId,
            'Computed or accessor write properties do not prove a static entity column.',
            [evidenceId, sink.operationEvidenceId],
          );
        }
        continue;
      }
      let origins = tracer.trace(propertyValue);
      if (origins.length === 0) continue;
      if (origins.length > MAX_PROVENANCE_ORIGINS_PER_VALUE) {
        const evidenceId = evidenceFor(frame, propertyValue, 'resolution_basis');
        addDiagnostic(
          'REQUEST_PROVENANCE_LIMIT_EXCEEDED',
          frame.methodId,
          `A write value exceeded the ${MAX_PROVENANCE_ORIGINS_PER_VALUE}-origin limit.`,
          [evidenceId, sink.operationEvidenceId],
        );
        origins = origins.slice(0, MAX_PROVENANCE_ORIGINS_PER_VALUE);
      }
      if (boundaryEvidenceId !== null) {
        origins = downgradeOrigins(origins, 'unknown', boundaryEvidenceId);
        addDiagnostic(
          'REQUEST_PROVENANCE_UNSUPPORTED',
          frame.methodId,
          'The write sink is nested in a callback, loop, branch, or exception-flow boundary.',
          [boundaryEvidenceId, sink.operationEvidenceId],
        );
      }
      const sinkEvidenceId = evidenceFor(frame, property, 'resolution_basis');
      const targetColumns = sink.entityTargets.flatMap((entityTarget) =>
        (columnsByEntityAndProperty.get(`${entityTarget.entityId}:${name}`) ?? []).map(
          (column) => ({ column, entityTarget }),
        ),
      );
      if (targetColumns.length === 0) {
        addDiagnostic(
          'REQUEST_PROVENANCE_UNSUPPORTED',
          frame.methodId,
          `Write property ${name} has request influence but no proven entity-column target.`,
          [sinkEvidenceId, sink.operationEvidenceId],
        );
        continue;
      }

      for (const symbolic of origins) {
        if (symbolic.propertyPath.length !== 1) {
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            frame.methodId,
            'Whole-object request provenance does not prove an individual request field.',
            [sinkEvidenceId, sink.operationEvidenceId, ...symbolic.evidenceIds],
          );
          continue;
        }
        const originId = makeRequestFieldOriginId({
          requestParameterId: symbolic.requestParameter.id,
          propertyPath: symbolic.propertyPath,
        });
        const origin: RequestFieldOriginRecord = {
          id: originId,
          requestParameterId: symbolic.requestParameter.id,
          propertyPath: symbolic.propertyPath,
          contractFieldIds: sortedUnique(symbolic.contractFieldIds),
          resolution: symbolic.resolution,
          originEvidenceId: symbolic.requestParameter.declarationEvidenceId,
        };
        originById.set(originId, origin);
        const originAssertionId = makeAssertionId({
          subjectId: origin.requestParameterId,
          predicate: 'REQUEST_PARAMETER_HAS_FIELD_ORIGIN',
          objectId: origin.id,
          ruleId: REQUEST_FIELD_ORIGIN_RULE_ID,
        });
        addAssertion({
          id: originAssertionId,
          subjectId: origin.requestParameterId,
          predicate: 'REQUEST_PARAMETER_HAS_FIELD_ORIGIN',
          objectId: origin.id,
          status:
            origin.resolution === 'resolved'
              ? 'resolved'
              : origin.resolution === 'ambiguous'
                ? 'ambiguous'
                : 'unsupported',
          ruleId: REQUEST_FIELD_ORIGIN_RULE_ID,
          evidenceIds: sortedUnique([
            symbolic.requestParameter.declarationEvidenceId,
            symbolic.requestParameter.decoratorEvidenceId,
            ...symbolic.evidenceIds,
          ]),
        });

        for (const { column, entityTarget } of targetColumns) {
          const disabled =
            (sink.kind.endsWith('insert') && column.insert === false) ||
            (sink.kind.endsWith('update') && column.update === false);
          if (disabled) continue;
          const callEvidenceIds = frame.callPath.map(({ callEvidenceId }) => callEvidenceId);
          const influenceId = makeColumnInfluenceId({
            methodId: frame.methodId,
            originId,
            columnId: column.id,
            sinkKind: sink.kind,
            sinkPropertyName: name,
            operationEvidenceId: sink.operationEvidenceId,
            callEvidenceIds,
          });
          const assertionId = makeAssertionId({
            subjectId: originId,
            predicate: 'REQUEST_FIELD_MAY_FLOW_TO_COLUMN',
            objectId: column.id,
            ruleId: REQUEST_INTER_METHOD_INFLUENCE_RULE_ID,
          });
          const status: AssertionStatus =
            entityTarget.status === 'ambiguous' || origin.resolution === 'ambiguous'
              ? 'ambiguous'
              : symbolic.state === 'unknown' || origin.resolution === 'unknown'
                ? 'unsupported'
                : 'resolved';
          const evidenceIds = sortedUnique([
            symbolic.requestParameter.declarationEvidenceId,
            symbolic.requestParameter.decoratorEvidenceId,
            ...symbolic.evidenceIds,
            ...callEvidenceIds,
            sinkEvidenceId,
            sink.operationEvidenceId,
            ...sink.evidenceIds,
            ...entityTarget.evidenceIds,
            column.declarationEvidenceId,
            column.decoratorEvidenceId,
          ]);
          addAssertion({
            id: assertionId,
            subjectId: originId,
            predicate: 'REQUEST_FIELD_MAY_FLOW_TO_COLUMN',
            objectId: column.id,
            status,
            ruleId: REQUEST_INTER_METHOD_INFLUENCE_RULE_ID,
            evidenceIds,
          });
          influenceById.set(influenceId, {
            id: influenceId,
            methodId: frame.methodId,
            originId,
            columnId: column.id,
            state: symbolic.state,
            sinkKind: sink.kind,
            sinkPropertyName: name,
            assertionId,
            sinkEvidenceId,
            operationEvidenceId: sink.operationEvidenceId,
            propagationEvidenceIds: sortedUnique(symbolic.evidenceIds),
            callPath: frame.callPath,
          });
        }
      }
    }
  };

  const queue = [...initialFrames];
  const visitedFrames = new Set<string>();
  let frameCount = 0;
  while (queue.length > 0) {
    const frame = queue.shift()!;
    const key = frameKey(frame);
    if (visitedFrames.has(key)) continue;
    visitedFrames.add(key);
    frameCount += 1;
    if (frameCount > MAX_CALL_FRAMES) {
      addDiagnostic(
        'REQUEST_PROVENANCE_LIMIT_EXCEEDED',
        frame.methodId,
        `Inter-method request provenance exceeded the ${MAX_CALL_FRAMES}-frame limit.`,
        frame.callPath.map(({ callEvidenceId }) => callEvidenceId),
      );
      break;
    }

    if (frame.callPath.length > 0) {
      for (const sink of sinksByMethod.get(frame.methodId) ?? []) analyzeSink(frame, sink);
    }

    for (const call of callsBySourceMethod.get(frame.methodId) ?? []) {
      const tracer = createTracer(frame, [call.callEvidenceId, call.resolutionEvidenceId], true);
      const argumentOrigins = call.call.arguments.map((argument) =>
        ts.isSpreadElement(argument) ? tracer.trace(argument.expression) : tracer.trace(argument),
      );
      const relevantOrigins = argumentOrigins.flat();
      if (relevantOrigins.length === 0) continue;
      if (call.status === 'ambiguous') {
        addDiagnostic(
          'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED',
          frame.methodId,
          'A request-derived call has multiple possible method declarations; no callee frame is selected.',
          [call.callEvidenceId, call.resolutionEvidenceId],
        );
        continue;
      }
      if (call.call.arguments.some(ts.isSpreadElement)) {
        addDiagnostic(
          'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED',
          frame.methodId,
          'Spread call arguments do not have a stable argument-to-parameter mapping.',
          [call.callEvidenceId],
        );
        continue;
      }
      if (call.call.arguments.some(containsFunctionLike)) {
        addDiagnostic(
          'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED',
          frame.methodId,
          'Callback-bearing request-derived calls are outside the inter-method provenance boundary.',
          [call.callEvidenceId],
        );
        continue;
      }
      if (frame.callPath.length >= input.maxCallDepth) {
        addDiagnostic(
          'REQUEST_PROVENANCE_CALL_DEPTH_LIMIT',
          frame.methodId,
          `Request provenance stopped at the configured call depth ${input.maxCallDepth}.`,
          [call.callEvidenceId, ...frame.callPath.map(({ callEvidenceId }) => callEvidenceId)],
        );
        continue;
      }
      if (frame.visitedMethodIds.has(call.targetMethodId)) {
        addDiagnostic(
          'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED',
          frame.methodId,
          'Request provenance encountered a call cycle and did not revisit the method.',
          [call.callEvidenceId, ...frame.callPath.map(({ callEvidenceId }) => callEvidenceId)],
        );
        continue;
      }
      const targetParameters = call.targetMethod.node.parameters;
      if (targetParameters.some(({ dotDotDotToken }) => dotDotDotToken !== undefined)) {
        addDiagnostic(
          'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED',
          frame.methodId,
          'Rest parameters do not have a bounded argument-to-parameter provenance mapping.',
          [call.callEvidenceId],
        );
        continue;
      }
      const parameterOrigins = new Map<ts.Symbol, readonly SymbolicOrigin[]>();
      for (const [index, origins] of argumentOrigins.entries()) {
        if (origins.length === 0) continue;
        const targetParameter = targetParameters[index];
        const symbol =
          targetParameter === undefined
            ? undefined
            : input.checker.getSymbolAtLocation(targetParameter.name);
        if (symbol === undefined) continue;
        parameterOrigins.set(
          symbol,
          origins.map((origin) => ({
            ...origin,
            evidenceIds: sortedUnique([
              ...origin.evidenceIds,
              call.callEvidenceId,
              call.resolutionEvidenceId,
            ]),
          })),
        );
      }
      const totalOrigins = [...parameterOrigins.values()].reduce(
        (count, origins) => count + origins.length,
        0,
      );
      if (totalOrigins === 0) continue;
      if (totalOrigins > MAX_ORIGINS_PER_FRAME) {
        addDiagnostic(
          'REQUEST_PROVENANCE_LIMIT_EXCEEDED',
          frame.methodId,
          `A callee frame exceeded the ${MAX_ORIGINS_PER_FRAME}-origin limit.`,
          [call.callEvidenceId],
        );
        continue;
      }
      const targetLocation = methodLocationById.get(call.targetMethodId);
      if (targetLocation === undefined || call.targetMethod.node.body === undefined) {
        addDiagnostic(
          'REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED',
          frame.methodId,
          'The resolved call target has no analyzable in-repository method body.',
          [call.callEvidenceId],
        );
        continue;
      }
      queue.push({
        ...targetLocation,
        parameterOrigins,
        callPath: [
          ...frame.callPath,
          {
            callerMethodId: frame.methodId,
            calleeMethodId: call.targetMethodId,
            callEvidenceId: call.callEvidenceId,
          },
        ],
        visitedMethodIds: new Set([...frame.visitedMethodIds, call.targetMethodId]),
      });
    }
  }

  return {
    requestFieldOrigins: [...originById.values()],
    columnInfluences: [...influenceById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
  };
}
