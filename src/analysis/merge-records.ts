import type { AssertionRecord } from '../model/assertions.js';
import type { ClassRecord, GuardRecord, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import type {
  ApplicationRecord,
  InteractionHandlerRecord,
  InteractionRecord,
} from '../model/interactions.js';
import { canonicalStringify } from '../model/ordering.js';

function withoutClassRoles(record: ClassRecord): Omit<ClassRecord, 'roles'> {
  return {
    id: record.id,
    sourceFileId: record.sourceFileId,
    qualifiedName: record.qualifiedName,
    displayName: record.displayName,
    declarationEvidenceId: record.declarationEvidenceId,
  };
}

export function mergeClassRecords(
  ...collections: readonly (readonly ClassRecord[])[]
): ClassRecord[] {
  const byId = new Map<string, ClassRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (
      existing !== undefined &&
      canonicalStringify(withoutClassRoles(existing)) !==
        canonicalStringify(withoutClassRoles(record))
    ) {
      throw new Error(`Unequal class records share stable ID ${record.id}.`);
    }
    byId.set(
      record.id,
      existing === undefined
        ? record
        : { ...existing, roles: [...new Set([...existing.roles, ...record.roles])] },
    );
  }
  return [...byId.values()];
}

export function mergeMethodRecords(
  ...collections: readonly (readonly MethodRecord[])[]
): MethodRecord[] {
  const byId = new Map<string, MethodRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (existing !== undefined && canonicalStringify(existing) !== canonicalStringify(record)) {
      throw new Error(`Unequal method records share stable ID ${record.id}.`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}

export function mergeGuardRecords(
  ...collections: readonly (readonly GuardRecord[])[]
): GuardRecord[] {
  const byId = new Map<string, GuardRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (existing !== undefined && canonicalStringify(existing) !== canonicalStringify(record)) {
      throw new Error(`Unequal guard records share stable ID ${record.id}.`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}

export function mergeAssertionRecords(
  ...collections: readonly (readonly AssertionRecord[])[]
): AssertionRecord[] {
  const byId = new Map<string, AssertionRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (
      existing !== undefined &&
      (existing.subjectId !== record.subjectId ||
        existing.predicate !== record.predicate ||
        existing.objectId !== record.objectId ||
        existing.ruleId !== record.ruleId ||
        existing.status !== record.status)
    ) {
      throw new Error(`Unequal assertions share stable ID ${record.id}.`);
    }
    byId.set(
      record.id,
      existing === undefined
        ? record
        : {
            ...existing,
            evidenceIds: [...new Set([...existing.evidenceIds, ...record.evidenceIds])],
          },
    );
  }
  return [...byId.values()];
}

export function mergeEvidenceRecords(
  ...collections: readonly (readonly EvidenceRecord[])[]
): EvidenceRecord[] {
  const byId = new Map<string, EvidenceRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (existing !== undefined && canonicalStringify(existing) !== canonicalStringify(record)) {
      throw new Error(`Unequal evidence records share stable ID ${record.id}.`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}

export function mergeInteractionRecords(
  ...collections: readonly (readonly InteractionRecord[])[]
): InteractionRecord[] {
  const byId = new Map<string, InteractionRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (existing !== undefined && canonicalStringify(existing) !== canonicalStringify(record)) {
      throw new Error(`Unequal interactions share stable ID ${record.id}.`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}

export function mergeApplicationRecords(
  ...collections: readonly (readonly ApplicationRecord[])[]
): ApplicationRecord[] {
  const byId = new Map<string, ApplicationRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (existing !== undefined && canonicalStringify(existing) !== canonicalStringify(record)) {
      throw new Error(`Unequal applications share stable ID ${record.id}.`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}

export function mergeInteractionHandlerRecords(
  ...collections: readonly (readonly InteractionHandlerRecord[])[]
): InteractionHandlerRecord[] {
  const byId = new Map<string, InteractionHandlerRecord>();
  for (const record of collections.flat()) {
    const existing = byId.get(record.id);
    if (existing !== undefined && canonicalStringify(existing) !== canonicalStringify(record)) {
      throw new Error(`Unequal interaction handlers share stable ID ${record.id}.`);
    }
    byId.set(record.id, record);
  }
  return [...byId.values()];
}
