import type { AnalysisDocument } from '../model/analysis.js';
import type { EndpointRecord } from '../model/entities.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import {
  buildEndpointCatalogue,
  renderEndpointCatalogueMarkdown,
  type EndpointCatalogueFilter,
} from './endpoint-catalogue.js';
import { renderEndpointTraceMarkdown } from './endpoint-trace-markdown.js';
import { renderEndpointContractsMarkdown } from './endpoint-contracts.js';

export interface MarkdownTraceReport {
  readonly endpointId: string;
  readonly fileName: string;
  readonly contents: string;
}

export interface MarkdownReportBundle {
  readonly endpointsMarkdown: string;
  readonly contractsMarkdown: string;
  readonly traces: readonly MarkdownTraceReport[];
  readonly skippedAmbiguousEndpointCount: number;
}

function safeRouteLabel(path: string): string {
  if (path === '/') return 'root';
  const segments = path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment.startsWith(':') ? `param-${segment.slice(1)}` : segment));
  const label = segments
    .join('-')
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 96);
  return label.length === 0 ? 'route' : label;
}

export function traceReportFileName(endpoint: EndpointRecord): string {
  const stableSuffix = endpoint.id.split(':').at(-1)?.slice(0, 10) ?? 'unknown';
  return `${endpoint.httpMethod.toLowerCase()}-${safeRouteLabel(endpoint.path)}-${stableSuffix}.md`;
}

export function buildMarkdownReportBundle(
  analysis: AnalysisDocument,
  filter: EndpointCatalogueFilter = {},
): MarkdownReportBundle {
  const catalogue = buildEndpointCatalogue(analysis, filter);
  const endpointById = new Map(analysis.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const traces: MarkdownTraceReport[] = [];
  let skippedAmbiguousEndpointCount = 0;

  for (const entry of catalogue.endpoints) {
    if (entry.selectionStatus === 'ambiguous') {
      skippedAmbiguousEndpointCount += 1;
      continue;
    }
    const endpoint = endpointById.get(entry.endpointId);
    if (endpoint === undefined) continue;
    const result = buildEndpointTrace(analysis, {
      httpMethod: endpoint.httpMethod,
      path: endpoint.path,
    });
    if (result.status !== 'resolved') continue;
    traces.push({
      endpointId: endpoint.id,
      fileName: traceReportFileName(endpoint),
      contents: renderEndpointTraceMarkdown({
        analysis,
        trace: result.trace,
        diagnostics: result.diagnostics,
      }),
    });
  }

  return {
    endpointsMarkdown: renderEndpointCatalogueMarkdown(catalogue),
    contractsMarkdown: renderEndpointContractsMarkdown(
      analysis,
      new Set(catalogue.endpoints.map((entry) => entry.endpointId)),
    ),
    traces: traces.sort((left, right) => left.fileName.localeCompare(right.fileName)),
    skippedAmbiguousEndpointCount,
  };
}
