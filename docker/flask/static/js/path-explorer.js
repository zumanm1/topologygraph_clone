/**
 * path-explorer.js  —  OSPF K-Path Explorer Page Logic
 * ======================================================
 * PRD-09: /path-explorer
 *
 * Depends on:
 *   - ospf-ksp.js  (KSP_* functions)
 *   - vis-network  (loaded from CDN in template)
 *   - Bootstrap 4  (loaded via base.html)
 */

/* ── State ───────────────────────────────────────────────────────── */
var _peNodes      = [];   // raw API node objects
var _peEdges      = [];   // raw API edge objects
var _peAdjFwd     = null; // directed adj list (normal/overridden)
var _peAdjRev     = null; // reversed adj list for REV direction
var _peFwdPaths   = [];   // computed FWD paths
var _peRevPaths   = [];   // computed REV paths
var _peNetwork    = null; // vis.js Network
var _peVNodes     = null; // vis.js DataSet nodes
var _peVEdges     = null; // vis.js DataSet edges
var _peOverrides  = {};   // { edgeId: { fwd, rev } or { sym } }
var _peOverrideRows = []; // { id, mode, fwd, rev }
var _peRowIdSeq   = 0;
var _peSelectedTab = 'fwd';
var _peGraphTime  = '';
var _peGraphId    = '';

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  _peGraphTime = _peGetParam('graph_time') || _peLSGet('ospf_graph_time') || '';
  _peGraphId   = _peLSGet('ospf_graph_id') || '';

  peLoadGraphTimeOptions().then(function () {
    if (_peGraphTime) {
      peSetStatus('Graph loaded. Select countries and click ▶ Go.');
      peLoadTopologyData(_peGraphTime);
    } else {
      peSetStatus('No graph selected. Load an OSPF database on the main page first.');
    }
  });
});

/* ── Graph-time dropdown ─────────────────────────────────────────── */
function peLoadGraphTimeOptions() {
  return fetch('/api/graph-times')
    .then(function (r) { return r.ok ? r.json() : { graph_time_list: [] }; })
    .catch(function () { return { graph_time_list: [] }; })
    .then(function (data) {
      var sel = document.getElementById('peGraphTime');
      var list = (data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []));
      if (!Array.isArray(list)) list = [];

      // Always ensure the current graph_time from URL/localStorage is in the list
      if (_peGraphTime && list.indexOf(_peGraphTime) === -1) list = [_peGraphTime].concat(list);

      sel.innerHTML = '';
      if (list.length === 0) {
        sel.innerHTML = '<option value="">No graphs found — load one on the main page</option>';
        return;
      }
      list.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        if (t === _peGraphTime) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!_peGraphTime) _peGraphTime = list[list.length - 1];
      sel.addEventListener('change', function () {
        _peGraphTime = sel.value;
        peLoadTopologyData(_peGraphTime);
      });
    });
}

/* ── Load topology via POST /upload-ospf-lsdb-from-js ───────────── */
function peLoadTopologyData(graphTime) {
  if (!graphTime) return;
  peSetStatus('<span class="pe-spinner"></span> Loading topology…');
  document.getElementById('peBtnGo').disabled = true;

  KSP_loadTopology(graphTime)
    .then(function (result) {
      _peNodes = result.nodes;
      _peEdges = result.edges;

      _peRebuildAdjLists();
      _pePopulateCountryDropdowns();
      _peBuildTopoView();

      var n = _peNodes.length, e = _peEdges.length;
      peSetStatus('Loaded: ' + n + ' nodes, ' + e + ' edges. Select countries and click ▶ Go.');
      document.getElementById('peBtnGo').disabled = false;
    })
    .catch(function (err) {
      peSetStatus('⚠ Failed to load topology: ' + err.message);
      document.getElementById('peBtnGo').disabled = false;
    });
}

/* ── Build adjacency lists (normal + reversed) ──────────────────── */
function _peRebuildAdjLists() {
  _peAdjFwd = KSP_buildDirAdjList(_peNodes, _peEdges, _peOverrides);

  // Build reversed adjacency list for REV direction paths
  // Swap fwd/rev overrides when reversing
  var revOverrides = {};
  Object.keys(_peOverrides).forEach(function (eid) {
    var ov = _peOverrides[eid];
    if (ov.sym !== undefined) {
      revOverrides[eid] = { sym: ov.sym };
    } else {
      revOverrides[eid] = { fwd: ov.rev, rev: ov.fwd };
    }
  });

  // Build a reversed edge list (swap from/to)
  var revEdges = _peEdges.map(function (e) {
    return { id: e.id + '_r', from: e.to, to: e.from, cost: e.cost, label: e.label, title: e.title, weight: e.weight, value: e.value };
  });
  _peAdjRev = KSP_buildDirAdjList(_peNodes, revEdges, revOverrides);
}

