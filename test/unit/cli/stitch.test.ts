import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../../src/cli/index.js';
import { EXIT_CODE } from '../../../src/cli/errors.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { validateSystemAnalysisDocument } from '../../../src/system-analysis/index.js';
import { validateSystemReportDocument } from '../../../src/system-report/index.js';
import { createMinimalAnalysisDocumentV3 } from '../../helpers/minimal-analysis.js';
import { createTemporaryDirectory } from '../../helpers/temp-directory.js';

function emptyInteractionAnalysis() {
  const base = createMinimalAnalysisDocumentV3();
  return {
    ...base,
    resultState: 'completed' as const,
    interactionAnalysis: {
      schemaKinds: [
        'outbound_http',
        'in_process_event',
        'job_queue',
        'microservice_message',
      ] as const,
      supportedKinds: [
        'outbound_http',
        'in_process_event',
        'job_queue',
        'microservice_message',
      ] as const,
      enabledKinds: [
        'outbound_http',
        'in_process_event',
        'job_queue',
        'microservice_message',
      ] as const,
      state: 'complete' as const,
    },
  };
}

describe('Phase 46 stitch CLI', () => {
  it('loads named files and .api-intel directories and atomically publishes both reports', async () => {
    const temporary = await createTemporaryDirectory();
    try {
      const firstDirectory = join(temporary.path, 'first', '.api-intel');
      const secondFile = join(temporary.path, 'second-analysis.json');
      const outputDirectory = join(temporary.path, 'system-output');
      await mkdir(firstDirectory, { recursive: true });
      const serialized = serializeCanonicalAnalysis(emptyInteractionAnalysis());
      await Promise.all([
        writeFile(join(firstDirectory, 'analysis.json'), serialized, 'utf8'),
        writeFile(secondFile, serialized, 'utf8'),
      ]);
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runCli(
        [
          'stitch',
          `ticket-service=${firstDirectory}`,
          `ctt-queue-service=${secondFile}`,
          '--name',
          'ticket-ctt-system',
          '--output',
          outputDirectory,
        ],
        {
          writeOut: (value) => stdout.push(value),
          writeError: (value) => stderr.push(value),
        },
      );

      expect(exitCode).toBe(EXIT_CODE.success);
      expect(stderr).toEqual([]);
      expect(stdout.join('\n')).toContain('System analysis:');
      const json = JSON.parse(
        await readFile(join(outputDirectory, 'system-analysis.json'), 'utf8'),
      ) as unknown;
      expect(validateSystemAnalysisDocument(json)).toMatchObject({ success: true });
      expect(json).toMatchObject({
        systemName: 'ticket-ctt-system',
        sourceDocumentsEmbedded: false,
        services: expect.arrayContaining([
          expect.objectContaining({ namespace: 'ticket-service' }),
          expect.objectContaining({ namespace: 'ctt-queue-service' }),
        ]),
      });
      expect(await readFile(join(outputDirectory, 'system-analysis.md'), 'utf8')).toContain(
        'Static artifact correlation only',
      );
    } finally {
      await temporary.cleanup();
    }
  });

  it('rejects malformed named inputs as usage-safe structured input errors', async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(['stitch', 'missing-separator'], {
      writeOut: () => undefined,
      writeError: (value) => stderr.push(value),
    });
    expect(exitCode).toBe(EXIT_CODE.invalidStructuredInput);
    expect(stderr.join('\n')).toContain('Named analysis must use');
  });

  it('publishes the bounded offline system report only when requested', async () => {
    const temporary = await createTemporaryDirectory();
    try {
      const analysisFile = join(temporary.path, 'analysis.json');
      const outputDirectory = join(temporary.path, 'system output with spaces');
      await writeFile(analysisFile, serializeCanonicalAnalysis(emptyInteractionAnalysis()), 'utf8');
      const stdout: string[] = [];
      const exitCode = await runCli(
        [
          'stitch',
          `empty-service=${analysisFile}`,
          '--name',
          'empty-system',
          '--output',
          outputDirectory,
          '--with-graph',
          '--max-nodes',
          '10',
          '--max-edges',
          '10',
        ],
        { writeOut: (value) => stdout.push(value), writeError: () => undefined },
      );
      expect(exitCode).toBe(EXIT_CODE.success);
      expect(stdout.join('\n')).toContain('System graph:');
      expect(
        validateSystemReportDocument(
          JSON.parse(await readFile(join(outputDirectory, 'system-report.json'), 'utf8')),
        ),
      ).toMatchObject({ success: true });
      expect(await readFile(join(outputDirectory, 'system-report.md'), 'utf8')).toContain(
        'Static artifact projection only',
      );
      const html = await readFile(join(outputDirectory, 'api-intel-system-graph.html'), 'utf8');
      expect(html).toContain("connect-src 'none'");
      expect(html).toContain('Accessible graph table');
    } finally {
      await temporary.cleanup();
    }
  });

  it('rejects system graph display options without --with-graph as usage errors', async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(['stitch', 'service=analysis.json', '--open'], {
      writeOut: () => undefined,
      writeError: (value) => stderr.push(value),
    });
    expect(exitCode).toBe(EXIT_CODE.usageError);
    expect(stderr.join('\n')).toContain('require --with-graph');
  });
});
