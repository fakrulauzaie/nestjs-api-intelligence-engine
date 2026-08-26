import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const MANIFEST_FILE_NAME = '.api-intel-reports.json';
const SAFE_TRACE_FILE = /^[a-z0-9-]+\.md$/u;

interface ReportManifest {
  readonly schemaVersion: 1;
  readonly traceFiles: readonly string[];
}

export interface ReportManifestUpdate {
  readonly manifestPath: string;
  readonly pendingContents: string;
  readonly finalContents: string;
  readonly staleTracePaths: readonly string[];
}

function serializeManifest(traceFiles: readonly string[]): string {
  const manifest: ReportManifest = {
    schemaVersion: 1,
    traceFiles: [...new Set(traceFiles)].sort(),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function readTrackedTraceFiles(manifestPath: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<ReportManifest>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.traceFiles)) return [];
    return parsed.traceFiles.filter(
      (value): value is string => typeof value === 'string' && SAFE_TRACE_FILE.test(value),
    );
  } catch {
    return [];
  }
}

export async function prepareReportManifestUpdate(
  outputDirectory: string,
  traceDirectory: string,
  currentTraceFiles: readonly string[],
): Promise<ReportManifestUpdate> {
  if (!currentTraceFiles.every((fileName) => SAFE_TRACE_FILE.test(fileName))) {
    throw new Error('Refusing to publish a trace report with an unsafe filename.');
  }
  const manifestPath = join(outputDirectory, MANIFEST_FILE_NAME);
  const previous = await readTrackedTraceFiles(manifestPath);
  const current = [...new Set(currentTraceFiles)].sort();
  const currentSet = new Set(current);
  const stale = previous.filter((fileName) => !currentSet.has(fileName));
  return {
    manifestPath,
    pendingContents: serializeManifest([...current, ...stale]),
    finalContents: serializeManifest(current),
    staleTracePaths: stale.map((fileName) => join(traceDirectory, fileName)),
  };
}

export async function cleanupStaleTraceArtifacts(
  staleTracePaths: readonly string[],
): Promise<void> {
  await Promise.all(staleTracePaths.map((path) => rm(path, { force: true })));
}

/** @deprecated Prefer publishing finalContents in the same artifact plan. */
export async function finalizeReportManifestUpdate(update: ReportManifestUpdate): Promise<void> {
  await cleanupStaleTraceArtifacts(update.staleTracePaths);
}
