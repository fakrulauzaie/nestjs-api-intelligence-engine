import type { GuardScope } from './analysis.js';
import type { RecordId } from './entities.js';

export const AUTHORIZATION_METADATA_SOURCES = [
  'direct_set_metadata',
  'repository_wrapper',
  'configured_decorator',
] as const;
export type AuthorizationMetadataSource = (typeof AUTHORIZATION_METADATA_SOURCES)[number];

export const AUTHORIZATION_VALUE_KINDS = ['scalar', 'array', 'object', 'unknown'] as const;
export type AuthorizationValueKind = (typeof AUTHORIZATION_VALUE_KINDS)[number];
export const AUTHORIZATION_SCALAR_TYPES = ['string', 'number', 'boolean', 'null'] as const;
export type AuthorizationScalarType = (typeof AUTHORIZATION_SCALAR_TYPES)[number];

export type AuthorizationValueShape =
  | {
      readonly kind: 'scalar';
      readonly scalarType: AuthorizationScalarType;
      readonly redacted: true;
    }
  | {
      readonly kind: 'array';
      readonly itemCount: number;
      readonly itemTypes: readonly AuthorizationScalarType[];
      readonly dynamicItems: boolean;
      readonly redacted: true;
    }
  | {
      readonly kind: 'object';
      readonly keys: readonly string[];
      readonly dynamicKeys: boolean;
      readonly redacted: true;
    }
  | {
      readonly kind: 'unknown';
      readonly redacted: true;
    };

export type AuthorizationSymbolReference =
  | {
      readonly kind: 'package_export';
      readonly moduleSpecifier: string;
      readonly exportedName: string;
    }
  | {
      readonly kind: 'repository_export';
      readonly sourceFile: string;
      readonly exportedName: string;
    };

export interface AuthorizationDecoratorConfiguration {
  readonly symbol: AuthorizationSymbolReference;
  readonly metadataKey: string;
}

export interface AuthorizationEnforcementConfiguration {
  readonly metadataKey: string;
  readonly guard: Extract<AuthorizationSymbolReference, { readonly kind: 'repository_export' }>;
}

export interface AuthorizationAnalysisConfiguration {
  readonly metadataKeys: readonly string[];
  readonly decoratorSymbols: readonly AuthorizationDecoratorConfiguration[];
  readonly enforcementRelationships: readonly AuthorizationEnforcementConfiguration[];
}

export interface AuthorizationDecoratorIdentity {
  readonly kind: 'direct_set_metadata' | 'repository_symbol' | 'configured_symbol';
  readonly moduleSpecifier: string | null;
  readonly exportedName: string;
  readonly sourceFileId: RecordId | null;
}

export interface AuthorizationMetadataRecord {
  readonly id: RecordId;
  readonly endpointId: RecordId;
  readonly scope: Extract<GuardScope, 'controller' | 'method'>;
  readonly metadataKey: string;
  readonly source: AuthorizationMetadataSource;
  readonly decorator: AuthorizationDecoratorIdentity;
  readonly valueShape: AuthorizationValueShape;
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}

export const AUTHORIZATION_ENFORCEMENT_STATES = [
  'proven_enforced',
  'configured_relationship',
  'enforcement_unknown',
] as const;
export type AuthorizationEnforcementState = (typeof AUTHORIZATION_ENFORCEMENT_STATES)[number];

export interface AuthorizationEnforcementRecord {
  readonly id: RecordId;
  readonly metadataId: RecordId;
  readonly endpointId: RecordId;
  readonly state: AuthorizationEnforcementState;
  readonly guardId: RecordId | null;
  readonly guardAssertionId: RecordId | null;
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}

export const AUTHORIZATION_RULE_IDS = {
  directMetadata: 'nest.authorization.set-metadata.direct.v1',
  repositoryWrapper: 'nest.authorization.set-metadata.wrapper.v1',
  configuredDecorator: 'nest.authorization.decorator.configured.v1',
  compositeControllerGuard: 'nest.guard.composite.controller.v1',
  compositeMethodGuard: 'nest.guard.composite.method.v1',
  compositeEnforcement: 'nest.authorization.enforcement.composite.v1',
  configuredEnforcement: 'nest.authorization.enforcement.configured.v1',
  unknownEnforcement: 'nest.authorization.enforcement.unknown.v1',
} as const;
