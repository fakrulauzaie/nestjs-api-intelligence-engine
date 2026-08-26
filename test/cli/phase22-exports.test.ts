import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { normalizePolicyConfiguration } from '../../src/policy/config.js';
import { evaluatePolicies } from '../../src/policy/evaluate.js';
import { serializePolicyResults } from '../../src/policy/ordering.js';
import { assertValidOpenApiEnrichmentResult } from '../../src/structured-exports/validate.js';
import { createMinimalAnalysisDocument } from '../helpers/minimal-analysis.js';
import { createTestTypeScriptProject } from '../helpers/typescript-project.js';

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeOut(message) {
        stdout.push(message);
      },
      writeError(message) {
        stderr.push(message);
      },
    },
  };
}

describe('Phase 22 structured-export CLI', () => {
  it('publishes deterministic OpenAPI and control artifacts without modifying inputs', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysis = createMinimalAnalysisDocument();
      const analysisPath = await files.write('analysis.json', serializeCanonicalAnalysis(analysis));
      const openApiText = JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Health', version: '1' },
        paths: { '/v1/health': { get: { summary: 'Keep me' } } },
      });
      const openApiPath = await files.write('openapi.json', openApiText);
      const policyResults = evaluatePolicies({
        analysis,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: { 'no-repository-access-in-controller': 'warn' },
        }),
      });
      const policyPath = await files.write(
        'policy-results.json',
        serializePolicyResults(policyResults),
      );
      const output = join(files.path, 'exports');
      const openApiIo = captureIo();
      expect(
        await runCli(
          [
            'openapi',
            analysisPath,
            '--document',
            openApiPath,
            '--path-prefix',
            '/v1',
            '--output',
            output,
          ],
          openApiIo.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(await readFile(openApiPath, 'utf8')).toBe(openApiText);
      const sidecarText = await readFile(join(output, 'openapi-enrichment.json'), 'utf8');
      expect(
        assertValidOpenApiEnrichmentResult(JSON.parse(sidecarText) as unknown).summary.resolved,
      ).toBe(1);
      const enrichedText = await readFile(join(output, 'openapi.enriched.json'), 'utf8');
      expect(enrichedText).toContain('"x-api-intel"');

      const controlsIo = captureIo();
      expect(
        await runCli(
          ['controls', analysisPath, '--policy-results', policyPath, '--output', output],
          controlsIo.io,
        ),
      ).toBe(EXIT_CODE.success);
      const firstJson = await readFile(join(output, 'control-evidence.json'), 'utf8');
      const firstCsv = await readFile(join(output, 'control-evidence.csv'), 'utf8');
      expect(firstJson).toContain('"state": "supplied"');
      expect(firstCsv).toContain('analysis_id');
      expect(
        await runCli(['controls', analysisPath, '-p', policyPath, '-o', output], controlsIo.io),
      ).toBe(EXIT_CODE.success);
      expect(await readFile(join(output, 'control-evidence.json'), 'utf8')).toBe(firstJson);
      expect(await readFile(join(output, 'control-evidence.csv'), 'utf8')).toBe(firstCsv);
    } finally {
      await files.cleanup();
    }
  });

  it('separates invalid structured inputs and refuses an OpenAPI input/output collision', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createMinimalAnalysisDocument()),
      );
      const invalidOpenApi = await files.write('invalid.json', JSON.stringify({ swagger: '2.0' }));
      const invalid = captureIo();
      expect(
        await runCli(['openapi', analysisPath, '--document', invalidOpenApi], invalid.io),
      ).toBe(EXIT_CODE.invalidStructuredInput);

      const collisionText = JSON.stringify({ openapi: '3.0.3', paths: {} });
      const collisionPath = await files.write('openapi.enriched.json', collisionText);
      const collision = captureIo();
      expect(
        await runCli(
          ['openapi', analysisPath, '-d', collisionPath, '-o', files.path],
          collision.io,
        ),
      ).toBe(EXIT_CODE.usageError);
      expect(await readFile(collisionPath, 'utf8')).toBe(collisionText);
    } finally {
      await files.cleanup();
    }
  });
});
