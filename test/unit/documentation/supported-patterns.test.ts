import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NEST_REQUEST_PARAMETER_RULE_ID,
  NEST_RESPONSE_CONTRACT_RULE_ID,
  TYPESCRIPT_CONTRACT_FIELD_RULE_ID,
} from '../../../src/extractors/nest-contracts.js';
import {
  CLASS_INJECTION_RULE_ID,
  DIRECT_CALL_RULE_ID,
} from '../../../src/extractors/class-relationships.js';
import {
  NEST_ROUTE_DECORATOR_METHODS,
  NEST_ROUTE_RULE_ID,
} from '../../../src/extractors/nest-routes.js';
import { NEST_MODULE_RULE_IDS } from '../../../src/extractors/nest-modules.js';
import {
  TYPEORM_ENTITY_TABLE_RULE_ID,
  TYPEORM_ENTITY_COLUMN_RULE_ID,
  TYPEORM_READ_OPERATIONS,
  TYPEORM_REPOSITORY_ENTITY_RULE_ID,
  TYPEORM_REPOSITORY_INJECTION_RULE_ID,
  TYPEORM_WRITE_OPERATIONS,
} from '../../../src/extractors/typeorm-persistence.js';
import {
  TYPEORM_QUERY_BUILDER_DELETE_RULE_ID,
  TYPEORM_QUERY_BUILDER_INSERT_RULE_ID,
  TYPEORM_QUERY_BUILDER_JOIN_RULE_ID,
  TYPEORM_QUERY_BUILDER_SELECT_RULE_ID,
  TYPEORM_QUERY_BUILDER_UPDATE_RULE_ID,
} from '../../../src/extractors/typeorm-query-builder.js';
import { TYPEORM_RAW_SQL_RULE_IDS } from '../../../src/extractors/typeorm-raw-sql.js';
import {
  REQUEST_COLUMN_INFLUENCE_RULE_ID,
  REQUEST_FIELD_ORIGIN_RULE_ID,
} from '../../../src/extractors/request-provenance.js';
import { REQUEST_INTER_METHOD_INFLUENCE_RULE_ID } from '../../../src/extractors/inter-method-provenance.js';
import { DIRECT_GUARD_RULE_IDS, GLOBAL_GUARD_RULE_IDS } from '../../../src/model/guard-rules.js';

describe('supported-pattern documentation fidelity', () => {
  it('names every implemented P0 rule and supported operation', async () => {
    const documentation = await readFile(resolve('docs/supported-patterns.md'), 'utf8');
    const fixedRuleIds = [
      NEST_ROUTE_RULE_ID,
      CLASS_INJECTION_RULE_ID,
      DIRECT_CALL_RULE_ID,
      ...Object.values(DIRECT_GUARD_RULE_IDS),
      ...Object.values(GLOBAL_GUARD_RULE_IDS),
      ...Object.values(NEST_MODULE_RULE_IDS),
      TYPEORM_ENTITY_TABLE_RULE_ID,
      TYPEORM_ENTITY_COLUMN_RULE_ID,
      NEST_REQUEST_PARAMETER_RULE_ID,
      NEST_RESPONSE_CONTRACT_RULE_ID,
      TYPESCRIPT_CONTRACT_FIELD_RULE_ID,
      TYPEORM_REPOSITORY_INJECTION_RULE_ID,
      TYPEORM_REPOSITORY_ENTITY_RULE_ID,
      TYPEORM_QUERY_BUILDER_SELECT_RULE_ID,
      TYPEORM_QUERY_BUILDER_JOIN_RULE_ID,
      TYPEORM_QUERY_BUILDER_INSERT_RULE_ID,
      TYPEORM_QUERY_BUILDER_UPDATE_RULE_ID,
      TYPEORM_QUERY_BUILDER_DELETE_RULE_ID,
      ...Object.values(TYPEORM_RAW_SQL_RULE_IDS),
      REQUEST_FIELD_ORIGIN_RULE_ID,
      REQUEST_COLUMN_INFLUENCE_RULE_ID,
      REQUEST_INTER_METHOD_INFLUENCE_RULE_ID,
    ];
    const operationRuleIds = [...TYPEORM_READ_OPERATIONS, ...TYPEORM_WRITE_OPERATIONS].map(
      (operation) => `typeorm.repository.${operation}.v1`,
    );

    for (const ruleId of [...fixedRuleIds, ...operationRuleIds]) {
      expect(documentation, `Missing supported rule ${ruleId}`).toContain(`\`${ruleId}\``);
    }
    for (const decorator of Object.keys(NEST_ROUTE_DECORATOR_METHODS)) {
      expect(documentation, `Missing route decorator ${decorator}`).toContain(decorator);
    }
    expect(documentation).toContain('TYPEORM_OPERATION_UNSUPPORTED');
    expect(documentation).toContain('TYPEORM_SAVE_COLUMNS_UNKNOWN');
    expect(documentation).toContain('TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED');
    expect(documentation).toContain('TYPEORM_RAW_SQL_PARSE_FAILED');
    expect(documentation).toContain('REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED');
    expect(documentation).toContain('REQUEST_PROVENANCE_CALL_DEPTH_LIMIT');
    expect(documentation).toContain('never `public`');
  });
});
