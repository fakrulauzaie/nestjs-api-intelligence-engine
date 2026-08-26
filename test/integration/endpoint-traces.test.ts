import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { assertValidAnalysisDocument } from '../../src/evidence/validate.js';
import type { AnalysisDocument, EndpointTraceStep } from '../../src/model/analysis.js';
import {
  serializeCanonicalAnalysis,
  serializeCanonicalEndpointTrace,
} from '../../src/model/ordering.js';
import { buildEndpointTrace } from '../../src/tracing/endpoint-trace.js';

interface FrozenTraceExpectation {
  readonly endpoint: { readonly method: string; readonly path: string };
  readonly steps: readonly {
    readonly from: string;
    readonly relation: string;
    readonly to: string;
    readonly operation?: string;
    readonly status: string;
  }[];
  readonly terminals: readonly { readonly direction: string; readonly table: string }[];
  readonly diagnostics?: readonly string[];
  readonly limitations?: readonly string[];
  readonly directGuardState?: 'declared' | 'none_declared';
  readonly guards?: readonly {
    readonly name: string;
    readonly scope: 'controller' | 'method';
    readonly status: string;
  }[];
}

function stepName(analysis: AnalysisDocument, id: string | null): string | null {
  if (id === null) return null;
  const endpoint = analysis.endpoints.find((record) => record.id === id);
  if (endpoint !== undefined) return `endpoint:${endpoint.httpMethod} ${endpoint.path}`;
  const method = analysis.methods.find((record) => record.id === id);
  if (method !== undefined) return method.qualifiedName;
  return analysis.tables.find((record) => record.id === id)?.name ?? id;
}

function semanticStep(analysis: AnalysisDocument, step: EndpointTraceStep) {
  const operation = step.ruleId.startsWith('typeorm.repository.')
    ? step.ruleId.replace('typeorm.repository.', '').replace('.v1', '')
    : undefined;
  return {
    from: stepName(analysis, step.fromId),
    relation: step.relation,
    to: stepName(analysis, step.toId),
    ...(operation === undefined ? {} : { operation }),
    status: step.status,
  };
}

function sortSteps<T extends { readonly from: string | null; readonly relation: string }>(
  steps: readonly T[],
): T[] {
  return [...steps].sort((left, right) =>
    `${left.from}:${left.relation}:${JSON.stringify(left)}`.localeCompare(
      `${right.from}:${right.relation}:${JSON.stringify(right)}`,
    ),
  );
}

describe('frozen endpoint traces', () => {
  it.each([
    ['expected/read-trace.json'],
    ['expected/write-trace.json'],
    ['expected/guarded-write-trace.json'],
    ['expected/legacy-read-write-trace.json'],
  ])(
    'rebuilds %s from canonical assertions only',
    async (relativeExpectationPath) => {
      const repositoryRoot = resolve('example-nestjs-app');
      const expected = JSON.parse(
        await readFile(resolve(repositoryRoot, relativeExpectationPath), 'utf8'),
      ) as FrozenTraceExpectation;
      const scanned = await scanRepository({ repositoryRoot });
      const serializedAnalysis = serializeCanonicalAnalysis(scanned.analysis);
      const reloadedAnalysis = assertValidAnalysisDocument(
        JSON.parse(serializedAnalysis) as unknown,
      );
      const selector = {
        httpMethod: expected.endpoint.method as 'GET' | 'POST' | 'PUT',
        path: expected.endpoint.path,
      };
      const inMemory = buildEndpointTrace(scanned.analysis, selector);
      const reloaded = buildEndpointTrace(reloadedAnalysis, selector);

      expect(inMemory.status).toBe('resolved');
      expect(reloaded.status).toBe('resolved');
      if (inMemory.status !== 'resolved' || reloaded.status !== 'resolved') return;
      expect(serializeCanonicalEndpointTrace(reloaded.trace)).toBe(
        serializeCanonicalEndpointTrace(inMemory.trace),
      );

      expect(
        sortSteps(inMemory.trace.steps.map((step) => semanticStep(scanned.analysis, step))),
      ).toEqual(
        sortSteps(
          expected.steps.map(({ from, relation, to, operation, status }) => ({
            from,
            relation,
            to,
            ...(operation === undefined ? {} : { operation }),
            status,
          })),
        ),
      );
      expect(
        inMemory.trace.terminals
          .map((terminal) => ({ direction: terminal.direction, table: terminal.tableName }))
          .sort((left, right) =>
            `${left.direction}:${left.table}`.localeCompare(`${right.direction}:${right.table}`),
          ),
      ).toEqual(
        [...expected.terminals].sort((left, right) =>
          `${left.direction}:${left.table}`.localeCompare(`${right.direction}:${right.table}`),
        ),
      );
      expect(inMemory.diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual(
        [...(expected.diagnostics ?? []), ...(expected.limitations ?? [])].sort(),
      );
      expect(
        inMemory.trace.guards.map(({ name, scope, status }) => ({ name, scope, status })),
      ).toEqual(
        (expected.guards ?? []).map(({ name, scope, status }) => ({ name, scope, status })),
      );
      expect(inMemory.trace.directGuardState).toBe(
        expected.directGuardState ??
          ((expected.guards?.length ?? 0) === 0 ? 'none_declared' : 'declared'),
      );

      for (const guard of inMemory.trace.guards) {
        const assertion = scanned.analysis.assertions.find(
          (record) =>
            record.subjectId === inMemory.trace.endpoint.id &&
            record.predicate === 'ENDPOINT_USES_GUARD' &&
            record.objectId === guard.guardId,
        );
        expect(assertion).toBeDefined();
        expect(guard.evidenceIds).toEqual([...assertion!.evidenceIds].sort());
      }

      for (const step of inMemory.trace.steps) {
        const assertion = scanned.analysis.assertions.find(
          (record) =>
            record.subjectId === step.fromId &&
            record.predicate === step.relation &&
            record.objectId === step.toId &&
            record.ruleId === step.ruleId,
        );
        expect(assertion).toBeDefined();
        expect(step.evidenceIds).toEqual([...assertion!.evidenceIds].sort());
      }
    },
    20_000,
  );
});
