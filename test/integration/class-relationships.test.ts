import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { traceDirectMethodCalls } from '../../src/tracing/preliminary-call-trace.js';

describe('frozen sample class relationships', () => {
  it('matches the expected injection and direct-call graph without name-based extras', async () => {
    const { analysis } = await scanRepository({ repositoryRoot: resolve('example-nestjs-app') });
    const classById = new Map(analysis.classes.map((record) => [record.id, record]));
    const methodById = new Map(analysis.methods.map((record) => [record.id, record]));
    const injectionFacts = analysis.assertions
      .filter((assertion) => assertion.predicate === 'CLASS_INJECTS_CLASS')
      .map((assertion) => ({
        from: classById.get(assertion.subjectId)?.qualifiedName,
        to: assertion.objectId === null ? null : classById.get(assertion.objectId)?.qualifiedName,
        status: assertion.status,
      }))
      .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));

    expect(injectionFacts).toEqual([
      { from: 'AdminNotesController', to: 'NotesService', status: 'resolved' },
      { from: 'AppController', to: 'AppService', status: 'resolved' },
      { from: 'NotesController', to: 'NotesService', status: 'resolved' },
      { from: 'NotesService', to: 'NotesFormatterService', status: 'resolved' },
    ]);

    const callFacts = analysis.assertions
      .filter((assertion) => assertion.predicate === 'METHOD_CALLS_METHOD')
      .map((assertion) => ({
        from: methodById.get(assertion.subjectId)?.qualifiedName,
        to: assertion.objectId === null ? null : methodById.get(assertion.objectId)?.qualifiedName,
        status: assertion.status,
      }))
      .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));
    expect(callFacts).toEqual([
      { from: 'AdminNotesController.count', to: 'NotesService.count', status: 'resolved' },
      { from: 'AppController.getHello', to: 'AppService.getHello', status: 'resolved' },
      { from: 'NotesController.create', to: 'NotesService.create', status: 'resolved' },
      { from: 'NotesController.findAll', to: 'NotesService.findAll', status: 'resolved' },
      {
        from: 'NotesController.findArchived',
        to: 'NotesService.findArchived',
        status: 'resolved',
      },
      { from: 'NotesController.remove', to: 'NotesService.remove', status: 'resolved' },
      {
        from: 'NotesService.create',
        to: 'NotesFormatterService.normalize',
        status: 'resolved',
      },
    ]);
    expect(callFacts.some((fact) => fact.to === 'NotesService.findAllBackup')).toBe(false);
    expect(
      injectionFacts.some(
        (fact) => fact.from === 'LegacyNotifierService' || fact.to === 'LegacySink',
      ),
    ).toBe(false);
    const unsupported = analysis.diagnostics.find(
      (diagnostic) => diagnostic.code === 'DI_TOKEN_UNSUPPORTED',
    );
    expect(unsupported).toBeDefined();
    expect(
      unsupported?.subjectId === undefined
        ? undefined
        : classById.get(unsupported.subjectId)?.qualifiedName,
    ).toBe('LegacyNotifierService');
    expect(unsupported?.message).toContain('LegacyNotifierService.sink');

    const createEndpoint = analysis.endpoints.find(
      (endpoint) => endpoint.httpMethod === 'POST' && endpoint.path === '/notes',
    );
    const handlerId = analysis.assertions.find(
      (assertion) =>
        assertion.predicate === 'ENDPOINT_IMPLEMENTED_BY' &&
        assertion.subjectId === createEndpoint?.id,
    )?.objectId;
    expect(handlerId).toBeDefined();
    const trace = traceDirectMethodCalls(analysis, handlerId!, 3);
    expect(
      trace.steps
        .map((step) => ({
          from: methodById.get(step.subjectId)?.qualifiedName,
          to: step.objectId === null ? null : methodById.get(step.objectId)?.qualifiedName,
        }))
        .sort((left, right) =>
          `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`),
        ),
    ).toEqual([
      { from: 'NotesController.create', to: 'NotesService.create' },
      { from: 'NotesService.create', to: 'NotesFormatterService.normalize' },
    ]);
    expect(trace.diagnostics).toEqual([]);
  }, 20_000);
});
