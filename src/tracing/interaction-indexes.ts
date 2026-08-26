import type { AnalysisDocument } from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';

export interface InteractionAssertionIndexes {
  readonly initiatedByMethod: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly handlersByInteraction: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly implementationByHandler: ReadonlyMap<string, readonly AssertionRecord[]>;
}

function add(index: Map<string, AssertionRecord[]>, key: string, assertion: AssertionRecord): void {
  index.set(key, [...(index.get(key) ?? []), assertion]);
}

function sortValues(index: Map<string, AssertionRecord[]>): void {
  for (const values of index.values()) {
    values.sort((left, right) => left.id.localeCompare(right.id));
  }
}

/**
 * Builds kind-agnostic interaction adjacency. V1/v2 documents and Phase 30 v3
 * documents naturally produce empty indexes; no unsupported fact is synthesized.
 */
export function buildInteractionAssertionIndexes(
  analysis: AnalysisDocument,
): InteractionAssertionIndexes {
  const initiatedByMethod = new Map<string, AssertionRecord[]>();
  const handlersByInteraction = new Map<string, AssertionRecord[]>();
  const implementationByHandler = new Map<string, AssertionRecord[]>();

  for (const assertion of analysis.assertions) {
    switch (assertion.predicate) {
      case 'METHOD_INITIATES_INTERACTION':
        add(initiatedByMethod, assertion.subjectId, assertion);
        break;
      case 'INTERACTION_MATCHES_LOCAL_HANDLER':
        add(handlersByInteraction, assertion.subjectId, assertion);
        break;
      case 'HANDLER_IMPLEMENTED_BY':
        add(implementationByHandler, assertion.subjectId, assertion);
        break;
      default:
        break;
    }
  }

  sortValues(initiatedByMethod);
  sortValues(handlersByInteraction);
  sortValues(implementationByHandler);
  return { initiatedByMethod, handlersByInteraction, implementationByHandler };
}
