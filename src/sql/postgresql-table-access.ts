import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { parse } from 'libpg-query/wasm/index.js';
import type {
  SqlAnalysisResult,
  SqlDialectAdapter,
  SqlStatementKind,
  SqlTableAccess,
} from './dialect-adapter.js';

type AstRecord = Record<string, unknown>;

class UnsupportedSqlAstError extends Error {}

function isRecord(value: unknown): value is AstRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recordField(record: AstRecord, key: string): AstRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function arrayField(record: AstRecord, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function variant(record: unknown, key: string): AstRecord | null {
  return isRecord(record) ? recordField(record, key) : null;
}

function boundedMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const oneLine = raw.replace(/\s+/gu, ' ').trim();
  return oneLine.length <= 240 ? oneLine : `${oneLine.slice(0, 239)}…`;
}

function countAstNodes(value: unknown, maximum: number): number {
  const pending: unknown[] = [value];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    count += 1;
    if (count > maximum) return count;
    if (Array.isArray(current)) pending.push(...current);
    else pending.push(...Object.values(current as AstRecord));
  }
  return count;
}

function renderIdentifier(value: string): string {
  return /^[a-z_][a-z0-9_$]*$/u.test(value) ? value : `"${value.replaceAll('"', '""')}"`;
}

function physicalTableName(range: AstRecord): { rawName: string; renderedName: string } {
  const relation = range.relname;
  if (typeof relation !== 'string' || relation.length === 0) {
    throw new UnsupportedSqlAstError('A relation node has no static relation name.');
  }
  if (range.catalogname !== undefined) {
    throw new UnsupportedSqlAstError('Cross-database relation names are outside PostgreSQL scope.');
  }
  const schema = range.schemaname;
  if (schema !== undefined && (typeof schema !== 'string' || schema.length === 0)) {
    throw new UnsupportedSqlAstError('A relation node has an invalid schema name.');
  }
  return {
    rawName: relation,
    renderedName:
      typeof schema === 'string'
        ? `${renderIdentifier(schema)}.${renderIdentifier(relation)}`
        : renderIdentifier(relation),
  };
}

class PostgreSqlTableAccessVisitor {
  readonly #accesses: SqlTableAccess[] = [];

  visit(parseTree: unknown): readonly SqlTableAccess[] {
    if (!isRecord(parseTree)) {
      throw new UnsupportedSqlAstError('The parser returned a non-object result.');
    }
    for (const rawStatement of arrayField(parseTree, 'stmts')) {
      if (!isRecord(rawStatement) || !isRecord(rawStatement.stmt)) {
        throw new UnsupportedSqlAstError('A parsed statement has no statement body.');
      }
      this.#visitStatement(rawStatement.stmt, new Set());
    }
    const byKey = new Map<string, SqlTableAccess>();
    for (const access of this.#accesses) {
      byKey.set(`${access.statementKind}:${access.direction}:${access.tableName}`, access);
    }
    return [...byKey.values()].sort((left, right) =>
      `${left.statementKind}:${left.direction}:${left.tableName}`.localeCompare(
        `${right.statementKind}:${right.direction}:${right.tableName}`,
      ),
    );
  }

