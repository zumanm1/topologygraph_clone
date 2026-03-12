/**
 * impact-lab.js  —  OSPF Impact Lab Page Logic
 * ==============================================
 * PRD-11: /impact-lab
 *
 * Features:
 *  - Node or link failure selector with autocomplete search
 *  - Blast radius computation (Ring 0/1/2, unreachable)
 *  - Topology overlay: failed=red, ring0=orange, ring1=amber, unreach=grey
 *  - Country pair impact table
 */

/* ── State ───────────────────────────────────────────────────────── */
var _ilNodes      = [];
var _ilEdges      = [];
var _ilAdj        = null;
var _ilNetwork    = null;
var _ilVNodes     = null;
var _ilVEdges     = null;
var _ilFailType   = 'node';   // 'node' | 'edge' — type for next search
var _ilFailId     = null;     // kept for topology-click compat
var _ilFailItems  = [];       // PRD-24: [{id, type, label}] — multi-failure list
var _ilGraphTime  = '';
var _ilLastResult = null;    // cached blast result for re-filtering without re-compute

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  _ilGraphTime = _ilParam('graph_time') || _ilLS('ospf_graph_time') || '';
  ilLoadGraphTimes().then(function () {
    if (_ilGraphTime) ilLoadTopology(_ilGraphTime);
  });
});

/* ── Graph time dropdown ─────────────────────────────────────────── */
function ilLoadGraphTimes() {
  return fetch('/api/graph-times')
    .then(function (r) { return r.ok ? r.json() : { graph_time_list: [] }; }).catch(function () { return { graph_time_list: [] }; })
    .then(function (data) {
      var sel = document.getElementById('ilGraphTime');
      var list = data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []);
      if (!Array.isArray(list)) list = [];
      if (_ilGraphTime && list.indexOf(_ilGraphTime) === -1) list = [_ilGraphTime].concat(list);
      sel.innerHTML = '';
      if (list.length === 0) {
        sel.innerHTML = '<option value="">No graphs — load one on the main page</option>';
        return;
      }
      list.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        if (t === _ilGraphTime) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!_ilGraphTime && list.length) _ilGraphTime = list[list.length - 1];
    });
}

function ilOnGraphTimeChange(t) {
  _ilGraphTime = t;
  ilLoadTopology(t);
}

/* ── Load topology via POST /upload-ospf-lsdb-from-js ───────────── */
function ilLoadTopology(gt) {
  if (!gt) return;
  ilSetStatus('<span class="il-spinner"></span> Loading topology…');
  document.getElementById('ilBtnAnalyse').disabled = true;

  KSP_loadTopology(gt)
    .then(function (result) {
      _ilNodes = result.nodes;
      _ilEdges = result.edges;
      _ilAdj = KSP_buildDirAdjList(_ilNodes, _ilEdges, {});
      _ilBuildVis();
      _ilPopulateCountryFilters();
      ilSetStatus('Loaded ' + _ilNodes.length + ' nodes, ' + _ilEdges.length + ' edges. Select a failure and click Compute.');
      document.getElementById('ilBtnAnalyse').disabled = false;
    })
    .catch(function (err) {
      ilSetStatus('⚠ Load error: ' + err.message);
    });
}

/* ── Failure type toggle ─────────────────────────────────────────── */
function ilSetType(type) {
  _ilFailType = type;
  _ilFailId = null;
  document.getElementById('ilTypeNode').classList.toggle('active', type === 'node');
  document.getElementById('ilTypeEdge').classList.toggle('active', type === 'edge');
  document.getElementById('ilSearchBox').value = '';
  document.getElementById('ilSearchResults').style.display = 'none';
  document.getElementById('ilSelectedFailure').textContent = 'No failure selected';
  document.getElementById('ilSearchBox').placeholder = type === 'node' ? 'Search node ID or label…' : 'Search edge ID (from→to)…';
}

/* ── Autocomplete search ─────────────────────────────────────────── */
function ilSearch(query) {
  var results = document.getElementById('ilSearchResults');
  query = query.trim().toLowerCase();
  if (!query || query.length < 1) { results.style.display = 'none'; return; }

  var items = [];
  if (_ilFailType === 'node') {
    items = _ilNodes.filter(function (n) {
      return String(n.id).toLowerCase().includes(query) ||
             (n.label || '').toLowerCase().includes(query);
    }).slice(0, 20);
  } else {
    items = _ilEdges.filter(function (e) {
      return String(e.id).toLowerCase().includes(query) ||
             (String(e.from) + '>' + String(e.to)).toLowerCase().includes(query);
    }).slice(0, 20);
  }

  if (!items.length) { results.style.display = 'none'; return; }

  results.innerHTML = items.map(function (item) {
    var label = _ilFailType === 'node'
      ? (item.label || String(item.id))
      : (String(item.from) + ' → ' + String(item.to));
    return '<div class="il-search-item" onclick="ilSelectFailure(\'' + _ilEsc(String(item.id)) + '\',\'' + _ilEsc(label) + '\')">' +
      '<b>' + _ilEsc(String(item.id)) + '</b> ' + _ilEsc(label) + '</div>';
  }).join('');
  results.style.display = 'block';
}

