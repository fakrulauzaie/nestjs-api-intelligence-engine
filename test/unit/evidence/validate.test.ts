import { describe, expect, it } from 'vitest';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import {
  createStableId,
  makeAssertionId,
  makeGlobalGuardRegistrationId,
  makeGuardId,
  makeModuleId,
} from '../../../src/model/ids.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

function issueCodes(input: unknown): string[] {
  const result = validateAnalysisDocument(input);
  return result.success ? [] : result.issues.map((issue) => issue.code);
}

function createMinimalV2WithGlobalGuard() {
  const minimal = createMinimalAnalysisDocument();
  const sourceClass = {
    ...minimal.classes[0]!,
    roles: ['controller', 'guard', 'module'] as const,
  };
  const moduleId = makeModuleId(sourceClass.id);
  const guardId = makeGuardId(sourceClass.id);
  const assertionId = makeAssertionId({
    subjectId: moduleId,
    predicate: 'MODULE_REGISTERS_GLOBAL_GUARD',
    objectId: guardId,
    ruleId: 'nest.global-guard.app-guard-use-class.v1',
  });
  const registrationEvidenceId = minimal.evidence[2]!.id;
  const registration = {
    id: makeGlobalGuardRegistrationId({
      moduleId,
      guardId,
      kind: 'app_guard_use_class',
      registrationEvidenceId,
    }),
    moduleId,
    guardId,
    kind: 'app_guard_use_class' as const,
    order: 0,
    assertionId,
    registrationEvidenceId,
  };
  return {
    ...minimal,
    schemaVersion: '2.0.0' as const,
    classes: [sourceClass],
    guards: [{ id: guardId, classId: sourceClass.id, displayName: sourceClass.displayName }],
    modules: [
      {
        id: moduleId,
        classId: sourceClass.id,
        isGlobal: false,
        metadataCompleteness: 'complete' as const,
        declarationEvidenceId: sourceClass.declarationEvidenceId,
      },
    ],
    globalGuardRegistrations: [registration],
    contractTypes: [],
    contractFields: [],
    requestParameters: [],
    responseContracts: [],
    entityColumns: [],
    requestFieldOrigins: [],
    columnInfluences: [],
    globalGuardAnalysis: { completeness: 'complete' as const, state: 'declared' as const },
    assertions: [
      ...minimal.assertions,
      {
        id: assertionId,
        subjectId: moduleId,
        predicate: 'MODULE_REGISTERS_GLOBAL_GUARD' as const,
        objectId: guardId,
        status: 'resolved' as const,
        ruleId: 'nest.global-guard.app-guard-use-class.v1',
        evidenceIds: [registrationEvidenceId],
      },
    ],
  };
}

