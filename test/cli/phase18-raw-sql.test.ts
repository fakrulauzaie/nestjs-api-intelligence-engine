import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODE } from '../../src/cli/errors.js';
import { runCli } from '../../src/cli/index.js';
import type { CliIo } from '../../src/cli/types.js';
import { writeFakeTypeOrm } from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeOut(message) {
        stdout.push(message);
      },
      writeError(message) {
        stderr.push(message);
      },
    },
  };
}

describe('Phase 18 raw-SQL CLI option', () => {
  it('requires the exact dialect value and records the parser boundary in artifacts', async () => {
    const project = await createTestTypeScriptProject();
    const output = await createTestTypeScriptProject();
    try {
      await writeFakeTypeOrm(project);
      await project.write(
        'src/raw-reader.ts',
        `import { DataSource } from 'typeorm';
export class RawReader {
  private readonly dataSource!: DataSource;
  read() { return this.dataSource.query('SELECT id FROM public.note'); }
}
`,
      );
      await writeBasicTsconfig(project);

      const invalid = captureIo();
      expect(await runCli(['scan', project.path, '--raw-sql-dialect', 'mysql'], invalid.io)).toBe(
        EXIT_CODE.usageError,
      );
      expect(invalid.stderr.join('\n')).toContain('currently supports only postgresql-18');

      const outputDirectory = join(output.path, 'raw-sql-output');
      const enabled = captureIo();
      expect(
        await runCli(
          ['scan', project.path, '--raw-sql-dialect', 'postgresql-18', '--output', outputDirectory],
          enabled.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(enabled.stderr).toEqual([]);

      const analysis = JSON.parse(
        await readFile(join(outputDirectory, 'analysis.json'), 'utf8'),
      ) as {
        analysisRun: { configuration: { rawSql: Record<string, unknown> } };
        assertions: { ruleId: string; objectId: string }[];
        tables: { id: string; name: string; nameSource: string }[];
      };
      expect(analysis.analysisRun.configuration.rawSql).toMatchObject({
        dialect: 'postgresql-18',
        parserName: 'libpg-query',
        parserVersion: '18.1.2',
      });
      const table = analysis.tables.find(({ name }) => name === 'public.note');
      expect(table).toMatchObject({ nameSource: 'raw_sql_literal' });
      expect(
        analysis.assertions.some(
          ({ ruleId, objectId }) =>
            ruleId === 'typeorm.raw-sql.select.read.v1' && objectId === table?.id,
        ),
      ).toBe(true);

      const run = JSON.parse(await readFile(join(outputDirectory, 'run.json'), 'utf8')) as {
        configuration: { rawSql: Record<string, unknown> };
      };
      expect(run.configuration.rawSql).toEqual(analysis.analysisRun.configuration.rawSql);
    } finally {
      await project.cleanup();
      await output.cleanup();
    }
  }, 30_000);
});
