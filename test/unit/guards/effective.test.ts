import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { buildEffectiveEndpointGuards } from '../../../src/guards/effective.js';
import { serializeCanonicalEndpointTrace } from '../../../src/model/ordering.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';
import { writeFakeNestCommon, writeFakeNestCore } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('effective endpoint guards', () => {
  it('orders proven application-global, controller, and method guards deterministically', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestCore(project);
      await project.write(
        'src/app.ts',
        [
          "import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';",
          "import { APP_GUARD } from '@nestjs/core';",
          '@Injectable() export class GlobalGuard {}',
          '@Injectable() export class ControllerGuard {}',
          '@Injectable() export class MethodGuard {}',
          "@Controller('secure')",
          '@UseGuards(ControllerGuard)',
          'export class SecureController {',
          "  @Get('both')",
          '  @UseGuards(MethodGuard)',
          '  both() {}',
          '}',
          '@Module({',
          '  controllers: [SecureController],',
          '  providers: [ControllerGuard, MethodGuard, { provide: APP_GUARD, useClass: GlobalGuard }],',
          '})',
          'export class AppModule {}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      expect(analysis.schemaVersion).toBe('3.0.0');
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      expect(analysis.globalGuardAnalysis).toEqual({ completeness: 'complete', state: 'declared' });

      const endpoint = analysis.endpoints.find(({ path }) => path === '/secure/both')!;
      const view = buildEffectiveEndpointGuards(analysis, endpoint.id);
      expect({
        direct: view.directGuardState,
        global: view.globalGuardState,
        effective: view.effectiveGuardState,
      }).toEqual({
        direct: 'declared',
        global: 'declared',
        effective: 'guard_declared',
      });
      expect(view.effectiveGuards.map(({ name, scope }) => `${scope}:${name}`)).toEqual([
        'application_global:GlobalGuard',
        'controller:ControllerGuard',
        'method:MethodGuard',
      ]);

      const trace = buildEndpointTrace(analysis, { httpMethod: 'GET', path: '/secure/both' });
      expect(trace.status).toBe('resolved');
      if (trace.status !== 'resolved') throw new Error('Expected a resolved endpoint trace.');
      const reversed = buildEndpointTrace(
        {
          ...analysis,
          assertions: [...analysis.assertions].reverse(),
          globalGuardRegistrations: [...analysis.globalGuardRegistrations].reverse(),
          guards: [...analysis.guards].reverse(),
        },
        { httpMethod: 'GET', path: '/secure/both' },
      );
      expect(reversed.status).toBe('resolved');
      if (reversed.status === 'resolved') {
        expect(serializeCanonicalEndpointTrace(reversed.trace)).toBe(
          serializeCanonicalEndpointTrace(trace.trace),
        );
      }
    } finally {
      await project.cleanup();
    }
  }, 15_000);

  it('distinguishes a complete supported scan with no guard from a public endpoint claim', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/app.ts',
        [
          "import { Controller, Get, Module } from '@nestjs/common';",
          "@Controller('open')",
          'export class OpenController { @Get() list() {} }',
          '@Module({ controllers: [OpenController] })',
          'export class AppModule {}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      expect(analysis.schemaVersion).toBe('3.0.0');
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      expect(analysis.globalGuardAnalysis).toEqual({
        completeness: 'complete',
        state: 'none_proven',
      });
      const endpoint = analysis.endpoints.find(({ path }) => path === '/open')!;
      expect(buildEffectiveEndpointGuards(analysis, endpoint.id).effectiveGuardState).toBe(
        'no_supported_guard_proven',
      );
      expect(analysis.diagnostics.map(({ code }) => code)).not.toContain(
        'AUTH_GLOBAL_POLICY_UNKNOWN',
      );
    } finally {
      await project.cleanup();
    }
  }, 15_000);

  it('preserves unknown global and effective state when reading analysis v1', () => {
    const analysis = createMinimalAnalysisDocument();
    const endpoint = analysis.endpoints[0]!;
    expect(buildEffectiveEndpointGuards(analysis, endpoint.id)).toMatchObject({
      directGuardState: 'none_declared',
      globalGuardState: 'unknown',
      effectiveGuardState: 'unknown',
      globalGuards: [],
      effectiveGuards: [],
    });
  });
});
