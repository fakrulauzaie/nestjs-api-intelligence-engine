import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { analysisHasAuthorizationFacts } from '../../../src/model/analysis.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { buildControlEvidenceDocument } from '../../../src/structured-exports/control-evidence.js';
import { enrichOpenApiDocument } from '../../../src/structured-exports/openapi.js';
import {
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('NestJS authorization metadata and composite decorators', () => {
  it('separates metadata, configured relationships, and composite guard enforcement', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestTypeOrm(project);
      await writeFakeTypeOrm(project);
      await project.writeJson('node_modules/@acme/auth/package.json', {
        name: '@acme/auth',
        version: '1.0.0-test',
        types: 'index.d.ts',
      });
      await project.write(
        'node_modules/@acme/auth/index.d.ts',
        'export declare function Permission(...values: unknown[]): ClassDecorator & MethodDecorator;\n',
      );
      await project.write(
        'src/auth.guard.ts',
        [
          "import { Injectable } from '@nestjs/common';",
          '@Injectable()',
          'export class AuthGuard {}',
        ].join('\n'),
      );
      await project.write(
        'src/auth.decorators.ts',
        [
          "import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';",
          "import { AuthGuard } from './auth.guard';",
          "export const Roles = (...roles: string[]) => SetMetadata('roles', roles);",
          'export const Secured = (...roles: string[]) =>',
          "  applyDecorators(SetMetadata('roles', roles), UseGuards(AuthGuard));",
          'export const Opaque = (..._values: unknown[]): MethodDecorator => () => undefined;',
        ].join('\n'),
      );
      await project.write(
        'src/item.entity.ts',
        ["import { Entity } from 'typeorm';", "@Entity('item')", 'export class Item {}'].join('\n'),
      );
      await project.write(
        'src/auth.controller.ts',
        [
          "import { Controller, Post, UseGuards } from '@nestjs/common';",
          "import { InjectRepository } from '@nestjs/typeorm';",
          "import { Repository } from 'typeorm';",
          "import { Permission } from '@acme/auth';",
          "import { AuthGuard } from './auth.guard';",
          "import { Opaque, Roles, Secured } from './auth.decorators';",
          "import { Item } from './item.entity';",
          "@Controller('auth')",
          'export class AuthController {',
          '  constructor(@InjectRepository(Item) private readonly items: Repository<Item>) {}',
          "  @Post('composite')",
          "  @Secured('writer')",
          '  composite() { return this.items.save({}); }',
          "  @Post('configured')",
          "  @Roles('editor')",
          '  @UseGuards(AuthGuard)',
          '  configured() { return this.items.save({}); }',
          "  @Post('metadata-only')",
          "  @Roles('reader')",
          '  metadataOnly() { return this.items.save({}); }',
          "  @Post('repository-symbol')",
          "  @Opaque('tenant')",
          '  repositorySymbol() { return this.items.save({}); }',
          "  @Post('package-symbol')",
          "  @Permission('billing')",
          '  packageSymbol() { return this.items.save({}); }',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const result = await scanRepository({
        repositoryRoot: project.path,
        configuration: {
          authorization: {
            metadataKeys: ['roles'],
            decoratorSymbols: [
              {
                symbol: {
                  kind: 'repository_export',
                  sourceFile: 'src/auth.decorators.ts',
                  exportedName: 'Opaque',
                },
                metadataKey: 'tenant_scope',
              },
              {
                symbol: {
                  kind: 'package_export',
                  moduleSpecifier: '@acme/auth',
                  exportedName: 'Permission',
                },
                metadataKey: 'permissions',
              },
            ],
            enforcementRelationships: [
              {
                metadataKey: 'roles',
                guard: {
                  kind: 'repository_export',
                  sourceFile: 'src/auth.guard.ts',
                  exportedName: 'AuthGuard',
                },
              },
            ],
          },
        },
      });
      expect(result.analysis.schemaVersion).toBe('8.0.0');
      expect(analysisHasAuthorizationFacts(result.analysis)).toBe(true);
      if (!analysisHasAuthorizationFacts(result.analysis)) return;

      expect(result.analysis.authorizationMetadata).toHaveLength(5);
      const endpointById = new Map(
        result.analysis.endpoints.map((endpoint) => [endpoint.id, endpoint]),
      );
      const stateByPath = new Map(
        result.analysis.authorizationEnforcements.map((enforcement) => [
          endpointById.get(enforcement.endpointId)!.path,
          enforcement.state,
        ]),
      );
      expect(stateByPath).toEqual(
        new Map([
          ['/auth/composite', 'proven_enforced'],
          ['/auth/configured', 'configured_relationship'],
          ['/auth/metadata-only', 'enforcement_unknown'],
          ['/auth/package-symbol', 'enforcement_unknown'],
          ['/auth/repository-symbol', 'enforcement_unknown'],
        ]),
      );
      expect(result.analysis.authorizationMetadata.map(({ valueShape }) => valueShape)).toSatisfy(
        (shapes: unknown[]) =>
          shapes.every(
            (shape) =>
              typeof shape === 'object' &&
              shape !== null &&
              'redacted' in shape &&
              shape.redacted === true,
          ),
      );

      const guardAssertions = result.analysis.assertions.filter(
        ({ predicate }) => predicate === 'ENDPOINT_USES_GUARD',
      );
      expect(guardAssertions).toHaveLength(2);
      expect(
        result.analysis.diagnostics.filter(
          ({ code }) => code === 'AUTHORIZATION_ENFORCEMENT_UNKNOWN',
        ),
      ).toHaveLength(3);

      const policy = evaluatePolicies({
        analysis: result.analysis,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: {
            'require-guard-on-write-endpoint': ['error', { onUnknown: 'error' }],
          },
        }),
      });
      const outcomeByPath = new Map(
        policy.results.map((policyResult) => [
          policyResult.subject.displayName,
          policyResult.outcome,
        ]),
      );
      expect(outcomeByPath.get('POST /auth/composite')).toBe('pass');
      expect(outcomeByPath.get('POST /auth/configured')).toBe('pass');
      expect(outcomeByPath.get('POST /auth/metadata-only')).not.toBe('pass');
      expect(outcomeByPath.get('POST /auth/repository-symbol')).not.toBe('pass');
      expect(outcomeByPath.get('POST /auth/package-symbol')).not.toBe('pass');

      const authorizationPolicy = evaluatePolicies({
        analysis: result.analysis,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: {
            'require-proven-authorization-enforcement': ['error', { onUnknown: 'error' }],
          },
        }),
      });
      const authorizationOutcomeByPath = new Map(
        authorizationPolicy.results.map((policyResult) => [
          policyResult.subject.displayName,
          [policyResult.outcome, policyResult.reasonCode],
        ]),
      );
      expect(authorizationOutcomeByPath.get('POST /auth/composite')).toEqual([
        'pass',
        'authorization_enforcement_proven',
      ]);
      expect(authorizationOutcomeByPath.get('POST /auth/configured')).toEqual([
        'unknown',
        'authorization_enforcement_configured',
      ]);
      expect(authorizationOutcomeByPath.get('POST /auth/metadata-only')).toEqual([
        'unknown',
        'authorization_enforcement_unknown',
      ]);

      const controlEvidence = buildControlEvidenceDocument({
        analysis: result.analysis,
        policyResults: authorizationPolicy,
      });
      expect(controlEvidence.schemaVersion).toBe('5.0.0');
      expect(
        controlEvidence.rows.find(({ path }) => path === '/auth/composite')
          ?.authorizationRequirements,
      ).toEqual([
        expect.objectContaining({
          metadataKey: 'roles',
          enforcementState: 'proven_enforced',
          guardName: 'AuthGuard',
        }),
      ]);

      const openApi = enrichOpenApiDocument({
        analysis: result.analysis,
        openApi: {
          openapi: '3.1.0',
          info: { title: 'Authorization fixture', version: '1.0.0' },
          paths: { '/auth/composite': { post: {} } },
        },
      });
      expect(openApi.result.schemaVersion).toBe('5.0.0');
      expect(
        (
          openApi.enrichedDocument.paths as Record<
            string,
            { post: { 'x-api-intel': { authorizationRequirements: unknown[] } } }
          >
        )['/auth/composite']?.post['x-api-intel'].authorizationRequirements,
      ).toHaveLength(1);

      const graph = buildGraphReportDocument({ analysis: result.analysis });
      expect(graph.schemaVersion).toBe('9.0.0');
      expect(
        graph.endpoints.find(({ path }) => path === '/auth/composite')?.authorizationRequirements,
      ).toHaveLength(1);

      const diff = compareAnalysisDocuments(result.analysis, result.analysis);
      expect(diff.schemaVersion).toBe('5.0.0');
      expect(diff.before.facts.authorization).toBe('available');
      expect(analyzePotentialImpact(result.analysis, result.analysis).schemaVersion).toBe('2.0.0');
    } finally {
      await project.cleanup();
    }
  }, 20_000);

  it('discovers a package-proven composite wrapper without configuration', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/controller.ts',
        [
          "import { applyDecorators, Controller, Get, SetMetadata, UseGuards } from '@nestjs/common';",
          'class LocalGuard {}',
          'const Protected = () =>',
          "  applyDecorators(SetMetadata('internal_policy', true), UseGuards(LocalGuard));",
          "@Controller('auto')",
          'export class AutoController {',
          '  @Get()',
          '  @Protected()',
          '  get() {}',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);
      const result = await scanRepository({ repositoryRoot: project.path });
      expect(analysisHasAuthorizationFacts(result.analysis)).toBe(true);
      if (!analysisHasAuthorizationFacts(result.analysis)) return;
      expect(result.analysis.authorizationMetadata).toHaveLength(1);
      expect(result.analysis.authorizationMetadata[0]).toMatchObject({
        metadataKey: 'internal_policy',
        source: 'repository_wrapper',
      });
      expect(result.analysis.authorizationEnforcements).toHaveLength(1);
      expect(result.analysis.authorizationEnforcements[0]?.state).toBe('proven_enforced');
    } finally {
      await project.cleanup();
    }
  }, 15_000);

  it('does not associate a configured global guard across separate application roots', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestCore(project);
      await project.write(
        'src/apps.ts',
        [
          "import { Controller, Get, Module, SetMetadata } from '@nestjs/common';",
          "import { APP_GUARD, NestFactory } from '@nestjs/core';",
          'export class AppAGuard {}',
          "@Controller('a')",
          'export class AppAController {',
          "  @Get() @SetMetadata('roles', ['a']) get() {}",
          '}',
          "@Controller('b')",
          'export class AppBController {',
          "  @Get() @SetMetadata('roles', ['b']) get() {}",
          '}',
          '@Module({',
          '  controllers: [AppAController],',
          '  providers: [{ provide: APP_GUARD, useClass: AppAGuard }],',
          '})',
          'export class AppAModule {}',
          '@Module({ controllers: [AppBController] })',
          'export class AppBModule {}',
          'export async function bootstrap() {',
          '  const appA = await NestFactory.create(AppAModule);',
          '  const appB = await NestFactory.create(AppBModule);',
          '  await appA.listen(3000);',
          '  await appB.listen(3001);',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({
        repositoryRoot: project.path,
        configuration: {
          authorization: {
            metadataKeys: ['roles'],
            decoratorSymbols: [],
            enforcementRelationships: [
              {
                metadataKey: 'roles',
                guard: {
                  kind: 'repository_export',
                  sourceFile: 'src/apps.ts',
                  exportedName: 'AppAGuard',
                },
              },
            ],
          },
        },
      });
      expect(analysisHasAuthorizationFacts(analysis)).toBe(true);
      if (!analysisHasAuthorizationFacts(analysis)) return;
      const pathByEndpointId = new Map(analysis.endpoints.map(({ id, path }) => [id, path]));
      expect(
        new Map(
          analysis.authorizationEnforcements.map(({ endpointId, state }) => [
            pathByEndpointId.get(endpointId),
            state,
          ]),
        ),
      ).toEqual(
        new Map([
          ['/a', 'configured_relationship'],
          ['/b', 'enforcement_unknown'],
        ]),
      );
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