/* ── Country dropdowns ───────────────────────────────────────────── */
function _pePopulateCountryDropdowns() {
  var countries = KSP_atypeCountries(_peNodes);
  var srcSel = document.getElementById('peSrc');
  var dstSel = document.getElementById('peDst');
  var prevSrc = srcSel.value;
  var prevDst = dstSel.value;

  var makeOptions = function (sel, prev) {
    sel.innerHTML = '<option value="">— select —</option>';
    countries.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === prev) opt.selected = true;
      sel.appendChild(opt);
    });
  };
  makeOptions(srcSel, prevSrc);
  makeOptions(dstSel, prevDst);
}

/* ── Main analysis ───────────────────────────────────────────────── */
function peRunAnalysis() {
  var srcCountry = document.getElementById('peSrc').value;
  var dstCountry = document.getElementById('peDst').value;
  var K = parseInt(document.getElementById('peK').value, 10) || 10;

  if (!srcCountry || !dstCountry) { peSetStatus('⚠ Select source and destination countries.'); return; }
  if (srcCountry === dstCountry)  { peSetStatus('⚠ Source and destination must be different.'); return; }
  if (!_peAdjFwd)                 { peSetStatus('⚠ No topology loaded.'); return; }

  peSetStatus('<span class="pe-spinner"></span> Computing ' + K + ' shortest paths FWD + REV…');
  document.getElementById('peBtnGo').disabled = true;

  // Run async so spinner renders
  setTimeout(function () {
    try {
      var pairFwd = KSP_bestPair(srcCountry, dstCountry, _peNodes, _peAdjFwd);
      var pairRev = KSP_bestPair(dstCountry, srcCountry, _peNodes, _peAdjRev);

      if (!pairFwd) {
        peSetStatus('⚠ No path found from ' + srcCountry + ' to ' + dstCountry + '.');
        document.getElementById('peBtnGo').disabled = false;
        return;
      }

      _peFwdPaths = KSP_yen(pairFwd.srcId, pairFwd.dstId, K, _peAdjFwd);
      _peRevPaths = pairRev ? KSP_yen(pairRev.srcId, pairRev.dstId, K, _peAdjRev) : [];

      _peRenderPaths();

      peSetStatus('Found: ' + _peFwdPaths.length + ' FWD path(s) ' + srcCountry + '→' + dstCountry +
        ',  ' + _peRevPaths.length + ' REV path(s) ' + dstCountry + '→' + srcCountry + '.');
    } catch (err) {
      peSetStatus('⚠ Computation error: ' + err.message);
    }
    document.getElementById('peBtnGo').disabled = false;
  }, 10);
}

/* ── Render path lists ───────────────────────────────────────────── */
function _peRenderPaths() {
  var srcC = document.getElementById('peSrc').value;
  var dstC = document.getElementById('peDst').value;

  document.getElementById('peTabFwd').textContent = '→ FWD (' + _peFwdPaths.length + ' paths)';
  document.getElementById('peTabRev').textContent = '← REV (' + _peRevPaths.length + ' paths)';

  _peRenderPathList('peListFwd', _peFwdPaths, 'fwd', srcC + ' → ' + dstC);
  _peRenderPathList('peListRev', _peRevPaths, 'rev', dstC + ' → ' + srcC);
}

