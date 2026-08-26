import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { hashContent } from '../model/hashing.js';
import { canonicalStringify } from '../model/ordering.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export const BUNDLE_MANIFEST_SCHEMA_VERSION = '1.0.0' as const;

export const BUNDLE_REPORTERS = [
  'analysis',
  'markdown',
  'policy',
  'graph',
  'controls',
  'openapi',
] as const;
export type BundleReporter = (typeof BUNDLE_REPORTERS)[number];

export const BUNDLE_ARTIFACT_KINDS = [
  'analysis',
  'run',
  'endpoint_catalogue',
  'contract_report',
  'endpoint_trace',
  'trace_manifest',
  'policy_results',
  'offline_graph',
  'control_evidence_json',
  'control_evidence_csv',
  'openapi_enriched',
  'openapi_sidecar',
] as const;
export type BundleArtifactKind = (typeof BUNDLE_ARTIFACT_KINDS)[number];

export interface PreparedTextArtifact {
  readonly kind: BundleArtifactKind;
  readonly path: string;
  readonly contents: string;
  /** Run metadata intentionally contains timing and repository-location fields. */
  readonly stability?: 'canonical' | 'run_metadata';
}

export interface BundleInputSnapshot {
  readonly kind: 'analysis' | 'openapi';
  readonly id: string;
  readonly schemaVersion: string;
}

const bundleManifestShapeSchema = z
  .object({
    schemaVersion: z.literal(BUNDLE_MANIFEST_SCHEMA_VERSION),
    completionState: z.literal('complete'),
    analysis: z
      .object({
        id: z.string().min(1),
        schemaVersion: z.string().min(1),
        resultState: z.enum(['completed', 'completed_with_gaps']),
      })
      .strict(),
    requestedReporters: z.array(z.enum(BUNDLE_REPORTERS)),
    inputSnapshots: z.array(
      z
        .object({
          kind: z.enum(['analysis', 'openapi']),
          id: z.string().min(1),
          schemaVersion: z.string().min(1),
        })
        .strict(),
    ),
    artifacts: z.array(
      z
        .object({
          kind: z.enum(BUNDLE_ARTIFACT_KINDS),
          path: z.string().min(1),
          contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          bytes: z.number().int().nonnegative(),
          stability: z.enum(['canonical', 'run_metadata']),
        })
        .strict(),
    ),
  })
  .strict();

const REQUIRED_ARTIFACT_KINDS: Readonly<Record<BundleReporter, readonly BundleArtifactKind[]>> = {
  analysis: ['analysis', 'run'],
  markdown: ['endpoint_catalogue', 'contract_report', 'trace_manifest'],
  policy: ['policy_results'],
  graph: ['offline_graph'],
  controls: ['control_evidence_json', 'control_evidence_csv'],
  openapi: ['openapi_enriched', 'openapi_sidecar'],
};

const REPORTER_BY_ARTIFACT_KIND = new Map<BundleArtifactKind, BundleReporter>(
  Object.entries(REQUIRED_ARTIFACT_KINDS).flatMap(([reporter, kinds]) =>
    kinds.map((kind) => [kind, reporter as BundleReporter]),
  ),
);
REPORTER_BY_ARTIFACT_KIND.set('endpoint_trace', 'markdown');

const bundleManifestSchema = bundleManifestShapeSchema.superRefine((manifest, context) => {
  const reporters = new Set(manifest.requestedReporters);
  if (
    reporters.size !== manifest.requestedReporters.length ||
    [...manifest.requestedReporters]
      .sort()
      .some((reporter, index) => reporter !== manifest.requestedReporters[index])
  ) {
    context.addIssue({
      code: 'custom',
      path: ['requestedReporters'],
      message: 'Requested reporters must be unique and sorted.',
    });
  }

  const artifactKinds = new Map<BundleArtifactKind, number>();
  const artifactPaths = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    artifactKinds.set(artifact.kind, (artifactKinds.get(artifact.kind) ?? 0) + 1);
    if (artifactPaths.has(artifact.path)) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts', index, 'path'],
        message: 'Artifact paths must be unique.',
      });
    }
    artifactPaths.add(artifact.path);
    const reporter = REPORTER_BY_ARTIFACT_KIND.get(artifact.kind);
    if (reporter !== undefined && !reporters.has(reporter)) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts', index, 'kind'],
        message: `Artifact kind ${artifact.kind} requires reporter ${reporter}.`,
      });
    }
  }
  for (const reporter of reporters) {
    for (const kind of REQUIRED_ARTIFACT_KINDS[reporter]) {
      if ((artifactKinds.get(kind) ?? 0) !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts'],
          message: `Reporter ${reporter} requires exactly one ${kind} artifact.`,
        });
      }
    }
  }

  const analysisInputs = manifest.inputSnapshots.filter(({ kind }) => kind === 'analysis');
  if (
    analysisInputs.length !== 1 ||
    analysisInputs[0]?.id !== manifest.analysis.id ||
    analysisInputs[0]?.schemaVersion !== manifest.analysis.schemaVersion
  ) {
    context.addIssue({
      code: 'custom',
      path: ['inputSnapshots'],
      message: 'The bundle must contain exactly one matching analysis input snapshot.',
    });
  }
  const openApiInputs = manifest.inputSnapshots.filter(({ kind }) => kind === 'openapi');
  if (openApiInputs.length !== (reporters.has('openapi') ? 1 : 0)) {
    context.addIssue({
      code: 'custom',
      path: ['inputSnapshots'],
      message: 'OpenAPI input identity must be present exactly when OpenAPI is requested.',
    });
  }
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

