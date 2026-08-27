import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { writeFakeNestCommon } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('canonical repository scan assembly', () => {
  it('preserves supported route facts alongside canonical unresolved-import diagnostics', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/controller.ts',
        [
          "import { Controller, Get } from '@nestjs/common';",
          "import { missing } from './missing-module.js';",
          "@Controller('partial')",
          'export class PartialController {',
          '  @Get() route() { return missing; }',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const result = await scanRepository({ repositoryRoot: project.path });

      expect(result.analysis.schemaVersion).toBe('3.0.0');
      if (result.analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      expect(result.analysis.applications).toEqual([]);
      expect(result.analysis.interactions).toEqual([]);
      expect(result.analysis.interactionHandlers).toEqual([]);
      expect(result.analysis.interactionAnalysis).toEqual({
        schemaKinds: ['in_process_event', 'job_queue', 'microservice_message', 'outbound_http'],
        supportedKinds: ['in_process_event', 'job_queue', 'microservice_message', 'outbound_http'],
        enabledKinds: ['in_process_event', 'job_queue', 'microservice_message', 'outbound_http'],
        state: 'complete',
      });
      expect(result.analysis.endpoints).toHaveLength(1);
      expect(result.analysis.endpoints[0]).toMatchObject({
        httpMethod: 'GET',
        path: '/partial',
      });
      expect(result.analysis.resultState).toBe('completed_with_gaps');
      expect(result.analysis.diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([
        'AUTH_GLOBAL_POLICY_UNKNOWN',
        'TS_IMPORT_UNRESOLVED',
      ]);
      const importDiagnostic = result.analysis.diagnostics.find(
        (diagnostic) => diagnostic.code === 'TS_IMPORT_UNRESOLVED',
      );
      expect(importDiagnostic).toMatchObject({
        code: 'TS_IMPORT_UNRESOLVED',
        severity: 'warning',
      });
      expect(importDiagnostic?.message).toContain('TS2307');
      expect(importDiagnostic?.evidenceIds).toHaveLength(1);
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
