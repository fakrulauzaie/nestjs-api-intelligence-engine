import type { RecordId } from './entities.js';

export const INTERACTION_KINDS = [
  'outbound_http',
  'in_process_event',
  'job_queue',
  'microservice_message',
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const APPLICATION_KINDS = ['http', 'microservice', 'hybrid'] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];
export const APPLICATION_ROOT_RESOLUTIONS = ['resolved', 'unknown'] as const;
export type ApplicationRootResolution = (typeof APPLICATION_ROOT_RESOLUTIONS)[number];
export const APPLICATION_TRANSPORT_STATES = ['not_applicable', 'resolved', 'unknown'] as const;
export type ApplicationTransportState = (typeof APPLICATION_TRANSPORT_STATES)[number];
export const NEST_MICROSERVICE_TRANSPORTS = ['tcp', 'redis', 'rmq', 'kafka'] as const;
export type NestMicroserviceTransport = (typeof NEST_MICROSERVICE_TRANSPORTS)[number];

export interface ApplicationRecord {
  readonly id: RecordId;
  readonly kind: ApplicationKind;
  readonly rootModuleId: RecordId | null;
  readonly rootResolution: ApplicationRootResolution;
  readonly transportState: ApplicationTransportState;
  readonly transport: NestMicroserviceTransport | null;
  readonly bootstrapEvidenceId: RecordId;
}

export const INTERACTION_ACTIVATION_STATES = [
  'eager',
  'proven_activated',
  'constructed_cold',
  'unknown',
] as const;
export type InteractionActivationState = (typeof INTERACTION_ACTIVATION_STATES)[number];

export const INTERACTION_BOUNDARY_STATES = [
  'in_process',
  'broker_or_worker_boundary',
  'external_or_unobserved',
  'unknown',
] as const;
export type InteractionBoundaryState = (typeof INTERACTION_BOUNDARY_STATES)[number];

export const INTERACTION_DISPATCH_TIMINGS = ['synchronous', 'asynchronous', 'unknown'] as const;
export type InteractionDispatchTiming = (typeof INTERACTION_DISPATCH_TIMINGS)[number];

export const TEXT_TARGET_RESOLUTIONS = ['exact', 'template', 'symbolic', 'dynamic'] as const;
export type TextTargetResolution = (typeof TEXT_TARGET_RESOLUTIONS)[number];

export interface TextInteractionTarget {
  readonly resolution: TextTargetResolution;
  /** Null only when resolution is dynamic. Runtime configuration values are never stored. */
  readonly value: string | null;
}

export const OUTBOUND_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'TRACE',
  'CONNECT',
  'UNKNOWN',
] as const;
export type OutboundHttpMethod = (typeof OUTBOUND_HTTP_METHODS)[number];

export interface OutboundHttpTarget {
  readonly targetKind: 'http';
  readonly method: OutboundHttpMethod;
  readonly url: TextInteractionTarget;
  /** Query key names only. Query values are deliberately excluded. */
  readonly queryKeys: readonly string[];
}

export const EVENT_IDENTITY_KINDS = ['string', 'symbol', 'dynamic'] as const;
export type EventIdentityKind = (typeof EVENT_IDENTITY_KINDS)[number];

export interface InProcessEventWildcardPattern {
  readonly kind: 'wildcard';
  readonly delimiter: string;
}

export interface InProcessEventTarget {
  readonly targetKind: 'event';
  readonly identityKind: EventIdentityKind;
  /** Event name or a stable declaration key; null only for a dynamic identity. */
  readonly value: string | null;
  /** Present only for a statically configured EventEmitter2 listener pattern. */
  readonly pattern?: InProcessEventWildcardPattern | undefined;
}

export const JOB_QUEUE_TECHNOLOGIES = ['bullmq', 'bull'] as const;
export type JobQueueTechnology = (typeof JOB_QUEUE_TECHNOLOGIES)[number];

export interface JobQueueTarget {
  readonly targetKind: 'queue';
  readonly technology: JobQueueTechnology;
  readonly queue: TextInteractionTarget;
  readonly job: TextInteractionTarget;
}

