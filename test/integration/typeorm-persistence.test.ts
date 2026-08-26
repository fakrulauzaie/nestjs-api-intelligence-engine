import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';

interface FrozenPersistenceExpectation {
  readonly entityTableMappings: readonly {
    readonly entity: string;
    readonly table: string;
    readonly naming: string;
  }[];
  readonly repositoryBindings: readonly {
    readonly class: string;
    readonly member: string;
    readonly entity: string;
  }[];
  readonly repositoryOperations: readonly {
    readonly method: string;
    readonly operation: string;
    readonly direction: 'READ' | 'WRITE' | 'UNSUPPORTED';
    readonly table: string | null;
    readonly line: number;
  }[];
}

describe('frozen sample TypeORM persistence graph', () => {
  it('matches entity mappings, repository bindings, operations, and honest limitations', async () => {
    const repositoryRoot = resolve('example-nestjs-app');
    const expected = JSON.parse(
      await readFile(resolve(repositoryRoot, 'expected/analysis.json'), 'utf8'),
    ) as FrozenPersistenceExpectation;
    const { analysis } = await scanRepository({ repositoryRoot });
    const classById = new Map(analysis.classes.map((record) => [record.id, record]));
    const methodById = new Map(analysis.methods.map((record) => [record.id, record]));
    const entityById = new Map(analysis.entities.map((record) => [record.id, record]));
    const tableById = new Map(analysis.tables.map((record) => [record.id, record]));
    const evidenceById = new Map(analysis.evidence.map((record) => [record.id, record]));

    const mappingFacts = analysis.assertions
      .filter((assertion) => assertion.predicate === 'ENTITY_MAPS_TO_TABLE')
      .map((assertion) => ({
        entity: entityById.get(assertion.subjectId)?.displayName,
        table: assertion.objectId === null ? null : tableById.get(assertion.objectId)?.name,
        naming: assertion.objectId === null ? null : tableById.get(assertion.objectId)?.nameSource,
      }))
      .sort((left, right) => `${left.entity}`.localeCompare(`${right.entity}`));
    expect(mappingFacts).toEqual(
      expected.entityTableMappings
        .map(({ entity, table, naming }) => ({ entity, table, naming }))
        .sort((left, right) => left.entity.localeCompare(right.entity)),
    );

    const entityAssertionByBinding = new Map(
      analysis.assertions
        .filter(
          (assertion) =>
            assertion.predicate === 'REPOSITORY_FOR_ENTITY' && assertion.objectId !== null,
        )
        .map((assertion) => [assertion.subjectId, assertion]),
    );
    const bindingFacts = analysis.repositoryBindings
      .map((binding) => {
        const entityId = entityAssertionByBinding.get(binding.id)?.objectId;
        return {
          class: classById.get(binding.ownerClassId)?.qualifiedName,
          member: binding.memberName,
          entity:
            entityId === null || entityId === undefined
              ? null
              : entityById.get(entityId)?.displayName,
        };
      })
      .sort((left, right) =>
        `${left.class}:${left.member}`.localeCompare(`${right.class}:${right.member}`),
      );
    expect(bindingFacts).toEqual(
      expected.repositoryBindings
        .map(({ class: owner, member, entity }) => ({ class: owner, member, entity }))
        .sort((left, right) =>
          `${left.class}:${left.member}`.localeCompare(`${right.class}:${right.member}`),
        ),
    );

    const operationFacts = analysis.assertions
      .filter(
        (assertion) =>
          assertion.predicate === 'METHOD_READS_TABLE' ||
          assertion.predicate === 'METHOD_WRITES_TABLE',
      )
      .map((assertion) => {
        const callEvidence = assertion.evidenceIds
          .map((id) => evidenceById.get(id))
          .find((evidence) => evidence?.role === 'call_site');
        return {
          method: methodById.get(assertion.subjectId)?.qualifiedName,
          operation: assertion.ruleId.replace('typeorm.repository.', '').replace('.v1', ''),
          direction: assertion.predicate === 'METHOD_READS_TABLE' ? 'READ' : 'WRITE',
          table: assertion.objectId === null ? null : tableById.get(assertion.objectId)?.name,
          line: callEvidence?.startLine,
          status: assertion.status,
          evidenceRoles: assertion.evidenceIds.map((id) => evidenceById.get(id)?.role),
        };
      })
      .sort((left, right) =>
        `${left.method}:${left.operation}`.localeCompare(`${right.method}:${right.operation}`),
      );
    expect(
      operationFacts.map(({ method, operation, direction, table, line }) => ({
        method,
        operation,
        direction,
        table,
        line,
      })),
    ).toEqual(
      expected.repositoryOperations
        .filter((operation) => operation.direction !== 'UNSUPPORTED')
        .map(({ method, operation, direction, table, line }) => ({
          method,
          operation,
          direction,
          table,
          line,
        }))
        .sort((left, right) =>
          `${left.method}:${left.operation}`.localeCompare(`${right.method}:${right.operation}`),
        ),
    );
    expect(operationFacts.every((fact) => fact.status === 'resolved')).toBe(true);
    expect(
      operationFacts.every(
        (fact) =>
          fact.evidenceRoles.includes('call_site') &&
          fact.evidenceRoles.includes('resolution_basis') &&
          fact.evidenceRoles.includes('decorator') &&
          fact.evidenceRoles.includes('declaration'),
      ),
    ).toBe(true);

    const unsupported = analysis.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'TYPEORM_OPERATION_UNSUPPORTED',
    );
    expect(unsupported).toHaveLength(1);
    expect(
      unsupported[0]?.subjectId === undefined
        ? undefined
        : methodById.get(unsupported[0].subjectId)?.qualifiedName,
    ).toBe('NotesService.unsupportedPreload');
    expect(unsupported[0]?.message).toContain('preload');
    const unknownColumns = analysis.diagnostics
      .filter((diagnostic) => diagnostic.code === 'TYPEORM_SAVE_COLUMNS_UNKNOWN')
      .map((diagnostic) =>
        diagnostic.subjectId === undefined
          ? undefined
          : methodById.get(diagnostic.subjectId)?.qualifiedName,
      )
      .sort();
    expect(unknownColumns).toEqual(['NotesController.updateLegacy']);
    expect(
      operationFacts.some(
        (fact) =>
          fact.method === 'LegacyNotifierService.notify' ||
          fact.method === 'NotesService.unsupportedPreload',
      ),
    ).toBe(false);
    expect(
      analysis.diagnostics.some((diagnostic) => diagnostic.code === 'TYPEORM_ENTITY_UNRESOLVED'),
    ).toBe(false);
  }, 20_000);
});
