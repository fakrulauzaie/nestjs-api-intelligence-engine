import type {
  InProcessEventTarget,
  JobQueueTarget,
  MicroserviceMessageTarget,
  OutboundHttpTarget,
} from '../model/interactions.js';

export function outboundHttpTargetLabel(target: OutboundHttpTarget): string {
  const url = target.url.value ?? 'dynamic target';
  const query = target.queryKeys.length === 0 ? '' : `; query keys: ${target.queryKeys.join(', ')}`;
  return `${target.method} ${url}${query}`;
}

export function inProcessEventTargetLabel(target: InProcessEventTarget): string {
  const identity =
    target.value === null
      ? 'dynamic event'
      : target.identityKind === 'symbol'
        ? `symbol ${target.value}`
        : target.value;
  return target.pattern === undefined
    ? identity
    : `${identity} [wildcard; delimiter ${target.pattern.delimiter}]`;
}

export function jobQueueTargetLabel(target: JobQueueTarget): string {
  const queue = target.queue.value ?? 'dynamic queue';
  const job = target.job.value ?? 'any/dynamic job';
  return `${target.technology} queue ${queue}; job ${job}`;
}

export function microserviceMessageTargetLabel(target: MicroserviceMessageTarget): string {
  const mode = target.mode === 'request_response' ? 'request-response' : 'event';
  const pattern = target.canonicalPattern ?? 'dynamic pattern';
  const client = target.clientToken.value ?? 'dynamic client';
  const transport = target.transport ?? 'unknown transport';
  return `${mode} ${pattern}; client ${client}; transport ${transport}`;
}