function ilSelectFailure(id, label) {
  // PRD-24: add to multi-failure list (deduplicate by id)
  if (_ilFailItems.find(function (f) { return String(f.id) === String(id); })) {
    document.getElementById('ilSearchResults').style.display = 'none';
    document.getElementById('ilSearchBox').value = '';
    return; // already in list
  }
  if (_ilFailItems.length >= 5) {
    ilSetStatus('⚠ Maximum 5 simultaneous failures. Remove one first.');
    return;
  }
  _ilFailItems.push({ id: String(id), type: _ilFailType, label: label });
  _ilFailId = id; // keep for topology overlay compat
  _ilRenderFailItems();
  document.getElementById('ilSearchResults').style.display = 'none';
  document.getElementById('ilSearchBox').value = '';
  var btn = document.getElementById('ilBtnAnalyse');
  if (btn) btn.disabled = false;
}

function _ilRenderFailItems() {
  var container = document.getElementById('ilFailItems');
  var clearBtn  = document.getElementById('ilBtnClearAll');
  var selDiv    = document.getElementById('ilSelectedFailure');
  if (!container) return;
  container.innerHTML = '';
  _ilFailItems.forEach(function (f, idx) {
    var chip = document.createElement('div');
    chip.style.cssText = 'display:flex;align-items:center;gap:6px;background:#1e2a38;border:1px solid #3d5066;border-radius:5px;padding:3px 8px;font-size:11px;color:#c8d8e8;';
    chip.innerHTML = (f.type === 'node' ? '💥 ' : '🔗 ') + _ilEsc(f.label) +
      '<button onclick="ilRemoveFailure(' + idx + ')" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:13px;line-height:1;padding:0;margin-left:auto;">×</button>';
    container.appendChild(chip);
  });
  if (clearBtn) clearBtn.style.display = _ilFailItems.length > 0 ? '' : 'none';
  if (selDiv) selDiv.textContent = _ilFailItems.length === 0 ? 'No failure selected' : _ilFailItems.length + ' failure(s) queued';
}

function ilRemoveFailure(idx) {
  _ilFailItems.splice(idx, 1);
  _ilRenderFailItems();
  var btn = document.getElementById('ilBtnAnalyse');
  if (btn) btn.disabled = (_ilFailItems.length === 0);
}

function ilClearAllFailures() {
  _ilFailItems = [];
  _ilFailId = null;
  _ilRenderFailItems();
  var btn = document.getElementById('ilBtnAnalyse');
  if (btn) btn.disabled = true;
}

/* ── Analyse blast radius ────────────────────────────────────────── */
function ilAnalyse() {
  if (_ilFailItems.length === 0) { ilSetStatus('⚠ Select a failure first.'); return; }
  if (!_ilAdj)                   { ilSetStatus('⚠ Load a topology first.'); return; }

  ilSetStatus('<span class="il-spinner"></span> Computing blast radius…');
  document.getElementById('ilBtnAnalyse').disabled = true;

  setTimeout(function () {
    try {
      // PRD-24: extract sets from multi-failure list
      var failNodeIds = new Set(
        _ilFailItems.filter(function (f) { return f.type === 'node'; }).map(function (f) { return f.id; })
      );
      var failEdgeIds = _ilFailItems.filter(function (f) { return f.type === 'edge'; }).map(function (f) { return f.id; });

      var result = KSP_blastRadius(failNodeIds, failEdgeIds, _ilNodes, _ilEdges, _ilAdj, 3);
      _ilRenderResult(result, failNodeIds, failEdgeIds);
      ilSetStatus('Blast radius computed. See topology overlay and tables below.');
    } catch (err) {
      ilSetStatus('⚠ Error: ' + err.message);
    }
    document.getElementById('ilBtnAnalyse').disabled = false;
  }, 20);
}

