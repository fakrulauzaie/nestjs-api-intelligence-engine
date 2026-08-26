import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_SCHEMA_VERSION } from '../../../src/model/analysis.js';

const corpusRoot = resolve('test/fixtures/post-mvp');
const classifications = ['ambiguous', 'negative', 'positive', 'unsupported'] as const;

interface CorpusManifest {
  readonly schemaVersion: string;
  readonly status: string;
  readonly fixtures: readonly {
    readonly feature: string;
    readonly expected: string;
    readonly futurePhases: readonly number[];
  }[];
}

interface FixtureExpectation {
  readonly schemaVersion: string;
  readonly feature: string;
  readonly status: string;
  readonly sourceFiles: readonly string[];
  readonly cases: readonly {
    readonly id: string;
    readonly classification: string;
    readonly expectation: string;
    readonly mustNotEmit: readonly string[];
  }[];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

describe('Phase 12 expansion groundwork', () => {
  it('freezes complete expectation classes for every future extractor corpus', async () => {
    const manifest = await readJson<CorpusManifest>(resolve(corpusRoot, 'manifest.json'));

    expect(manifest.schemaVersion).toBe('phase12-corpus-1');
    expect(manifest.status).toBe('frozen');
    expect(manifest.fixtures.map(({ feature }) => feature).sort()).toEqual([
      'comparison',
      'contracts',
      'modules',
      'provenance',
      'query-builder',
      'raw-sql',
    ]);

    const allCaseIds = new Set<string>();
    for (const fixture of manifest.fixtures) {
      expect(fixture.futurePhases.length).toBeGreaterThan(0);
      const expectationPath = resolve(corpusRoot, fixture.expected);
      const expectation = await readJson<FixtureExpectation>(expectationPath);

      expect(expectation.schemaVersion).toBe('phase12-expectation-1');
      expect(expectation.feature).toBe(fixture.feature);
      expect(expectation.status).toBe('pending');
      expect(
        [...new Set(expectation.cases.map(({ classification }) => classification))].sort(),
      ).toEqual([...classifications]);

      for (const sourceFile of expectation.sourceFiles) {
        expect(sourceFile).toMatch(/\.ts\.txt$/u);
        const sourcePath = resolve(dirname(expectationPath), sourceFile);
        expect((await stat(sourcePath)).isFile()).toBe(true);
        await expect(readFile(sourcePath, 'utf8')).resolves.toContain('CASE:');
      }

      for (const fixtureCase of expectation.cases) {
        expect(allCaseIds.has(fixtureCase.id), `Duplicate case ${fixtureCase.id}`).toBe(false);
        allCaseIds.add(fixtureCase.id);
        expect(fixtureCase.expectation.length).toBeGreaterThan(20);
        expect(fixtureCase.mustNotEmit.length).toBeGreaterThan(0);
      }
    }
  });

  it('records independent schema ownership and semantic identity boundaries', async () => {
    const [schemaAdr, semanticKeyAdr] = await Promise.all([
      readFile(resolve('docs/adr/0001-analysis-schema-evolution.md'), 'utf8'),
      readFile(resolve('docs/adr/0002-snapshot-semantic-keys.md'), 'utf8'),
    ]);

    expect(schemaAdr).toContain('Status: Accepted');
    expect(schemaAdr).toContain('Keep the published v1 schema immutable');
    expect(schemaAdr).toContain('`AnalysisDocument` v2');
    for (const derivedDocument of [
      '`DiffDocument`',
      '`ImpactDocument`',
      '`PolicyResultsDocument`',
      'OpenAPI match sidecar',
      'Offline graph view model',
    ]) {
      expect(schemaAdr, `Missing owner for ${derivedDocument}`).toContain(derivedDocument);
    }

    expect(semanticKeyAdr).toContain('not a replacement canonical ID');
    expect(semanticKeyAdr).toContain('Duplicate exact keys or route slots');
    expect(semanticKeyAdr).toMatch(/does not\s+inspect a working tree/u);
  });

  it('keeps unselected spike dependencies isolated, promotes selected pins, and preserves the production schema', async () => {
    const [rootPackage, spikePackage, parserReport, graphReport, baselineReport] =
      await Promise.all([
        readJson<{ readonly dependencies?: Readonly<Record<string, string>> }>(
          resolve('package.json'),
        ),
        readJson<{
          readonly private?: boolean;
          readonly dependencies?: Readonly<Record<string, string>>;
        }>(resolve('spikes/phase12/package.json')),
        readFile(resolve('docs/spikes/phase12-postgresql-parser.md'), 'utf8'),
        readFile(resolve('docs/spikes/phase12-offline-graph.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase12-baseline.md'), 'utf8'),
      ]);

    expect(ANALYSIS_SCHEMA_VERSION).toBe('1.0.0');
    expect(rootPackage.dependencies).toEqual({
      cytoscape: '3.34.0',
      'libpg-query': '18.1.2',
      zod: '4.1.5',
    });
    expect(spikePackage.private).toBe(true);
    expect(spikePackage.dependencies).toEqual({
      cytoscape: '3.34.0',
      'libpg-query': '18.1.2',
      'node-sql-parser': '5.4.0',
      'pgsql-parser': '18.1.1',
    });
    expect(parserReport).toContain('use `libpg-query@18.1.2` directly');
    expect(parserReport).toContain('explicit PostgreSQL 18 only');
    expect(graphReport).toContain('no HTTP, HTTPS, or protocol-relative');
    expect(baselineReport).toContain('five times with a clean output');
    expect(baselineReport).toContain('88,832 bytes');
    expect(baselineReport).toContain('39,844 bytes');
  });
});
