(function () {
  const API_BASE = '/layout-api';

  function element(id) {
    return document.getElementById(id);
  }

  function notify(message, warning) {
    if (typeof show_instant_notification !== 'function') return;
    var msg;
    if (typeof message === 'string') {
      msg = message;
    } else if (Array.isArray(message)) {
      msg = '(' + message.length + ' items)';
    } else if (message !== null && typeof message === 'object') {
      msg = message.msg || message.message || message.detail || JSON.stringify(message).slice(0, 120);
    } else {
      msg = String(message || '');
    }
    show_instant_notification(msg, 3500, !!warning);
  }

  function currentGraphTime() {
    const select = element('dynamic_graph_time') || element('graph_time');
    if (!select || select.selectedIndex < 0) return '';
    return select.options[select.selectedIndex].value || '';
  }

  function currentGraphId() {
    return typeof graph_id !== 'undefined' && graph_id !== null ? String(graph_id) : '';
  }

  function currentViewMode() {
    return typeof _viewMode !== 'undefined' && _viewMode ? _viewMode : 'enriched';
  }

  function currentContext() {
    return {
      graphId: currentGraphId(),
      graphTime: currentGraphTime(),
      viewMode: currentViewMode()
    };
  }

  function sameContext(a, b) {
    return !!a && !!b &&
      String(a.graphId || '') === String(b.graphId || '') &&
      String(a.graphTime || '') === String(b.graphTime || '') &&
      String(a.viewMode || '') === String(b.viewMode || '');
  }

  function canPersist() {
    return typeof network !== 'undefined' && network && typeof nodes !== 'undefined' && nodes && currentGraphId() && currentGraphTime();
  }

  function selectedNodeId() {
    if (!canPersist() || typeof network.getSelectedNodes !== 'function') return null;
    const selected = network.getSelectedNodes();
    return selected && selected.length ? String(selected[0]) : null;
  }

  async function fetchLayoutSnapshot() {
    if (!canPersist()) return { found: false };
    const query = new URLSearchParams({
      graph_id: currentGraphId(),
      graph_time: currentGraphTime(),
      view_mode: currentViewMode()
    });
    let data = await apiRequest('/layouts?' + query.toString(), { method: 'GET' });
    // Fallback: if not found and current viewMode isn't 'enriched', retry with 'enriched'
    if (!data.found && currentViewMode() !== 'enriched') {
      const q2 = new URLSearchParams({
        graph_id: currentGraphId(),
        graph_time: currentGraphTime(),
        view_mode: 'enriched'
      });
      const d2 = await apiRequest('/layouts?' + q2.toString(), { method: 'GET' });
      if (d2.found) data = d2;
    }
    return data;
  }

  async function apiRequest(path, options) {
    const response = await fetch(API_BASE + path, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }, options || {}));
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json();
        detail = body.detail || body.msg || detail;
      } catch (error) {
      }
      throw new Error(detail || 'layout api error');
    }
    if (response.status === 204) return {};
    return response.json();
  }

  function snapshotPayload() {
    const positions = network.getPositions();
    const formatted = {};
    Object.keys(positions || {}).forEach(function (id) {
      const node = nodes.get(id);
      formatted[String(id)] = {
        x: positions[id].x,
        y: positions[id].y,
        physics: node ? node.physics : undefined,
        fixed: node && node.fixed ? { x: !!node.fixed.x, y: !!node.fixed.y } : undefined
      };
    });
    return {
      graph_id: currentGraphId(),
      graph_time: currentGraphTime(),
      view_mode: currentViewMode(),
      positions: formatted,
      viewport: {
        position: typeof network.getViewPosition === 'function' ? network.getViewPosition() : {},
        scale: typeof network.getScale === 'function' ? network.getScale() : 1
      },
      physics_enabled: !!(network.physics && network.physics.physicsEnabled),
      selected_node_id: selectedNodeId()
    };
  }

  function applyLayoutSnapshot(data) {
    if (!data || !data.positions || typeof nodes === 'undefined' || !nodes) return false;
    const existingIds = new Set((typeof nodes.getIds === 'function' ? nodes.getIds() : []).map(function (id) { return String(id); }));
    const updates = Object.keys(data.positions).filter(function (id) {
      return existingIds.has(String(id));
    }).map(function (id) {
      const raw = data.positions[id] || {};
      const numericId = Number(id);
      return {
        id: Number.isNaN(numericId) ? id : numericId,
        x: raw.x,
        y: raw.y,
        physics: raw.physics,
        fixed: raw.fixed || (raw.physics === false ? { x: true, y: true } : undefined)
      };
    });
    if (updates.length) {
      nodes.update(updates);
    }
    if (typeof network.setOptions === 'function') {
      network.setOptions({ physics: { enabled: !!data.physics_enabled } });
    }
    if (element('btnStopPhysics')) {
      element('btnStopPhysics').innerHTML = data.physics_enabled === false
        ? '<img src="/static/start_button.png"/>Unfreeze network'
        : '<img src="/static/stop_button.png"/>Freeze network';
    }
    // Stabilize viewport
    setTimeout(function () {
      if (data.viewport && data.viewport.position && typeof network.moveTo === 'function') {
        network.moveTo({
          position: data.viewport.position,
          scale: data.viewport.scale || 1,
          animation: false
        });
      } else if (typeof network.redraw === 'function') {
        network.redraw();
      }
      if (data.selected_node_id && existingIds.has(String(data.selected_node_id)) && typeof network.selectNodes === 'function') {
        const numericId = Number(data.selected_node_id);
        network.selectNodes([Number.isNaN(numericId) ? data.selected_node_id : numericId]);
      }
    }, 150);
    return updates.length > 0;
  }

  async function loadLayout(showNotification) {
    if (!canPersist()) return false;
    const requestedContext = currentContext();
    const data = await fetchLayoutSnapshot();
    if (!sameContext(requestedContext, currentContext())) {
      return false;
    }
    if (!data.found) {
      if (showNotification) notify('No saved layout found — drag a node to auto-save, or use 💾 Save Layout', true);
      return false;
    }
    if (!sameContext(requestedContext, {
      graphId: data.graph_id,
      graphTime: data.graph_time,
      viewMode: data.view_mode
    })) {
      return false;
    }
    const applied = applyLayoutSnapshot(data);
    if (showNotification && applied) {
      notify('Saved layout loaded');
    }
    return applied;
  }

  async function saveLayout() {
    if (!canPersist()) {
      notify('Load a graph before saving layout', true);
      return;
    }
    const data = await apiRequest('/layouts', {
      method: 'PUT',
      body: JSON.stringify(snapshotPayload())
    });
    notify('Layout saved (revision ' + data.revision + ')');
  }

  function reloadCurrentGraph() {
    const graphTime = currentGraphTime();
    const mode = currentViewMode();
    if (!graphTime || typeof upload_ospf_lsdb !== 'function') return;
    upload_ospf_lsdb(false, false, graphTime);
    setTimeout(function () {
      if (typeof setViewMode === 'function' && mode) {
        setViewMode(mode);
      }
    }, 1400);
  }

  async function resetLayout() {
    if (!canPersist()) {
      notify('Load a graph before resetting layout', true);
      return;
    }
    const query = new URLSearchParams({
      graph_id: currentGraphId(),
      graph_time: currentGraphTime(),
      view_mode: currentViewMode()
    });
    await apiRequest('/layouts?' + query.toString(), { method: 'DELETE' });
    notify('Saved layout reset');
    reloadCurrentGraph();
  }

  async function resetSelectedNodeLayout() {
    if (!canPersist()) {
      notify('Load a graph before resetting node layout', true);
      return;
    }
    let nodeId = selectedNodeId();
    if (!nodeId) {
      const snapshot = await fetchLayoutSnapshot();
      if (snapshot && snapshot.found && snapshot.selected_node_id) {
        nodeId = String(snapshot.selected_node_id);
      }
    }
    if (!nodeId) {
      notify('Select a node first', true);
      return;
    }
    const query = new URLSearchParams({
      graph_id: currentGraphId(),
      graph_time: currentGraphTime(),
      view_mode: currentViewMode(),
      node_id: nodeId
    });
    await apiRequest('/layouts/node?' + query.toString(), { method: 'DELETE' });
    notify('Selected node layout reset');
    reloadCurrentGraph();
  }

  function visibleNodes() {
    if (typeof nodes === 'undefined' || !nodes) return [];
    return nodes.get().filter(function (node) { return node.hidden !== true; });
  }

  function visibleEdges() {
    if (typeof edges === 'undefined' || !edges) return [];
    return edges.get().filter(function (edge) { return edge.hidden !== true; });
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function yamlValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '"' + String(value).replace(/"/g, '\\"') + '"';
  }

  function exportYaml() {
    const payload = snapshotPayload();
    const lines = [];
    lines.push('graph_time: ' + yamlValue(currentGraphTime()));
    lines.push('graph_id: ' + yamlValue(currentGraphId()));
    lines.push('view_mode: ' + yamlValue(currentViewMode()));
    lines.push('physics_enabled: ' + yamlValue(payload.physics_enabled));
    lines.push('nodes:');
    visibleNodes().forEach(function (node) {
      const pos = payload.positions[String(node.id)] || {};
      lines.push('  - id: ' + yamlValue(node.id));
      lines.push('    label: ' + yamlValue(node.label || node.name || ''));
      lines.push('    country: ' + yamlValue(node.country || node.group || ''));
      lines.push('    is_gateway: ' + yamlValue(node.is_gateway === true));
      lines.push('    x: ' + yamlValue(pos.x));
      lines.push('    y: ' + yamlValue(pos.y));
    });
    lines.push('edges:');
    visibleEdges().forEach(function (edge) {
      lines.push('  - id: ' + yamlValue(edge.id || ''));
      lines.push('    from: ' + yamlValue(edge.from));
      lines.push('    to: ' + yamlValue(edge.to));
      lines.push('    label: ' + yamlValue(edge.label || ''));
      lines.push('    cost: ' + yamlValue(edge.cost || edge.label || ''));
    });
    downloadFile('topology-' + currentGraphTime() + '-' + currentViewMode() + '.yaml', lines.join('\n') + '\n', 'application/x-yaml');
    notify('YAML export downloaded');
  }

  function exportCsv() {
    const payload = snapshotPayload();
    const lines = ['section,id,label,country,is_gateway,x,y,from,to,cost'];
    visibleNodes().forEach(function (node) {
      const pos = payload.positions[String(node.id)] || {};
      lines.push(['node', node.id, node.label || node.name || '', node.country || node.group || '', node.is_gateway === true, pos.x ?? '', pos.y ?? '', '', '', ''].map(csvCell).join(','));
    });
    visibleEdges().forEach(function (edge) {
      lines.push(['edge', edge.id || '', edge.label || '', '', '', '', '', edge.from || '', edge.to || '', edge.cost || edge.label || ''].map(csvCell).join(','));
    });
    downloadFile('topology-' + currentGraphTime() + '-' + currentViewMode() + '.csv', lines.join('\n') + '\n', 'text/csv;charset=utf-8');
    notify('CSV export downloaded');
  }

  function csvCell(value) {
    const raw = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(raw)) return '"' + raw.replace(/"/g, '""') + '"';
    return raw;
  }

  function htmlCell(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function exportExcel() {
    const payload = snapshotPayload();
    let html = '<html><head><meta charset="utf-8"></head><body>';
    html += '<table border="1"><tr><th colspan="6">Nodes</th></tr><tr><th>ID</th><th>Label</th><th>Country</th><th>Gateway</th><th>X</th><th>Y</th></tr>';
    visibleNodes().forEach(function (node) {
      const pos = payload.positions[String(node.id)] || {};
      html += '<tr><td>' + htmlCell(node.id) + '</td><td>' + htmlCell(node.label || node.name || '') + '</td><td>' + htmlCell(node.country || node.group || '') + '</td><td>' + htmlCell(node.is_gateway === true) + '</td><td>' + htmlCell(pos.x ?? '') + '</td><td>' + htmlCell(pos.y ?? '') + '</td></tr>';
    });
    html += '</table><br><table border="1"><tr><th colspan="5">Edges</th></tr><tr><th>ID</th><th>From</th><th>To</th><th>Label</th><th>Cost</th></tr>';
    visibleEdges().forEach(function (edge) {
      html += '<tr><td>' + htmlCell(edge.id || '') + '</td><td>' + htmlCell(edge.from || '') + '</td><td>' + htmlCell(edge.to || '') + '</td><td>' + htmlCell(edge.label || '') + '</td><td>' + htmlCell(edge.cost || edge.label || '') + '</td></tr>';
    });
    html += '</table></body></html>';
    downloadFile('topology-' + currentGraphTime() + '-' + currentViewMode() + '.xls', html, 'application/vnd.ms-excel');
    notify('Excel export downloaded');
  }

  function ensureControls() {
    const bar = element('viewModeBar');
    if (!bar || element('layoutControls')) return;
    const wrapper = document.createElement('span');
    wrapper.id = 'layoutControls';
    wrapper.style.display = 'inline-flex';
    wrapper.style.gap = '5px';
    wrapper.style.flexWrap = 'wrap';
    wrapper.innerHTML =
      '<span class="vmSep">│</span>' +
      '<button class="vmToolBtn" id="btnLayoutSave" title="Save node positions for this topology and view mode">💾 Save Layout</button>' +
      '<button class="vmToolBtn" id="btnLayoutLoad" title="Load saved layout for this topology and view mode">📥 Load Layout</button>' +
      '<button class="vmToolBtn" id="btnLayoutReset" title="Reset saved layout for this topology and view mode">♻ Reset Layout</button>' +
      '<button class="vmToolBtn" id="btnLayoutResetNode" title="Reset saved layout for the selected node in this mode">🎯 Reset Node</button>' +
      '<button class="vmToolBtn" id="btnExportYaml" title="Export current topology and positions as YAML">YAML</button>' +
      '<button class="vmToolBtn" id="btnExportCsv" title="Export current topology and positions as CSV">CSV</button>' +
      '<button class="vmToolBtn" id="btnExportExcel" title="Export current topology and positions as Excel">Excel</button>';
    bar.appendChild(wrapper);
    element('btnLayoutSave').addEventListener('click', function () { saveLayout().catch(function (error) { notify(error.message, true); }); });
    element('btnLayoutLoad').addEventListener('click', function () { loadLayout(true).catch(function (error) { notify(error.message, true); }); });
    element('btnLayoutReset').addEventListener('click', function () { resetLayout().catch(function (error) { notify(error.message, true); }); });
    element('btnLayoutResetNode').addEventListener('click', function () { resetSelectedNodeLayout().catch(function (error) { notify(error.message, true); }); });
    element('btnExportYaml').addEventListener('click', exportYaml);
    element('btnExportCsv').addEventListener('click', exportCsv);
    element('btnExportExcel').addEventListener('click', exportExcel);
  }

  window.save_nodes_position = function () {
    saveLayout().catch(function (error) { notify(error.message, true); });
  };
  window.load_saved_layout = function () {
    loadLayout(true).catch(function (error) { notify(error.message, true); });
  };
  window.reset_saved_layout = function () {
    resetLayout().catch(function (error) { notify(error.message, true); });
  };
  window.reset_selected_node_layout = function () {
    resetSelectedNodeLayout().catch(function (error) { notify(error.message, true); });
  };

  const originalBuildViewModeButtons = window.buildViewModeButtons;
  if (typeof originalBuildViewModeButtons === 'function') {
    window.buildViewModeButtons = function () {
      originalBuildViewModeButtons.apply(this, arguments);
      ensureControls();
      setTimeout(function () {
        loadLayout(false).catch(function () { });
      }, 180);
    };
  }

  const originalSetViewMode = window.setViewMode;
  if (typeof originalSetViewMode === 'function') {
    window.setViewMode = function (mode) {
      const result = originalSetViewMode.apply(this, arguments);
      setTimeout(function () {
        loadLayout(false).catch(function () { });
      }, 180);
      return result;
    };
  }
})();
