import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const spikeDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(spikeDirectory, '..', '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli', 'index.js');
const outputRoot = path.join(spikeDirectory, '.output', 'analyzer-benchmark');
const iterations = 5;

const corpora = [
  {
    id: 'integrated-fixture',
    path: path.join(repositoryRoot, 'example-nestjs-app'),
  },
  {
    id: 'official-nest-05-sql-typeorm',
    path: path.join(repositoryRoot, '.demo', 'reference-nest', 'sample', '05-sql-typeorm'),
  },
];

const ignoredDirectories = new Set(['.api-intel', '.git', 'dist', 'node_modules']);
const corpusExtensions = new Set(['.json', '.ts']);

async function walkFiles(directory, predicate = () => true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name))
        files.push(...(await walkFiles(entryPath, predicate)));
    } else if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

async function fingerprintCorpus(corpusPath) {
  const files = await walkFiles(corpusPath, (file) => corpusExtensions.has(path.extname(file)));
  const hash = createHash('sha256');

  for (const file of files) {
    hash.update(path.relative(corpusPath, file).replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }

  return { fileCount: files.length, sha256: hash.digest('hex') };
}

async function artifactSizes(outputPath) {
  const files = await walkFiles(outputPath);
  const rows = [];
  let totalBytes = 0;

  for (const file of files) {
    const bytes = (await stat(file)).size;
    totalBytes += bytes;
    rows.push({
      path: path.relative(outputPath, file).replaceAll(path.sep, '/'),
      bytes,
    });
  }

  return { totalBytes, files: rows };
}

function summarize(times) {
  const sorted = [...times].sort((left, right) => left - right);
  return {
    minimumMs: Number(sorted[0].toFixed(2)),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
    maximumMs: Number(sorted.at(-1).toFixed(2)),
    meanMs: Number((times.reduce((total, value) => total + value, 0) / times.length).toFixed(2)),
  };
}

await stat(cliPath);
await rm(outputRoot, { force: true, recursive: true });

const results = [];
for (const corpus of corpora) {
  await stat(corpus.path);
  const fingerprint = await fingerprintCorpus(corpus.path);
  const elapsedMs = [];
  let outputPath;

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    outputPath = path.join(outputRoot, corpus.id, `run-${iteration}`);
    const started = performance.now();
    const run = spawnSync(
      process.execPath,
      [cliPath, 'scan', corpus.path, '--output', outputPath],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    elapsedMs.push(performance.now() - started);

    if (run.status !== 0) {
      throw new Error(
        `${corpus.id} scan failed with status ${String(run.status)}: ${run.stderr || run.stdout}`,
      );
    }
  }

  const analysis = JSON.parse(await readFile(path.join(outputPath, 'analysis.json'), 'utf8'));
  results.push({
    id: corpus.id,
    repositoryRelativePath: path.relative(repositoryRoot, corpus.path).replaceAll(path.sep, '/'),
    fingerprint,
    iterations,
    elapsedMs: elapsedMs.map((value) => Number(value.toFixed(2))),
    summary: summarize(elapsedMs),
    output: await artifactSizes(outputPath),
    analysisCounts: {
      sourceFiles: analysis.sourceFiles.length,
      classes: analysis.classes.length,
      methods: analysis.methods.length,
      endpoints: analysis.endpoints.length,
      assertions: analysis.assertions.length,
      evidence: analysis.evidence.length,
      diagnostics: analysis.diagnostics.length,
    },
  });
}

console.log(
  JSON.stringify(
    {
      toolVersion: '0.1.0',
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: os.cpus().length,
      commandTemplate:
        'node dist/cli/index.js scan <corpus> --output spikes/phase12/.output/analyzer-benchmark/<corpus>/run-<n>',
      results,
    },
    null,
    2,
  ),
);
