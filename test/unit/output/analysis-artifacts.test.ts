import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeAnalysisArtifacts } from '../../../src/output/analysis-artifacts.js';
import type { AnalysisDocument, RunDocument } from '../../../src/model/analysis.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';
import { createTestTypeScriptProject } from '../../helpers/typescript-project.js';

function runFor(analysis: AnalysisDocument): RunDocument {
  return {
    schemaVersion: analysis.schemaVersion,
    analysisId: analysis.analysisRun.id,
    repositoryPath: 'C:\\fixture',
    repositoryRevision: analysis.analysisRun.repositoryRevision,
    startedAt: '2026-08-17T00:00:00.000Z',
    endedAt: '2026-08-17T00:00:01.000Z',
    durationMs: 1_000,
    resultState: analysis.resultState,
    tool: analysis.analysisRun.tool,
    configuration: analysis.analysisRun.configuration,
    diagnostics: analysis.diagnostics,
  };
}

describe('analysis artifact publication hardening', () => {
  it('validates cross-record integrity before creating any output', async () => {
    const files = await createTestTypeScriptProject();
    const outputDirectory = join(files.path, 'invalid-output');
    try {
      const valid = createMinimalAnalysisDocument();
      const invalid: AnalysisDocument = {
        ...valid,
        assertions: [{ ...valid.assertions[0]!, evidenceIds: [] }],
      };

      await expect(
        writeAnalysisArtifacts(outputDirectory, invalid, runFor(valid)),
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'RESOLVED_ASSERTION_WITHOUT_EVIDENCE' }),
        ]),
      });
      await expect(access(outputDirectory)).rejects.toThrow();
    } finally {
      await files.cleanup();
    }
  });

  it('preserves an existing canonical file and leaves no staging files when interrupted', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysis = createMinimalAnalysisDocument();
      const outputDirectory = join(files.path, 'interrupted-output');
      const analysisPath = await files.write(
        'interrupted-output/analysis.json',
        'previous complete canonical output\n',
      );
      const controller = new AbortController();
      controller.abort();

      await expect(
        writeAnalysisArtifacts(outputDirectory, analysis, runFor(analysis), {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(await readFile(analysisPath, 'utf8')).toBe('previous complete canonical output\n');
      expect((await readdir(outputDirectory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      await expect(access(join(outputDirectory, 'run.json'))).rejects.toThrow();
      await expect(access(join(outputDirectory, 'endpoints.md'))).rejects.toThrow();
      await expect(access(join(outputDirectory, 'contracts.md'))).rejects.toThrow();
    } finally {
      await files.cleanup();
    }
  });

  it('fails cleanly when the output location is a regular file', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysis = createMinimalAnalysisDocument();
      const blockedOutput = await files.write('not-a-directory', 'user-owned content\n');

      await expect(
        writeAnalysisArtifacts(blockedOutput, analysis, runFor(analysis)),
      ).rejects.toThrow();
      expect(await readFile(blockedOutput, 'utf8')).toBe('user-owned content\n');
    } finally {
      await files.cleanup();
    }
  });
});
