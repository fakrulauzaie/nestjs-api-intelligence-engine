export const OFFLINE_SYSTEM_REPORT_APP = String.raw`
(() => {
  'use strict';
  const documentData = JSON.parse(document.getElementById('api-intel-system-data').textContent);
  const byId = new Map(documentData.graph.nodes.map((node) => [node.id, node]));
  const correlationList = document.getElementById('correlation-list');
  const search = document.getElementById('filter-search');
  const stateFilter = document.getElementById('filter-state');
  const count = document.getElementById('result-count');
  const inspector = document.getElementById('inspector');
  const pathViewButton = document.getElementById('view-paths');
  const allViewButton = document.getElementById('view-all');
  const fitButton = document.getElementById('fit-graph');
  const viewStatus = document.getElementById('graph-view-status');

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
    layout: { name: 'preset', fit: false },
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
      { selector: '.hidden', style: { 'display': 'none' } },
      { selector: '.faded', style: { 'opacity': .12, 'text-opacity': .12 } },
      { selector: '.focused', style: { 'border-color': '#ffffff', 'line-color': '#ffffff', 'target-arrow-color': '#ffffff', 'width': 4 } },
    ],
  });

  const withAncestors = (ids) => {
    const expanded = new Set(ids);
    for (const id of [...expanded]) {
      let current = byId.get(id);
      while (current?.parentId) {
        expanded.add(current.parentId);
        current = byId.get(current.parentId);
      }
    }
    return expanded;
  };
  const groupIdFor = (node) => node.parentId || node.id;
  const nodeSort = (left, right) =>
    left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
  const localRank = (node) => {
    if (node.kind === 'http_endpoint' || node.kind === 'consumer' || node.kind === 'broker_destination') return 0;
    if (node.kind === 'producer' || node.kind === 'table_effect' || node.kind === 'resource_effect') return 1;
    return 0;
  };

  const compactGroupLayout = (children) => {
    const buckets = new Map();
    for (const child of [...children].sort(nodeSort)) {
      const rank = localRank(child);
      buckets.set(rank, [...(buckets.get(rank) || []), child]);
    }
    const positions = new Map();
    let columnOffset = 0;
    let maximumRows = 1;
    for (const rank of [...buckets.keys()].sort((left, right) => left - right)) {
      const bucket = buckets.get(rank);
      const rows = Math.min(5, bucket.length);
      const columns = Math.ceil(bucket.length / rows);
      maximumRows = Math.max(maximumRows, rows);
      bucket.forEach((child, index) => {
        positions.set(child.id, {
          x: (columnOffset + Math.floor(index / rows)) * 190,
          y: (index % rows) * 105,
        });
      });
      columnOffset += columns;
    }
    const columns = Math.max(1, columnOffset);
    const width = (columns - 1) * 190 + 120;
    const height = (maximumRows - 1) * 105 + 120;
    for (const position of positions.values()) {
      position.x -= (columns - 1) * 95;
      position.y -= (maximumRows - 1) * 52.5;
    }
    return { positions, width, height };
  };

  const layoutVisible = (visibleNodeIds, visibleEdgeIds) => {
    const childrenByGroup = new Map();
    for (const node of documentData.graph.nodes) {
      if (!visibleNodeIds.has(node.id) || node.kind === 'service' || node.kind === 'broker_realm') continue;
      const groupId = groupIdFor(node);
      childrenByGroup.set(groupId, [...(childrenByGroup.get(groupId) || []), node]);
    }
    const groupLinks = [];
    for (const edge of documentData.graph.edges) {
      if (!visibleEdgeIds.has(edge.id)) continue;
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const sourceGroup = groupIdFor(source);
      const targetGroup = groupIdFor(target);
      if (sourceGroup !== targetGroup) groupLinks.push([sourceGroup, targetGroup]);
    }
    const outgoingToBroker = new Set();
    const incomingFromBroker = new Set();
    for (const [sourceId, targetId] of groupLinks) {
      if (byId.get(targetId)?.kind === 'broker_realm') outgoingToBroker.add(sourceId);
      if (byId.get(sourceId)?.kind === 'broker_realm') incomingFromBroker.add(targetId);
    }
    const groups = [...childrenByGroup.entries()].map(([id, children]) => {
      const container = byId.get(id);
      const layer = container?.kind === 'broker_realm'
        ? 1
        : incomingFromBroker.has(id) && !outgoingToBroker.has(id)
          ? 2
          : 0;
      return { id, label: container?.label || id, layer, ...compactGroupLayout(children) };
    }).sort((left, right) => left.layer - right.layer || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));

    const byLayer = new Map();
    for (const group of groups) byLayer.set(group.layer, [...(byLayer.get(group.layer) || []), group]);
    const orderedLayers = [...byLayer.keys()].sort((left, right) => left - right);
    const layerWidths = new Map(orderedLayers.map((layer) => [layer, Math.max(...byLayer.get(layer).map((group) => group.width))]));
    const layerHeights = new Map(orderedLayers.map((layer) => [layer, byLayer.get(layer).reduce((sum, group) => sum + group.height, 0) + Math.max(0, byLayer.get(layer).length - 1) * 140]));
    const totalHeight = Math.max(0, ...layerHeights.values());
    let cursorX = 0;
    for (const layer of orderedLayers) {
      const layerWidth = layerWidths.get(layer);
      const layerGroups = byLayer.get(layer);
      const centerX = cursorX + layerWidth / 2;
      let cursorY = (totalHeight - layerHeights.get(layer)) / 2;
      for (const group of layerGroups) {
        const centerY = cursorY + group.height / 2;
        for (const [id, position] of group.positions) {
          cy.getElementById(id).position({ x: centerX + position.x, y: centerY + position.y });
        }
        cursorY += group.height + 140;
      }
      cursorX += layerWidth + 260;
    }
  };

  const visibleElements = () => cy.elements().not('.hidden');
  const fitVisible = () => {
    cy.resize();
    const visible = visibleElements();
    if (visible.length > 0) cy.fit(visible, 48);
  };
  const setViewButtons = (mode) => {
    pathViewButton.setAttribute('aria-pressed', String(mode === 'paths'));
    allViewButton.setAttribute('aria-pressed', String(mode === 'all'));
  };
  const showView = (requestedNodeIds, requestedEdgeIds, label, mode) => {
    const visibleNodeIds = withAncestors(requestedNodeIds);
    const visibleEdgeIds = new Set(documentData.graph.edges.filter((edge) =>
      requestedEdgeIds.has(edge.id) && visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    ).map((edge) => edge.id));
    cy.batch(() => {
      cy.elements().addClass('hidden').removeClass('focused faded');
      for (const id of visibleNodeIds) cy.getElementById(id).removeClass('hidden');
      for (const id of visibleEdgeIds) cy.getElementById(id).removeClass('hidden');
    });
    layoutVisible(visibleNodeIds, visibleEdgeIds);
    setViewButtons(mode);
    viewStatus.textContent = label + ' · ' + [...visibleNodeIds].filter((id) => byId.has(id)).length + ' nodes · ' + visibleEdgeIds.size + ' edges';
    requestAnimationFrame(fitVisible);
  };

  const allNodeIds = new Set(documentData.graph.nodes.map((node) => node.id));
  const allEdgeIds = new Set(documentData.graph.edges.map((edge) => edge.id));
  const pathNodeIds = new Set(documentData.graph.edges.flatMap((edge) => [edge.source, edge.target]));
  const showPaths = () => showView(pathNodeIds.size > 0 ? pathNodeIds : allNodeIds, allEdgeIds, pathNodeIds.size > 0 ? 'Conditional paths' : 'All interactions', pathNodeIds.size > 0 ? 'paths' : 'all');
  const showAll = () => showView(allNodeIds, allEdgeIds, 'All interactions', 'all');

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
        const recordEdges = documentData.graph.edges.filter((edge) => edge.correlationId === record.id);
        const recordEdgeIds = new Set(recordEdges.map((edge) => edge.id));
        const recordNodeIds = new Set([
          ...(record.producerEndpointId ? [record.producerEndpointId] : []),
          ...record.consumerEndpointIds,
          ...documentData.graph.nodes.filter((node) => node.correlationIds.includes(record.id)).map((node) => node.id),
          ...recordEdges.flatMap((edge) => [edge.source, edge.target]),
        ]);
        showView(recordNodeIds, recordEdgeIds, 'Selected correlation', 'correlation');
        const selected = cy.elements().filter((entry) => entry.data('correlationId') === record.id || (entry.data('correlationIds') || []).includes(record.id));
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
  pathViewButton.addEventListener('click', () => {
    for (const candidate of correlationList.querySelectorAll('button')) candidate.classList.remove('active');
    showPaths();
  });
  allViewButton.addEventListener('click', () => {
    for (const candidate of correlationList.querySelectorAll('button')) candidate.classList.remove('active');
    showAll();
  });
  fitButton.addEventListener('click', fitVisible);
  search.addEventListener('input', renderList);
  stateFilter.addEventListener('change', renderList);
  let resizeTimer;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(fitVisible, 100);
  });
  renderList();
  showPaths();

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
