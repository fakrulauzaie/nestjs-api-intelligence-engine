import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { assertValidAnalysisDocument } from '../../src/evidence/validate.js';
import type { AnalysisDocument } from '../../src/model/analysis.js';
import {
  canonicalStringify,
  normalizeRunForComparison,
  serializeCanonicalAnalysis,
} from '../../src/model/ordering.js';

function reverseDiscoveryOrder(analysis: AnalysisDocument): AnalysisDocument {
  return {
    ...analysis,
    sourceFiles: analysis.sourceFiles.toReversed(),
    classes: analysis.classes.toReversed().map((record) => ({
      ...record,
      roles: record.roles.toReversed(),
    })),
    methods: analysis.methods.toReversed(),
    endpoints: analysis.endpoints.toReversed(),
    guards: analysis.guards.toReversed(),
    repositoryBindings: analysis.repositoryBindings.toReversed(),
    entities: analysis.entities.toReversed(),
    tables: analysis.tables.toReversed(),
    assertions: analysis.assertions.toReversed().map((record) => ({
      ...record,
      evidenceIds: record.evidenceIds.toReversed(),
    })),
    evidence: analysis.evidence.toReversed(),
    diagnostics: analysis.diagnostics.toReversed().map((record) => ({
      ...record,
      evidenceIds: record.evidenceIds.toReversed(),
    })),
    ...(analysis.schemaVersion !== '1.0.0'
      ? {
          modules: analysis.modules.toReversed(),
          globalGuardRegistrations: analysis.globalGuardRegistrations.toReversed(),
          contractTypes: analysis.contractTypes.toReversed(),
          contractFields: analysis.contractFields.toReversed().map((record) => ({
            ...record,
            declaredConstraints: record.declaredConstraints.toReversed(),
          })),
          requestParameters: analysis.requestParameters.toReversed().map((record) => ({
            ...record,
            declaredType: {
              ...record.declaredType,
              alternatives: record.declaredType.alternatives.toReversed(),
              contractTypeIds: record.declaredType.contractTypeIds.toReversed(),
            },
          })),
          responseContracts: analysis.responseContracts.toReversed().map((record) => ({
            ...record,
            declaredType: {
              ...record.declaredType,
              alternatives: record.declaredType.alternatives.toReversed(),
              contractTypeIds: record.declaredType.contractTypeIds.toReversed(),
            },
          })),
          entityColumns: analysis.entityColumns.toReversed(),
          requestFieldOrigins: analysis.requestFieldOrigins.toReversed().map((record) => ({
            ...record,
            contractFieldIds: record.contractFieldIds.toReversed(),
          })),
          columnInfluences: analysis.columnInfluences.toReversed().map((record) => ({
            ...record,
            propagationEvidenceIds: record.propagationEvidenceIds.toReversed(),
          })),
        }
      : {}),
    ...(analysis.schemaVersion === '3.0.0' ||
    analysis.schemaVersion === '4.0.0' ||
    analysis.schemaVersion === '5.0.0'
      ? {
          applications: analysis.applications.toReversed(),
          interactions: analysis.interactions.toReversed().map((record) => ({
            ...record,
            evidenceIds: record.evidenceIds.toReversed(),
          })),
          interactionHandlers: analysis.interactionHandlers.toReversed(),
          interactionAnalysis: {
            ...analysis.interactionAnalysis,
            schemaKinds: analysis.interactionAnalysis.schemaKinds.toReversed(),
            supportedKinds: analysis.interactionAnalysis.supportedKinds.toReversed(),
            enabledKinds: analysis.interactionAnalysis.enabledKinds.toReversed(),
          },
        }
      : {}),
    ...(analysis.schemaVersion === '4.0.0' || analysis.schemaVersion === '5.0.0'
      ? {
          interactionHandlerDispatches: analysis.interactionHandlerDispatches
            .toReversed()
            .map((record) => ({
              ...record,
              branchIds: record.branchIds.toReversed(),
              evidenceIds: record.evidenceIds.toReversed(),
            })),
          interactionHandlerBranches: analysis.interactionHandlerBranches
            .toReversed()
            .map((record) => ({
              ...record,
              evidenceIds: record.evidenceIds.toReversed(),
              selector:
                record.selector.kind === 'exact_jobs'
                  ? { ...record.selector, jobs: record.selector.jobs.toReversed() }
                  : record.selector.kind === 'unmatched_jobs'
                    ? {
                        ...record.selector,
                        excludedJobs: record.selector.excludedJobs.toReversed(),
                      }
                    : record.selector,
            })),
          interactionHandlerBranchEffects: analysis.interactionHandlerBranchEffects
            .toReversed()
            .map((record) => ({
              ...record,
              evidenceIds: record.evidenceIds.toReversed(),
            })),
        }
      : {}),
    ...(analysis.schemaVersion === '5.0.0'
      ? {
          authorizationMetadata: analysis.authorizationMetadata.toReversed().map((record) => ({
            ...record,
            evidenceIds: record.evidenceIds.toReversed(),
          })),
          authorizationEnforcements: analysis.authorizationEnforcements
            .toReversed()
            .map((record) => ({
              ...record,
              evidenceIds: record.evidenceIds.toReversed(),
            })),
        }
      : {}),
  };
}

describe('complete integrated analysis v5 determinism and frozen v2 golden', () => {
  it('keeps v2 byte-stable and v5 scans identical across discovery order', async () => {
    const repositoryRoot = resolve('example-nestjs-app');
    const goldenPath = resolve('test/golden/example-nestjs-app/analysis-v2.json');
    const startedAt = performance.now();
    const [first, second] = await Promise.all([
      scanRepository({ repositoryRoot }),
      scanRepository({ repositoryRoot }),
    ]);
    const elapsedMs = performance.now() - startedAt;
    const golden = await readFile(goldenPath, 'utf8');
    const frozenV2 = assertValidAnalysisDocument(JSON.parse(golden) as unknown);

    expect(serializeCanonicalAnalysis(frozenV2)).toBe(golden);
    expect(first.analysis.schemaVersion).toBe('5.0.0');
    expect(serializeCanonicalAnalysis(second.analysis)).toBe(
      serializeCanonicalAnalysis(first.analysis),
    );
    expect(serializeCanonicalAnalysis(reverseDiscoveryOrder(first.analysis))).toBe(
      serializeCanonicalAnalysis(first.analysis),
    );
    expect(canonicalStringify(normalizeRunForComparison(first.run))).toBe(
      canonicalStringify(normalizeRunForComparison(second.run)),
    );
    expect(elapsedMs).toBeLessThan(40_000);
  }, 60_000);
});
