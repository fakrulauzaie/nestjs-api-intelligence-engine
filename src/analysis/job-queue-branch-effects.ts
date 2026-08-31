import type { AssertionRecord } from '../model/assertions.js';
import type { EvidenceRecord } from '../model/evidence.js';
import type { InteractionHandlerRecord } from '../model/interactions.js';
import type {
  JobQueueBranchEffectKind,
  JobQueueHandlerBranchEffectRecord,
  JobQueueHandlerBranchRecord,
  JobQueueHandlerDispatchRecord,
} from '../model/job-queue-branches.js';
import { makeJobQueueHandlerBranchEffectId } from '../model/ids.js';
import { BULLMQ_BRANCH_RULE_IDS } from '../extractors/bullmq-branches.js';

function positionAtOrAfter(
  line: number,
  column: number,
  boundaryLine: number,
  boundaryColumn: number,
): boolean {
  return line > boundaryLine || (line === boundaryLine && column >= boundaryColumn);
}

function positionAtOrBefore(
  line: number,
  column: number,
  boundaryLine: number,
  boundaryColumn: number,
): boolean {
  return line < boundaryLine || (line === boundaryLine && column <= boundaryColumn);
}

function containsEvidence(region: EvidenceRecord, candidate: EvidenceRecord): boolean {
  return (
    region.fileId === candidate.fileId &&
    positionAtOrAfter(
      candidate.startLine,
      candidate.startColumn,
      region.startLine,
      region.startColumn,
    ) &&
    positionAtOrBefore(candidate.endLine, candidate.endColumn, region.endLine, region.endColumn)
  );
}

function effectKind(assertion: AssertionRecord): JobQueueBranchEffectKind | null {
  switch (assertion.predicate) {
    case 'METHOD_CALLS_METHOD':
      return 'calls_method';
    case 'METHOD_READS_TABLE':
      return 'reads_table';
    case 'METHOD_WRITES_TABLE':
      return 'writes_table';
    case 'METHOD_INITIATES_INTERACTION':
      return 'initiates_interaction';
    case 'METHOD_ACCESSES_RESOURCE':
      return 'accesses_resource';
    default:
      return null;
  }
}

export function projectJobQueueBranchEffects(input: {
  readonly handlers: readonly InteractionHandlerRecord[];
  readonly dispatches: readonly JobQueueHandlerDispatchRecord[];
  readonly branches: readonly JobQueueHandlerBranchRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
}): JobQueueHandlerBranchEffectRecord[] {
  const handlerById = new Map(input.handlers.map((handler) => [handler.id, handler]));
  const dispatchById = new Map(input.dispatches.map((dispatch) => [dispatch.id, dispatch]));
  const evidenceById = new Map(input.evidence.map((evidence) => [evidence.id, evidence]));
  const assertionsByMethod = new Map<string, AssertionRecord[]>();
  for (const assertion of input.assertions) {
    if (
      assertion.objectId === null ||
      (assertion.status !== 'resolved' && assertion.status !== 'ambiguous') ||
      effectKind(assertion) === null
    ) {
      continue;
    }
    assertionsByMethod.set(assertion.subjectId, [
      ...(assertionsByMethod.get(assertion.subjectId) ?? []),
      assertion,
    ]);
  }

  const effects = new Map<string, JobQueueHandlerBranchEffectRecord>();
  for (const branch of input.branches) {
    const dispatch = dispatchById.get(branch.dispatchId);
    const handler = dispatch === undefined ? undefined : handlerById.get(dispatch.handlerId);
    if (handler?.kind !== 'job_queue') continue;
    const regions = branch.evidenceIds.flatMap((id) => {
      const evidence = evidenceById.get(id);
      return evidence === undefined ? [] : [evidence];
    });
    for (const assertion of assertionsByMethod.get(handler.methodId) ?? []) {
      const kind = effectKind(assertion);
      if (
        kind === null ||
        assertion.objectId === null ||
        (assertion.status !== 'resolved' && assertion.status !== 'ambiguous')
      )
        continue;
      const evidenceIds = assertion.evidenceIds
        .flatMap((id) => {
          const evidence = evidenceById.get(id);
          return evidence?.role === 'call_site' &&
            regions.some((region) => containsEvidence(region, evidence))
            ? [id]
            : [];
        })
        .sort();
      if (evidenceIds.length === 0) continue;
      const id = makeJobQueueHandlerBranchEffectId({
        branchId: branch.id,
        kind,
        targetId: assertion.objectId,
        sourceAssertionId: assertion.id,
        effectEvidenceId: evidenceIds[0]!,
        ruleId: BULLMQ_BRANCH_RULE_IDS.effect,
      });
      effects.set(id, {
        id,
        branchId: branch.id,
        kind,
        targetId: assertion.objectId,
        sourceAssertionId: assertion.id,
        status: assertion.status,
        ruleId: BULLMQ_BRANCH_RULE_IDS.effect,
        evidenceIds,
      });
    }
  }
  return [...effects.values()];
}