/* ── Render result ───────────────────────────────────────────────── */
function _ilRenderResult(result, failNodeId, failEdgeIds) {
  // Ring counts
  document.getElementById('ilRingSection').style.display = '';
  document.getElementById('ilRing0').textContent = result.ring0.size;
  document.getElementById('ilRing1').textContent = result.ring1.size;
  document.getElementById('ilRing2').textContent = result.ring2.size;
  document.getElementById('ilUnreach').textContent = result.unreachable.size;

  // Country table
  document.getElementById('ilCountrySection').style.display = '';
  _ilLastResult = result;
  _ilRenderCountryTable(result);

  // Topology overlay
  _ilApplyTopoOverlay(result, failNodeId, failEdgeIds);
}

function _ilPopulateCountryFilters() {
  var countries = KSP_atypeCountries(_ilNodes);
  ['ilFilterSrc', 'ilFilterDst'].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">All</option>';
    countries.forEach(function (c) { sel.appendChild(new Option(c, c)); });
  });
  var filterDiv = document.getElementById('ilCountryFilter');
  if (filterDiv) filterDiv.style.display = countries.length > 0 ? '' : 'none';
}

function _ilRenderCountryTable(result) {
  if (!result) return;
  var src = (document.getElementById('ilFilterSrc') || {}).value || '';
  var dst = (document.getElementById('ilFilterDst') || {}).value || '';
  var tbody = document.getElementById('ilCountryRows');
  tbody.innerHTML = '';
  var pairs = Object.keys(result.countries).sort();
  var shown = 0;
  pairs.forEach(function (key) {
    var c = result.countries[key];
    if (c.affected === 0) return;
    var parts = key.split('>');
    var pairSrc = parts[0] || '';
    var pairDst = parts[1] || '';
    if (src && pairSrc !== src) return;
    if (dst && pairDst !== dst) return;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + _ilEsc(pairSrc) + '→' + _ilEsc(pairDst) + '</td>' +
      '<td>' + c.total + '</td>' +
      '<td>' + (c.total - c.affected) + '</td>' +
      '<td style="color:#ef4444">-' + c.affected + '</td>';
    tbody.appendChild(tr);
    shown++;
  });
  if (shown === 0) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" style="color:#6b7280;text-align:center;padding:8px;">No affected pairs match filter</td>';
    tbody.appendChild(tr);
  }
}

function ilFilterCountryPairs() {
  _ilRenderCountryTable(_ilLastResult);
}

function _ilApplyTopoOverlay(result, failNodeIds, failEdgeIds) {
  if (!_ilVNodes || !_ilVEdges) return;

  // Reset all nodes
  var nodeUpd = _ilNodes.map(function (n) {
    var isAtype = !!KSP_parseAtype(n.label || n.id || '');
    return { id: n.id, color: isAtype ? { background:'#1e40af', border:'#3b82f6' } : { background:'#374151', border:'#6b7280' } };
  });

  // Apply ring colours
  if (result.unreachable.size) {
    result.unreachable.forEach(function (id) {
      var n = nodeUpd.find(function(x){ return x.id === id; });
      if (n) n.color = { background:'#374151', border:'#6b7280' };
    });
  }
  if (result.ring1.size) {
    result.ring1.forEach(function (id) {
      var n = nodeUpd.find(function(x){ return x.id === id; });
      if (n) n.color = { background:'#78350f', border:'#f59e0b' };
    });
  }
  if (result.ring0.size) {
    result.ring0.forEach(function (id) {
      var n = nodeUpd.find(function(x){ return x.id === id; });
      if (n) n.color = { background:'#7c2d12', border:'#ea580c' };
    });
  }
  // PRD-24: Failed nodes — bright red (supports Set)
  var fnIds = failNodeIds instanceof Set ? failNodeIds : (failNodeIds ? new Set([failNodeIds]) : new Set());
  fnIds.forEach(function (fnId) {
    var fn = nodeUpd.find(function (x) { return String(x.id) === String(fnId); });
    if (fn) fn.color = { background:'#991b1b', border:'#ef4444' };
  });
  _ilVNodes.update(nodeUpd);

  // Failed edges — red dashed
  var edgeUpd = _ilEdges.map(function (e) {
    var isFailed = failEdgeIds.includes(e.id) || failEdgeIds.includes(String(e.id));
    return { id: e.id, color: { color: isFailed ? '#ef4444' : '#374151' }, width: isFailed ? 4 : 1 };
  });
  _ilVEdges.update(edgeUpd);

  // Focus on first failed node
  if (fnIds.size > 0 && _ilNetwork) {
    _ilNetwork.focus(fnIds.values().next().value, { scale: 1.5, animation: { duration: 500 } });
  }
}

