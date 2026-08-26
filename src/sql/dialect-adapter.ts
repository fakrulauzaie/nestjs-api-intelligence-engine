import type { RawSqlAnalysisConfiguration } from '../model/entities.js';

export const SQL_ACCESS_DIRECTIONS = ['read', 'write'] as const;
export type SqlAccessDirection = (typeof SQL_ACCESS_DIRECTIONS)[number];

export const SQL_STATEMENT_KINDS = ['select', 'insert', 'update', 'delete'] as const;
export type SqlStatementKind = (typeof SQL_STATEMENT_KINDS)[number];

export interface SqlTableAccess {
  readonly direction: SqlAccessDirection;
  readonly statementKind: SqlStatementKind;
  readonly tableName: string;
}

export type SqlAnalysisFailureKind = 'limit_exceeded' | 'parse_failed' | 'unsupported_statement';

export type SqlAnalysisResult =
  | {
      readonly status: 'resolved';
      readonly accesses: readonly SqlTableAccess[];
      readonly statementCount: number;
      readonly parseTimeMs: number;
    }
  | {
      readonly status: 'failed';
      readonly kind: SqlAnalysisFailureKind;
      readonly message: string;
      readonly parseTimeMs?: number | undefined;
    };

export interface SqlDialectAdapter {
  readonly dialect: RawSqlAnalysisConfiguration['dialect'];
  readonly parserName: RawSqlAnalysisConfiguration['parserName'];
  readonly parserVersion: RawSqlAnalysisConfiguration['parserVersion'];
  analyze(
    sql: string,
    limits: RawSqlAnalysisConfiguration,
    signal?: AbortSignal,
  ): Promise<SqlAnalysisResult>;
}
