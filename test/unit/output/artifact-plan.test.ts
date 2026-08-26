import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertValidBundleManifest,
  prepareArtifactPublication,
  writePreparedArtifactPublication,
} from '../../../src/output/artifact-plan.js';
import { createTestTypeScriptProject } from '../../helpers/typescript-project.js';

function publication(outputDirectory: string) {
  return prepareArtifactPublication({
    outputDirectory,
    analysis: {
      id: 'run:fixture',
      schemaVersion: '2.0.0',
      resultState: 'completed',
    },
    requestedReporters: ['markdown', 'analysis', 'analysis'],
    inputSnapshots: [{ kind: 'analysis', id: 'run:fixture', schemaVersion: '2.0.0' }],
    artifacts: [
      { kind: 'analysis', path: join(outputDirectory, 'analysis.json'), contents: '{}\n' },
      {
        kind: 'run',
        path: join(outputDirectory, 'run.json'),
        contents: '{}\n',
        stability: 'run_metadata',
      },
      {
        kind: 'endpoint_catalogue',
        path: join(outputDirectory, 'endpoints.md'),
        contents: '# Endpoints\n',
      },
      {
        kind: 'contract_report',
        path: join(outputDirectory, 'contracts.md'),
        contents: '# Contracts\n',
      },
      {
        kind: 'trace_manifest',
        path: join(outputDirectory, '.api-intel-reports.json'),
        contents: '{}\n',
      },
    ],
  });
}

describe('Phase 28 coherent artifact planning', () => {
  it('precomputes a strict deterministic inventory and commits bundle.json last', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const prepared = publication(files.path);
      expect(prepared.files.at(-1)?.path).toBe(join(files.path, 'bundle.json'));
      expect(prepared.bundle.requestedReporters).toEqual(['analysis', 'markdown']);
      expect(prepared.bundle.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'analysis',
            path: 'analysis.json',
            stability: 'canonical',
          }),
          expect.objectContaining({ kind: 'run', path: 'run.json', stability: 'run_metadata' }),
        ]),
      );
      await writePreparedArtifactPublication(prepared);
      expect(
        assertValidBundleManifest(
          JSON.parse(await readFile(join(files.path, 'bundle.json'), 'utf8')) as unknown,
        ),
      ).toEqual(prepared.bundle);
    } finally {
      await files.cleanup();
    }
  });

  it('rejects duplicate/protected destinations before commit and preserves a prior bundle on cancellation', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const inputPath = await files.write('source.json', 'source\n');
      expect(() =>
        prepareArtifactPublication({
          outputDirectory: files.path,
          analysis: { id: 'run:fixture', schemaVersion: '2.0.0', resultState: 'completed' },
          requestedReporters: ['analysis'],
          inputSnapshots: [{ kind: 'analysis', id: 'run:fixture', schemaVersion: '2.0.0' }],
          artifacts: [
            { kind: 'analysis', path: inputPath, contents: 'replacement\n' },
            { kind: 'run', path: inputPath, contents: 'duplicate\n' },
          ],
          protectedInputPaths: [inputPath],
        }),
      ).toThrow(/protected input|same path/u);
      expect(await readFile(inputPath, 'utf8')).toBe('source\n');

      expect(() =>
        prepareArtifactPublication({
          outputDirectory: files.path,
          analysis: { id: 'run:fixture', schemaVersion: '2.0.0', resultState: 'completed' },
          requestedReporters: ['analysis'],
          inputSnapshots: [{ kind: 'analysis', id: 'run:fixture', schemaVersion: '2.0.0' }],
          artifacts: [
            { kind: 'analysis', path: join(files.path, 'analysis.json'), contents: '{}\n' },
          ],
          protectedInputPaths: [join(files.path, 'bundle.json')],
        }),
      ).toThrow('Bundle manifest collides');

      const oldBundle = await files.write('bundle.json', 'previous complete bundle\n');
      const controller = new AbortController();
      controller.abort();
      await expect(
        writePreparedArtifactPublication(publication(files.path), controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(await readFile(oldBundle, 'utf8')).toBe('previous complete bundle\n');
    } finally {
      await files.cleanup();
    }
  });
});
