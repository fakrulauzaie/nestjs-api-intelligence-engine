import { performance } from 'node:perf_hooks';

const ITERATIONS = 100;

const corpus = [
  {
    id: 'select-join',
    sql: 'SELECT n.id FROM public.note n JOIN audit_log a ON a.note_id = n.id',
  },
  {
    id: 'insert-select',
    sql: 'INSERT INTO note_archive (id) SELECT id FROM note WHERE archived = true',
  },
  {
    id: 'update-from',
    sql: 'UPDATE note n SET reviewed = true FROM audit_log a WHERE a.note_id = n.id',
  },
  {
    id: 'delete-using',
    sql: 'DELETE FROM note n USING expired_note e WHERE e.id = n.id',
  },
  {
    id: 'cte',
    sql: 'WITH recent AS (SELECT id FROM note) SELECT r.id FROM recent r JOIN audit_log a ON a.note_id = r.id',
  },
  {
    id: 'quoted-schema',
    sql: 'SELECT * FROM "audit"."EventLog"',
  },
  {
    id: 'invalid',
    sql: 'SELECT FROM WHERE',
    expectFailure: true,
  },
];

function round(value) {
  return Math.round(value * 100) / 100;
}

function collectRangeVars(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRangeVars(item, output);
    return output;
  }
  if (value === null || typeof value !== 'object') return output;
  if ('RangeVar' in value && value.RangeVar !== null && typeof value.RangeVar === 'object') {
    const range = value.RangeVar;
    output.push([range.schemaname ?? null, range.relname ?? null]);
  }
  for (const child of Object.values(value)) collectRangeVars(child, output);
  return output;
}

async function measure(name, load, parse, inspect) {
  const loadStarted = performance.now();
  const parser = await load();
  await parse(parser, 'SELECT 1');
  const loadAndWarmMs = performance.now() - loadStarted;

  const cases = [];
  const repeatableSql = [];
  const corpusStarted = performance.now();
  for (const item of corpus) {
    try {
      const ast = await parse(parser, item.sql);
      cases.push({
        id: item.id,
        outcome: 'parsed',
        astBytes: Buffer.byteLength(JSON.stringify(ast)),
        tables: inspect(ast),
      });
      if (item.expectFailure !== true) repeatableSql.push(item.sql);
    } catch (error) {
      cases.push({
        id: item.id,
        outcome: 'error',
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  const corpusMs = performance.now() - corpusStarted;

  const repeatedStarted = performance.now();
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    for (const sql of repeatableSql) await parse(parser, sql);
  }
  const repeatedMs = performance.now() - repeatedStarted;
  const repeatedParses = ITERATIONS * repeatableSql.length;

  return {
    name,
    loadAndWarmMs: round(loadAndWarmMs),
    corpusMs: round(corpusMs),
    repeatedParses,
    repeatedMs: round(repeatedMs),
    meanWarmParseMs: repeatedParses === 0 ? null : round(repeatedMs / repeatedParses),
    cases,
  };
}

const results = [];

results.push(
  await measure(
    'libpg-query',
    async () => import('libpg-query'),
    (module, sql) => module.parse(sql),
    (ast) => collectRangeVars(ast),
  ),
);

results.push(
  await measure(
    'pgsql-parser',
    async () => import('pgsql-parser'),
    (module, sql) => module.parse(sql),
    (ast) => collectRangeVars(ast),
  ),
);

results.push(
  await measure(
    'node-sql-parser',
    async () => {
      const module = await import('node-sql-parser');
      const Parser = module.Parser ?? module.default?.Parser;
      return new Parser();
    },
    (parser, sql) => parser.parse(sql, { database: 'Postgresql' }),
    (result) => result.tableList ?? [],
  ),
);

process.stdout.write(
  `${JSON.stringify(
    {
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      iterations: ITERATIONS,
      results,
    },
    null,
    2,
  )}\n`,
);
