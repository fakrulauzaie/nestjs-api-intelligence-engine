import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProjectConfigurationForScan,
  ProjectConfigurationInputError,
} from '../../../src/config/project-config.js';
import {
  apiIntelConfigurationJsonSchema,
  projectConfigurationFileSchema,
} from '../../../src/config/project-config-schema.js';
import { createTestTypeScriptProject } from '../../helpers/typescript-project.js';

describe('Phase 27 project configuration contract', () => {
  it('keeps the bundled JSON Schema generated from the strict runtime schema', async () => {
    const bundled = JSON.parse(
      await readFile(resolve('schemas/api-intel.config.schema.json'), 'utf8'),
    ) as unknown;
    expect(bundled).toEqual(apiIntelConfigurationJsonSchema());

    const accepted = [
      {
        version: 1,
        rules: { 'no-repository-access-in-controller': 'error' },
      },
      {
        $schema: 'https://example.invalid/schema-that-must-not-be-read.json',
        version: 2,
        analysis: { maxCallDepth: 2, rawSqlDialect: 'postgresql-18' },
        output: { directory: '.api-intel' },
        rules: { 'require-guard-on-write-endpoint': 'error' },
        reports: {
          policy: { enabled: true },
          graph: { enabled: true, maxNodesPerEndpoint: 40, maxEdgesPerEndpoint: 60 },
          controls: { enabled: true },
          openapi: {
            enabled: true,
            document: './openapi.json',
            pathPrefix: '/api',
            includeEvidence: true,
          },
        },
      },
      { version: 2 },
      {
        version: 3,
        analysis: {
          interactions: {
            maxInteractionHops: 4,
            maxFanOutPerInteraction: 80,
            maxInteractionTraceStates: 2_000,
          },
        },
      },
      { version: 3 },
    ];
    const rejected = [
      { version: 4 },
      { version: 2, analysis: { interactions: { maxInteractionHops: 2 } } },
      { version: 3, analysis: { interactions: { maxInteractionHops: 9 } } },
      { version: 3, analysis: { interactions: { invented: 2 } } },
      { version: 2, invented: true },
      { version: 2, analysis: { maxCallDepth: 4 } },
      { version: 2, analysis: { rawSqlDialect: 'mysql' } },
      { version: 2, output: { directory: '   ' } },
      { version: 2, rules: {} },
      { version: 2, rules: { invented: 'error' } },
      { version: 2, reports: { graph: { enabled: true, maxNodesPerEndpoint: 9 } } },
      { version: 2, reports: { policy: { enabled: true } } },
      { version: 2, reports: { openapi: { enabled: true } } },
      { version: 2, reports: { controls: { enabled: true, invented: true } } },
      {
        version: 2,
        rules: {
          'require-complete-write-trace': ['error', { onUnknown: 'warn' }, 'extra'],
        },
      },
    ];

    for (const fixture of accepted) {
      expect(
        projectConfigurationFileSchema.safeParse(fixture).success,
        JSON.stringify(fixture),
      ).toBe(true);
    }
    for (const fixture of rejected) {
      expect(
        projectConfigurationFileSchema.safeParse(fixture).success,
        JSON.stringify(fixture),
      ).toBe(false);
    }
  });

  it('discovers only the exact root, supports explicit/disabled loading, and ignores $schema', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const repositoryRoot = join(files.path, 'repository');
      await files.write('repository/placeholder.txt', 'repository');
      await files.write(
        'api-intel.config.json',
        JSON.stringify({
          version: 2,
          output: { directory: 'parent-output' },
        }),
      );
      expect(await loadProjectConfigurationForScan({ repositoryRoot })).toBeUndefined();

      const rootConfig = await files.write(
        'repository/api-intel.config.json',
        JSON.stringify({
          $schema: join(files.path, 'does-not-exist.schema.json'),
          version: 2,
          analysis: { maxCallDepth: 2 },
          output: { directory: 'configured output' },
          reports: { graph: { enabled: true } },
        }),
      );
      const discovered = await loadProjectConfigurationForScan({ repositoryRoot });
      expect(discovered).toMatchObject({
        path: rootConfig,
        sourceKind: 'discovered',
        fileVersion: 2,
        analysis: { maxCallDepth: 2 },
        outputDirectory: join(repositoryRoot, 'configured output'),
        graph: { enabled: true, maxNodesPerEndpoint: 120, maxEdgesPerEndpoint: 180 },
      });
      expect(
        await loadProjectConfigurationForScan({ repositoryRoot, disabled: true }),
      ).toBeUndefined();
      await expect(
        loadProjectConfigurationForScan({
          repositoryRoot,
          explicitPath: join(files.path, 'missing-explicit.json'),
        }),
      ).rejects.toThrow('Could not read project configuration');

      const explicitPath = await files.write(
        'configuration/explicit.json',
        JSON.stringify({ version: 2, output: { directory: '../outside-repository' } }),
      );
      const explicit = await loadProjectConfigurationForScan({
        repositoryRoot,
        explicitPath,
      });
      expect(explicit?.sourceKind).toBe('explicit');
      expect(explicit?.outputDirectory).toBe(join(files.path, 'outside-repository'));

      const v3Path = await files.write(
        'configuration/v3.json',
        JSON.stringify({
          version: 3,
          analysis: { interactions: { maxInteractionHops: 4 } },
        }),
      );
      expect(
        await loadProjectConfigurationForScan({ repositoryRoot, explicitPath: v3Path }),
      ).toMatchObject({
        fileVersion: 3,
        analysis: {
          interactions: {
            maxInteractionHops: 4,
            maxFanOutPerInteraction: 50,
            maxInteractionTraceStates: 1_000,
          },
        },
      });

      const legacyPath = await files.write(
        'configuration/legacy.json',
        JSON.stringify({
          version: 1,
          rules: { 'require-complete-write-trace': 'warn' },
        }),
      );
      expect(
        await loadProjectConfigurationForScan({ repositoryRoot, explicitPath: legacyPath }),
      ).toMatchObject({
        fileVersion: 1,
        rules: [{ ruleId: 'require-complete-write-trace', severity: 'warn' }],
      });

      await expect(
        loadProjectConfigurationForScan({ repositoryRoot, explicitPath, disabled: true }),
      ).rejects.toThrow('--config and --no-config cannot be used together.');
    } finally {
      await files.cleanup();
    }
  });

  it('rejects an output escape from an auto-discovered configuration', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const repositoryRoot = join(files.path, 'repository');
      await files.write(
        'repository/api-intel.config.json',
        JSON.stringify({ version: 2, output: { directory: '../escaped' } }),
      );
      await expect(loadProjectConfigurationForScan({ repositoryRoot })).rejects.toBeInstanceOf(
        ProjectConfigurationInputError,
      );
      await expect(loadProjectConfigurationForScan({ repositoryRoot })).rejects.toThrow(
        'must remain inside the analyzed repository',
      );
    } finally {
      await files.cleanup();
    }
  });
});