  #visitStatement(wrapper: AstRecord, inheritedCtes: ReadonlySet<string>): void {
    const supported = [
      ['SelectStmt', 'select'],
      ['InsertStmt', 'insert'],
      ['UpdateStmt', 'update'],
      ['DeleteStmt', 'delete'],
    ] as const;
    const match = supported.find(([key]) => isRecord(wrapper[key]));
    if (match === undefined) {
      const statementType =
        Object.keys(wrapper).find((key) => /^[A-Z].*Stmt$/u.test(key)) ?? 'unknown statement';
      throw new UnsupportedSqlAstError(`${statementType} is outside the supported statement set.`);
    }
    const body = wrapper[match[0]] as AstRecord;
    switch (match[1]) {
      case 'select':
        this.#visitSelect(body, inheritedCtes);
        return;
      case 'insert':
        this.#visitInsert(body, inheritedCtes);
        return;
      case 'update':
        this.#visitUpdate(body, inheritedCtes);
        return;
      case 'delete':
        this.#visitDelete(body, inheritedCtes);
    }
  }

  #withCtes(statement: AstRecord, inherited: ReadonlySet<string>): ReadonlySet<string> {
    const withClause = recordField(statement, 'withClause');
    if (withClause === null) return inherited;
    const ctes = arrayField(withClause, 'ctes');
    const names = new Set(inherited);
    for (const cteNode of ctes) {
      const cte = variant(cteNode, 'CommonTableExpr');
      if (cte === null || typeof cte.ctename !== 'string' || cte.ctename.length === 0) {
        throw new UnsupportedSqlAstError('A CTE has no static name.');
      }
      names.add(cte.ctename);
    }
    for (const cteNode of ctes) {
      const cte = variant(cteNode, 'CommonTableExpr')!;
      if (!isRecord(cte.ctequery)) {
        throw new UnsupportedSqlAstError('A CTE has no supported query body.');
      }
      this.#visitStatement(cte.ctequery, names);
    }
    return names;
  }

  #visitSelect(statement: AstRecord, inheritedCtes: ReadonlySet<string>): void {
    if (statement.intoClause !== undefined) {
      throw new UnsupportedSqlAstError('SELECT INTO is outside the supported direction model.');
    }
    const ctes = this.#withCtes(statement, inheritedCtes);
    this.#visitFromClause(arrayField(statement, 'fromClause'), ctes, 'select');
    this.#visitOptionalStatement(statement.larg, ctes);
    this.#visitOptionalStatement(statement.rarg, ctes);
    this.#visitNestedFields(statement, new Set(['withClause', 'fromClause', 'larg', 'rarg']), ctes);
  }

  #visitInsert(statement: AstRecord, inheritedCtes: ReadonlySet<string>): void {
    const ctes = this.#withCtes(statement, inheritedCtes);
    this.#addRelation(statement.relation, ctes, 'insert', 'write', false);
    this.#visitOptionalStatement(statement.selectStmt, ctes);
    this.#visitNestedFields(statement, new Set(['withClause', 'relation', 'selectStmt']), ctes);
  }

  #visitUpdate(statement: AstRecord, inheritedCtes: ReadonlySet<string>): void {
    const ctes = this.#withCtes(statement, inheritedCtes);
    this.#addRelation(statement.relation, ctes, 'update', 'write', false);
    this.#visitFromClause(arrayField(statement, 'fromClause'), ctes, 'update');
    this.#visitNestedFields(statement, new Set(['withClause', 'relation', 'fromClause']), ctes);
  }

  #visitDelete(statement: AstRecord, inheritedCtes: ReadonlySet<string>): void {
    const ctes = this.#withCtes(statement, inheritedCtes);
    this.#addRelation(statement.relation, ctes, 'delete', 'write', false);
    this.#visitFromClause(arrayField(statement, 'usingClause'), ctes, 'delete');
    this.#visitNestedFields(statement, new Set(['withClause', 'relation', 'usingClause']), ctes);
  }

  #visitFromClause(
    sources: readonly unknown[],
    ctes: ReadonlySet<string>,
    statementKind: SqlStatementKind,
  ): void {
    for (const source of sources) this.#visitFromSource(source, ctes, statementKind);
  }

  #visitFromSource(
    source: unknown,
    ctes: ReadonlySet<string>,
    statementKind: SqlStatementKind,
  ): void {
    const range = variant(source, 'RangeVar');
    if (range !== null) {
      this.#addRange(range, ctes, statementKind, 'read', true);
      return;
    }
    const join = variant(source, 'JoinExpr');
    if (join !== null) {
      this.#visitFromSource(join.larg, ctes, statementKind);
      this.#visitFromSource(join.rarg, ctes, statementKind);
      this.#visitNestedStatements(join.quals, ctes);
      return;
    }
    const subselect = variant(source, 'RangeSubselect');
    if (subselect !== null && isRecord(subselect.subquery)) {
      this.#visitStatement(subselect.subquery, ctes);
      return;
    }
    const tableSample = variant(source, 'RangeTableSample');
    if (tableSample !== null && tableSample.relation !== undefined) {
      this.#visitFromSource(tableSample.relation, ctes, statementKind);
      this.#visitNestedFields(tableSample, new Set(['relation']), ctes);
      return;
    }
    if (
      variant(source, 'RangeFunction') !== null ||
      variant(source, 'RangeTableFunc') !== null ||
      variant(source, 'JsonTable') !== null
    ) {
      this.#visitNestedStatements(source, ctes);
      return;
    }
    throw new UnsupportedSqlAstError('A FROM/USING source has an unsupported AST shape.');
  }

  #addRelation(
    relation: unknown,
    ctes: ReadonlySet<string>,
    statementKind: SqlStatementKind,
    direction: SqlTableAccess['direction'],
    allowCte: boolean,
  ): void {
    if (!isRecord(relation)) {
      throw new UnsupportedSqlAstError('A write statement has no physical target relation.');
    }
    this.#addRange(relation, ctes, statementKind, direction, allowCte);
  }

  #addRange(
    range: AstRecord,
    ctes: ReadonlySet<string>,
    statementKind: SqlStatementKind,
    direction: SqlTableAccess['direction'],
    allowCte: boolean,
  ): void {
    const table = physicalTableName(range);
    if (allowCte && range.schemaname === undefined && ctes.has(table.rawName)) return;
    this.#accesses.push({ direction, statementKind, tableName: table.renderedName });
  }

  #visitOptionalStatement(value: unknown, ctes: ReadonlySet<string>): void {
    if (value === undefined) return;
    if (!isRecord(value)) {
      throw new UnsupportedSqlAstError('A nested statement has an unsupported AST shape.');
    }
    this.#visitStatement(value, ctes);
  }

  #visitNestedFields(
    record: AstRecord,
    excluded: ReadonlySet<string>,
    ctes: ReadonlySet<string>,
  ): void {
    for (const [key, value] of Object.entries(record)) {
      if (!excluded.has(key)) this.#visitNestedStatements(value, ctes);
    }
  }

  #visitNestedStatements(value: unknown, ctes: ReadonlySet<string>): void {
    if (Array.isArray(value)) {
      for (const child of value) this.#visitNestedStatements(child, ctes);
      return;
    }
    if (!isRecord(value)) return;
    const statementKey = Object.keys(value).find((key) => /^[A-Z].*Stmt$/u.test(key));
    if (statementKey !== undefined) {
      this.#visitStatement(value, ctes);
      return;
    }
    for (const child of Object.values(value)) this.#visitNestedStatements(child, ctes);
  }
}

