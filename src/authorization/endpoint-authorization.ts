import { analysisHasAuthorizationFacts, type AnalysisDocument } from '../model/analysis.js';
import type {
  AuthorizationEnforcementState,
  AuthorizationMetadataSource,
  AuthorizationValueShape,
} from '../model/authorization.js';
import type { GuardScope } from '../model/analysis.js';

export interface EndpointAuthorizationRequirement {
  readonly metadataId: string;
  readonly enforcementId: string;
  readonly metadataKey: string;
  readonly scope: Extract<GuardScope, 'controller' | 'method'>;
  readonly source: AuthorizationMetadataSource;
  readonly valueShape: AuthorizationValueShape;
  readonly enforcementState: AuthorizationEnforcementState;
  readonly guardId: string | null;
  readonly guardName: string | null;
  readonly evidenceIds: readonly string[];
}

export interface EndpointAuthorizationView {
  readonly availability: 'available' | 'unavailable';
  readonly requirements: readonly EndpointAuthorizationRequirement[];
}

export function buildEndpointAuthorization(
  analysis: AnalysisDocument,
  endpointId: string,
): EndpointAuthorizationView {
  if (!analysisHasAuthorizationFacts(analysis)) {
    return { availability: 'unavailable', requirements: [] };
  }
  const metadataById = new Map(
    analysis.authorizationMetadata
      .filter((metadata) => metadata.endpointId === endpointId)
      .map((metadata) => [metadata.id, metadata]),
  );
  const guardById = new Map(analysis.guards.map((guard) => [guard.id, guard]));
  return {
    availability: 'available',
    requirements: analysis.authorizationEnforcements
      .flatMap((enforcement) => {
        const metadata = metadataById.get(enforcement.metadataId);
        if (metadata === undefined || enforcement.endpointId !== endpointId) return [];
        return [
          {
            metadataId: metadata.id,
            enforcementId: enforcement.id,
            metadataKey: metadata.metadataKey,
            scope: metadata.scope,
            source: metadata.source,
            valueShape: metadata.valueShape,
            enforcementState: enforcement.state,
            guardId: enforcement.guardId,
            guardName:
              enforcement.guardId === null
                ? null
                : (guardById.get(enforcement.guardId)?.displayName ?? null),
            evidenceIds: [...new Set([...metadata.evidenceIds, ...enforcement.evidenceIds])].sort(),
          },
        ];
      })
      .sort((left, right) =>
        `${left.metadataKey}:${left.scope}:${left.enforcementState}:${left.guardName ?? ''}:${left.enforcementId}`.localeCompare(
          `${right.metadataKey}:${right.scope}:${right.enforcementState}:${right.guardName ?? ''}:${right.enforcementId}`,
        ),
      ),
  };
}
