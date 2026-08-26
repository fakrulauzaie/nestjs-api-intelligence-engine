import type { AnalysisResultState } from '../model/analysis.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';

export interface AnalysisResultStateInput {
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly trustedFactCount: number;
  readonly fatal?: boolean;
  readonly canceled?: boolean;
}

export function deriveAnalysisResultState(input: AnalysisResultStateInput): AnalysisResultState {
  if (input.canceled === true) return 'canceled';
  if (input.fatal === true) return 'failed';
  if (
    input.trustedFactCount === 0 &&
    input.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  ) {
    return 'failed';
  }
  return input.diagnostics.length === 0 ? 'completed' : 'completed_with_gaps';
}