function statementCount(parseTree: unknown): number | null {
  if (!isRecord(parseTree) || !Array.isArray(parseTree.stmts)) return null;
  return parseTree.stmts.length;
}

async function parseWithDeadline(
  sql: string,
  maximumMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  let timeout: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new RangeError(`PostgreSQL parsing exceeded ${maximumMs} ms.`)),
      maximumMs,
    );
    if (signal !== undefined) {
      abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    }
  });
  try {
    return await Promise.race([parse(sql), timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (signal !== undefined && abort !== undefined) signal.removeEventListener('abort', abort);
  }
}

export const postgresql18TableAccessAdapter: SqlDialectAdapter = {
  dialect: 'postgresql-18',
  parserName: 'libpg-query',
  parserVersion: '18.1.2',
  async analyze(sql, limits, signal): Promise<SqlAnalysisResult> {
    const byteLength = Buffer.byteLength(sql, 'utf8');
    if (byteLength > limits.maxSqlBytes) {
      return {
        status: 'failed',
        kind: 'limit_exceeded',
        message: `SQL source is ${byteLength} bytes; the configured maximum is ${limits.maxSqlBytes}.`,
      };
    }

    const startedAt = performance.now();
    let parseTree: unknown;
    try {
      parseTree = await parseWithDeadline(sql, limits.maxParseTimeMs, signal);
    } catch (error) {
      if (signal?.aborted === true) throw error;
      const parseTimeMs = performance.now() - startedAt;
      const timedOut = error instanceof RangeError && /exceeded/u.test(error.message);
      return {
        status: 'failed',
        kind: timedOut ? 'limit_exceeded' : 'parse_failed',
        message: timedOut
          ? error.message
          : `PostgreSQL 18 parser rejected the static SQL source: ${boundedMessage(error)}`,
        parseTimeMs,
      };
    }
    const parseTimeMs = performance.now() - startedAt;
    if (parseTimeMs > limits.maxParseTimeMs) {
      return {
        status: 'failed',
        kind: 'limit_exceeded',
        message: `PostgreSQL parsing took ${Math.ceil(parseTimeMs)} ms; the configured maximum is ${limits.maxParseTimeMs} ms.`,
        parseTimeMs,
      };
    }
    if (!isRecord(parseTree) || typeof parseTree.version !== 'number') {
      return {
        status: 'failed',
        kind: 'unsupported_statement',
        message: 'The PostgreSQL parser returned no versioned parse result.',
        parseTimeMs,
      };
    }
    if (Math.floor(parseTree.version / 10_000) !== 18) {
      return {
        status: 'failed',
        kind: 'unsupported_statement',
        message: `Parser result version ${parseTree.version} is not PostgreSQL major 18.`,
        parseTimeMs,
      };
    }
    const count = statementCount(parseTree);
    if (count === null || count === 0) {
      return {
        status: 'failed',
        kind: 'unsupported_statement',
        message: 'The static SQL source contains no executable statement.',
        parseTimeMs,
      };
    }
    if (count > limits.maxStatements) {
      return {
        status: 'failed',
        kind: 'limit_exceeded',
        message: `SQL source contains ${count} statements; the configured maximum is ${limits.maxStatements}.`,
        parseTimeMs,
      };
    }
    const nodes = countAstNodes(parseTree, limits.maxAstNodes);
    if (nodes > limits.maxAstNodes) {
      return {
        status: 'failed',
        kind: 'limit_exceeded',
        message: `PostgreSQL AST exceeds the configured ${limits.maxAstNodes}-node maximum.`,
        parseTimeMs,
      };
    }
    try {
      return {
        status: 'resolved',
        accesses: new PostgreSqlTableAccessVisitor().visit(parseTree),
        statementCount: count,
        parseTimeMs,
      };
    } catch (error) {
      return {
        status: 'failed',
        kind: 'unsupported_statement',
        message: boundedMessage(error),
        parseTimeMs,
      };
    }
  },
};