/**
 * BullMQ processors are queue-wide in Phase 35. A dynamic handler job target is the
 * explicit queue-wide marker; it does not mean that a dynamic producer identity was
 * resolved. Exact job targets are reserved for a future proven branch-slicing rule.
 */
export function jobQueueTargetsMatch(
  interaction: JobQueueTarget,
  handler: JobQueueTarget,
): boolean {
  if (interaction.technology !== handler.technology) return false;
  if (
    interaction.queue.resolution !== 'exact' ||
    handler.queue.resolution !== 'exact' ||
    interaction.queue.value === null ||
    interaction.queue.value !== handler.queue.value
  ) {
    return false;
  }
  if (handler.job.resolution === 'dynamic' && handler.job.value === null) return true;
  return interactionTargetKey(interaction) === interactionTargetKey(handler);
}

export const MICROSERVICE_MESSAGE_MODES = ['request_response', 'event'] as const;
export type MicroserviceMessageMode = (typeof MICROSERVICE_MESSAGE_MODES)[number];
export const MICROSERVICE_PATTERN_KINDS = ['scalar', 'object', 'array', 'dynamic'] as const;
export type MicroservicePatternKind = (typeof MICROSERVICE_PATTERN_KINDS)[number];

export interface MicroserviceMessageTarget {
  readonly targetKind: 'message';
  readonly mode: MicroserviceMessageMode;
  readonly patternKind: MicroservicePatternKind;
  /** Canonical JSON text for a static pattern; null only for a dynamic pattern. */
  readonly canonicalPattern: string | null;
  readonly clientToken: TextInteractionTarget;
  readonly transport: NestMicroserviceTransport | null;
}

/**
 * Matches only statically canonical Nest message patterns with the same communication
 * mode and proven transport. Handler targets deliberately carry a dynamic client token
 * because Nest pattern decorators do not identify a producer token; token/application
 * compatibility is enforced by extractor and integrity rules instead of being guessed.
 */
export function microserviceMessageTargetsMatch(
  interaction: MicroserviceMessageTarget,
  handler: MicroserviceMessageTarget,
): boolean {
  return (
    interaction.mode === handler.mode &&
    interaction.patternKind !== 'dynamic' &&
    handler.patternKind !== 'dynamic' &&
    interaction.canonicalPattern !== null &&
    interaction.canonicalPattern === handler.canonicalPattern &&
    interaction.transport !== null &&
    interaction.transport === handler.transport
  );
}

export type InteractionTarget =
  | OutboundHttpTarget
  | InProcessEventTarget
  | JobQueueTarget
  | MicroserviceMessageTarget;

interface InteractionRecordBase {
  readonly id: RecordId;
  readonly sourceMethodId: RecordId;
  readonly applicationId: RecordId | null;
  readonly direction: 'outbound';
  readonly activation: InteractionActivationState;
  readonly boundary: InteractionBoundaryState;
  readonly dispatchTiming: InteractionDispatchTiming;
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}

export interface OutboundHttpInteractionRecord extends InteractionRecordBase {
  readonly kind: 'outbound_http';
  readonly target: OutboundHttpTarget;
}

export interface InProcessEventInteractionRecord extends InteractionRecordBase {
  readonly kind: 'in_process_event';
  readonly target: InProcessEventTarget;
}

export interface JobQueueInteractionRecord extends InteractionRecordBase {
  readonly kind: 'job_queue';
  readonly target: JobQueueTarget;
}

export interface MicroserviceMessageInteractionRecord extends InteractionRecordBase {
  readonly kind: 'microservice_message';
  readonly target: MicroserviceMessageTarget;
}

export type InteractionRecord =
  | OutboundHttpInteractionRecord
  | InProcessEventInteractionRecord
  | JobQueueInteractionRecord
  | MicroserviceMessageInteractionRecord;

export const HANDLER_REGISTRATION_STATES = [
  'proven_registered',
  'declared_candidate',
  'registration_unknown',
] as const;
export type HandlerRegistrationState = (typeof HANDLER_REGISTRATION_STATES)[number];

