/** Frozen v6 values retained so old documents cannot acquire v7-only facts. */
export const RESOURCE_TECHNOLOGIES_V6 = ['cache_manager', 'ioredis'] as const;
export const RESOURCE_TECHNOLOGIES = [...RESOURCE_TECHNOLOGIES_V6, 'redlock'] as const;
export type ResourceTechnology = (typeof RESOURCE_TECHNOLOGIES)[number];

export const RESOURCE_KINDS_V6 = [
  'cache_entry',
  'redis_key',
  'redis_hash',
  'redis_keyspace',
] as const;
export const RESOURCE_KINDS = [...RESOURCE_KINDS_V6, 'distributed_lock'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_OPERATIONS_V6 = [
  'read',
  'write',
  'read_write',
  'delete',
  'expire',
  'scan',
] as const;
export const RESOURCE_OPERATIONS = [...RESOURCE_OPERATIONS_V6, 'critical_section'] as const;
export type ResourceOperation = (typeof RESOURCE_OPERATIONS)[number];

export const RESOURCE_TARGET_KINDS = ['exact', 'template', 'symbolic', 'dynamic'] as const;
export type ResourceTargetKind = (typeof RESOURCE_TARGET_KINDS)[number];

export type ResourceTargetSegment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'symbolic'; readonly token: string }
  | { readonly kind: 'placeholder'; readonly index: number };

export type ResourceTarget =
  | { readonly kind: 'exact'; readonly value: string }
  | { readonly kind: 'template'; readonly segments: readonly ResourceTargetSegment[] }
  | { readonly kind: 'symbolic'; readonly token: string }
  | { readonly kind: 'dynamic' };

export interface ResourceAccessRecord {
  readonly id: string;
  readonly resourceKind: ResourceKind;
  readonly operation: ResourceOperation;
  readonly technology: ResourceTechnology;
  readonly api: string;
  readonly sourceMethodId: string;
  readonly target: ResourceTarget;
  /** Optional field/keyspace selector; currently used only by supported scan calls. */
  readonly selector: ResourceTarget | null;
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
}

export interface ResourceAccessAnalysisMetadata {
  readonly supportedTechnologies: readonly ResourceTechnology[];
  readonly enabledTechnologies: readonly ResourceTechnology[];
  readonly state: 'complete' | 'incomplete';
}

export function resourceTargetKey(target: ResourceTarget): string {
  switch (target.kind) {
    case 'exact':
      return JSON.stringify(['exact', target.value.normalize('NFC')]);
    case 'symbolic':
      return JSON.stringify(['symbolic', target.token.normalize('NFC')]);
    case 'dynamic':
      return JSON.stringify(['dynamic']);
    case 'template':
      return JSON.stringify([
        'template',
        ...target.segments.map((segment) =>
          segment.kind === 'literal'
            ? ['literal', segment.value.normalize('NFC')]
            : segment.kind === 'symbolic'
              ? ['symbolic', segment.token.normalize('NFC')]
              : ['placeholder', segment.index],
        ),
      ]);
  }
}

export function resourceAccessLabel(record: ResourceAccessRecord): string {
  const target =
    record.target.kind === 'exact'
      ? record.target.value
      : record.target.kind === 'symbolic'
        ? `$${record.target.token}`
        : record.target.kind === 'dynamic'
          ? '<dynamic>'
          : record.target.segments
              .map((segment) =>
                segment.kind === 'literal'
                  ? segment.value
                  : segment.kind === 'symbolic'
                    ? `\${${segment.token}}`
                    : `\${${segment.index}}`,
              )
              .join('');
  return `${record.technology} ${record.operation} ${target}`;
}