export interface PreparedArtifactPublication {
  readonly bundlePath: string;
  readonly bundle: BundleManifest;
  readonly files: readonly { readonly path: string; readonly contents: string }[];
}

function pathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute;
}

function portableArtifactPath(outputDirectory: string, artifactPath: string): string {
  const value = relative(outputDirectory, artifactPath);
  if (value === '' || value === '..' || value.startsWith(`..${sep}`)) {
    throw new RangeError(
      `Generated artifact must remain inside its output directory: ${artifactPath}`,
    );
  }
  return value.split(sep).join('/');
}

export function prepareArtifactPublication(input: {
  readonly outputDirectory: string;
  readonly analysis: {
    readonly id: string;
    readonly schemaVersion: string;
    readonly resultState: 'completed' | 'completed_with_gaps';
  };
  readonly requestedReporters: readonly BundleReporter[];
  readonly inputSnapshots: readonly BundleInputSnapshot[];
  readonly artifacts: readonly PreparedTextArtifact[];
  readonly protectedInputPaths?: readonly string[] | undefined;
}): PreparedArtifactPublication {
  const outputDirectory = resolve(input.outputDirectory);
  const bundlePath = resolve(outputDirectory, 'bundle.json');
  const destinationKeys = new Set<string>();
  const protectedKeys = new Set((input.protectedInputPaths ?? []).map(pathKey));
  if (protectedKeys.has(pathKey(bundlePath))) {
    throw new RangeError(`Bundle manifest collides with a protected input path: ${bundlePath}`);
  }
  const artifacts = input.artifacts.map((artifact) => {
    const path = resolve(artifact.path);
    const key = pathKey(path);
    if (destinationKeys.has(key)) {
      throw new RangeError(`Refusing to publish two artifacts to the same path: ${path}`);
    }
    if (protectedKeys.has(key)) {
      throw new RangeError(`Generated artifact collides with a protected input path: ${path}`);
    }
    if (key === pathKey(bundlePath)) {
      throw new RangeError(`Generated artifact collides with the bundle manifest: ${path}`);
    }
    destinationKeys.add(key);
    return { ...artifact, path };
  });

  const manifest = bundleManifestSchema.parse({
    schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
    completionState: 'complete',
    analysis: input.analysis,
    requestedReporters: [...new Set(input.requestedReporters)].sort(),
    inputSnapshots: [...input.inputSnapshots].sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
    ),
    artifacts: artifacts
      .map((artifact) => ({
        kind: artifact.kind,
        path: portableArtifactPath(outputDirectory, artifact.path),
        contentHash: hashContent(artifact.contents),
        bytes: Buffer.byteLength(artifact.contents),
        stability: artifact.stability ?? 'canonical',
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
  return {
    bundlePath,
    bundle: manifest,
    files: [
      ...artifacts.map(({ path, contents }) => ({ path, contents })),
      // A complete bundle manifest is the publication commit marker and is always last.
      { path: bundlePath, contents: canonicalStringify(manifest) },
    ],
  };
}

export async function writePreparedArtifactPublication(
  publication: PreparedArtifactPublication,
  signal?: AbortSignal,
): Promise<void> {
  await writeTextFilesAtomically(publication.files, signal);
}

export function assertValidBundleManifest(input: unknown): BundleManifest {
  return bundleManifestSchema.parse(input);
}
