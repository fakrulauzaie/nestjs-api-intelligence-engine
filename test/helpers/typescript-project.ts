import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TemporaryDirectory } from './temp-directory.js';
import { createTemporaryDirectory } from './temp-directory.js';

export interface TestTypeScriptProject extends TemporaryDirectory {
  write(relativePath: string, contents: string | Uint8Array): Promise<string>;
  writeJson(relativePath: string, value: unknown): Promise<string>;
}

export async function createTestTypeScriptProject(): Promise<TestTypeScriptProject> {
  const temporary = await createTemporaryDirectory();

  const write = async (relativePath: string, contents: string | Uint8Array): Promise<string> => {
    const absolutePath = join(temporary.path, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
    return absolutePath;
  };

  return {
    ...temporary,
    write,
    async writeJson(relativePath, value) {
      return write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export async function writeBasicTsconfig(
  project: TestTypeScriptProject,
  relativePath = 'tsconfig.json',
  include: readonly string[] = ['src/**/*.ts'],
): Promise<string> {
  return project.writeJson(relativePath, {
    compilerOptions: {
      target: 'ES2023',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      experimentalDecorators: true,
      strict: true,
      noEmit: true,
    },
    include,
  });
}
