import type {
  AnalysisConfiguration,
  RawSqlAnalysisConfiguration,
  RawSqlDialect,
} from '../model/entities.js';
import { DEFAULT_EVIDENCE_SNIPPET_LIMIT } from '../evidence/snippets.js';
import { DEFAULT_MAX_SOURCE_FILE_BYTES } from '../scanner/inventory.js';

export const DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION = {
  maxInteractionHops: 2,
  maxFanOutPerInteraction: 50,
  maxInteractionTraceStates: 1_000,
} as const;

export const DEFAULT_ANALYSIS_CONFIGURATION: AnalysisConfiguration = {
  maxCallDepth: 3,
  maxSourceFileBytes: DEFAULT_MAX_SOURCE_FILE_BYTES,
  evidenceSnippetLimit: DEFAULT_EVIDENCE_SNIPPET_LIMIT,
  interactions: DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION,
};

export const POSTGRESQL_18_RAW_SQL_CONFIGURATION: RawSqlAnalysisConfiguration = {
  dialect: 'postgresql-18',
  parserName: 'libpg-query',
  parserVersion: '18.1.2',
  maxSqlBytes: 65_536,
  maxStatements: 8,
  maxParseTimeMs: 250,
  maxAstNodes: 20_000,
};

export function rawSqlConfigurationForDialect(dialect: RawSqlDialect): RawSqlAnalysisConfiguration {
  switch (dialect) {
    case 'postgresql-18':
      return { ...POSTGRESQL_18_RAW_SQL_CONFIGURATION };
  }
}
