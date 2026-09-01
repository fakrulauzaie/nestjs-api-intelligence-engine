import { createStableId } from '../model/ids.js';
import type {
  BrokerRealmRecord,
  SystemInteractionContractTarget,
  SystemInteractionCorrelationRecord,
  SystemServiceRecord,
} from './model.js';
import { systemInteractionContractKey } from './model.js';

export function makeSystemServiceId(namespace: string): string {
  return createStableId('system_service', [namespace]);
}

export function makeNamespacedAnalysisRecordId(input: {
  serviceNamespace: string;
  analysisRecordId: string;
}): string {
  return createStableId('system_record', [input.serviceNamespace, input.analysisRecordId]);
}

export function makeSystemEndpointId(input: { namespacedRecordId: string; role: string }): string {
  return createStableId('system_endpoint', [input.namespacedRecordId, input.role]);
}

export function makeBrokerRealmId(
  input: Omit<BrokerRealmRecord, 'id' | 'declarationSource'>,
): string {
  return createStableId('broker_realm', [
    input.environmentAlias,
    input.brokerAlias,
    input.technology,
    input.transport,
    input.destination.kind,
    input.destination.value,
    input.prefix,
    input.namespace,
  ]);
}

export function makeSystemCorrelationId(
  input: Omit<SystemInteractionCorrelationRecord, 'id' | 'diagnosticIds'>,
): string {
  const consumerEndpointIds = [...input.consumerEndpointIds].sort((left, right) =>
    left.localeCompare(right),
  );
  return createStableId('system_correlation', [
    input.kind,
    input.contractKey,
    input.producerEndpointId,
    ...consumerEndpointIds,
    input.brokerRealmId,
    input.state,
    input.unmatchedReason,
    input.ambiguityReason,
  ]);
}

export function makeSystemDiagnosticId(input: {
  code: string;
  subjectId: string;
  message: string;
}): string {
  return createStableId('system_diagnostic', [input.code, input.subjectId, input.message]);
}

export function makeSystemReportNodeId(parts: readonly (string | number | null)[]): string {
  return createStableId('system_graph_node', parts);
}

export function makeSystemReportEdgeId(parts: readonly (string | number | null)[]): string {
  return createStableId('system_graph_edge', parts);
}

export function makeSystemConditionalPathId(parts: readonly (string | number | null)[]): string {
  return createStableId('system_path', parts);
}

export function makeSystemReportDiagnosticId(parts: readonly (string | number | null)[]): string {
  return createStableId('system_report_diagnostic', parts);
}

export function makeSystemPolicyResultId(parts: readonly (string | number | null)[]): string {
  return createStableId('system_policy_result', parts);
}

export function makeSystemReportId(parts: readonly (string | number | null)[]): string {
  return createStableId('system_report', parts);
}

export function makeSystemAnalysisId(input: {
  systemName: string;
  services: readonly Pick<
    SystemServiceRecord,
    'id' | 'analysisId' | 'analysisSchemaVersion' | 'analysisResultState'
  >[];
  brokerRealmIds: readonly string[];
  endpoints: readonly {
    readonly id: string;
    readonly contract: SystemInteractionContractTarget;
    readonly sourceTransport: string | null;
    readonly brokerRealmId: string | null;
  }[];
  correlationIds: readonly string[];
  diagnosticIds: readonly string[];
}): string {
  const services = [...input.services].sort((left, right) => left.id.localeCompare(right.id));
  const endpoints = [...input.endpoints].sort((left, right) => left.id.localeCompare(right.id));
  return createStableId('system_analysis', [
    input.systemName,
    ...services.flatMap(({ id, analysisId, analysisSchemaVersion, analysisResultState }) => [
      id,
      analysisId,
      analysisSchemaVersion,
      analysisResultState,
    ]),
    ...[...input.brokerRealmIds].sort((left, right) => left.localeCompare(right)),
    ...endpoints.flatMap(({ id, contract, sourceTransport, brokerRealmId }) => [
      id,
      systemInteractionContractKey(contract),
      sourceTransport,
      brokerRealmId,
    ]),
    ...[...input.correlationIds].sort((left, right) => left.localeCompare(right)),
    ...[...input.diagnosticIds].sort((left, right) => left.localeCompare(right)),
  ]);
}
