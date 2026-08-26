import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../src/evidence/validate.js';
import type { AnalysisDocument } from '../../src/model/analysis.js';
import type { AssertionPredicate } from '../../src/model/assertions.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { buildEndpointCatalogue } from '../../src/reporting/endpoint-catalogue.js';

interface NegativeExpectation {
  readonly assertionsThatMustNotExist: readonly {
    readonly predicate: AssertionPredicate;
    readonly subject: string;
    readonly object: string;
    readonly reason: string;
  }[];
  readonly propertiesThatMustNotBeClaimed: readonly {
    readonly subject: string;
    readonly property: string;
    readonly reason: string;
  }[];
}

function semanticLabel(analysis: AnalysisDocument, id: string | null): string | null {
  if (id === null) return null;
  const endpoint = analysis.endpoints.find((record) => record.id === id);
  if (endpoint !== undefined) return `${endpoint.httpMethod} ${endpoint.path}`;
  const method = analysis.methods.find((record) => record.id === id);
  if (method !== undefined) return method.qualifiedName;
  const classRecord = analysis.classes.find((record) => record.id === id);
  if (classRecord !== undefined) return classRecord.qualifiedName;
  const entity = analysis.entities.find((record) => record.id === id);
  if (entity !== undefined) return entity.displayName;
  const table = analysis.tables.find((record) => record.id === id);
  return table?.name ?? id;
}

function hasOwnPropertyDeep(value: unknown, property: string): boolean {
  if (Array.isArray(value)) return value.some((child) => hasOwnPropertyDeep(child, property));
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(record, property) ||
    Object.values(record).some((child) => hasOwnPropertyDeep(child, property))
  );
}

describe('Phase 10 integrated negatives and integrity', () => {
  it('enforces every frozen negative assertion and keeps diagnostics bounded to safe context', async () => {
    const repositoryRoot = resolve('example-nestjs-app');
    const expected = JSON.parse(
      await readFile(resolve(repositoryRoot, 'expected/negative-assertions.json'), 'utf8'),
    ) as NegativeExpectation;
    const scanned = await scanRepository({ repositoryRoot });
    const { analysis } = scanned;

    expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    for (const forbidden of expected.assertionsThatMustNotExist) {
      const matching = analysis.assertions.filter(
        (assertion) =>
          assertion.predicate === forbidden.predicate &&
          semanticLabel(analysis, assertion.subjectId) === forbidden.subject &&
          semanticLabel(analysis, assertion.objectId) === forbidden.object,
      );
      expect(matching, forbidden.reason).toEqual([]);
    }

    for (const forbidden of expected.propertiesThatMustNotBeClaimed) {
      if (forbidden.subject === 'any endpoint without direct UseGuards') {
        expect(
          hasOwnPropertyDeep(buildEndpointCatalogue(analysis).endpoints, forbidden.property),
          forbidden.reason,
        ).toBe(false);
        continue;
      }
      const subject = analysis.methods.find((method) => method.qualifiedName === forbidden.subject);
      expect(subject, `Missing meaningful negative subject ${forbidden.subject}`).toBeDefined();
      const subjectFacts = analysis.assertions.filter(
        (assertion) => assertion.subjectId === subject?.id,
      );
      expect(hasOwnPropertyDeep(subjectFacts, forbidden.property), forbidden.reason).toBe(false);
    }

    const absoluteForms = [repositoryRoot, repositoryRoot.replaceAll('\\', '/')].map((value) =>
      value.toLowerCase(),
    );
    for (const diagnostic of analysis.diagnostics) {
      const message = diagnostic.message.toLowerCase();
      expect(
        absoluteForms.every((absolutePath) => !message.includes(absolutePath)),
        `Diagnostic ${diagnostic.code} exposed the checkout path`,
      ).toBe(true);
      for (const source of scanned.inventory.sourceFiles) {
        const sourceText = source.text.trim();
        if (sourceText.length >= 40) {
          expect(
            diagnostic.message.includes(sourceText),
            `Diagnostic ${diagnostic.code} included full source ${source.record.path}`,
          ).toBe(false);
        }
      }
    }

    for (const evidence of analysis.evidence) {
      if (evidence.snippet !== undefined) {
        expect([...evidence.snippet].length).toBeLessThanOrEqual(
          analysis.analysisRun.configuration.evidenceSnippetLimit,
        );
      }
    }
    const canonical = serializeCanonicalAnalysis(analysis).toLowerCase();
    expect(absoluteForms.every((absolutePath) => !canonical.includes(absolutePath))).toBe(true);
  }, 30_000);
});
