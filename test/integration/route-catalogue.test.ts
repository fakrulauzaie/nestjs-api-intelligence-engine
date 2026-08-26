import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import {
  buildEndpointCatalogue,
  renderEndpointCatalogueMarkdown,
} from '../../src/reporting/endpoint-catalogue.js';

interface ExpectedCatalogue {
  readonly supportedEndpointCount: number;
  readonly endpoints: readonly {
    readonly method: string;
    readonly path: string;
    readonly handler: string;
  }[];
}

describe('frozen sample route catalogue', () => {
  it('matches all supported endpoints, excludes the computed route, and is deterministic', async () => {
    const repositoryRoot = resolve('example-nestjs-app');
    const expected = JSON.parse(
      await readFile(resolve(repositoryRoot, 'expected/endpoint-catalogue.json'), 'utf8'),
    ) as ExpectedCatalogue;
    const first = await scanRepository({ repositoryRoot });
    const second = await scanRepository({ repositoryRoot });
    const methodById = new Map(first.analysis.methods.map((method) => [method.id, method]));
    const implementationByEndpoint = new Map(
      first.analysis.assertions
        .filter((assertion) => assertion.predicate === 'ENDPOINT_IMPLEMENTED_BY')
        .map((assertion) => [assertion.subjectId, assertion]),
    );
    const actualFacts = first.analysis.endpoints
      .map((endpoint) => {
        const methodId = implementationByEndpoint.get(endpoint.id)?.objectId;
        return {
          method: endpoint.httpMethod,
          path: endpoint.path,
          handler:
            methodId === null || methodId === undefined
              ? null
              : methodById.get(methodId)?.qualifiedName,
        };
      })
      .sort((left, right) =>
        `${left.method}:${left.path}:${left.handler}`.localeCompare(
          `${right.method}:${right.path}:${right.handler}`,
        ),
      );
    const expectedFacts = expected.endpoints
      .map(({ method, path, handler }) => ({ method, path, handler }))
      .sort((left, right) =>
        `${left.method}:${left.path}:${left.handler}`.localeCompare(
          `${right.method}:${right.path}:${right.handler}`,
        ),
      );

    expect(first.analysis.endpoints).toHaveLength(expected.supportedEndpointCount);
    expect(actualFacts).toEqual(expectedFacts);
    expect(serializeCanonicalAnalysis(first.analysis)).toBe(
      serializeCanonicalAnalysis(second.analysis),
    );
    expect(first.analysis.resultState).toBe('completed_with_gaps');

    const methodNames = new Map(
      first.analysis.methods.map((method) => [method.id, method.qualifiedName]),
    );
    const dynamicDiagnostic = first.analysis.diagnostics.find(
      (diagnostic) => diagnostic.code === 'NEST_ROUTE_DYNAMIC',
    );
    expect(dynamicDiagnostic).toBeDefined();
    expect(
      dynamicDiagnostic?.subjectId === undefined
        ? undefined
        : methodNames.get(dynamicDiagnostic.subjectId),
    ).toBe('NotesController.computedStatus');
    expect(first.analysis.endpoints.some((endpoint) => endpoint.path.includes('computed'))).toBe(
      false,
    );
    const sourceById = new Map(first.analysis.sourceFiles.map((source) => [source.id, source]));
    const evidenceById = new Map(
      first.analysis.evidence.map((evidence) => [evidence.id, evidence]),
    );
    expect(
      (dynamicDiagnostic?.evidenceIds ?? [])
        .map((id) => evidenceById.get(id))
        .filter((evidence) => evidence !== undefined)
        .map((evidence) => ({
          path: sourceById.get(evidence.fileId)?.path,
          line: evidence.startLine,
        }))
        .sort((left, right) => left.line - right.line),
    ).toEqual([
      { path: 'src/notes/notes.controller.ts', line: 10 },
      { path: 'src/notes/notes.controller.ts', line: 104 },
    ]);

    const archivedEndpoint = first.analysis.endpoints.find(
      (endpoint) => endpoint.httpMethod === 'GET' && endpoint.path === '/notes/archived',
    );
    const archivedAssertion = first.analysis.assertions.find(
      (assertion) => assertion.subjectId === archivedEndpoint?.id,
    );
    expect(
      (archivedAssertion?.evidenceIds ?? [])
        .map((id) => evidenceById.get(id))
        .filter((evidence) => evidence !== undefined)
        .map((evidence) => evidence.startLine)
        .sort((left, right) => left - right),
    ).toEqual([9, 12, 33, 34]);

    const catalogue = buildEndpointCatalogue(first.analysis);
    expect(
      first.analysis.assertions.filter(
        (assertion) => assertion.predicate === 'ENDPOINT_USES_GUARD',
      ),
    ).toHaveLength(3);
    expect(catalogue.endpoints).toHaveLength(7);
    expect(catalogue.endpoints.every((endpoint) => endpoint.selectionStatus === 'resolved')).toBe(
      true,
    );
    expect(
      catalogue.endpoints
        .filter((endpoint) => endpoint.directGuardState === 'declared')
        .map((endpoint) => ({
          endpoint: `${endpoint.httpMethod} ${endpoint.path}`,
          guards: endpoint.guards.map(({ name, scope, evidence }) => ({
            name,
            scope,
            evidence: evidence.map((reference) => reference.split(':').slice(0, 2).join(':')),
          })),
        })),
    ).toEqual([
      {
        endpoint: 'GET /admin/notes/count',
        guards: [
          {
            name: 'AuthGuard',
            scope: 'controller',
            evidence: ['src/notes/admin-notes.controller.ts:7'],
          },
          {
            name: 'AuditGuard',
            scope: 'method',
            evidence: ['src/notes/admin-notes.controller.ts:12'],
          },
        ],
      },
      {
        endpoint: 'DELETE /notes/:id',
        guards: [
          {
            name: 'AuthGuard',
            scope: 'method',
            evidence: ['src/notes/notes.controller.ts:40'],
          },
        ],
      },
    ]);
    expect(
      catalogue.endpoints
        .filter((endpoint) => endpoint.directGuardState === 'none_declared')
        .every((endpoint) => endpoint.guards.length === 0),
    ).toBe(true);
    const markdown = renderEndpointCatalogueMarkdown(catalogue);
    expect(markdown).toContain('| GET | `/notes/archived` | NotesController.findArchived |');
    expect(markdown).toContain('`NEST_ROUTE_DYNAMIC`');
    expect(markdown).toContain('controller: AuthGuard');
    expect(markdown.toLowerCase()).not.toContain('public');
  }, 30_000);
});
