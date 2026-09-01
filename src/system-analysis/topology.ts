import { systemTopologyManifestSchema } from './schemas.js';
import type { SystemTopologyManifest } from './model.js';
import { systemInteractionContractKey } from './model.js';

export interface SystemTopologyIssue {
  readonly path: string;
  readonly message: string;
}

export class SystemTopologyManifestError extends Error {
  readonly issues: readonly SystemTopologyIssue[];

  constructor(issues: readonly SystemTopologyIssue[]) {
    super(`System topology manifest is invalid with ${issues.length} issue(s).`);
    this.name = 'SystemTopologyManifestError';
    this.issues = issues;
  }
}

export function validateSystemTopologyManifest(
  input: unknown,
):
  | { readonly success: true; readonly data: SystemTopologyManifest }
  | { readonly success: false; readonly issues: readonly SystemTopologyIssue[] } {
  const parsed = systemTopologyManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const issues: SystemTopologyIssue[] = [];
  const realms = new Map<string, (typeof parsed.data.brokerRealms)[number]>();
  for (const [index, realm] of parsed.data.brokerRealms.entries()) {
    const alias = `${realm.environmentAlias}:${realm.brokerAlias}`;
    if (realms.has(alias)) {
      issues.push({
        path: `brokerRealms.${index}`,
        message: `Broker realm alias ${alias} is declared more than once.`,
      });
    } else {
      realms.set(alias, realm);
    }
    const compatible =
      (realm.technology === 'bullmq' &&
        realm.transport === 'bullmq' &&
        realm.destination.kind === 'queue') ||
      (realm.technology === 'nest_microservices' && realm.transport !== 'bullmq');
    if (!compatible) {
      issues.push({
        path: `brokerRealms.${index}`,
        message: 'Broker technology, transport, and destination are incompatible.',
      });
    }
  }

  const bindingKeys = new Set<string>();
  for (const [index, binding] of parsed.data.bindings.entries()) {
    const realm = realms.get(`${binding.environmentAlias}:${binding.brokerAlias}`);
    if (realm === undefined) {
      issues.push({
        path: `bindings.${index}`,
        message: 'Binding references an undeclared broker realm alias.',
      });
      continue;
    }
    const key = [
      binding.serviceNamespace,
      binding.role,
      systemInteractionContractKey(binding.contract),
      binding.analysisRecordId,
    ].join(':');
    if (bindingKeys.has(key)) {
      issues.push({
        path: `bindings.${index}`,
        message: 'An equivalent service, role, contract, and source-record binding is repeated.',
      });
    }
    bindingKeys.add(key);

    if (binding.contract.targetKind === 'job_queue') {
      if (
        realm.technology !== 'bullmq' ||
        realm.transport !== 'bullmq' ||
        realm.destination.kind !== 'queue' ||
        binding.contract.queue === null ||
        binding.contract.queue !== realm.destination.value ||
        (binding.role === 'producer' && binding.contract.job === null)
      ) {
        issues.push({
          path: `bindings.${index}.contract`,
          message:
            'A BullMQ binding requires the declared queue destination and an exact producer job.',
        });
      }
    } else if (
      realm.technology !== 'nest_microservices' ||
      realm.transport === 'bullmq' ||
      binding.contract.patternKind === 'dynamic' ||
      binding.contract.canonicalPattern === null
    ) {
      issues.push({
        path: `bindings.${index}.contract`,
        message: 'A Nest microservice binding requires an exact canonical message pattern.',
      });
    }
  }

  return issues.length === 0 ? { success: true, data: parsed.data } : { success: false, issues };
}

export function assertValidSystemTopologyManifest(input: unknown): SystemTopologyManifest {
  const result = validateSystemTopologyManifest(input);
  if (!result.success) throw new SystemTopologyManifestError(result.issues);
  return result.data;
}
