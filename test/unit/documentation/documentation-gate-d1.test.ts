import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_INTERACTION_KINDS } from '../../../src/analysis/scan-repository.js';
import { checkCommand } from '../../../src/cli/commands/check.js';
import { controlsCommand } from '../../../src/cli/commands/controls.js';
import { diffCommand } from '../../../src/cli/commands/diff.js';
import { endpointsCommand } from '../../../src/cli/commands/endpoints.js';
import { graphCommand } from '../../../src/cli/commands/graph.js';
import { impactCommand } from '../../../src/cli/commands/impact.js';
import { openApiCommand } from '../../../src/cli/commands/openapi.js';
import { reportCommand } from '../../../src/cli/commands/report.js';
import { scanCommand } from '../../../src/cli/commands/scan.js';
import { traceCommand } from '../../../src/cli/commands/trace.js';
import { DIFF_SCHEMA_V2_VERSION } from '../../../src/comparison/model.js';
import { GRAPH_REPORT_SCHEMA_V4_VERSION } from '../../../src/graph-report/model.js';
import { IMPACT_SCHEMA_VERSION } from '../../../src/impact/model.js';
import { CURRENT_ANALYSIS_SCHEMA_VERSION } from '../../../src/model/analysis.js';
import { INTERACTION_KINDS } from '../../../src/model/interactions.js';
import { BUNDLE_MANIFEST_SCHEMA_VERSION } from '../../../src/output/artifact-plan.js';
import { POLICY_RESULTS_SCHEMA_VERSION } from '../../../src/policy/model.js';
import {
  CONTROL_EVIDENCE_SCHEMA_V3_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION,
} from '../../../src/structured-exports/model.js';

const COMMANDS = [
  scanCommand,
  endpointsCommand,
  traceCommand,
  reportCommand,
  diffCommand,
  impactCommand,
  checkCommand,
  openApiCommand,
  controlsCommand,
  graphCommand,
] as const;

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

describe('Documentation Gate D1 conformance', () => {
  it('keeps the complete CLI synopsis synchronized with command definitions', async () => {
    const workflow = normalizeWhitespace(await readFile(resolve('docs/cli-workflow.md'), 'utf8'));
    expect(COMMANDS).toHaveLength(10);
    for (const command of COMMANDS) {
      expect(workflow, `Missing or stale ${command.name} synopsis`).toContain(
        normalizeWhitespace(command.usage),
      );
    }
  });

  it('publishes current schema versions and interaction capability from source constants', async () => {
    const [readme, index, model, projectConfig, patterns] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/project-configuration.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
    ]);

    expect(index).toContain('Source-of-truth hierarchy');
    const normalizedModel = normalizeWhitespace(model);
    expect(normalizedModel).toContain(`analysis.json\` | \`${CURRENT_ANALYSIS_SCHEMA_VERSION}`);
    expect(normalizedModel).toContain(`diff.json\` | \`${DIFF_SCHEMA_V2_VERSION}`);
    expect(normalizedModel).toContain(`impact.json\` | \`${IMPACT_SCHEMA_VERSION}`);
    expect(normalizedModel).toContain(`policy-results.json\` | \`${POLICY_RESULTS_SCHEMA_VERSION}`);
    expect(normalizedModel).toContain(`graph view | \`${GRAPH_REPORT_SCHEMA_V4_VERSION}`);
    expect(normalizedModel).toContain(
      `OpenAPI enrichment sidecar | \`${OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION}`,
    );
    expect(normalizedModel).toContain(
      `control-evidence JSON/CSV | \`${CONTROL_EVIDENCE_SCHEMA_V3_VERSION}`,
    );
    expect(normalizedModel).toContain(`bundle.json\` | \`${BUNDLE_MANIFEST_SCHEMA_VERSION}`);

    for (const kind of SUPPORTED_INTERACTION_KINDS) {
      for (const [name, document] of [
        ['README', readme],
        ['model contract', model],
        ['project configuration', projectConfig],
        ['supported patterns', patterns],
      ] as const) {
        expect(document, `${name} omits supported interaction kind ${kind}`).toContain(kind);
      }
    }
    const unsupportedKinds = INTERACTION_KINDS.filter(
      (kind) => !SUPPORTED_INTERACTION_KINDS.includes(kind as never),
    );
    expect(unsupportedKinds).toEqual([]);
  });

  it('has no broken local Markdown links in README or docs', async () => {
    const files = [resolve('README.md'), ...(await markdownFiles(resolve('docs')))];
    const broken: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
        const target = match[1]!.replace(/^<|>$/gu, '');
        if (/^(?:https?:\/\/|mailto:|#)/u.test(target)) continue;
        const path = target.split('#', 1)[0]!;
        if (path.length === 0) continue;
        try {
          await stat(resolve(dirname(file), path));
        } catch {
          broken.push(`${relative(process.cwd(), file)} -> ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('labels legacy examples and validation as historical', async () => {
    const [validation, catalogue, readTrace, writeTrace] = await Promise.all([
      readFile(resolve('docs/real-repository-validation.md'), 'utf8'),
      readFile(resolve('docs/examples/official-nestjs-typeorm/endpoints.md'), 'utf8'),
      readFile(resolve('docs/examples/official-nestjs-typeorm/read-trace.md'), 'utf8'),
      readFile(resolve('docs/examples/official-nestjs-typeorm/write-trace.md'), 'utf8'),
    ]);
    expect(validation).toContain('Historical validation record');
    for (const artifact of [catalogue, readTrace, writeTrace]) {
      expect(artifact).toContain('Historical Phase 11 output');
    }
  });
});