function _peRenderPathList(containerId, paths, dir, label) {
  var container = document.getElementById(containerId);
  container.innerHTML = '';

  if (!paths || paths.length === 0) {
    container.innerHTML = '<div style="color:#6b7280;font-size:12px;padding:10px;">No paths found.</div>';
    return;
  }

  paths.forEach(function (path, idx) {
    var row = document.createElement('div');
    row.className = 'pe-path-row';
    row.id = 'pe-path-' + dir + '-' + idx;

    var hdr = document.createElement('div');
    hdr.className = 'pe-path-header';
    hdr.innerHTML =
      '<span class="pe-path-num">#' + (idx + 1) + '</span>' +
      '<span class="pe-path-cost">Cost: ' + path.totalCost + '</span>' +
      '<span class="pe-path-hops">Hops: ' + (path.nodes.length - 1) + '</span>' +
      '<span class="pe-path-expand">▼</span>';

    var detail = document.createElement('div');
    detail.className = 'pe-path-hops-detail';

    // Build hop breakdown
    var hopHtml = '';
    for (var i = 0; i < path.nodes.length; i++) {
      var nodeLabel = KSP_nodeLabel(path.nodes[i], _peNodes);
      hopHtml += '<div class="pe-hop"><span class="pe-hop-node">' + _peEscHtml(nodeLabel) + '</span>';
      if (i < path.hopCosts.length) {
        hopHtml += '<span class="pe-hop-arrow">→</span><span class="pe-hop-cost">' + path.hopCosts[i] + '</span>';
      }
      hopHtml += '</div>';
    }
    detail.innerHTML = hopHtml;

    row.appendChild(hdr);
    row.appendChild(detail);

    // Click: expand hops + highlight on topology
    var capturedIdx = idx;
    var capturedDir = dir;
    row.addEventListener('click', function () {
      // Toggle expand
      var isOpen = detail.classList.contains('open');
      detail.classList.toggle('open', !isOpen);
      hdr.querySelector('.pe-path-expand').textContent = isOpen ? '▼' : '▲';

      // Select/highlight
      document.querySelectorAll('.pe-path-row').forEach(function (r) { r.classList.remove('selected'); });
      row.classList.add('selected');
      _peHighlightPath(capturedDir === 'fwd' ? _peFwdPaths[capturedIdx] : _peRevPaths[capturedIdx]);
    });

    container.appendChild(row);
  });
}

/* ── Tab switching ───────────────────────────────────────────────── */
function peSelectTab(tab) {
  _peSelectedTab = tab;
  ['fwd', 'rev'].forEach(function (t) {
    document.getElementById('peTab' + (t === 'fwd' ? 'Fwd' : 'Rev')).classList.toggle('active', t === tab);
    document.getElementById('peList' + (t === 'fwd' ? 'Fwd' : 'Rev')).classList.toggle('active', t === tab);
  });
}

/* ── Topology view ───────────────────────────────────────────────── */
function _peBuildTopoView() {
  var container = document.getElementById('peTopoContainer');

  // Build vis.js DataSets
  var visNodes = _peNodes.map(function (n) {
    var parsed = KSP_parseAtype(n.label || n.id || '');
    return {
      id:    n.id,
      label: n.label || String(n.id),
      color: parsed ? { background: '#1e40af', border: '#3b82f6' } : { background: '#374151', border: '#6b7280' },
      font:  { color: '#e0e8f0', size: 10 },
      size:  parsed ? 12 : 8
    };
  });

  var visEdges = _peEdges.map(function (e) {
    return {
      id:     e.id,
      from:   e.from,
      to:     e.to,
      label:  e.label || String(_peEdgeCostRaw(e)),
      color:  { color: '#374151', highlight: '#22c55e' },
      width:  1,
      font:   { color: '#6b7280', size: 8, strokeWidth: 0 },
      arrows: { to: { enabled: true, scaleFactor: 0.4 } }
    };
  });

  _peVNodes = new vis.DataSet(visNodes);
  _peVEdges = new vis.DataSet(visEdges);

  var options = {
    physics: { enabled: true, solver: 'forceAtlas2Based',
      forceAtlas2Based: { gravitationalConstant: -30, springLength: 100, springConstant: 0.02 },
      stabilization: { iterations: 150 }
    },
    interaction: { hover: true, tooltipDelay: 200 },
    layout: { improvedLayout: false }
  };

  _peNetwork = new vis.Network(container, { nodes: _peVNodes, edges: _peVEdges }, options);
  _peNetwork.on('stabilizationIterationsDone', function () { _peNetwork.setOptions({ physics: { enabled: false } }); });
}