describe('analysis integrity validation', () => {
  it('accepts the hand-constructed minimal analysis', () => {
    const result = validateAnalysisDocument(createMinimalAnalysisDocument());

    expect(result.success).toBe(true);
  });

  it('rejects a resolved assertion without evidence', () => {
    const minimal = createMinimalAnalysisDocument();
    const analysis = {
      ...minimal,
      assertions: [{ ...minimal.assertions[0]!, evidenceIds: [] }],
    };

    expect(issueCodes(analysis)).toContain('RESOLVED_ASSERTION_WITHOUT_EVIDENCE');
  });

  it('rejects missing and wrong-kind references', () => {
    const minimalMissing = createMinimalAnalysisDocument();
    const missing = {
      ...minimalMissing,
      assertions: [
        {
          ...minimalMissing.assertions[0]!,
          subjectId: createStableId('endpoint', ['missing']),
        },
      ],
    };
    expect(issueCodes(missing)).toContain('MISSING_REFERENCE');

    const minimalWrongKind = createMinimalAnalysisDocument();
    const wrongKind = {
      ...minimalWrongKind,
      assertions: [
        {
          ...minimalWrongKind.assertions[0]!,
          subjectId: minimalWrongKind.methods[0]!.id,
        },
      ],
    };
    expect(issueCodes(wrongKind)).toContain('REFERENCE_KIND_MISMATCH');
  });

  it('requires resolved and ambiguous assertions to have a target', () => {
    for (const status of ['resolved', 'ambiguous'] as const) {
      const minimal = createMinimalAnalysisDocument();
      const analysis = {
        ...minimal,
        assertions: [{ ...minimal.assertions[0]!, status, objectId: null }],
      };

      expect(issueCodes(analysis)).toContain('MISSING_ASSERTION_TARGET');
    }
  });

  it('permits an unresolved assertion with a null target when evidence exists', () => {
    const minimal = createMinimalAnalysisDocument();
    const analysis = {
      ...minimal,
      assertions: [{ ...minimal.assertions[0]!, status: 'unresolved' as const, objectId: null }],
    };

    expect(validateAnalysisDocument(analysis).success).toBe(true);
  });

  it('rejects an evidence hash that differs from the indexed source', () => {
    const minimal = createMinimalAnalysisDocument();
    const analysis = {
      ...minimal,
      evidence: [
        {
          ...minimal.evidence[0]!,
          contentHash: `sha256:${'f'.repeat(64)}`,
        },
        ...minimal.evidence.slice(1),
      ],
    };

    expect(issueCodes(analysis)).toContain('EVIDENCE_HASH_MISMATCH');
  });

  it('rejects evidence that points to an unknown source file', () => {
    const minimal = createMinimalAnalysisDocument();
    const analysis = {
      ...minimal,
      evidence: [
        {
          ...minimal.evidence[0]!,
          fileId: createStableId('source', ['missing']),
        },
        ...minimal.evidence.slice(1),
      ],
    };

    expect(issueCodes(analysis)).toContain('MISSING_REFERENCE');
  });

  it('rejects an evidence range whose start follows its end', () => {
    const minimal = createMinimalAnalysisDocument();
    const analysis = {
      ...minimal,
      evidence: [
        {
          ...minimal.evidence[0]!,
          startLine: 8,
          endLine: 7,
        },
        ...minimal.evidence.slice(1),
      ],
    };

    expect(issueCodes(analysis)).toContain('INVALID_EVIDENCE_RANGE');
  });

  it('distinguishes duplicate IDs from unequal stable-ID collisions', () => {
    const minimalDuplicate = createMinimalAnalysisDocument();
    const duplicate = {
      ...minimalDuplicate,
      evidence: [...minimalDuplicate.evidence, minimalDuplicate.evidence[0]!],
    };
    expect(issueCodes(duplicate)).toContain('DUPLICATE_RECORD_ID');

    const minimalCollision = createMinimalAnalysisDocument();
    const collision = {
      ...minimalCollision,
      evidence: [
        ...minimalCollision.evidence,
        {
          ...minimalCollision.evidence[0]!,
          snippet: 'different content under the same ID',
        },
      ],
    };
    expect(issueCodes(collision)).toContain('STABLE_ID_COLLISION');
  });

  it('rejects schema-invalid canonical output before integrity traversal', () => {
    const analysis = { ...createMinimalAnalysisDocument(), unknownField: true };

    expect(issueCodes(analysis)).toEqual(['SCHEMA_INVALID']);
  });

  it('validates v2 global registration linkage, order, and completeness', () => {
    const valid = createMinimalV2WithGlobalGuard();
    expect(validateAnalysisDocument(valid).success).toBe(true);

    const mismatched = {
      ...valid,
      globalGuardRegistrations: [
        { ...valid.globalGuardRegistrations[0]!, assertionId: valid.assertions[0]!.id, order: 2 },
      ],
    };
    expect(issueCodes(mismatched)).toContain('GLOBAL_GUARD_REGISTRATION_MISMATCH');

    const falseCompleteness = {
      ...valid,
      modules: [{ ...valid.modules[0]!, metadataCompleteness: 'incomplete' as const }],
    };
    expect(issueCodes(falseCompleteness)).toContain('GLOBAL_GUARD_STATE_MISMATCH');
  });
});