/* ── Vis.js topology ─────────────────────────────────────────────── */
function _ilBuildVis() {
  var container = document.getElementById('ilTopoContainer');
  var visNodes = _ilNodes.map(function (n) {
    var isAtype = !!KSP_parseAtype(n.label || n.id || '');
    return { id:n.id, label:n.label||String(n.id),
      color: isAtype ? { background:'#1e40af', border:'#3b82f6' } : { background:'#374151', border:'#6b7280' },
      font:{ color:'#e0e8f0', size:10 }, size: isAtype ? 12 : 8 };
  });
  var visEdges = _ilEdges.map(function (e) {
    return { id:e.id, from:e.from, to:e.to, label:e.label||'',
      color:{ color:'#374151' }, width:1,
      font:{ color:'#6b7280', size:8, strokeWidth:0 },
      arrows:{ to:{ enabled:true, scaleFactor:0.4 } } };
  });
  _ilVNodes = new vis.DataSet(visNodes);
  _ilVEdges = new vis.DataSet(visEdges);
  _ilNetwork = new vis.Network(container, { nodes:_ilVNodes, edges:_ilVEdges }, {
    physics:{ enabled:true, solver:'forceAtlas2Based',
      forceAtlas2Based:{ gravitationalConstant:-30, springLength:100, springConstant:0.02 },
      stabilization:{ iterations:150 }
    },
    interaction:{ hover:true }, layout:{ improvedLayout:false }
  });
  _ilNetwork.on('stabilizationIterationsDone', function () { _ilNetwork.setOptions({ physics:{ enabled:false } }); });

  // Click to select failure
  _ilNetwork.on('click', function (params) {
    if (params.nodes.length > 0 && _ilFailType === 'node') {
      var nodeId = params.nodes[0];
      var node = _ilNodes.find(function(n){ return n.id === nodeId; });
      ilSelectFailure(String(nodeId), node ? (node.label || String(nodeId)) : String(nodeId));
    } else if (params.edges.length > 0 && _ilFailType === 'edge') {
      var edgeId = params.edges[0];
      var edge = _ilEdges.find(function(e){ return e.id === edgeId; });
      var lbl = edge ? (String(edge.from) + ' → ' + String(edge.to)) : String(edgeId);
      ilSelectFailure(String(edgeId), lbl);
    }
  });
}

/* ── Utilities ───────────────────────────────────────────────────── */
function ilSetStatus(html) { document.getElementById('ilStatus').innerHTML = html; }
function _ilParam(name) { return new URLSearchParams(window.location.search).get(name) || ''; }
function _ilLS(key) { try { return localStorage.getItem(key) || ''; } catch(e) { return ''; } }
function _ilEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ════════════════════════════════════════════════════════════════════
   PRD-15 — 🌍 Country Reachability Matrix
   ════════════════════════════════════════════════════════════════════ */

var _ilMatrixBase     = null;  // { countries, matrix } — base (no failure)
var _ilMatrixCurrent  = null;  // matrix with failure applied
var _ilMatrixCountries= [];

/* ── Mode tab switch ─────────────────────────────────────────────── */
function ilSelectMode(mode) {
  var blast  = document.getElementById('ilBlastPanel');
  var matrix = document.getElementById('ilMatrixPanel');
  var tabB   = document.getElementById('ilTabBlast');
  var tabM   = document.getElementById('ilTabMatrix');

  if (mode === 'matrix') {
    if (blast)  blast.classList.add('hidden');
    if (matrix) matrix.classList.add('active');
    if (tabB)   tabB.classList.remove('active');
    if (tabM)   tabM.classList.add('active');
    // Populate failure node dropdown if topology loaded
    _ilPopulateMatrixFailNodes();
  } else {
    if (blast)  blast.classList.remove('hidden');
    if (matrix) matrix.classList.remove('active');
    if (tabB)   tabB.classList.add('active');
    if (tabM)   tabM.classList.remove('active');
  }
}

function _ilPopulateMatrixFailNodes() {
  var sel = document.getElementById('ilMatrixFailNode');
  if (!sel || !_ilNodes || !_ilNodes.length) return;
  // Preserve current selection
  var cur = sel.value;
  sel.innerHTML = '<option value="">None (base state)</option>';
  var sorted = _ilNodes.slice().sort(function (a, b) {
    return String(a.label || a.id).localeCompare(String(b.label || b.id));
  });
  sorted.forEach(function (n) {
    var lbl = _ilEsc(n.label || String(n.id));
    var isGw = !!KSP_parseAtype(n.label || n.id || '');
    var opt = document.createElement('option');
    opt.value = String(n.id);
    opt.textContent = lbl + (isGw ? ' [GW]' : '');
    sel.appendChild(opt);
  });
  sel.value = cur || '';
}

