import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { writeFakeNestCommon } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('class injection and direct-call extraction', () => {
  it('uses checker-resolved class and method declarations for supported relationships', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/relationships.ts',
        [
          "import { Controller, Get, Inject, Injectable } from '@nestjs/common';",
          "const LEGACY_TOKEN = 'LEGACY';",
          '@Injectable()',
          'class TargetService {',
          "  work(): string { return 'target'; }",
          "  workBackup(): string { return 'backup'; }",
          '}',
          '@Injectable()',
          'class OtherService {',
          "  work(): string { return 'other'; }",
          '}',
          "@Controller('parameter')",
          'class ParameterPropertyController {',
          '  constructor(private readonly target: TargetService) {}',
          '  @Get() run(): string { return this.target.work(); }',
          '}',
          '@Injectable()',
          'class ExplicitAssignmentService {',
          '  private target: TargetService;',
          '  constructor(target: TargetService) { this.target = target; }',
          '  run(): string { return this.target.work(); }',
          '}',
          '@Injectable()',
          'class MissingCallService {',
          '  constructor(private readonly target: TargetService) {}',
          '  run(): unknown { return this.target.missing(); }',
          '}',
          '@Injectable()',
          'class OverloadedService {',
          '  work(value: string): string;',
          '  work(value: number): number;',
          '  work(value: string | number): string | number { return value; }',
          '}',
          '@Injectable()',
          'class AmbiguousCallService {',
          '  constructor(private readonly target: OverloadedService) {}',
          '  run(value: string): string { return this.target.work(value); }',
          '}',
          'interface LegacySink { write(message: string): void; }',
          '@Injectable()',
          'class UnsupportedTokenService {',
          '  constructor(@Inject(LEGACY_TOKEN) private readonly sink: LegacySink) {}',
          "  notify(): void { this.sink.write('message'); }",
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      const classById = new Map(analysis.classes.map((record) => [record.id, record]));
      const methodById = new Map(analysis.methods.map((record) => [record.id, record]));
      const injectionFacts = analysis.assertions
        .filter((assertion) => assertion.predicate === 'CLASS_INJECTS_CLASS')
        .map((assertion) => ({
          from: classById.get(assertion.subjectId)?.qualifiedName,
          to: assertion.objectId === null ? null : classById.get(assertion.objectId)?.qualifiedName,
          status: assertion.status,
          evidenceRoles: assertion.evidenceIds.map(
            (id) => analysis.evidence.find((evidence) => evidence.id === id)?.role,
          ),
        }))
        .sort((left, right) =>
          `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`),
        );

      expect(injectionFacts).toEqual([
        {
          from: 'AmbiguousCallService',
          to: 'OverloadedService',
          status: 'resolved',
          evidenceRoles: ['type_reference'],
        },
        {
          from: 'ExplicitAssignmentService',
          to: 'TargetService',
          status: 'resolved',
          evidenceRoles: ['type_reference'],
        },
        {
          from: 'MissingCallService',
          to: 'TargetService',
          status: 'resolved',
          evidenceRoles: ['type_reference'],
        },
        {
          from: 'ParameterPropertyController',
          to: 'TargetService',
          status: 'resolved',
          evidenceRoles: ['type_reference'],
        },
      ]);

      const calls = analysis.assertions.filter(
        (assertion) => assertion.predicate === 'METHOD_CALLS_METHOD',
      );
      const resolvedCallFacts = calls
        .filter((assertion) => assertion.status === 'resolved')
        .map((assertion) => ({
          from: methodById.get(assertion.subjectId)?.qualifiedName,
          to:
            assertion.objectId === null ? null : methodById.get(assertion.objectId)?.qualifiedName,
          evidenceRoles: assertion.evidenceIds
            .map((id) => analysis.evidence.find((evidence) => evidence.id === id)?.role)
            .sort(),
        }))
        .sort((left, right) =>
          `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`),
        );
      expect(resolvedCallFacts).toEqual([
        {
          from: 'ExplicitAssignmentService.run',
          to: 'TargetService.work',
          evidenceRoles: ['call_site', 'resolution_basis'],
        },
        {
          from: 'ParameterPropertyController.run',
          to: 'TargetService.work',
          evidenceRoles: ['call_site', 'resolution_basis'],
        },
      ]);
      expect(
        calls.some((assertion) => {
          const target =
            assertion.objectId === null ? undefined : methodById.get(assertion.objectId);
          return (
            target?.qualifiedName === 'OtherService.work' || target?.displayName === 'workBackup'
          );
        }),
      ).toBe(false);

      const ambiguousCalls = calls.filter((assertion) => assertion.status === 'ambiguous');
      expect(ambiguousCalls).toHaveLength(3);
      expect(
        ambiguousCalls.every(
          (assertion) =>
            assertion.objectId !== null &&
            methodById.get(assertion.subjectId)?.qualifiedName === 'AmbiguousCallService.run' &&
            methodById.get(assertion.objectId)?.qualifiedName === 'OverloadedService.work',
        ),
      ).toBe(true);

      const unsupported = analysis.diagnostics.find(
        (diagnostic) => diagnostic.code === 'DI_TOKEN_UNSUPPORTED',
      );
      expect(unsupported).toBeDefined();
      expect(
        unsupported?.subjectId === undefined
          ? undefined
          : classById.get(unsupported.subjectId)?.qualifiedName,
      ).toBe('UnsupportedTokenService');
      expect(unsupported?.message).toContain('UnsupportedTokenService.sink');
      expect(unsupported?.evidenceIds).toHaveLength(3);

      const unresolved = analysis.diagnostics.find(
        (diagnostic) => diagnostic.code === 'CALL_TARGET_UNRESOLVED',
      );
      expect(unresolved).toBeDefined();
      expect(
        unresolved?.subjectId === undefined
          ? undefined
          : methodById.get(unresolved.subjectId)?.qualifiedName,
      ).toBe('MissingCallService.run');
      expect(unresolved?.message).toContain('target.missing');
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
