export const OFFLINE_GRAPH_REPORT_APP = String.raw`
(function () {
  'use strict';
  var report = JSON.parse(document.getElementById('api-intel-data').textContent);
  var endpoints = report.endpoints;
  var handlers = report.interactionHandlers || [];
  var architecture = report.architecture || null;
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
    impact: document.getElementById('filter-impact'),
    metric: document.getElementById('filter-metric')
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
  var graphElement = document.getElementById('graph');
  var relayoutButton = document.getElementById('graph-relayout');
  var fitButton = document.getElementById('graph-fit');
  var layoutStatus = document.getElementById('graph-layout-status');
  var persistentLayoutStatus = 'No graph selected';

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
  if (architecture) {
    architecture.metricLegends.forEach(function (legend) {
      if (legend.metric !== 'supported_root_reach_count') {
        addOption(controls.metric, legend.metric, legend.metric.replaceAll('_', ' '));
      }
    });
  }

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
    if (controls.view.value === 'architecture') {
      renderArchitectureList();
      return;
    }
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

  function renderArchitectureList() {
    list.replaceChildren();
    if (!architecture) {
      resultCount.textContent = 'Architecture overview unavailable for this graph schema';
      renderArchitecture(null);
      return;
    }
    resultCount.textContent = architecture.summary.metricRecords + ' metric records';
    selectedId = architecture.rootId;
    var item = document.createElement('li');
    var button = element('button', 'endpoint-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'true');
    button.appendChild(badge('repository', 'method'));
    button.appendChild(badge('bounded metrics', 'resolved'));
    button.appendChild(element('span', 'endpoint-route', 'Architecture overview'));
    item.appendChild(button);
    list.appendChild(item);
    renderArchitecture(architecture);
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
    if (heading.indexOf('verified wrapper critical section') === 0 || heading.indexOf('static wrapper callback projection') === 0) {
      inspector.appendChild(element('p', '', 'These bounded source locations collectively prove an exact inline callback path to package-proven Redlock. This is static conditional evidence, not proof of acquisition or callback execution.'));
    }
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

  function clearGraph() {
    if (graph) {
      graph.destroy();
      graph = null;
    }
    graphElement.replaceChildren();
    graphElement.style.minHeight = '';
    relayoutButton.disabled = true;
    fitButton.disabled = true;
    relayoutButton.onclick = null;
    fitButton.onclick = null;
    setLayoutStatus('No graph selected');
  }

  function setLayoutStatus(message) {
    persistentLayoutStatus = message;
    layoutStatus.textContent = message;
  }

  function fitGraph() {
    if (!graph || graph.elements().length === 0) return;
    graph.resize();
    graph.fit(graph.elements(), 42);
    setLayoutStatus('Fit all · ' + Math.round(graph.zoom() * 100) + '% zoom');
  }

  function methodNameParts(label) {
    var separator = label.lastIndexOf('.');
    if (separator <= 0 || separator === label.length - 1) return null;
    return { owner: label.slice(0, separator), member: label.slice(separator + 1) };
  }

  function displayLabelForNode(node, scene, architectureMode) {
    if (architectureMode || node.kind !== 'method') return node.label;
    var parts = methodNameParts(node.label);
    if (!parts) return node.label;
    var nodesById = new Map(scene.nodes.map(function (candidate) { return [candidate.id, candidate]; }));
    var callers = scene.edges
      .filter(function (edge) { return edge.target === node.id; })
      .map(function (edge) { return nodesById.get(edge.source); })
      .filter(function (candidate) { return candidate && candidate.kind === 'method'; });
    if (callers.length === 0) return node.label;
    var sameOwner = callers.every(function (caller) {
      var callerParts = methodNameParts(caller.label);
      return callerParts && callerParts.owner === parts.owner;
    });
    return sameOwner ? '.' + parts.member + '()' : node.label;
  }

  function nodeLayoutMetrics(node) {
    var bounds = node.boundingBox({ includeLabels: true, includeOverlays: false });
    var position = node.position();
    return {
      node: node,
      width: bounds.w,
      height: bounds.h,
      topOffset: position.y - bounds.y1,
      bottomOffset: bounds.y2 - position.y
    };
  }

  function directedDepths(rootId) {
    var depths = new Map();
    var queue = [];
    var root = graph.getElementById(rootId);
    if (root.length > 0) {
      depths.set(rootId, 0);
      queue.push(root);
    }
    for (var index = 0; index < queue.length; index += 1) {
      var source = queue[index];
      var nextDepth = depths.get(source.id()) + 1;
      source.outgoers('edge').forEach(function (edge) {
        var target = edge.target();
        if (!depths.has(target.id())) {
          depths.set(target.id(), nextDepth);
          queue.push(target);
        }
      });
    }
    var fallbackDepth = depths.size === 0 ? 0 : Math.max.apply(null, Array.from(depths.values())) + 1;
    graph.nodes().forEach(function (node) {
      if (!depths.has(node.id())) depths.set(node.id(), fallbackDepth);
    });
    return depths;
  }

  function orderedDepthLayers(rootId) {
    var depths = directedDepths(rootId);
    var layers = new Map();
    graph.nodes().forEach(function (node) {
      var depth = depths.get(node.id());
      if (!layers.has(depth)) layers.set(depth, []);
      layers.get(depth).push(node);
    });
    var priorOrder = new Map();
    return Array.from(layers.keys()).sort(function (left, right) { return left - right; }).map(function (depth) {
      var nodes = layers.get(depth);
      nodes.sort(function (left, right) {
        function barycenter(node) {
          var positions = node.incomers('edge').map(function (edge) {
            var sourceOrder = priorOrder.get(edge.source().id());
            return sourceOrder === undefined ? null : sourceOrder;
          }).filter(function (value) { return value !== null; });
          if (positions.length === 0) return Number.POSITIVE_INFINITY;
          return positions.reduce(function (sum, value) { return sum + value; }, 0) / positions.length;
        }
        var leftCenter = barycenter(left);
        var rightCenter = barycenter(right);
        if (Number.isFinite(leftCenter) && !Number.isFinite(rightCenter)) return -1;
        if (!Number.isFinite(leftCenter) && Number.isFinite(rightCenter)) return 1;
        if (leftCenter !== rightCenter) return leftCenter - rightCenter;
        return String(left.data('label')).localeCompare(String(right.data('label'))) || left.id().localeCompare(right.id());
      });
      nodes.forEach(function (node, index) { priorOrder.set(node.id(), index); });
      return nodes;
    });
  }

  function laneHeight(items, rowGap) {
    return items.reduce(function (height, item, index) {
      return height + item.height + (index === 0 ? 0 : rowGap);
    }, 0);
  }

  function planFoldedLayer(nodes, heightCapacity) {
    var rowGap = 24;
    var metrics = nodes.map(nodeLayoutMetrics);
    var unfoldedHeight = laneHeight(metrics, rowGap);
    var laneCount = Math.min(3, Math.max(1, Math.ceil(unfoldedHeight / heightCapacity)));
    var rowsPerLane = Math.ceil(metrics.length / laneCount);
    var lanes = [];
    for (var laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      var items = metrics.slice(laneIndex * rowsPerLane, (laneIndex + 1) * rowsPerLane);
      if (items.length > 0) {
        lanes.push({
          items: items,
          width: Math.max.apply(null, items.map(function (item) { return item.width; })),
          height: laneHeight(items, rowGap)
        });
      }
    }
    return {
      lanes: lanes,
      width: lanes.reduce(function (width, lane, index) { return width + lane.width + (index === 0 ? 0 : 44); }, 0),
      height: Math.max.apply(null, lanes.map(function (lane) { return lane.height; })),
      folded: lanes.length > 1,
      rowGap: rowGap
    };
  }

  function applyFoldedLayerLayout(rootId) {
    var heightCapacity = Math.max(600, (Math.min(900, Math.max(520, window.innerHeight - 180)) - 84) / 0.68);
    var plans = orderedDepthLayers(rootId).map(function (nodes) { return planFoldedLayer(nodes, heightCapacity); });
    var maxHeight = Math.max.apply(null, plans.map(function (plan) { return plan.height; }));
    var nextX = 42;
    var foldedLayers = 0;
    graph.batch(function () {
      plans.forEach(function (plan) {
        if (plan.folded) foldedLayers += 1;
        var laneX = nextX;
        plan.lanes.forEach(function (lane) {
          var currentY = (maxHeight - lane.height) / 2 + 42;
          lane.items.forEach(function (item) {
            item.node.position({
              x: laneX + lane.width / 2,
              y: currentY + item.topOffset
            });
            currentY += item.height + plan.rowGap;
          });
          laneX += lane.width + 44;
        });
        nextX += plan.width + 92;
      });
    });
    return foldedLayers;
  }

  function fitInitialGraph(directionLabel, foldedLayers) {
    graph.resize();
    graph.fit(graph.elements(), 42);
    var fittedZoom = graph.zoom();
    if (fittedZoom > 1) {
      graph.zoom(1);
      graph.center(graph.elements());
    }
    var actualZoom = graph.zoom();
    var detail = foldedLayers > 0 ? ' · ' + foldedLayers + ' folded layer' + (foldedLayers === 1 ? '' : 's') : '';
    if (actualZoom < 0.62) {
      setLayoutStatus(directionLabel + detail + ' · complete overview at ' + Math.round(actualZoom * 100) + '%; select a node to fit its path');
    } else {
      setLayoutStatus(directionLabel + detail + ' · complete fit at ' + Math.round(actualZoom * 100) + '%');
    }
  }

  function fitFocusedPath(path) {
    if (!graph || path.length === 0) return;
    graph.fit(path, 58);
    if (graph.zoom() > 1.25) {
      graph.zoom(1.25);
      graph.center(path);
    }
    setLayoutStatus('Selected causal path · ' + Math.round(graph.zoom() * 100) + '% zoom; Reset layout restores the complete view');
  }

  function applyReadableLayout(rootId, architectureMode) {
    if (!graph || graph.elements().length === 0) return;
    graphElement.style.minHeight = '520px';
    graph.resize();
    var foldedLayers = 0;
    if (architectureMode) {
      graph.layout({
        name: 'breadthfirst',
        directed: true,
        roots: graph.getElementById(rootId),
        direction: 'downward',
        nodeDimensionsIncludeLabels: true,
        padding: 42,
        spacingFactor: 1.15,
        fit: false,
        depthSort: function (left, right) {
          return String(left.data('label')).localeCompare(String(right.data('label'))) || left.id().localeCompare(right.id());
        }
      }).run();
    } else {
      foldedLayers = applyFoldedLayerLayout(rootId);
    }
    var bounds = graph.elements().boundingBox({ includeLabels: true });
    var heightLimit = architectureMode ? 960 : 900;
    var desiredHeight = Math.min(heightLimit, Math.max(520, Math.ceil(bounds.h + 96)));
    graphElement.style.minHeight = desiredHeight + 'px';
    graph.resize();
    fitInitialGraph(architectureMode ? 'Top-down architecture' : 'Adaptive left-to-right flow', foldedLayers);
  }

  function renderGraph(record, rootId, rootLabel, architectureMode) {
    if (graph) graph.destroy();
    var elements = record.scene.nodes.map(function (node) {
      var suffix = node.uncertainty === 'resolved' ? '' : ' · ' + node.uncertainty;
      var metric = (node.architectureMetrics || []).find(function (candidate) { return candidate.metric === controls.metric.value; });
      var metricSuffix = architectureMode && metric ? ' · ' + metric.value : '';
      var data = { id: node.id, label: displayLabelForNode(node, record.scene, Boolean(architectureMode)) + suffix + metricSuffix, fullLabel: node.label + suffix + metricSuffix, kind: node.kind, uncertainty: node.uncertainty, impact: node.impact, evidenceIds: node.evidenceIds, heat: metric ? metric.heat : 'zero', metricValue: metric ? metric.value : null, reachability: node.architectureReachability || null, ownership: node.moduleOwnership ? node.moduleOwnership.state : null };
      if (node.parentId) data.parent = node.parentId;
      return { data: data };
    }).concat(record.scene.edges.map(function (edge) {
      var suffix = edge.uncertainty === 'resolved' ? '' : ' · ' + edge.uncertainty;
      return { data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label + suffix, kind: edge.kind, uncertainty: edge.uncertainty, impact: edge.impact, evidenceIds: edge.evidenceIds } };
    }));
    graph = cytoscape({
      container: graphElement,
      elements: elements,
      maxZoom: 2.5,
      layout: { name: 'preset' },
      style: [
        { selector: 'node', style: { 'label': 'data(label)', 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': 150, 'text-valign': 'bottom', 'text-margin-y': 8, 'text-background-color': '#fbfcfe', 'text-background-opacity': 0.92, 'text-background-padding': 2, 'background-color': '#52647f', 'border-width': 2, 'border-color': '#334057', 'width': 30, 'height': 30 } },
        { selector: 'node[kind="endpoint"]', style: { 'shape': 'round-rectangle', 'width': 48, 'height': 32, 'background-color': '#2457d6' } },
        { selector: 'node[kind="repository"]', style: { 'shape': 'round-rectangle', 'width': 64, 'height': 38, 'background-color': '#172033' } },
        { selector: 'node[kind="module"]', style: { 'shape': 'round-rectangle', 'background-color': '#dbe5f7', 'border-color': '#2457d6', 'padding': 18, 'text-valign': 'top', 'text-margin-y': -8 } },
        { selector: 'node[kind="class"]', style: { 'shape': 'round-rectangle', 'background-color': '#eef2f7', 'border-color': '#637087', 'padding': 12, 'text-valign': 'top', 'text-margin-y': -7 } },
        { selector: 'node[kind="table"]', style: { 'shape': 'barrel', 'background-color': '#18794e' } },
        { selector: 'node[kind="resource_access"]', style: { 'shape': 'hexagon', 'background-color': '#0f766e' } },
        { selector: 'node[kind="critical_section"]', style: { 'shape': 'round-rectangle', 'background-color': '#6d28d9', 'border-color': '#4c1d95', 'border-style': 'double' } },
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
        { selector: 'node[heat="low"]', style: { 'background-color': '#7aa2e8' } },
        { selector: 'node[heat="medium"]', style: { 'background-color': '#d19a00' } },
        { selector: 'node[heat="high"]', style: { 'background-color': '#d06413' } },
        { selector: 'node[heat="very_high"]', style: { 'background-color': '#b42318' } },
        { selector: 'edge', style: { 'label': '', 'font-size': 8, 'text-background-color': '#ffffff', 'text-background-opacity': 0.92, 'text-background-padding': 2, 'curve-style': 'bezier', 'line-color': '#93a1b5', 'target-arrow-color': '#93a1b5', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'width': 2 } },
        { selector: 'edge[kind="provenance"]', style: { 'line-style': 'dashed', 'line-color': '#6f42c1', 'target-arrow-color': '#6f42c1' } },
        { selector: 'edge[kind="interaction"]', style: { 'line-style': 'dashed', 'line-color': '#b54708', 'target-arrow-color': '#b54708' } },
        { selector: 'edge[kind="architecture"]', style: { 'line-color': '#b9c3d3', 'target-arrow-color': '#b9c3d3', 'width': 1 } },
        { selector: 'edge[uncertainty != "resolved"]', style: { 'line-style': 'dotted', 'line-color': '#b42318', 'target-arrow-color': '#b42318' } },
        { selector: 'edge[impact="direct"]', style: { 'line-color': '#b42318', 'target-arrow-color': '#b42318', 'width': 5 } },
        { selector: 'edge[impact="potential"]', style: { 'line-color': '#d19a00', 'target-arrow-color': '#d19a00', 'width': 5 } },
        { selector: 'edge[uncertainty != "resolved"], edge[impact != "none"], edge.focus, edge.edge-label-visible', style: { 'label': 'data(label)' } },
        { selector: '.dim', style: { 'opacity': 0.14 } },
        { selector: '.focus', style: { 'opacity': 1, 'z-index': 20 } }
      ]
    });
    relayoutButton.disabled = false;
    fitButton.disabled = false;
    relayoutButton.onclick = function () { applyReadableLayout(rootId, Boolean(architectureMode)); };
    fitButton.onclick = fitGraph;
    applyReadableLayout(rootId, Boolean(architectureMode));
    graph.on('mouseover', 'edge', function (event) { event.target.addClass('edge-label-visible'); });
    graph.on('mouseout', 'edge', function (event) { event.target.removeClass('edge-label-visible'); });
    graph.on('mouseover', 'node', function (event) { layoutStatus.textContent = event.target.data('fullLabel'); });
    graph.on('mouseout', 'node', function () { layoutStatus.textContent = persistentLayoutStatus; });
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
      var endpointView = endpoints.find(function (endpoint) { return endpoint.endpointId === target.id(); });
      if (endpointView && controls.view.value === 'architecture') {
        controls.view.value = 'endpoints';
        selectedId = endpointView.endpointId;
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
      fitFocusedPath(path);
      showEvidence(record, target.data('fullLabel'), target.data('evidenceIds') || []);
    });
    graph.on('tap', 'edge', function (event) {
      graph.elements().removeClass('dim focus');
      var target = event.target;
      var path = target.source().predecessors().union(target.target().successors()).union(target).union(target.source()).union(target.target());
      graph.elements().not(path).addClass('dim');
      path.addClass('focus');
      fitFocusedPath(path);
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
    addFactSection(facts, 'Authorization metadata', (endpoint.authorizationRequirements || []).map(function (requirement) {
      var shape = requirement.valueShape.kind === 'scalar'
        ? requirement.valueShape.scalarType
        : requirement.valueShape.kind === 'array'
          ? 'array[' + requirement.valueShape.itemCount + ']'
          : requirement.valueShape.kind === 'object'
            ? 'object{' + requirement.valueShape.keys.join(', ') + '}'
            : 'dynamic shape';
      return requirement.scope + ': ' + requirement.metadataKey + ' — ' + requirement.enforcementState + (requirement.guardName ? ' via ' + requirement.guardName : '') + ' (redacted ' + shape + ')';
    }), endpoint.authorizationRequirements ? 'No authorization metadata proven' : 'Authorization facts unavailable');
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
      var metric = (node.architectureMetrics || []).find(function (candidate) { return candidate.metric === controls.metric.value; });
      var label = node.label + (metric ? ' · ' + metric.metric + '=' + metric.value + ' [' + metric.heat + ']' : '');
      var certainty = node.uncertainty + (node.architectureReachability ? ' · ' + node.architectureReachability : '') + (node.moduleOwnership ? ' · ' + node.moduleOwnership.state : '');
      ['node', node.kind, label, certainty, node.impact, String(node.evidenceIds.length)].forEach(function (value) { row.appendChild(element('td', '', value)); });
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
      clearGraph();
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
      clearGraph();
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

  function renderArchitecture(overview) {
    if (!overview) {
      title.textContent = 'Architecture overview unavailable';
      badges.replaceChildren();
      chips.replaceChildren();
      facts.replaceChildren();
      tableBody.replaceChildren();
      limitNotice.hidden = true;
      clearGraph();
      return;
    }
    title.textContent = 'Repository architecture overview';
    badges.replaceChildren(badge('derived static view', 'resolved'));
    chips.replaceChildren();
    appendChip(chips, overview.supportedRoots.endpoints + ' endpoint roots');
    appendChip(chips, overview.supportedRoots.interactionHandlers + ' handler roots');
    appendChip(chips, overview.scene.nodes.length + ' nodes · ' + overview.scene.edges.length + ' edges');
    var omitted = overview.scene.omitted;
    limitNotice.hidden = omitted.nodes + omitted.edges + omitted.evidence === 0;
    limitNotice.textContent = 'Display limits omitted ' + omitted.nodes + ' nodes, ' + omitted.edges + ' edges, and ' + omitted.evidence + ' evidence records from this architecture scene. Complete numeric records remain in the report data.';
    renderGraph(overview, overview.rootId, 'Architecture overview', true);
    facts.replaceChildren();
    addFactSection(facts, 'Supported static roots', [overview.supportedRoots.endpoints + ' endpoints', overview.supportedRoots.interactionHandlers + ' interaction handlers (' + overview.rootCapabilities.interactionHandlers + ')'], 'No supported roots');
    addFactSection(facts, 'Selected heat legend', overview.metricLegends.filter(function (legend) { return legend.metric === controls.metric.value; }).map(function (legend) { return legend.metric.replaceAll('_', ' ') + ': p50 ' + legend.percentiles.p50 + ' · p75 ' + legend.percentiles.p75 + ' · p90 ' + legend.percentiles.p90 + ' · max ' + legend.maximum + ' (' + legend.eligibleRecords + ' records)'; }), 'Metric unavailable');
    addFactSection(facts, 'Reachability', [overview.summary.notReachedFromSupportedRoots + ' of ' + overview.summary.metricRecords + ' records: not_reached_from_supported_roots'], 'No metric records');
    addFactSection(facts, 'Module declarations', [overview.summary.uniquelyOwnedClasses + ' uniquely owned classes', overview.summary.multipleOwnerClasses + ' multiple-owner classes', overview.summary.ownershipUnknownClasses + ' unknown/unavailable class ownership'], 'Module ownership unavailable');
    addFactSection(facts, 'Interpretation boundary', ['Reach means inclusion in a supported static endpoint or handler trace. It does not prove runtime execution. Zero reach is not dead code and is never a safe-to-delete conclusion.'], 'No interpretation statement');
    renderFallback(overview);
    showEvidence(overview, 'Architecture overview', []);
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
