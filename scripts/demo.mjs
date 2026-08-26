import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REFERENCE_URL = 'https://github.com/nestjs/nest.git';
const REFERENCE_REVISION = '841df8792fbedd1fbba12c9fe999aee307a155c7';
const SAMPLE_PATH = 'sample/05-sql-typeorm';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = join(projectRoot, '.demo');
const referenceCheckout = join(demoRoot, 'reference-nest');
const sampleRoot = join(referenceCheckout, SAMPLE_PATH);
const outputRoot = join(demoRoot, 'official-nest-output');
const regeneratedRoot = join(demoRoot, 'official-nest-regenerated');

function displayCommand(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(' ');
}

function run(command, args, cwd = projectRoot) {
  process.stdout.write(`\n> ${displayCommand(command, args)}\n`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command exited with status ${String(result.status)}.`);
  }
}

function runPnpm(args, cwd = projectRoot) {
  const pnpmEntry = process.env.npm_execpath;
  if (pnpmEntry !== undefined && pnpmEntry.length > 0) {
    run(pnpmEntry, args, cwd);
    return;
  }
  run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, cwd);
}

function runCli(args) {
  run(process.execPath, [join(projectRoot, 'dist/cli/index.js'), ...args]);
}

mkdirSync(demoRoot, { recursive: true });
if (!existsSync(join(referenceCheckout, '.git'))) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', REFERENCE_URL, referenceCheckout]);
}

run('git', ['-C', referenceCheckout, 'sparse-checkout', 'set', SAMPLE_PATH]);
run('git', ['-C', referenceCheckout, 'fetch', 'origin', REFERENCE_REVISION]);
run('git', ['-C', referenceCheckout, 'checkout', '--detach', REFERENCE_REVISION]);

// Dependency declarations are required for TypeChecker symbol identity. Lifecycle
// scripts remain disabled, and no target application command is invoked.
runPnpm(['install', '--ignore-workspace', '--ignore-scripts'], sampleRoot);
runPnpm(['install', '--frozen-lockfile']);
runPnpm(['run', 'build']);

runCli(['scan', sampleRoot, '--output', outputRoot]);
const analysisPath = join(outputRoot, 'analysis.json');
runCli(['endpoints', analysisPath]);
runCli(['trace', analysisPath, '--method', 'GET', '--path', '/users/:id']);
runCli(['trace', analysisPath, '--method', 'POST', '--path', '/users']);
runCli(['report', analysisPath, '--output', regeneratedRoot]);

process.stdout.write(
  `\nDemo complete. Canonical analysis: ${analysisPath}\nRegenerated reports: ${regeneratedRoot}\n`,
);
