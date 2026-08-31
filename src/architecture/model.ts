export const ARCHITECTURE_RECORD_KINDS = [
  'method',
  'table',
  'interaction',
  'resource_access',
] as const;
export type ArchitectureRecordKind = (typeof ARCHITECTURE_RECORD_KINDS)[number];

export const ARCHITECTURE_METRIC_KINDS = [
  'direct_call_fan_in',
  'direct_call_fan_out',
  'endpoint_reach_count',
  'handler_reach_count',
  'supported_root_reach_count',
] as const;
export type ArchitectureMetricKind = (typeof ARCHITECTURE_METRIC_KINDS)[number];

export const ARCHITECTURE_HEAT_BANDS = ['zero', 'low', 'medium', 'high', 'very_high'] as const;
export type ArchitectureHeatBand = (typeof ARCHITECTURE_HEAT_BANDS)[number];

export const ARCHITECTURE_REACHABILITY_STATES = [
  'reached_from_supported_root',
  'not_reached_from_supported_roots',
] as const;
export type ArchitectureReachabilityState = (typeof ARCHITECTURE_REACHABILITY_STATES)[number];

export const MODULE_OWNERSHIP_STATES = [
  'uniquely_owned',
  'multiple_owners',
  'not_declared_by_supported_modules',
  'ownership_unknown',
  'unavailable',
] as const;
export type ModuleOwnershipState = (typeof MODULE_OWNERSHIP_STATES)[number];

export interface ArchitectureMetricValue {
  readonly metric: ArchitectureMetricKind;
  readonly value: number;
  readonly heat: ArchitectureHeatBand;
}

export interface ArchitectureMetricRecord {
  readonly recordId: string;
  readonly recordKind: ArchitectureRecordKind;
  readonly metrics: readonly ArchitectureMetricValue[];
  readonly reachability: ArchitectureReachabilityState;
}

export interface ArchitectureMetricLegend {
  readonly metric: ArchitectureMetricKind;
  readonly eligibleRecords: number;
  readonly maximum: number;
  readonly percentiles: {
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
  };
}

export interface ModuleOwnershipRecord {
  readonly recordId: string;
  readonly recordKind: 'class' | 'method';
  readonly state: ModuleOwnershipState;
  readonly moduleIds: readonly string[];
}

export interface ArchitectureOverview {
  readonly rootCapabilities: {
    readonly endpoints: 'available';
    readonly interactionHandlers: 'available' | 'unavailable';
  };
  readonly supportedRoots: {
    readonly endpoints: number;
    readonly interactionHandlers: number;
  };
  readonly summary: {
    readonly metricRecords: number;
    readonly notReachedFromSupportedRoots: number;
    readonly uniquelyOwnedClasses: number;
    readonly multipleOwnerClasses: number;
    readonly ownershipUnknownClasses: number;
  };
  readonly metricLegends: readonly ArchitectureMetricLegend[];
  readonly records: readonly ArchitectureMetricRecord[];
  readonly moduleOwnership: readonly ModuleOwnershipRecord[];
}