interface InteractionHandlerRecordBase {
  readonly id: RecordId;
  readonly methodId: RecordId;
  readonly applicationId: RecordId | null;
  readonly registrationState: HandlerRegistrationState;
  readonly ruleId: string;
  readonly handlerEvidenceId: RecordId;
}

export interface InProcessEventHandlerRecord extends InteractionHandlerRecordBase {
  readonly kind: 'in_process_event';
  readonly target: InProcessEventTarget;
  /** Configuration evidence required to prove wildcard matching; omitted for exact listeners. */
  readonly configurationEvidenceIds?: readonly RecordId[] | undefined;
}

export interface JobQueueHandlerRecord extends InteractionHandlerRecordBase {
  readonly kind: 'job_queue';
  readonly target: JobQueueTarget;
}

export interface MicroserviceMessageHandlerRecord extends InteractionHandlerRecordBase {
  readonly kind: 'microservice_message';
  readonly target: MicroserviceMessageTarget;
}

export type InteractionHandlerRecord =
  | InProcessEventHandlerRecord
  | JobQueueHandlerRecord
  | MicroserviceMessageHandlerRecord;

export const INTERACTION_ANALYSIS_STATES = ['not_run', 'complete', 'incomplete'] as const;
export type InteractionAnalysisState = (typeof INTERACTION_ANALYSIS_STATES)[number];

export interface InteractionAnalysisMetadata {
  /** Kinds representable by this analysis schema. */
  readonly schemaKinds: readonly InteractionKind[];
  /** Kinds for which this tool version contains an extractor. */
  readonly supportedKinds: readonly InteractionKind[];
  /** Supported extractors enabled for this run. */
  readonly enabledKinds: readonly InteractionKind[];
  readonly state: InteractionAnalysisState;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable, normalized target component shared by IDs and semantic projections. */
export function interactionTargetKey(target: InteractionTarget): string {
  return canonicalJson(target);
}

const MAX_EVENT_PATTERN_SEGMENTS = 100;

export function validInProcessEventPattern(value: string, delimiter: string): boolean {
  if (delimiter.length === 0 || delimiter.includes('*')) return false;
  const segments = value.split(delimiter);
  return (
    segments.length <= MAX_EVENT_PATTERN_SEGMENTS &&
    segments.some((segment) => segment === '*' || segment === '**') &&
    segments.every((segment) => segment === '*' || segment === '**' || !segment.includes('*'))
  );
}

/** EventEmitter2-compatible bounded namespace matching for proven string patterns. */
export function inProcessEventTargetsMatch(
  interaction: InProcessEventTarget,
  handler: InProcessEventTarget,
): boolean {
  if (interaction.identityKind === 'dynamic' || handler.identityKind === 'dynamic') return false;
  if (handler.pattern === undefined)
    return interactionTargetKey(interaction) === interactionTargetKey(handler);
  if (
    interaction.identityKind !== 'string' ||
    handler.identityKind !== 'string' ||
    interaction.value === null ||
    handler.value === null ||
    interaction.pattern !== undefined ||
    !validInProcessEventPattern(handler.value, handler.pattern.delimiter)
  ) {
    return false;
  }

  const pattern = handler.value.split(handler.pattern.delimiter);
  const event = interaction.value.split(handler.pattern.delimiter);
  const memo = new Map<string, boolean>();
  const match = (patternIndex: number, eventIndex: number): boolean => {
    const key = `${patternIndex}:${eventIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (patternIndex === pattern.length) result = eventIndex === event.length;
    else if (pattern[patternIndex] === '**') {
      result =
        match(patternIndex + 1, eventIndex) ||
        (eventIndex < event.length && match(patternIndex, eventIndex + 1));
    } else {
      result =
        eventIndex < event.length &&
        (pattern[patternIndex] === '*' || pattern[patternIndex] === event[eventIndex]) &&
        match(patternIndex + 1, eventIndex + 1);
    }
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}
