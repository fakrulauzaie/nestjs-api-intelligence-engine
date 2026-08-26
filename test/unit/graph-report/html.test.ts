import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { OFFLINE_GRAPH_REPORT_APP } from '../../../src/graph-report/app-script.js';
import {
  CYTOSCAPE_RUNTIME_CONTAINER_STYLE,
  renderOfflineGraphReport,
} from '../../../src/graph-report/html.js';
import { OFFLINE_GRAPH_REPORT_STYLES } from '../../../src/graph-report/styles.js';
import { makeAssertionId, makeEndpointId } from '../../../src/model/ids.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

describe('Phase 23 self-contained HTML rendering', () => {
  it('is byte-deterministic, CSP-hardened, offline, keyboard-oriented, and accessible', async () => {
    const analysis = createMinimalAnalysisDocument();
    const document = buildGraphReportDocument({ analysis });
    const first = await renderOfflineGraphReport(document);
    const second = await renderOfflineGraphReport(document);
    expect(second).toBe(first);
    expect(first).toContain("connect-src 'none'");
    expect(first).toContain("script-src 'sha256-");
    expect(first).not.toMatch(/(?:src|href)=["'](?:https?:|\/\/)/iu);
    expect(first).toContain('Accessible graph table');
    expect(first).toContain("event.key === 'ArrowDown'");
    expect(first).toContain('uncertainty without relying on color');
    expect(first).toContain('Repository-relative, copyable source location');
    expect(first.length).toBeGreaterThan(400_000);
    const csp = first.match(/Content-Security-Policy" content="([^"]+)"/u)?.[1] ?? '';
    const inlineBlocks = [
      ...(first.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/gu) ?? []),
      ...(first.matchAll(/<style>([\s\S]*?)<\/style>/gu) ?? []),
    ].map((match) => match[1]!);
    for (const block of inlineBlocks) {
      const hash = createHash('sha256').update(block, 'utf8').digest('base64');
      expect(csp).toContain(`'sha256-${hash}'`);
    }
    const cytoscapeStyleHash = createHash('sha256')
      .update(CYTOSCAPE_RUNTIME_CONTAINER_STYLE, 'utf8')
      .digest('base64');
    expect(csp).toContain(`'sha256-${cytoscapeStyleHash}'`);
    expect(cytoscapeStyleHash).toBe('pgvDUBa4IjFA2yuSJ2cqcyxmNYJMborsd0ORcRv9vw8=');
    expect(OFFLINE_GRAPH_REPORT_STYLES).toContain('#graph { position: relative;');
    expect(OFFLINE_GRAPH_REPORT_APP).not.toContain('wheelSensitivity');
    const scripts = [...first.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/gu)].map(
      (match) => match[1]!,
    );
    expect(scripts).toHaveLength(3);
    expect(() => new Script(scripts[1]!)).not.toThrow();
    expect(() => new Script(scripts[2]!)).not.toThrow();
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(first).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/u);
  });

  it('neutralizes closing-script and HTML injection in labels, snippets, and metadata', async () => {
    const original = createMinimalAnalysisDocument();
    const handlerId = original.methods[0]!.id;
    const path = '/</script><img src=x onerror=alert(1)>';
    const endpointId = makeEndpointId({
      httpMethod: 'GET',
      path,
      handlerMethodId: handlerId,
      repositoryRevision: original.analysisRun.repositoryRevision,
    });
    const assertion = original.assertions[0]!;
    const analysis = {
      ...original,
      analysisRun: {
        ...original.analysisRun,
        tool: { ...original.analysisRun.tool, version: '<img src=x onerror=alert(2)>' },
      },
      endpoints: [{ ...original.endpoints[0]!, id: endpointId, path }],
      assertions: [
        {
          ...assertion,
          id: makeAssertionId({
            subjectId: endpointId,
            predicate: assertion.predicate,
            objectId: assertion.objectId,
            ruleId: assertion.ruleId,
          }),
          subjectId: endpointId,
        },
      ],
    };
    const html = await renderOfflineGraphReport(buildGraphReportDocument({ analysis }));
    expect(html).not.toContain('<img src=x onerror=alert');
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c/script\\u003e\\u003cimg');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });
});
