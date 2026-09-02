import cytoscape from 'cytoscape';
import { Script } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { OFFLINE_SYSTEM_REPORT_APP } from '../../../src/system-report/app-script.js';

class FakeClassList {
  private readonly values = new Set<string>();

  add(...values: string[]): void {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]): void {
    for (const value of values) this.values.delete(value);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly listeners = new Map<string, Array<() => void>>();
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  textContent = '';
  value = '';
  className = '';
  type = '';

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }

  dispatch(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) listener();
  }
}

function node(
  id: string,
  kind: string,
  label: string,
  parentId: string | null,
  correlationIds: readonly string[] = [],
) {
  return {
    id,
    kind,
    label,
    parentId,
    serviceId: parentId,
    certainty: 'conditional_candidate',
    correlationIds,
    diagnosticIds: [],
    analysisRecords: [],
  };
}

describe('offline system report application', () => {
  let graph: cytoscape.Core | undefined;

  afterEach(() => graph?.destroy());

  it('opens on a compact path-only service to broker to service layout', () => {
    const report = {
      graph: {
        nodes: [
          node('ticket', 'service', 'ticket-service', null),
          node('producer', 'producer', 'producer', 'ticket', ['correlation']),
          node('unmatched', 'producer', 'unmatched inventory', 'ticket'),
          node('realm', 'broker_realm', 'ctt-rmq', null),
          node('destination', 'broker_destination', 'intt_ctt_queue', 'realm', ['correlation']),
          node('worker', 'service', 'ctt-queue-service', null),
          node('consumer', 'consumer', 'consumer', 'worker', ['correlation']),
          node('effect', 'table_effect', 'WRITE apim_log', 'worker', ['correlation']),
        ],
        edges: [
          {
            id: 'route',
            source: 'producer',
            target: 'destination',
            label: 'route',
            kind: 'conditional_route',
            certainty: 'conditional_candidate',
            correlationId: 'correlation',
            diagnosticIds: [],
          },
          {
            id: 'candidate',
            source: 'destination',
            target: 'consumer',
            label: 'candidate',
            kind: 'conditional_candidate',
            certainty: 'conditional_candidate',
            correlationId: 'correlation',
            diagnosticIds: [],
          },
          {
            id: 'effect-edge',
            source: 'consumer',
            target: 'effect',
            label: 'effect',
            kind: 'conditional_effect',
            certainty: 'conditional_candidate',
            correlationId: 'correlation',
            diagnosticIds: [],
          },
        ],
      },
      correlations: [
        {
          id: 'correlation',
          state: 'declared_realm_candidate',
          contractLabel: 'tmf-update-ctt-list',
          reason: null,
          producerEndpointId: 'producer',
          consumerEndpointIds: ['consumer'],
        },
      ],
    };
    const ids = [
      'api-intel-system-data',
      'correlation-list',
      'filter-search',
      'filter-state',
      'result-count',
      'inspector',
      'view-paths',
      'view-all',
      'fit-graph',
      'graph-view-status',
      'graph',
      'fallback-body',
    ];
    const dom = new Map(ids.map((id) => [id, new FakeElement()]));
    dom.get('api-intel-system-data')!.textContent = JSON.stringify(report);

    const applicationGlobals = globalThis as unknown as Record<string, unknown>;
    const replacements = {
      document: {
        getElementById: (id: string) => dom.get(id),
        createElement: () => new FakeElement(),
      },
      cytoscape: (input: cytoscape.CytoscapeOptions) => {
        graph = cytoscape({
          ...input,
          layout: input.layout ?? { name: 'preset' },
          container: null,
          headless: true,
          styleEnabled: true,
        });
        return graph;
      },
      requestAnimationFrame: (callback: () => void) => {
        callback();
        return 0;
      },
      window: {
        addEventListener: () => undefined,
        clearTimeout: () => undefined,
        setTimeout: () => 0,
      },
    };
    const previous = new Map(
      Object.keys(replacements).map((key) => [key, applicationGlobals[key]]),
    );
    try {
      Object.assign(applicationGlobals, replacements);
      new Script(OFFLINE_SYSTEM_REPORT_APP).runInThisContext();

      expect(graph).toBeDefined();
      expect(
        graph!.getElementById('unmatched').classes(),
        JSON.stringify(graph!.nodes().map((entry) => [entry.id(), entry.classes()])),
      ).toContain('hidden');
      expect(graph!.nodes().filter((entry) => !entry.hasClass('hidden'))).toHaveLength(7);
      expect(graph!.getElementById('producer').position('x')).toBeLessThan(
        graph!.getElementById('destination').position('x'),
      );
      expect(graph!.getElementById('destination').position('x')).toBeLessThan(
        graph!.getElementById('consumer').position('x'),
      );
      expect(dom.get('graph-view-status')!.textContent).toContain('Conditional paths · 7 nodes');

      dom.get('view-all')!.dispatch('click');
      expect(graph!.nodes().filter((entry) => !entry.hasClass('hidden'))).toHaveLength(8);
      expect(dom.get('graph-view-status')!.textContent).toContain('All interactions · 8 nodes');
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete applicationGlobals[key];
        else applicationGlobals[key] = value;
      }
    }
  });
});
