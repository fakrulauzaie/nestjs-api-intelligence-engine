import type { AssertionRecord } from '../model/assertions.js';

export interface TraceAssertionIndexes {
  readonly implementationsByEndpoint: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly guardsByEndpoint: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly callsByMethod: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly tableAccessByMethod: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly resourceAccessByMethod: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly interactionsByMethod: ReadonlyMap<string, readonly AssertionRecord[]>;
}

function add(index: Map<string, AssertionRecord[]>, key: string, assertion: AssertionRecord): void {
  const records = index.get(key) ?? [];
  records.push(assertion);
  index.set(key, records);
}

function sortValues(index: Map<string, AssertionRecord[]>): void {
  for (const records of index.values()) {
    records.sort((left, right) => left.id.localeCompare(right.id));
  }
}

export function buildTraceAssertionIndexes(
  assertions: readonly AssertionRecord[],
): TraceAssertionIndexes {
  const implementationsByEndpoint = new Map<string, AssertionRecord[]>();
  const guardsByEndpoint = new Map<string, AssertionRecord[]>();
  const callsByMethod = new Map<string, AssertionRecord[]>();
  const tableAccessByMethod = new Map<string, AssertionRecord[]>();
  const resourceAccessByMethod = new Map<string, AssertionRecord[]>();
  const interactionsByMethod = new Map<string, AssertionRecord[]>();

  for (const assertion of assertions) {
    switch (assertion.predicate) {
      case 'ENDPOINT_IMPLEMENTED_BY':
        add(implementationsByEndpoint, assertion.subjectId, assertion);
        break;
      case 'ENDPOINT_USES_GUARD':
        add(guardsByEndpoint, assertion.subjectId, assertion);
        break;
      case 'METHOD_CALLS_METHOD':
        add(callsByMethod, assertion.subjectId, assertion);
        break;
      case 'METHOD_READS_TABLE':
      case 'METHOD_WRITES_TABLE':
        add(tableAccessByMethod, assertion.subjectId, assertion);
        break;
      case 'METHOD_INITIATES_INTERACTION':
        add(interactionsByMethod, assertion.subjectId, assertion);
        break;
      case 'METHOD_ACCESSES_RESOURCE':
        add(resourceAccessByMethod, assertion.subjectId, assertion);
        break;
      default:
        break;
    }
  }

  sortValues(implementationsByEndpoint);
  sortValues(guardsByEndpoint);
  sortValues(callsByMethod);
  sortValues(tableAccessByMethod);
  sortValues(resourceAccessByMethod);
  sortValues(interactionsByMethod);
  return {
    implementationsByEndpoint,
    guardsByEndpoint,
    callsByMethod,
    tableAccessByMethod,
    resourceAccessByMethod,
    interactionsByMethod,
  };
}
