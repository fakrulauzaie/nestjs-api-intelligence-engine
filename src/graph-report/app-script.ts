export const OFFLINE_GRAPH_REPORT_APP = String.raw`
(function () {
  'use strict';
  var report = JSON.parse(document.getElementById('api-intel-data').textContent);
  var endpoints = report.endpoints;
  var handlers = report.interactionHandlers || [];
  var selectedId = endpoints.length > 0 ? endpoints[0].endpointId : null;
  var graph = null;
  var controls = {
    search: document.getElementById('filter-search'),
    view: document.getElementById('filter-view'),
    method: document.getElementById('filter-method'),
    guard: document.getElementById('filter-guard'),
    diagnostic: document.getElementById('filter-diagnostic'),
    access: document.getElementById('filter-access'),
    policy: document.getElementById('filter-policy'),
    impact: document.getElementById('filter-impact')
  };
  var list = document.getElementById('endpoint-list');
  var resultCount = document.getElementById('result-count');
  var title = document.getElementById('endpoint-title');
  var badges = document.getElementById('endpoint-badges');
  var chips = document.getElementById('endpoint-chips');
  var limitNotice = document.getElementById('limit-notice');
  var inspector = document.getElementById('inspector-content');
  var tableBody = document.getElementById('fallback-body');
  var facts = document.getElementById('facts-grid');

  function element(name, className, text) {
    var node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addOption(select, value, label) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  Array.from(new Set(endpoints.map(function (endpoint) { return endpoint.httpMethod; })))
    .sort()
    .forEach(function (method) { addOption(controls.method, method, method); });

  function endpointAccess(endpoint) {
    if (endpoint.mutationClassification === 'unknown') return 'unknown';
    if (endpoint.dbReads.length > 0 && endpoint.dbWrites.length > 0) return 'read_write';
    if (endpoint.dbWrites.length > 0) return 'write';
    if (endpoint.dbReads.length > 0) return 'read';
    return 'none';
  }

  function endpointMatches(endpoint) {
    var search = controls.search.value.trim().toLowerCase();
    var searchable = (endpoint.httpMethod + ' ' + endpoint.path + ' ' + (endpoint.handler || '')).toLowerCase();
    if (search && searchable.indexOf(search) === -1) return false;
    if (controls.method.value && endpoint.httpMethod !== controls.method.value) return false;
    if (controls.guard.value === 'declared' && endpoint.effectiveGuardState !== 'guard_declared') return false;
    if (controls.guard.value === 'none' && endpoint.effectiveGuardState !== 'no_supported_guard_proven') return false;
    if (controls.guard.value === 'unknown' && endpoint.effectiveGuardState !== 'unknown') return false;
    if (controls.diagnostic.value === 'with' && endpoint.diagnostics.length === 0) return false;
    if (controls.diagnostic.value === 'without' && endpoint.diagnostics.length > 0) return false;
    if (controls.access.value && endpointAccess(endpoint) !== controls.access.value) return false;
    if (controls.policy.value === 'not_supplied' && endpoint.policyOutcomes.length > 0) return false;
    if (controls.policy.value && controls.policy.value !== 'not_supplied' &&
        !endpoint.policyOutcomes.some(function (outcome) { return outcome.outcome === controls.policy.value; })) return false;
    if (controls.impact.value && endpoint.impact !== controls.impact.value) return false;
    return true;
  }

  function badge(text, state) {
    return element('span', 'badge ' + state, text);
  }

  function visibleEndpoints() {
    return endpoints.filter(endpointMatches);
  }

  function renderList() {
    if (controls.view.value === 'handlers') {
      renderHandlerList();
      return;
    }
    var visible = visibleEndpoints();
    resultCount.textContent = visible.length + ' of ' + endpoints.length + ' endpoints';
    list.replaceChildren();
    if (visible.length === 0) {
      list.appendChild(element('li', 'empty', 'No endpoints match these filters.'));
      selectedId = null;
      renderEndpoint(null);
      return;
    }
    if (!visible.some(function (endpoint) { return endpoint.endpointId === selectedId; })) {
      selectedId = visible[0].endpointId;
    }
    visible.forEach(function (endpoint) {
      var item = document.createElement('li');
      var button = element('button', 'endpoint-button');
      button.type = 'button';
      button.dataset.endpointId = endpoint.endpointId;
      button.setAttribute('aria-pressed', endpoint.endpointId === selectedId ? 'true' : 'false');
      button.appendChild(badge(endpoint.httpMethod, 'method'));
      button.appendChild(badge(endpoint.selectionStatus, endpoint.selectionStatus));
      if (endpoint.impact !== 'none') button.appendChild(badge(endpoint.impact + ' impact', endpoint.impact));
      button.appendChild(element('span', 'endpoint-route', endpoint.path));
      button.addEventListener('click', function () {
        selectedId = endpoint.endpointId;
        renderList();
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    renderEndpoint(visible.find(function (endpoint) { return endpoint.endpointId === selectedId; }) || visible[0]);
  }

  function handlerMatches(handler) {
    var search = controls.search.value.trim().toLowerCase();
    var searchable = (handler.kind + ' ' + handler.target + ' ' + handler.method).toLowerCase();
    return !search || searchable.indexOf(search) !== -1;
  }

  function renderHandlerList() {
    var visible = handlers.filter(handlerMatches);
    resultCount.textContent = visible.length + ' of ' + handlers.length + ' interaction handlers';
    list.replaceChildren();
    if (visible.length === 0) {
      list.appendChild(element('li', 'empty', 'No interaction handlers match this search.'));
      selectedId = null;
      renderHandler(null);
      return;
    }
    if (!visible.some(function (handler) { return handler.handlerId === selectedId; })) {
      selectedId = visible[0].handlerId;
    }
    visible.forEach(function (handler) {
      var item = document.createElement('li');
      var button = element('button', 'endpoint-button');
      button.type = 'button';
      button.dataset.handlerId = handler.handlerId;
      button.setAttribute('aria-pressed', handler.handlerId === selectedId ? 'true' : 'false');
      button.appendChild(badge(handler.kind.replaceAll('_', ' '), 'method'));
      button.appendChild(badge(handler.registrationState, handler.registrationState === 'proven_registered' ? 'resolved' : 'unknown'));
      button.appendChild(element('span', 'endpoint-route', handler.target));
      button.addEventListener('click', function () {
        selectedId = handler.handlerId;
        renderList();
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    renderHandler(visible.find(function (handler) { return handler.handlerId === selectedId; }) || visible[0]);
  }

  function appendChip(container, text) {
    container.appendChild(element('span', 'chip', text));
  }

  function evidenceMap(record) {
    return new Map(record.scene.evidence.map(function (evidence) { return [evidence.id, evidence]; }));
  }

  function showEvidence(record, heading, evidenceIds) {
    inspector.replaceChildren();
    inspector.appendChild(element('h3', '', heading));
    var byId = evidenceMap(record);
    var records = evidenceIds.map(function (id) { return byId.get(id); }).filter(Boolean);
    if (records.length === 0) {
      inspector.appendChild(element('p', 'inspector-empty', 'No retained evidence for this item. Check the endpoint facts and omitted-count notice for explicit limits.'));
      return;
    }
    records.forEach(function (evidence) {
      var card = element('section', 'evidence-card');
      card.appendChild(badge(evidence.role, 'none'));
      var location = element('code', '', evidence.path + ':' + evidence.startLine + ':' + evidence.startColumn + '–' + evidence.endLine + ':' + evidence.endColumn);
      location.title = 'Repository-relative, copyable source location';
      card.appendChild(location);
      if (evidence.snippet !== null) card.appendChild(element('pre', '', evidence.snippet));
      inspector.appendChild(card);
    });
  }

  function renderGraph(record, rootId, rootLabel) {
    if (graph) graph.destroy();
    var elements = record.scene.nodes.map(function (node) {
      var suffix = node.uncertainty === 'resolved' ? '' : ' · ' + node.uncertainty;
      return { data: { id: node.id, label: node.label + suffix, kind: node.kind, uncertainty: node.uncertainty, impact: node.impact, evidenceIds: node.evidenceIds } };
    }).concat(record.scene.edges.map(function (edge) {
      var suffix = edge.uncertainty === 'resolved' ? '' : ' · ' + edge.uncertainty;
      return { data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label + suffix, kind: edge.kind, uncertainty: edge.uncertainty, impact: edge.impact, evidenceIds: edge.evidenceIds } };
    }));
    graph = cytoscape({
      container: document.getElementById('graph'),
      elements: elements,
      minZoom: 0.25,
      maxZoom: 2.5,
      layout: { name: 'preset' },
      style: [
        { selector: 'node', style: { 'label': 'data(label)', 'font-size': 10, 'text-wrap': 'wrap', 'text-max-width': 130, 'text-valign': 'bottom', 'text-margin-y': 7, 'background-color': '#52647f', 'border-width': 2, 'border-color': '#334057', 'width': 30, 'height': 30 } },
        { selector: 'node[kind="endpoint"]', style: { 'shape': 'round-rectangle', 'width': 48, 'height': 32, 'background-color': '#2457d6' } },
        { selector: 'node[kind="table"]', style: { 'shape': 'barrel', 'background-color': '#18794e' } },
        { selector: 'node[kind="guard"]', style: { 'shape': 'diamond', 'background-color': '#9a6700' } },
        { selector: 'node[kind="request_origin"], node[kind="request_parameter"]', style: { 'shape': 'hexagon', 'background-color': '#6f42c1' } },
        { selector: 'node[kind="entity_column"]', style: { 'shape': 'round-rectangle', 'background-color': '#147d92' } },
        { selector: 'node[kind="interaction"]', style: { 'shape': 'tag', 'background-color': '#b54708' } },
        { selector: 'node[kind="interaction_handler"]', style: { 'shape': 'round-diamond', 'background-color': '#8f3f71' } },
        { selector: 'node[kind="external_target"]', style: { 'shape': 'round-rectangle', 'background-color': '#086788', 'width': 42 } },
        { selector: 'node[kind="boundary"]', style: { 'shape': 'cut-rectangle', 'background-color': '#667085', 'border-style': 'dashed' } },
        { selector: 'node[kind="gap"]', style: { 'shape': 'vee', 'background-color': '#b42318' } },
        { selector: 'node[uncertainty != "resolved"]', style: { 'border-style': 'dashed', 'border-width': 4 } },
        { selector: 'node[impact="direct"]', style: { 'border-color': '#b42318', 'border-width': 6 } },
        { selector: 'node[impact="potential"]', style: { 'border-color': '#d19a00', 'border-width': 6 } },
        { selector: 'node[impact="unknown"]', style: { 'border-color': '#6f42c1', 'border-width': 6, 'border-style': 'dotted' } },
        { selector: 'edge', style: { 'label': 'data(label)', 'font-size': 8, 'text-background-color': '#ffffff', 'text-background-opacity': 0.9, 'text-background-padding': 2, 'curve-style': 'bezier', 'line-color': '#93a1b5', 'target-arrow-color': '#93a1b5', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'width': 2 } },
        { selector: 'edge[kind="provenance"]', style: { 'line-style': 'dashed', 'line-color': '#6f42c1', 'target-arrow-color': '#6f42c1' } },
        { selector: 'edge[kind="interaction"]', style: { 'line-style': 'dashed', 'line-color': '#b54708', 'target-arrow-color': '#b54708' } },
        { selector: 'edge[uncertainty != "resolved"]', style: { 'line-style': 'dotted', 'line-color': '#b42318', 'target-arrow-color': '#b42318' } },
        { selector: 'edge[impact="direct"]', style: { 'line-color': '#b42318', 'target-arrow-color': '#b42318', 'width': 5 } },
        { selector: 'edge[impact="potential"]', style: { 'line-color': '#d19a00', 'target-arrow-color': '#d19a00', 'width': 5 } },
        { selector: '.dim', style: { 'opacity': 0.14 } },
        { selector: '.focus', style: { 'opacity': 1, 'z-index': 20 } }
      ]
    });
    graph.layout({ name: 'breadthfirst', directed: true, roots: graph.getElementById(rootId), padding: 28, spacingFactor: 1.15 }).run();
    graph.on('tap', 'node', function (event) {
      graph.elements().removeClass('dim focus');
      var target = event.target;
      var path = target.predecessors().union(target.successors()).union(target);
      graph.elements().not(path).addClass('dim');
      path.addClass('focus');
      var handlerView = handlers.find(function (handler) { return handler.handlerId === target.id(); });
      if (handlerView && (controls.view.value !== 'handlers' || selectedId !== handlerView.handlerId)) {
        controls.view.value = 'handlers';
        selectedId = handlerView.handlerId;
        renderList();
        return;
      }
      var producerView = endpoints.find(function (endpoint) {
        return endpoint.scene.nodes.some(function (node) { return node.id === target.id() && node.kind === 'interaction'; });
      });
      if (producerView && controls.view.value === 'handlers' && target.data('kind') === 'interaction') {
        controls.view.value = 'endpoints';
        selectedId = producerView.endpointId;
        renderList();
        return;
      }
      showEvidence(record, target.data('label'), target.data('evidenceIds') || []);
    });
    graph.on('tap', 'edge', function (event) {
      graph.elements().removeClass('dim focus');
      var target = event.target;
      var path = target.source().predecessors().union(target.target().successors()).union(target).union(target.source()).union(target.target());
      graph.elements().not(path).addClass('dim');
      path.addClass('focus');
      showEvidence(record, target.data('label'), target.data('evidenceIds') || []);
    });
    graph.on('tap', function (event) {
      if (event.target === graph) {
        graph.elements().removeClass('dim focus');
        var root = record.scene.nodes.find(function (node) { return node.id === rootId; });
        showEvidence(record, rootLabel, root ? root.evidenceIds : []);
      }
    });
  }

  function addFactSection(container, heading, values, emptyText) {
    var section = document.createElement('section');
    section.appendChild(element('h3', '', heading));
    var ul = document.createElement('ul');
    (values.length > 0 ? values : [emptyText]).forEach(function (value) { ul.appendChild(element('li', '', value)); });
    section.appendChild(ul);
    container.appendChild(section);
  }

  function renderFacts(endpoint) {
    facts.replaceChildren();
    addFactSection(facts, 'Guards', endpoint.guards.length > 0 ? endpoint.guards : [endpoint.effectiveGuardState], 'No supported guard proven');
    addFactSection(facts, 'Synchronous data access', endpoint.dbReads.map(function (name) { return 'READ ' + name; }).concat(endpoint.dbWrites.map(function (name) { return 'WRITE ' + name; })), endpoint.mutationClassification === 'unknown' ? 'Synchronous persistence state unknown' : 'No synchronous table access proven');
    addFactSection(facts, 'Local causal effects', (endpoint.localCausalEffects || []).map(function (effect) { return effect.direction + ' ' + effect.table + ' (' + effect.causalClass + ')'; }), 'No local causal table effect proven');
    addFactSection(facts, 'Distributed conditional effects', (endpoint.distributedConditionalEffects || []).map(function (effect) { return effect.direction + ' ' + effect.table + ' (' + effect.causalClass + ')'; }), 'No distributed conditional table effect proven');
    addFactSection(facts, 'Diagnostics', endpoint.diagnostics.map(function (item) { return item.code + ' — ' + item.message; }), 'No endpoint-relevant diagnostics');
    addFactSection(facts, 'Policy', endpoint.policyOutcomes.map(function (item) { return item.ruleId + ': ' + item.outcome + ' (' + item.severity + ')'; }), report.policy.state === 'supplied' ? 'No endpoint-specific outcome' : 'Policy results not supplied');
    addFactSection(facts, 'Impact', endpoint.impactReasons.map(function (item) { return item.category + ': ' + item.reasonCode + ' — ' + item.subject; }), report.impact.state === 'supplied' ? 'No impact found' : 'Impact results not supplied');
    addFactSection(facts, 'Handler', [endpoint.handler || 'Unresolved handler'], 'Unresolved handler');
  }

  function renderFallback(endpoint) {
    tableBody.replaceChildren();
    endpoint.scene.nodes.forEach(function (node) {
      var row = document.createElement('tr');
      ['node', node.kind, node.label, node.uncertainty, node.impact, String(node.evidenceIds.length)].forEach(function (value) { row.appendChild(element('td', '', value)); });
      tableBody.appendChild(row);
    });
    endpoint.scene.edges.forEach(function (edge) {
      var row = document.createElement('tr');
      ['edge', edge.kind, edge.label + ' (' + edge.source + ' → ' + edge.target + ')', edge.uncertainty, edge.impact, String(edge.evidenceIds.length)].forEach(function (value) { row.appendChild(element('td', '', value)); });
      tableBody.appendChild(row);
    });
  }

  function renderEndpoint(endpoint) {
    if (!endpoint) {
      title.textContent = endpoints.length === 0 ? 'No endpoints in this analysis' : 'No matching endpoint';
      badges.replaceChildren();
      chips.replaceChildren();
      facts.replaceChildren();
      tableBody.replaceChildren();
      inspector.replaceChildren(element('p', 'inspector-empty', 'Select an endpoint to inspect evidence.'));
      limitNotice.hidden = true;
      if (graph) { graph.destroy(); graph = null; }
      document.getElementById('graph').replaceChildren();
      return;
    }
    title.textContent = endpoint.httpMethod + ' ' + endpoint.path;
    badges.replaceChildren(badge(endpoint.selectionStatus, endpoint.selectionStatus), badge(endpoint.impact + ' impact', endpoint.impact));
    chips.replaceChildren();
    appendChip(chips, endpoint.handler || 'handler unresolved');
    appendChip(chips, endpoint.effectiveGuardState);
    appendChip(chips, endpoint.mutationClassification);
    appendChip(chips, endpoint.scene.nodes.length + ' nodes · ' + endpoint.scene.edges.length + ' edges');
    var omitted = endpoint.scene.omitted;
    limitNotice.hidden = omitted.nodes + omitted.edges + omitted.evidence === 0;
    limitNotice.textContent = 'Display limits omitted ' + omitted.nodes + ' nodes, ' + omitted.edges + ' edges, and ' + omitted.evidence + ' evidence records for this endpoint. The counts are explicit; no omitted fact is inferred as absent.';
    renderGraph(endpoint, endpoint.endpointId, 'Endpoint evidence');
    renderFacts(endpoint);
    renderFallback(endpoint);
    var root = endpoint.scene.nodes.find(function (node) { return node.id === endpoint.endpointId; });
    showEvidence(endpoint, 'Endpoint evidence', root ? root.evidenceIds : []);
  }

  function renderHandler(handler) {
    if (!handler) {
      title.textContent = handlers.length === 0 ? 'No interaction handlers in this analysis' : 'No matching interaction handler';
      badges.replaceChildren();
      chips.replaceChildren();
      facts.replaceChildren();
      tableBody.replaceChildren();
      inspector.replaceChildren(element('p', 'inspector-empty', 'Select an interaction handler to inspect evidence.'));
      limitNotice.hidden = true;
      if (graph) { graph.destroy(); graph = null; }
      document.getElementById('graph').replaceChildren();
      return;
    }
    title.textContent = handler.kind.replaceAll('_', ' ') + ' · ' + handler.target;
    badges.replaceChildren(badge(handler.registrationState, handler.registrationState === 'proven_registered' ? 'resolved' : 'unknown'), badge(handler.causalClass, handler.causalClass === 'unknown' ? 'unknown' : 'potential'));
    chips.replaceChildren();
    appendChip(chips, handler.method);
    appendChip(chips, handler.boundary);
    appendChip(chips, handler.scene.nodes.length + ' nodes · ' + handler.scene.edges.length + ' edges');
    var omitted = handler.scene.omitted;
    limitNotice.hidden = omitted.nodes + omitted.edges + omitted.evidence === 0;
    limitNotice.textContent = 'Display limits omitted ' + omitted.nodes + ' nodes, ' + omitted.edges + ' edges, and ' + omitted.evidence + ' evidence records for this handler. The counts are explicit; no omitted fact is inferred as absent.';
    renderGraph(handler, handler.handlerId, 'Handler evidence');
    facts.replaceChildren();
    addFactSection(facts, 'Handler data access', handler.dbReads.map(function (name) { return 'READ ' + name; }).concat(handler.dbWrites.map(function (name) { return 'WRITE ' + name; })), 'No table access proven');
    addFactSection(facts, 'Boundary semantics', [handler.boundary + ' · ' + handler.causalClass], 'Boundary unknown');
    addFactSection(facts, 'Local producer candidates', handler.producerInteractionIds, 'No in-repository producer candidate');
    addFactSection(facts, 'Diagnostics', handler.diagnostics.map(function (item) { return item.code + ' — ' + item.message; }), 'No handler-relevant diagnostics');
    renderFallback(handler);
    var root = handler.scene.nodes.find(function (node) { return node.id === handler.handlerId; });
    showEvidence(handler, 'Handler evidence', root ? root.evidenceIds : []);
  }

  Object.keys(controls).forEach(function (key) {
    controls[key].addEventListener(key === 'search' ? 'input' : 'change', renderList);
  });
  list.addEventListener('keydown', function (event) {
    var buttons = Array.from(list.querySelectorAll('button'));
    var current = buttons.indexOf(document.activeElement);
    var next = current;
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    if (buttons[next]) buttons[next].focus();
  });
  renderList();
})();
`;
