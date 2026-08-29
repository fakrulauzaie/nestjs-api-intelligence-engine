export const SEMANTIC_KEY_KINDS = [
  'analysis',
  'source_file',
  'class',
  'method',
  'endpoint_exact',
  'endpoint_route_slot',
  'endpoint_terminal',
  'guard',
  'repository_binding',
  'entity',
  'table',
  'module',
  'global_guard_registration',
  'contract_type',
  'contract_field',
  'request_parameter',
  'response_contract',
  'entity_column',
  'request_field_origin',
  'column_influence',
  'application',
  'interaction',
  'interaction_handler',
  'interaction_handler_dispatch',
  'interaction_handler_branch',
  'interaction_handler_branch_effect',
  'authorization_metadata',
  'authorization_enforcement',
  'assertion',
  'diagnostic',
  'evidence',
  'evidence_location',
] as const;
export type SemanticKeyKind = (typeof SEMANTIC_KEY_KINDS)[number];
export type SemanticKeyComponent = string | number | boolean | null;

export interface SemanticKey {
  readonly kind: SemanticKeyKind;
  readonly components: readonly SemanticKeyComponent[];
  readonly encoded: string;
}

function normalizeComponent(component: SemanticKeyComponent): SemanticKeyComponent {
  return typeof component === 'string' ? component.normalize('NFC') : component;
}

export function createSemanticKey(
  kind: SemanticKeyKind,
  components: readonly SemanticKeyComponent[],
): SemanticKey {
  const normalized = components.map(normalizeComponent);
  return {
    kind,
    components: normalized,
    encoded: JSON.stringify([kind, ...normalized]),
  };
}

export function normalizeSignature(signature: string): string {
  return signature.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function semanticKeyIsCanonical(key: SemanticKey): boolean {
  return createSemanticKey(key.kind, key.components).encoded === key.encoded;
}

export function compareSemanticKeys(left: SemanticKey, right: SemanticKey): number {
  return left.encoded.localeCompare(right.encoded);
}
