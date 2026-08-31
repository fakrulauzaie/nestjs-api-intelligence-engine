import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { canonicalStringify } from '../model/ordering.js';
import type { GraphReportDocument } from './model.js';
import { OFFLINE_GRAPH_REPORT_APP } from './app-script.js';
import { OFFLINE_GRAPH_REPORT_STYLES } from './styles.js';

const require = createRequire(import.meta.url);

// Cytoscape 3.34.0 injects this exact rule when its first renderer starts. Keep the
// source explicit so the restrictive CSP can authorize only the pinned library rule.
export const CYTOSCAPE_RUNTIME_CONTAINER_STYLE =
  '.__________cytoscape_container { position: relative; }';

export class GraphReportRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphReportRenderError';
  }
}

function cspHash(contents: string): string {
  return `'sha256-${createHash('sha256').update(contents, 'utf8').digest('base64')}'`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safelySerializeGraphData(document: GraphReportDocument): string {
  return canonicalStringify(document)
    .trimEnd()
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export async function loadCytoscapeBrowserSource(): Promise<string> {
  const path = require.resolve('cytoscape/dist/cytoscape.min.js');
  return readFile(path, 'utf8');
}

function assertInlineScriptSafe(name: string, contents: string): void {
  if (/<\/script/iu.test(contents)) {
    throw new GraphReportRenderError(`${name} contains a closing script sequence.`);
  }
}

function assertNoExternalResources(html: string): void {
  if (/(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/)/iu.test(html)) {
    throw new GraphReportRenderError('The offline report contains an external resource URL.');
  }
}

export async function renderOfflineGraphReport(
  document: GraphReportDocument,
  cytoscapeSource?: string,
): Promise<string> {
  const library = cytoscapeSource ?? (await loadCytoscapeBrowserSource());
  const data = safelySerializeGraphData(document);
  assertInlineScriptSafe('Cytoscape.js', library);
  assertInlineScriptSafe('Graph report application', OFFLINE_GRAPH_REPORT_APP);
  assertInlineScriptSafe('Graph report data', data);
  const allowedStyleHashes = [OFFLINE_GRAPH_REPORT_STYLES, CYTOSCAPE_RUNTIME_CONTAINER_STYLE]
    .map(cspHash)
    .join(' ');
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src ${[library, OFFLINE_GRAPH_REPORT_APP, data].map(cspHash).join(' ')}`,
    `style-src ${allowedStyleHashes}`,
    `style-src-elem ${allowedStyleHashes}`,
    "style-src-attr 'unsafe-inline'",
    'img-src data: blob:',
    "connect-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "media-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="api-intel-graph-schema" content="${document.schemaVersion}">
    <title>API Intel offline graph report</title>
    <style>${OFFLINE_GRAPH_REPORT_STYLES}</style>
  </head>
  <body>
    <header class="app-header">
      <div class="brand"><h1>API Intel</h1><span>offline evidence graph</span></div>
      <div class="snapshot">${escapeHtml(document.analysis.toolName)} ${escapeHtml(document.analysis.toolVersion)}<br>Schema ${escapeHtml(document.schemaVersion)} · ${escapeHtml(document.analysis.resultState)}</div>
    </header>
    <div class="layout">
      <aside class="sidebar" aria-label="Graph view selection and filters">
        <section class="filters">
          <h2>Find graph views</h2>
          <div class="filter-grid">
            <label>View<select id="filter-view"><option value="endpoints">Endpoint producers</option><option value="handlers">Interaction handlers</option>${document.architecture === undefined ? '' : '<option value="architecture">Architecture overview</option>'}</select></label>
            <label>Search path, target, or handler<input id="filter-search" type="search" autocomplete="off"></label>
            <label>Method<select id="filter-method"><option value="">Any</option></select></label>
            <label>Guard<select id="filter-guard"><option value="">Any</option><option value="declared">Declared</option><option value="none">None proven</option><option value="unknown">Unknown</option></select></label>
            <label>Diagnostics<select id="filter-diagnostic"><option value="">Any</option><option value="with">With diagnostics</option><option value="without">Without diagnostics</option></select></label>
            <label>Data access<select id="filter-access"><option value="">Any</option><option value="read">Read</option><option value="write">Write</option><option value="read_write">Read + write</option><option value="none">None proven</option><option value="unknown">Unknown</option></select></label>
            <label>Policy<select id="filter-policy"><option value="">Any</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="unknown">Unknown</option><option value="not_applicable">Not applicable</option><option value="not_supplied">Not supplied/no outcome</option></select></label>
            <label>Impact<select id="filter-impact"><option value="">Any</option><option value="direct">Direct</option><option value="potential">Potential</option><option value="unknown">Unknown</option><option value="none">None</option></select></label>
            <label>Architecture heat<select id="filter-metric"><option value="supported_root_reach_count">Supported-root reach</option></select></label>
          </div>
        </section>
        <p id="result-count" class="result-count" role="status"></p>
        <ul id="endpoint-list" class="endpoint-list" aria-label="Matching graph views"></ul>
      </aside>
      <main class="main">
        <div class="endpoint-heading">
          <h2 id="endpoint-title">Select a graph view</h2>
          <div id="endpoint-badges" aria-label="Graph view states"></div>
        </div>
        <div id="endpoint-chips" class="chips" aria-label="Graph view summary"></div>
        <p id="limit-notice" class="notice" role="status" hidden></p>
        <div class="workspace">
          <section class="graph-card" aria-labelledby="graph-label">
            <h3 id="graph-label" class="visually-hidden">Interactive evidence graph</h3>
            <div id="graph" aria-hidden="true"></div>
            <p class="graph-caption">Select a node or edge to highlight its static path and inspect retained evidence. Dashed labels and borders name uncertainty without relying on color. Architecture heat is also published numerically in the accessible table and percentile legend. Selecting a handler or endpoint root opens its dedicated view.</p>
          </section>
          <aside class="inspector" aria-live="polite" aria-label="Evidence inspector">
            <div id="inspector-content"><p class="inspector-empty">Select an endpoint to inspect evidence.</p></div>
          </aside>
        </div>
        <section class="facts" aria-label="Graph view facts"><div id="facts-grid" class="facts-grid"></div></section>
        <details class="fallback" open>
          <summary>Accessible graph table</summary>
          <div class="table-scroll">
            <table>
              <caption class="visually-hidden">Nodes and edges for the selected graph view</caption>
              <thead><tr><th>Record</th><th>Kind</th><th>Label or connection</th><th>Certainty</th><th>Impact</th><th>Evidence</th></tr></thead>
              <tbody id="fallback-body"></tbody>
            </table>
          </div>
        </details>
      </main>
    </div>
    <noscript><p class="empty">JavaScript is required to explore this local report. The file makes no network requests.</p></noscript>
    <script id="api-intel-data" type="application/json">${data}</script>
    <script>${library}</script>
    <script>${OFFLINE_GRAPH_REPORT_APP}</script>
  </body>
</html>
`;
  assertNoExternalResources(html);
  return html;
}
