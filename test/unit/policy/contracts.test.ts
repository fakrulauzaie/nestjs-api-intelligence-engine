import { describe, expect, it } from 'vitest';
import {
  normalizePolicyConfiguration,
  policyConfigurationSchema,
} from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { renderPolicyResultsMarkdown } from '../../../src/policy/markdown.js';
import { serializePolicyResults } from '../../../src/policy/ordering.js';
import { validatePolicyResultsDocument } from '../../../src/policy/validate.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

describe('Phase 16 policy contracts', () => {
  it('accepts only strict typed rule settings and normalizes in stable rule order', () => {
    const first = normalizePolicyConfiguration({
      version: 1,
      rules: {
        'no-new-diagnostics': ['warn', { minimumSeverity: 'error' }],
        'no-repository-access-in-controller': 'error',
      },
    });
    const second = normalizePolicyConfiguration({
      version: 1,
      rules: {
        'no-repository-access-in-controller': 'error',
        'no-new-diagnostics': ['warn', { minimumSeverity: 'error' }],
      },
    });
    expect(first).toEqual(second);
    expect(first.rules.map(({ ruleId }) => ruleId)).toEqual([
      'no-repository-access-in-controller',
      'no-new-diagnostics',
    ]);
    expect(
      policyConfigurationSchema.safeParse({
        version: 1,
        rules: { 'unknown-rule': 'error' },
      }).success,
    ).toBe(false);
    expect(
      policyConfigurationSchema.safeParse({
        version: 1,
        rules: { 'require-guard-on-write-endpoint': ['error', { onUnknown: 'ignore' }] },
      }).success,
    ).toBe(false);
  });

  it('serializes reproducibly regardless of source rule order and renders validated Markdown', () => {
    const analysis = createMinimalAnalysisDocument();
    const left = evaluatePolicies({
      analysis,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: {
          'require-complete-write-trace': 'warn',
          'no-repository-access-in-controller': 'error',
        },
      }),
    });
    const right = evaluatePolicies({
      analysis,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: {
          'no-repository-access-in-controller': 'error',
          'require-complete-write-trace': 'warn',
        },
      }),
    });
    expect(serializePolicyResults(left)).toBe(serializePolicyResults(right));
    expect(renderPolicyResultsMarkdown(left)).toContain('# API Intelligence Policy Results');
    expect(renderPolicyResultsMarkdown(left)).toContain('Not applicable');
  });

  it('rejects summary, blocking, and rule-configuration integrity mismatches', () => {
    const valid = evaluatePolicies({
      analysis: createMinimalAnalysisDocument(),
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: { 'no-repository-access-in-controller': 'error' },
      }),
    });
    const invalid = {
      ...valid,
      summary: { ...valid.summary, passed: 99 },
      results: valid.results.map((result) => ({ ...result, blocking: true })),
    };
    const validation = validatePolicyResultsDocument(invalid);
    expect(validation.success).toBe(false);
    if (!validation.success) {
      expect(validation.issues.map(({ code }) => code)).toEqual(
        expect.arrayContaining(['SUMMARY_MISMATCH', 'BLOCKING_STATE_MISMATCH']),
      );
    }
  });
});