/* ── Build base matrix ───────────────────────────────────────────── */
function ilBuildMatrix() {
  if (!_ilNodes || !_ilNodes.length) {
    document.getElementById('ilMatrixSummary').textContent = '⚠ Load a topology first.';
    return;
  }
  var countries = KSP_atypeCountries(_ilNodes);
  if (countries.length < 2) {
    document.getElementById('ilMatrixSummary').textContent =
      '⚠ No A-type countries found in this topology.';
    return;
  }
  _ilMatrixCountries = countries;

  var btn = document.getElementById('ilBtnBuildMatrix');
  btn.disabled = true;
  btn.textContent = '⏳ Computing…';
  document.getElementById('ilMatrixSummary').textContent = 'Building adjacency list and running Dijkstra…';

  setTimeout(function () {
    var adj = KSP_buildDirAdjList(_ilNodes, _ilEdges, {});
    var matrix = KSP_reachabilityMatrix(countries, _ilNodes, adj, null);
    _ilMatrixBase    = { countries: countries, matrix: matrix, adj: adj };
    _ilMatrixCurrent = matrix;

    btn.disabled = false;
    btn.textContent = '▶ Build Matrix';
    document.getElementById('ilBtnExportMatrix').style.display = '';

    _ilPopulateMatrixFailNodes();
    _ilRenderMatrix(matrix, null);
  }, 0);
}

/* ── Failure simulation ──────────────────────────────────────────── */
function ilMatrixSimulate(failNodeId) {
  if (!_ilMatrixBase) return;
  var countries = _ilMatrixBase.countries;
  var adj       = _ilMatrixBase.adj;
  var excl      = failNodeId ? new Set([String(failNodeId)]) : null;

  setTimeout(function () {
    var matrix = KSP_reachabilityMatrix(countries, _ilNodes, adj, excl);
    _ilMatrixCurrent = matrix;
    _ilRenderMatrix(matrix, _ilMatrixBase.matrix);
  }, 0);
}

/* ── Render the N×N table ────────────────────────────────────────── */
function _ilRmClass(cost) {
  if (!isFinite(cost) || cost === Infinity) return 'rm-none';
  if (cost === 0)      return 'rm-self';
  if (cost < 500)      return 'rm-low';
  if (cost < 1500)     return 'rm-med';
  if (cost < 3000)     return 'rm-high';
  return 'rm-crit';
}

