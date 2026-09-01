export const OFFLINE_SYSTEM_REPORT_APP = String.raw`
(() => {
  'use strict';
  const documentData = JSON.parse(document.getElementById('api-intel-system-data').textContent);
  const byId = new Map(documentData.graph.nodes.map((node) => [node.id, node]));
  const correlations = new Map(documentData.correlations.map((record) => [record.id, record]));
  const correlationList = document.getElementById('correlation-list');
  const search = document.getElementById('filter-search');
  const stateFilter = document.getElementById('filter-state');
  const count = document.getElementById('result-count');
  const inspector = document.getElementById('inspector');

  const element = (name, text, className) => {
    const result = document.createElement(name);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const inspect = (title, rows) => {
    inspector.replaceChildren(element('h3', title));
    const list = element('dl');
    for (const [key, value] of rows) {
      list.append(element('dt', key), element('dd', value === null || value === '' ? '—' : String(value)));
    }
    inspector.append(list);
  };
  const renderList = () => {
    const query = search.value.trim().toLowerCase();
    const state = stateFilter.value;
    const matches = documentData.correlations.filter((record) =>
      (!state || record.state === state) &&
      (!query || (record.contractLabel + ' ' + record.state + ' ' + (record.reason || '')).toLowerCase().includes(query))
    );
    count.textContent = matches.length + ' of ' + documentData.correlations.length + ' correlations';
    correlationList.replaceChildren();
    for (const record of matches) {
      const item = element('li');
      const button = element('button');
      button.type = 'button';
      button.append(element('div', record.contractLabel), element('span', record.state, 'state'));
      button.addEventListener('click', () => {
        for (const candidate of correlationList.querySelectorAll('button')) candidate.classList.remove('active');
        button.classList.add('active');
        cy.elements().removeClass('focused faded');
        const selected = cy.elements().filter((entry) => entry.data('correlationId') === record.id || (entry.data('correlationIds') || []).includes(record.id));
        cy.elements().not(selected).addClass('faded');
        selected.addClass('focused');
        inspect('Correlation', [
          ['State', record.state],
          ['Contract', record.contractLabel],
          ['Boundary', record.state === 'declared_realm_candidate' ? 'conditional candidate; delivery not proven' : 'non-traversable'],
          ['Reason', record.reason],
          ['Consumers', record.consumerEndpointIds.length],
        ]);
      });
      item.append(button);
      correlationList.append(item);
    }
  };

  const elements = [
    ...documentData.graph.nodes.map((node) => ({ data: {
      id: node.id,
      label: node.label,
      kind: node.kind,
      parent: node.parentId || undefined,
      certainty: node.certainty,
      correlationIds: node.correlationIds,
      diagnosticIds: node.diagnosticIds,
    }})),
    ...documentData.graph.edges.map((edge) => ({ data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      kind: edge.kind,
      certainty: edge.certainty,
      correlationId: edge.correlationId,
      diagnosticIds: edge.diagnosticIds,
    }})),
  ];
  const cy = cytoscape({
    container: document.getElementById('graph'),
    elements,
    layout: { name: 'cose', animate: false, fit: true, padding: 35, nodeRepulsion: () => 9000 },
    style: [
      { selector: 'node', style: { 'label': 'data(label)', 'font-size': 10, 'color': '#e8eef8', 'text-wrap': 'wrap', 'text-max-width': 125, 'text-valign': 'bottom', 'text-margin-y': 7, 'background-color': '#4285c5', 'border-width': 2, 'border-color': '#8ec8ff', 'width': 38, 'height': 38 } },
      { selector: 'node[kind = "service"], node[kind = "broker_realm"]', style: { 'shape': 'round-rectangle', 'background-opacity': .15, 'border-width': 2, 'padding': 24, 'text-valign': 'top', 'text-halign': 'center', 'font-size': 12 } },
      { selector: 'node[kind = "broker_realm"]', style: { 'background-color': '#7b5db5', 'border-color': '#c9a8ff' } },
      { selector: 'node[kind = "broker_destination"]', style: { 'shape': 'diamond', 'background-color': '#855fbd', 'border-color': '#d4b8ff' } },
      { selector: 'node[kind = "http_endpoint"]', style: { 'shape': 'round-rectangle', 'background-color': '#216c62', 'border-color': '#7ce0d0' } },
      { selector: 'node[kind = "consumer"]', style: { 'shape': 'hexagon', 'background-color': '#9a6429', 'border-color': '#ffc174' } },
      { selector: 'node[kind = "table_effect"], node[kind = "resource_effect"]', style: { 'shape': 'barrel', 'background-color': '#8b3f56', 'border-color': '#ff9bb8' } },
      { selector: 'node[certainty = "ambiguous"], node[certainty = "unknown"]', style: { 'border-style': 'dashed' } },
      { selector: 'edge', style: { 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'line-color': '#7891ad', 'target-arrow-color': '#7891ad', 'width': 2, 'label': 'data(label)', 'font-size': 8, 'color': '#c5d2e3', 'text-background-color': '#08111f', 'text-background-opacity': .85, 'text-background-padding': 2 } },
      { selector: 'edge[certainty = "conditional_candidate"]', style: { 'line-style': 'dashed', 'line-color': '#d4a958', 'target-arrow-color': '#d4a958' } },
      { selector: '.faded', style: { 'opacity': .12, 'text-opacity': .12 } },
      { selector: '.focused', style: { 'border-color': '#ffffff', 'line-color': '#ffffff', 'target-arrow-color': '#ffffff', 'width': 4 } },
    ],
  });
  cy.on('tap', 'node', (event) => {
    const data = event.target.data();
    const source = byId.get(data.id);
    inspect(source.label, [
      ['Kind', source.kind],
      ['Certainty', source.certainty],
      ['Service', source.serviceId],
      ['Source records', source.analysisRecords.map((record) => record.namespacedId).join(', ')],
      ['Correlations', source.correlationIds.join(', ')],
      ['Diagnostics', source.diagnosticIds.length],
    ]);
  });
  cy.on('tap', 'edge', (event) => {
    const data = event.target.data();
    inspect(data.label, [
      ['Kind', data.kind],
      ['Certainty', data.certainty],
      ['Correlation', data.correlationId],
      ['Meaning', data.certainty === 'conditional_candidate' ? 'Static candidate only; runtime delivery and execution are not proven.' : 'Proven only inside the named source artifact.'],
    ]);
  });
  search.addEventListener('input', renderList);
  stateFilter.addEventListener('change', renderList);
  renderList();

  const fallbackBody = document.getElementById('fallback-body');
  for (const node of documentData.graph.nodes) {
    const row = element('tr');
    for (const value of ['node', node.kind, node.label, node.certainty, node.analysisRecords.map((record) => record.namespacedId).join(', ')]) row.append(element('td', value));
    fallbackBody.append(row);
  }
  for (const edge of documentData.graph.edges) {
    const row = element('tr');
    for (const value of ['edge', edge.kind, (byId.get(edge.source)?.label || edge.source) + ' → ' + (byId.get(edge.target)?.label || edge.target), edge.certainty, edge.correlationId || '—']) row.append(element('td', value));
    fallbackBody.append(row);
  }
})();
`;
