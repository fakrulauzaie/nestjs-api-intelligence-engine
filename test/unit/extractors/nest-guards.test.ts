import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { serializeCanonicalEndpointTrace } from '../../../src/model/ordering.js';
import { buildEndpointCatalogue } from '../../../src/reporting/endpoint-catalogue.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import { writeFakeNestCommon } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('direct NestJS guard extraction', () => {
  it('preserves controller and method scopes while rejecting lookalikes and expressions', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/guards.controller.ts',
        [
          "import { Controller, Get, Injectable, UseGuards as NestUseGuards } from '@nestjs/common';",
          '@Injectable()',
          'export class ControllerGuard {}',
          '@Injectable()',
          'export class MethodGuard {}',
          'function UseGuards(..._guards: unknown[]): ClassDecorator & MethodDecorator {',
          '  return () => undefined;',
          '}',
          'function makeGuard() { return ControllerGuard; }',
          "@Controller('secure')",
          '@NestUseGuards(ControllerGuard)',
          'export class SecureController {',
          "  @Get('both')",
          '  @NestUseGuards(MethodGuard)',
          '  both() {}',
          "  @Get('class-only') classOnly() {}",
          '}',
          "@Controller('open')",
          'export class OpenController {',
          '  @Get()',
          '  @UseGuards(MethodGuard)',
          '  localLookalike() {}',
          "  @Get('unsupported')",
          '  @NestUseGuards(makeGuard())',
          '  unsupported() {}',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const result = await scanRepository({ repositoryRoot: project.path });
      const guardAssertions = result.analysis.assertions.filter(
        (assertion) => assertion.predicate === 'ENDPOINT_USES_GUARD',
      );
      expect(result.analysis.guards.map((guard) => guard.displayName).sort()).toEqual([
        'ControllerGuard',
        'MethodGuard',
      ]);
      expect(guardAssertions).toHaveLength(3);
      expect(
        result.analysis.classes
          .filter((record) => record.roles.includes('guard'))
          .map((record) => record.displayName)
          .sort(),
      ).toEqual(['ControllerGuard', 'MethodGuard']);

      const catalogue = buildEndpointCatalogue(result.analysis);
      expect(
        catalogue.endpoints.map((endpoint) => ({
          path: endpoint.path,
          state: endpoint.directGuardState,
          guards: endpoint.guards.map(({ name, scope }) => `${scope}:${name}`),
        })),
      ).toEqual([
        { path: '/open', state: 'none_declared', guards: [] },
        { path: '/open/unsupported', state: 'none_declared', guards: [] },
        {
          path: '/secure/both',
          state: 'declared',
          guards: ['controller:ControllerGuard', 'method:MethodGuard'],
        },
        {
          path: '/secure/class-only',
          state: 'declared',
          guards: ['controller:ControllerGuard'],
        },
      ]);
      expect(
        result.analysis.diagnostics.filter(
          (diagnostic) => diagnostic.code === 'NEST_GUARD_UNRESOLVED',
        ),
      ).toHaveLength(1);
      expect(result.analysis.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'AUTH_GLOBAL_POLICY_UNKNOWN',
      );

      const trace = buildEndpointTrace(result.analysis, {
        httpMethod: 'GET',
        path: '/secure/both',
      });
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(trace.trace.directGuardState).toBe('declared');
        expect(trace.trace.guards.map(({ name, scope }) => ({ name, scope }))).toEqual([
          { name: 'ControllerGuard', scope: 'controller' },
          { name: 'MethodGuard', scope: 'method' },
        ]);
        const reversed = buildEndpointTrace(
          {
            ...result.analysis,
            assertions: [...result.analysis.assertions].reverse(),
            guards: [...result.analysis.guards].reverse(),
          },
          { httpMethod: 'GET', path: '/secure/both' },
        );
        expect(reversed.status).toBe('resolved');
        if (reversed.status === 'resolved') {
          expect(serializeCanonicalEndpointTrace(reversed.trace)).toBe(
            serializeCanonicalEndpointTrace(trace.trace),
          );
        }
      }

      const unguardedTrace = buildEndpointTrace(result.analysis, {
        httpMethod: 'GET',
        path: '/open',
      });
      expect(unguardedTrace.status).toBe('resolved');
      if (unguardedTrace.status === 'resolved') {
        expect(unguardedTrace.trace.directGuardState).toBe('none_declared');
        expect(unguardedTrace.trace.guards).toEqual([]);
        expect(unguardedTrace.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          'AUTH_GLOBAL_POLICY_UNKNOWN',
        );
      }
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