function _ilRenderMatrix(matrix, baseMatrix) {
  var countries = _ilMatrixCountries;
  var wrap = document.getElementById('ilMatrixWrap');
  var lostCount = 0, degradedCount = 0;

  var html = '<table class="il-rm-table"><thead><tr><th></th>';
  countries.forEach(function (c) { html += '<th>' + _ilEsc(c) + '</th>'; });
  html += '</tr></thead><tbody>';

  countries.forEach(function (src) {
    html += '<tr><td class="il-rm-row-hdr">' + _ilEsc(src) + '</td>';
    countries.forEach(function (dst) {
      if (src === dst) { html += '<td class="rm-self">—</td>'; return; }
      var cost     = matrix[src] ? matrix[src][dst] : Infinity;
      var baseCost = baseMatrix  ? (baseMatrix[src] ? baseMatrix[src][dst] : Infinity) : null;
      var cls = _ilRmClass(cost);
      var extraCls = '';
      if (baseCost !== null && cost !== baseCost) {
        if (!isFinite(cost) && isFinite(baseCost)) { extraCls = ' rm-lost'; lostCount++; }
        else if (isFinite(cost) && cost > baseCost) { extraCls = ' rm-degraded'; degradedCount++; }
      }
      var label = isFinite(cost) ? cost : '∞';
      var clickable = (src !== dst) ? ' rm-clickable' : '';
      var onclick   = (src !== dst) ? ' onclick="ilCellDetail(\'' + src + '\',\'' + dst + '\')"' : '';
      html += '<td class="' + cls + extraCls + clickable + '" id="ilCell-' + src + '-' + dst + '"' +
              onclick + ' title="Click to inspect OSPF path: ' + src + '→' + dst + ' cost=' + label + '">' + label + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  var failSel = document.getElementById('ilMatrixFailNode');
  var failName = failSel && failSel.value ? (failSel.options[failSel.selectedIndex] || {}).text : '';
  var summary = countries.length + '×' + countries.length + ' matrix · ' + countries.length + ' A-type countries';
  if (baseMatrix && (lostCount || degradedCount)) {
    summary += ' · Failure: ' + failName +
      ' · 🔴 Lost: ' + lostCount + ' · 🟠 Degraded: ' + degradedCount;
  }
  document.getElementById('ilMatrixSummary').textContent = summary;
}

/* ── Export CSV ──────────────────────────────────────────────────── */
function ilExportMatrixCsv() {
  if (!_ilMatrixCurrent || !_ilMatrixCountries.length) return;
  var countries = _ilMatrixCountries;
  var matrix    = _ilMatrixCurrent;
  var lines     = [',' + countries.join(',')];
  countries.forEach(function (src) {
    var row = [src];
    countries.forEach(function (dst) {
      var c = (src === dst) ? '' : (matrix[src] ? matrix[src][dst] : Infinity);
      row.push(isFinite(c) ? c : 'inf');
    });
    lines.push(row.join(','));
  });
  var gt = (document.getElementById('ilGraphTime') || {}).value || 'matrix';
  var fname = 'reachability-' + gt + '.csv';
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
}

/* ════════════════════════════════════════════════════════════════════
   OSPF Cost Detail Viewer — click a matrix cell to inspect path
   ════════════════════════════════════════════════════════════════════ */

var _ilDetailSrc = null; // currently selected src country
var _ilDetailDst = null; // currently selected dst country

/**
 * ilCellDetail(srcCountry, dstCountry)
 * Called by onclick on each matrix cell. Runs Dijkstra + path reconstruction
 * for the src→dst gateway pair and renders the OSPF cost detail panel.
 */
function ilCellDetail(srcCountry, dstCountry) {
  if (!_ilMatrixBase) return;

  // Deselect previous
  if (_ilDetailSrc && _ilDetailDst) {
    var prev = document.getElementById('ilCell-' + _ilDetailSrc + '-' + _ilDetailDst);
    if (prev) prev.classList.remove('rm-selected');
  }
  _ilDetailSrc = srcCountry;
  _ilDetailDst = dstCountry;

  // Mark selected cell
  var cell = document.getElementById('ilCell-' + srcCountry + '-' + dstCountry);
  if (cell) cell.classList.add('rm-selected');

  var panel    = document.getElementById('ilDetailPanel');
  var titleEl  = document.getElementById('ilDetailTitle');
  var badgeEl  = document.getElementById('ilDetailCostBadge');
  var gwEl     = document.getElementById('ilDetailGw');
  var content  = document.getElementById('ilDetailContent');

  // Use the SAME gateway resolution as KSP_reachabilityMatrix for cost consistency
  // (first A-type gateway per country — matches the matrix cell value exactly)
  var adj      = _ilMatrixBase.adj;
  var srcId    = KSP_countryGateway(srcCountry, _ilNodes);
  var dstId    = KSP_countryGateway(dstCountry, _ilNodes);

  titleEl.textContent = srcCountry + ' → ' + dstCountry;

  if (!srcId || !dstId) {
    badgeEl.textContent = '∞';
    gwEl.textContent = 'No A-type gateway for ' + (!srcId ? srcCountry : dstCountry);
    content.innerHTML = '<div class="il-detail-no-route">⚠ No gateway node found</div>';
    panel.style.display = '';
    return;
  }

  // Determine excl set from matrix failure selector
  var failSel  = document.getElementById('ilMatrixFailNode');
  var failId   = failSel ? failSel.value : '';
  var excl     = failId ? new Set([String(failId)]) : new Set();

  // Run Dijkstra from srcId (same as matrix), reconstruct path to dstId
  var r         = KSP_dijkstra(srcId, adj, excl, new Set());
  var bestCost  = r.dist.has(dstId) ? r.dist.get(dstId) : Infinity;
  var bestPath  = KSP_reconstructPath(srcId, dstId, r.prev, r.dist);
  var bestSrcId = srcId;
  var bestDstId = dstId;

  // Also compute base path if failure is active (for comparison)
  var basePath  = null;
  var baseCost  = null;
  if (failId) {
    var rb = KSP_dijkstra(srcId, _ilMatrixBase.adj, new Set(), new Set());
    baseCost = rb.dist.has(dstId) ? rb.dist.get(dstId) : Infinity;
    basePath = KSP_reconstructPath(srcId, dstId, rb.prev, rb.dist);
  }

  // Label helpers
  function nodeLabel(id) {
    var n = _ilNodes.find(function (x) { return String(x.id) === String(id); });
    return n ? (n.label || String(n.id)) : String(id);
  }
  function isGw(id) { return !!KSP_parseAtype(nodeLabel(id)); }

  // Badge
  var costText = isFinite(bestCost) ? bestCost : '∞';
  badgeEl.textContent = isFinite(bestCost) ? ('Cost: ' + bestCost) : 'No Route';
  badgeEl.style.background = isFinite(bestCost) ? '#2563eb' : '#7f1d1d';

  // Gateway info
  var srcLabel = nodeLabel(bestSrcId);
  var dstLabel = bestDstId ? nodeLabel(bestDstId) : '—';
  gwEl.textContent = 'Gateway: ' + srcLabel + ' (' + bestSrcId + ') → ' + dstLabel + ' (' + bestDstId + ')';

  // ── No route ────────────────────────────────────────────────────────
  if (!isFinite(bestCost) || !bestPath) {
    content.innerHTML = '<div class="il-detail-no-route">∞ No OSPF route — destination unreachable' +
      (failId ? ' (after failure of ' + _ilEsc(nodeLabel(failId)) + ')' : '') + '</div>';
    panel.style.display = '';
    _ilResetTopoHighlight();
    return;
  }

  // ── Build HTML ───────────────────────────────────────────────────────
  var html = '';

  // Failure comparison banner
  if (failId && basePath && isFinite(baseCost)) {
    var delta = bestCost - baseCost;
    var deltaCol = delta > 0 ? '#fb923c' : (delta < 0 ? '#4ade80' : '#9ca3af');
    var deltaSign = delta > 0 ? '+' : '';
    html += '<div class="il-detail-section">' +
      '<div class="il-detail-section-title">⚡ Failure Impact: ' + _ilEsc(nodeLabel(failId)) + '</div>' +
      '<div style="display:flex;gap:16px;font-size:11px;padding:4px 0;">' +
      '  <span style="color:#9ca3af;">Base cost: <b style="color:#e0e8f0;">' + baseCost + '</b></span>' +
      '  <span style="color:#9ca3af;">After failure: <b style="color:#e0e8f0;">' + bestCost + '</b></span>' +
      '  <span style="color:' + deltaCol + ';font-weight:700;">' + deltaSign + delta + '</span>' +
      '</div></div>';
  }

  // Hop-by-hop primary path
  html += '<div class="il-detail-section">';
  html += '<div class="il-detail-section-title">📍 Primary Path — ' + bestPath.nodes.length + ' hops, ' + bestPath.edges.length + ' links</div>';
  html += '<table class="il-hop-tbl"><thead><tr>' +
    '<th>#</th><th>Router (Node ID)</th><th style="text-align:right">Hop Cost</th>' +
    '<th style="text-align:right">Cumulative</th></tr></thead><tbody>';

  var maxHopCost = bestPath.hopCosts.length ? Math.max.apply(null, bestPath.hopCosts) : 1;
  bestPath.nodes.forEach(function (nodeId, i) {
    var lbl      = nodeLabel(nodeId);
    var gw       = isGw(nodeId);
    var hopCost  = i > 0 ? bestPath.hopCosts[i - 1] : null;
    var cumCost  = i > 0 ? bestPath.totalCost - (bestPath.hopCosts.slice(i).reduce(function(a,b){return a+b;},0)) : 0;
    var isFailed = failId && String(nodeId) === String(failId);
    var rowCls   = gw ? ' class="hop-gw"' : '';
    var lblCls   = isFailed ? ' class="hop-failed"' : '';
    var gwBadge  = gw ? ' <span style="font-size:9px;background:#14532d;color:#4ade80;padding:1px 4px;border-radius:3px;">GW</span>' : '';
    var barW     = hopCost ? Math.round((hopCost / maxHopCost) * 60) : 0;
    var barHtml  = hopCost ? '<span class="il-hop-bar" style="width:' + barW + 'px;"></span>' : '';

    html += '<tr' + rowCls + '>' +
      '<td style="color:#4b5563;font-family:monospace;">' + (i + 1) + '</td>' +
      '<td' + lblCls + '>' + _ilEsc(lbl) + gwBadge + '</td>' +
      '<td class="hop-cost">' + (hopCost !== null ? hopCost + barHtml : '—') + '</td>' +
      '<td class="hop-cum">' + cumCost + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';

  // Top-3 alternate paths (Yen)
  html += '<div class="il-detail-section">';
  html += '<div class="il-detail-section-title" style="cursor:pointer;" onclick="ilToggleAltPaths(this)">▼ Alternate Paths (K=3)</div>';
  html += '<div class="il-alt-paths" id="ilAltPaths">';

  var altAdj = failId ? (function(){
    var ef = new Set([String(failId)]);
    return KSP_buildDirAdjList(_ilNodes, _ilEdges.filter(function(e){
      return !ef.has(String(e.from)) && !ef.has(String(e.to));
    }), {});
  })() : adj;

  var kPaths = KSP_yen(bestSrcId, bestDstId, 3, altAdj);
  if (!kPaths || !kPaths.length) {
    html += '<div style="color:#6b7280;font-size:10px;padding:4px;">No alternate paths found</div>';
  } else {
    kPaths.forEach(function (p, idx) {
      var nodeNames = p.nodes.map(nodeLabel);
      var rankColor = idx === 0 ? '#22c55e' : (idx === 1 ? '#fbbf24' : '#f97316');
      html += '<div class="il-alt-path-row" onclick="ilSelectAltPath(' + idx + ')" data-path-idx="' + idx + '">' +
        '<span class="il-alt-path-rank" style="color:' + rankColor + '">#' + (idx + 1) + '</span>' +
        '<span class="il-alt-path-cost">' + p.totalCost + '</span>' +
        '<span class="il-alt-path-hops">' + p.nodes.length + ' hops</span>' +
        '<span class="il-alt-path-nodes">' + _ilEsc(nodeNames.join(' → ')) + '</span>' +
        '</div>';
    });
  }
  html += '</div></div>';

  content.innerHTML = html;
  panel.style.display = '';

  // Highlight primary path on topology
  _ilHighlightPathOnTopo(bestPath, false);

  // Store alt paths for click-to-show
  _ilDetailAltPaths = kPaths;
  _ilDetailNodeLabel = nodeLabel;
}

var _ilDetailAltPaths  = [];
var _ilDetailNodeLabel = null;

function ilToggleAltPaths(titleEl) {
  var body = document.getElementById('ilAltPaths');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  titleEl.textContent = (open ? '▶' : '▼') + ' Alternate Paths (K=3)';
}

function ilSelectAltPath(idx) {
  var paths = _ilDetailAltPaths;
  if (!paths || idx >= paths.length) return;
  // Highlight selected row
  var rows = document.querySelectorAll('.il-alt-path-row');
  rows.forEach(function (r) { r.style.background = ''; });
  var row = document.querySelector('.il-alt-path-row[data-path-idx="' + idx + '"]');
  if (row) row.style.background = '#1e2a38';
  _ilHighlightPathOnTopo(paths[idx], true);
}

function ilCloseDetail() {
  var panel = document.getElementById('ilDetailPanel');
  if (panel) panel.style.display = 'none';
  if (_ilDetailSrc && _ilDetailDst) {
    var cell = document.getElementById('ilCell-' + _ilDetailSrc + '-' + _ilDetailDst);
    if (cell) cell.classList.remove('rm-selected');
  }
  _ilDetailSrc = null;
  _ilDetailDst = null;
  _ilResetTopoHighlight();
}

/**
 * Highlight a path on the vis.js topology.
 * Non-path edges are dimmed; path edges glow blue (or amber for alt).
 */
function _ilHighlightPathOnTopo(path, isAlt) {
  if (!_ilVEdges || !_ilVNodes || !path) return;
  var pathEdgeSet = new Set(path.edges.map(String));
  var pathNodeSet = new Set(path.nodes.map(String));
  var edgeColor   = isAlt ? '#f59e0b' : '#3b82f6';  // amber for alt, blue for primary

  var edgeUpd = _ilEdges.map(function (e) {
    var inPath = pathEdgeSet.has(String(e.id));
    return {
      id:    e.id,
      color: { color: inPath ? edgeColor : '#1f2937' },
      width: inPath ? 3 : 1,
      dashes: isAlt ? [6, 3] : false
    };
  });
  _ilVEdges.update(edgeUpd);

  // Re-colour only path nodes (keep ring overlay for non-path nodes)
  var nodeUpd = [];
  path.nodes.forEach(function (nId) {
    var n = _ilNodes.find(function (x) { return String(x.id) === String(nId); });
    var isGwNode = n && !!KSP_parseAtype(n.label || n.id || '');
    nodeUpd.push({
      id:    nId,
      color: isGwNode ? { background:'#1e40af', border:'#7cb4ff' } : { background:'#1e3a5f', border:'#3b82f6' }
    });
  });
  if (nodeUpd.length) _ilVNodes.update(nodeUpd);

  // Focus on midpoint of path
  if (path.nodes.length > 0 && _ilNetwork) {
    var mid = path.nodes[Math.floor(path.nodes.length / 2)];
    _ilNetwork.focus(mid, { scale: 1.2, animation: { duration: 400 } });
  }
}

function _ilResetTopoHighlight() {
  if (!_ilVEdges || !_ilVNodes) return;
  var edgeUpd = _ilEdges.map(function (e) {
    return { id: e.id, color: { color: '#374151' }, width: 1, dashes: false };
  });
  _ilVEdges.update(edgeUpd);

  var nodeUpd = _ilNodes.map(function (n) {
    var isAtype = !!KSP_parseAtype(n.label || n.id || '');
    return { id: n.id, color: isAtype ? { background:'#1e40af', border:'#3b82f6' } : { background:'#374151', border:'#6b7280' } };
  });
  _ilVNodes.update(nodeUpd);
}
