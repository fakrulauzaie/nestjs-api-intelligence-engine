import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitCommandRunner = (
  repositoryRoot: string,
  arguments_: readonly string[],
) => Promise<string>;

const defaultGitCommandRunner: GitCommandRunner = async (repositoryRoot, arguments_) => {
  const result = await execFileAsync('git', ['-C', repositoryRoot, ...arguments_], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: 3_000,
    windowsHide: true,
  });
  return result.stdout;
};

export async function readLocalGitRevision(
  repositoryRoot: string,
  runGit: GitCommandRunner = defaultGitCommandRunner,
): Promise<string | null> {
  try {
    const output = await runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD']);
    const revision = output.trim();
    return /^[a-f0-9]{40,64}$/i.test(revision) ? revision.toLowerCase() : null;
  } catch {
    return null;
  }
}