/* ── Highlight a path on the topology ───────────────────────────── */
function _peHighlightPath(path) {
  if (!_peVEdges || !path) return;

  // Reset all edge colors
  var allEdges = _peVEdges.get();
  var resetUpd = allEdges.map(function (e) {
    return { id: e.id, color: { color: '#374151' }, width: 1 };
  });
  _peVEdges.update(resetUpd);

  // Highlight path edges (green, thick)
  var pathEdgeSet = new Set(path.edges.map(function (eid) { return String(eid); }));
  var hlUpd = [];
  allEdges.forEach(function (e) {
    if (pathEdgeSet.has(String(e.id))) {
      hlUpd.push({ id: e.id, color: { color: '#22c55e' }, width: 4 });
    }
  });
  if (hlUpd.length) _peVEdges.update(hlUpd);

  // Focus network on path nodes
  if (_peNetwork && path.nodes.length) {
    _peNetwork.selectNodes(path.nodes);
    _peNetwork.fit({ nodes: path.nodes, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
  }
}

/* ── Override panel ──────────────────────────────────────────────── */
function peToggleOverrides() {
  var body = document.getElementById('peOverrideBody');
  var toggle = document.getElementById('peOverrideToggle');
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  toggle.textContent = (isOpen ? '▶' : '▼') + ' Cost Overrides (asymmetric support) ';
  var cnt = document.getElementById('peOverrideCount');
  cnt.textContent = _peOverrideRows.length ? '(' + _peOverrideRows.length + ' active)' : '';
}

function peAddOverrideRow() {
  var id = ++_peRowIdSeq;
  _peOverrideRows.push({ id: id, edgeId: '', mode: 'sym', fwd: '', rev: '' });
  _peRenderOverrideTable();
}

function peClearOverrides() {
  _peOverrideRows = [];
  _peOverrides = {};
  _peRenderOverrideTable();
  document.getElementById('peOverrideCount').textContent = '';
}

function peApplyOverrides() {
  _peOverrides = {};
  _peOverrideRows.forEach(function (row) {
    var eid = String(row.edgeId).trim();
    if (!eid) return;
    var fwd = parseFloat(row.fwd);
    var rev = parseFloat(row.rev);
    if (row.mode === 'sym' && !isNaN(fwd) && fwd > 0) {
      _peOverrides[eid] = { sym: fwd };
    } else if (row.mode === 'asym') {
      if (!isNaN(fwd) && fwd > 0 && !isNaN(rev) && rev > 0) {
        _peOverrides[eid] = { fwd: fwd, rev: rev };
      }
    }
  });
  _peRebuildAdjLists();
  document.getElementById('peOverrideCount').textContent = Object.keys(_peOverrides).length
    ? '(' + Object.keys(_peOverrides).length + ' active)' : '';
  peSetStatus('Cost overrides applied. Click ▶ Go to recompute paths.');
}

function _peRenderOverrideTable() {
  var tbody = document.getElementById('peOvRows');
  tbody.innerHTML = '';
  _peOverrideRows.forEach(function (row) {
    var tr = document.createElement('tr');
    var capturedId = row.id;
    tr.innerHTML =
      '<td><input type="text" placeholder="edgeId" value="' + _peEscHtml(row.edgeId) + '" ' +
        'onchange="peOvUpdate(' + capturedId + ',\'edgeId\',this.value)"></td>' +
      '<td><select onchange="peOvUpdate(' + capturedId + ',\'mode\',this.value)">' +
        '<option value="sym"' + (row.mode === 'sym' ? ' selected' : '') + '>SYM</option>' +
        '<option value="asym"' + (row.mode === 'asym' ? ' selected' : '') + '>ASYM</option>' +
      '</select></td>' +
      '<td><input type="number" min="1" placeholder="fwd" value="' + (row.fwd || '') + '" ' +
        'onchange="peOvUpdate(' + capturedId + ',\'fwd\',this.value)"></td>' +
      '<td><input type="number" min="1" placeholder="rev" value="' + (row.rev || '') + '" ' +
        (row.mode === 'sym' ? 'disabled ' : '') +
        'onchange="peOvUpdate(' + capturedId + ',\'rev\',this.value)" id="peOvRev' + capturedId + '"></td>' +
      '<td><button class="ov-del-btn" onclick="peOvDelete(' + capturedId + ')">✕</button></td>';
    tbody.appendChild(tr);
  });
}

function peOvUpdate(id, field, value) {
  var row = _peOverrideRows.find(function (r) { return r.id === id; });
  if (!row) return;
  row[field] = value;
  if (field === 'mode') {
    // toggle rev field disabled
    var revInput = document.getElementById('peOvRev' + id);
    if (revInput) revInput.disabled = (value === 'sym');
  }
}

function peOvDelete(id) {
  _peOverrideRows = _peOverrideRows.filter(function (r) { return r.id !== id; });
  _peRenderOverrideTable();
}

/* ── Utilities ───────────────────────────────────────────────────── */
function peSetStatus(html) {
  document.getElementById('peStatus').innerHTML = html;
}

function _peGetParam(name) {
  var params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}

function _peLSGet(key) {
  try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
}

function _peEscHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _peEdgeCostRaw(e) {
  var c = e.cost || e.weight || e.value || 0;
  if (!c && e.label) { var l = String(e.label).trim(); if (/^\d+$/.test(l)) c = parseInt(l, 10); }
  return c || 1;
}
