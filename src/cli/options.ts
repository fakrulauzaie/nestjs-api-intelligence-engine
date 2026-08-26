import type { EndpointCatalogueFilter } from '../reporting/endpoint-catalogue.js';
import { rawSqlConfigurationForDialect } from '../config/analysis-config.js';
import type { RawSqlAnalysisConfiguration } from '../model/entities.js';
import {
  MAX_GRAPH_EDGE_LIMIT,
  MAX_GRAPH_NODE_LIMIT,
  MIN_GRAPH_DISPLAY_LIMIT,
} from '../graph-report/model.js';

export interface EndpointFilterOptionValues {
  readonly controller?: string;
  readonly route?: string;
}

export function endpointFilterFromOptions(
  values: EndpointFilterOptionValues,
): EndpointCatalogueFilter {
  const controller = values.controller?.trim();
  if (values.controller !== undefined && controller?.length === 0) {
    throw new RangeError('--controller must not be empty.');
  }
  return {
    ...(controller === undefined ? {} : { controller }),
    ...(values.route === undefined ? {} : { route: values.route }),
  };
}

export function maximumCallDepthFromOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-3]$/u.test(value)) {
    throw new RangeError('--max-call-depth must be an integer from 1 to 3.');
  }
  return Number(value);
}

export function rawSqlConfigurationFromOption(
  value: string | undefined,
): RawSqlAnalysisConfiguration | undefined {
  if (value === undefined) return undefined;
  if (value !== 'postgresql-18') {
    throw new RangeError('--raw-sql-dialect currently supports only postgresql-18.');
  }
  return rawSqlConfigurationForDialect(value);
}

function boundedIntegerOption(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export function graphNodeLimitFromOption(value: string | undefined): number | undefined {
  return boundedIntegerOption(value, '--max-nodes', MIN_GRAPH_DISPLAY_LIMIT, MAX_GRAPH_NODE_LIMIT);
}

export function graphEdgeLimitFromOption(value: string | undefined): number | undefined {
  return boundedIntegerOption(value, '--max-edges', MIN_GRAPH_DISPLAY_LIMIT, MAX_GRAPH_EDGE_LIMIT);
}
