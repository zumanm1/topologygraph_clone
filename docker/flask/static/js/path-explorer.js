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
var _peAdjFwd     = null; // bidirectional OSPF adj list (shared for FWD & REV)
var _peFwdPaths   = [];   // computed FWD paths
var _peRevPaths   = [];   // computed REV paths
var _peNetwork    = null; // vis.js Network
var _peVNodes     = null; // vis.js DataSet nodes
var _peVEdges     = null; // vis.js DataSet edges
var _peFilterBar  = null; // TopoFilterBar instance
var _peOverrides  = {};   // { edgeId: { fwd, rev } or { sym } }
var _peOverrideRows = []; // { id, mode, fwd, rev }
var _peRowIdSeq   = 0;
var _peSelectedTab = 'fwd';
var _peGraphTime  = '';
var _peGraphId    = '';
var _peAnimInterval = null; // pulsing animation interval
var _peAuditResults = [];  // cached full audit result set
var _peCostMap      = new Map(); // key: "fromId:toId" → cost (number)
var _peShowAll      = false;     // PRD-19: show all K paths simultaneously
var _peConstraints  = { mustPass: [], mustAvoid: [] }; // PRD-20: node constraints

// Direction colour palette for tab/header
var PE_COLORS = {
  fwd: { base: '#22d3ee', dim: '#0e7490', glow: '#67e8f9' },  // cyan
  rev: { base: '#f97316', dim: '#c2410c', glow: '#fdba74' }   // orange
};

// Path quality gradient: path #1 = best (green) → path #10 = worst (dark red)
var PE_PATH_COLORS = [
  '#22c55e',  // 1 best   — green
  '#84cc16',  // 2        — lime
  '#a3e635',  // 3        — yellow-green
  '#facc15',  // 4        — yellow
  '#f59e0b',  // 5        — amber
  '#f97316',  // 6        — orange
  '#ef4444',  // 7        — red
  '#dc2626',  // 8        — dark red
  '#b91c1c',  // 9        — darker red
  '#7f1d1d'   // 10 worst — deep red
];

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

      _peBuildCostMap();
      _peRebuildAdjLists();
      var countries = KSP_atypeCountries(_peNodes);
      _pePopulateCountryDropdowns();
      _peBuildTopoView();

      var n = _peNodes.length, e = _peEdges.length;
      if (countries.length > 0) {
        peSetStatus('Loaded: ' + n + ' nodes, ' + e + ' edges. Select countries and click ▶ Go.');
        document.getElementById('peBtnGo').disabled = false;
      }
      // If no A-type countries, _pePopulateCountryDropdowns() already set the warning status
    })
    .catch(function (err) {
      peSetStatus('⚠ Failed to load topology: ' + err.message);
      document.getElementById('peBtnGo').disabled = false;
    });
}

/* ── Build adjacency list (single bidirectional OSPF graph) ─────── */
function _peRebuildAdjLists() {
  // KSP_buildDirAdjList now synthesises the reverse direction for every edge
  // that has no explicit reverse entry, making the graph bidirectional.
  // We use this single adj list for both FWD (src→dst) and REV (dst→src) paths.
  _peAdjFwd = KSP_buildDirAdjList(_peNodes, _peEdges, _peOverrides);
}

/* ── Gather paths from ALL gateway pairs → richer alternatives ───── */
function _peGatherAllPaths(srcCountry, dstCountry, K) {
  if (!_peAdjFwd) return [];
  var gw     = KSP_atypeGateways(_peNodes);
  var srcGws = gw[srcCountry] || [];
  var dstGws = gw[dstCountry] || [];
  if (!srcGws.length || !dstGws.length) return [];

  var allPaths = [];
  var seenKeys = new Set();

  srcGws.forEach(function (srcId) {
    dstGws.forEach(function (dstId) {
      if (srcId === dstId) return;
      var paths = KSP_yen(srcId, dstId, K, _peAdjFwd);
      paths.forEach(function (p) {
        var key = p.nodes.join(',');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allPaths.push(p);
        }
      });
    });
  });

  // Sort by ascending cost, return top K
  allPaths.sort(function (a, b) { return a.totalCost - b.totalCost; });
  return allPaths.slice(0, K);
}

/* ── Export FWD + REV paths to CSV (opens in Excel) ──────────────── */
function peExportPathsCsv() {
  var srcC = document.getElementById('peSrc').value;
  var dstC = document.getElementById('peDst').value;
  if (!_peFwdPaths.length && !_peRevPaths.length) {
    alert('No paths to export. Select countries and click ▶ Go first.');
    return;
  }

  var rows = [['Direction','Rank','From Country','To Country','Total Cost (OSPF metric)','Hop Count','Path Detail']];

  function addRows(paths, dir, src, dst) {
    paths.forEach(function (p, idx) {
      var hopStr = '';
      for (var i = 0; i < p.nodes.length; i++) {
        hopStr += KSP_nodeLabel(p.nodes[i], _peNodes);
        if (i < p.hopCosts.length) hopStr += ' -[cost:' + p.hopCosts[i] + ']-> ';
      }
      rows.push([dir, idx + 1, src, dst, p.totalCost, p.nodes.length - 1, hopStr]);
    });
  }

  addRows(_peFwdPaths, 'FWD', srcC, dstC);
  addRows(_peRevPaths, 'REV', dstC, srcC);

  var csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\r\n');

  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = 'ospf-paths-' + srcC + '-' + dstC + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Country dropdowns ───────────────────────────────────────────── */
function _pePopulateCountryDropdowns() {
  var countries = KSP_atypeCountries(_peNodes);
  var srcSel = document.getElementById('peSrc');
  var dstSel = document.getElementById('peDst');
  var prevSrc = srcSel.value;
  var prevDst = dstSel.value;

  if (countries.length === 0) {
    // No A-type hostnames — show a hint and disable Go
    var hint = '<option value="">⚠ No A-type nodes (need xxx-yyy-zzz-r1 labels)</option>';
    srcSel.innerHTML = hint;
    dstSel.innerHTML = hint;
    document.getElementById('peBtnGo').disabled = true;
    peSetStatus('⚠ No A-type nodes found. Topology loaded (' + _peNodes.length +
      ' nodes) but path-explorer requires A-type hostname format (e.g. fra-par-mar-r1). ' +
      'Upload an OSPF database with structured hostnames to use K-Path analysis.');
    return;
  }

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
  document.getElementById('peBtnGo').disabled = false;
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
      // Gather paths across ALL gateway pairs — more alternatives than single-best-pair
      _peFwdPaths = _peFilterByConstraints(_peGatherAllPaths(srcCountry, dstCountry, K));
      _peRevPaths = _peFilterByConstraints(_peGatherAllPaths(dstCountry, srcCountry, K));

      _peRenderPaths();

      var fwdMsg = _peFwdPaths.length
        ? _peFwdPaths.length + ' FWD path(s) ' + srcCountry + '→' + dstCountry
        : '⚠ No FWD path ' + srcCountry + '→' + dstCountry;
      var revMsg = _peRevPaths.length
        ? _peRevPaths.length + ' REV path(s) ' + dstCountry + '→' + srcCountry
        : '⚠ No REV path ' + dstCountry + '→' + srcCountry;
      peSetStatus(fwdMsg + '  |  ' + revMsg);
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

  // PRD-19: if show-all mode is active, render all paths on topology immediately
  if (_peShowAll) {
    setTimeout(function () { _peShowAllOnTopology(paths, dir); }, 0);
  }

  paths.forEach(function (path, idx) {
    var row = document.createElement('div');
    row.className = 'pe-path-row dir-' + dir;
    row.id = 'pe-path-' + dir + '-' + idx;

    // Path quality gradient: #1 = green (best), progressively worse toward red
    var pathColor = PE_PATH_COLORS[Math.min(idx, PE_PATH_COLORS.length - 1)];
    var isBest = (idx === 0);

    // PRD-21: diversity score vs path #1 (best path)
    var diversityHtml = '';
    if (idx > 0 && paths[0]) {
      var div = _peDiversity(paths[0], path);
      var divColor = div >= 60 ? '#22c55e' : div >= 30 ? '#f59e0b' : '#ef4444';
      var divWarn = div < 30 ? ' title="⚠ Low diversity — high shared-risk with path #1"' : '';
      diversityHtml = '<span style="display:inline-flex;align-items:center;gap:2px;margin-left:4px;" ' + divWarn + '>' +
        '<span style="display:inline-block;width:32px;height:4px;background:#374151;border-radius:2px;overflow:hidden;">' +
          '<span style="display:block;width:' + div + '%;height:100%;background:' + divColor + ';"></span>' +
        '</span>' +
        '<span style="font-size:9px;color:' + divColor + ';">' + div + '%</span>' +
        (div < 30 ? '<span style="font-size:9px;color:#f59e0b;">⚠</span>' : '') +
      '</span>';
    }

    var hdr = document.createElement('div');
    hdr.className = 'pe-path-header';
    hdr.innerHTML =
      '<span class="pe-path-num" style="color:' + pathColor + '">#' + (idx + 1) + '</span>' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + pathColor + ';margin-right:4px;' + (isBest ? 'box-shadow:0 0 6px ' + pathColor + ';' : '') + '"></span>' +
      '<span class="pe-path-cost" style="color:' + pathColor + '">Cost: ' + path.totalCost + '</span>' +
      (isBest ? '<span style="font-size:9px;color:#22c55e;background:#052e16;border-radius:3px;padding:1px 5px;margin-left:2px;">BEST</span>' : '') +
      diversityHtml +
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
        var fwdCost = path.hopCosts[i];
        var revCost = _peCostMap.get(String(path.nodes[i + 1]) + ':' + String(path.nodes[i]));
        var costLabel = String(fwdCost);
        if (revCost !== undefined && revCost !== fwdCost) {
          costLabel += '<span style="color:#6b7280;font-size:9px;"> (&#8592;' + revCost + ')</span>';
        }
        hopHtml += '<span class="pe-hop-arrow">→</span><span class="pe-hop-cost">' + costLabel + '</span>';
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

      // Select/highlight — pass rank index so topology uses path quality colour
      document.querySelectorAll('.pe-path-row').forEach(function (r) { r.classList.remove('selected'); });
      row.classList.add('selected');

      if (_peShowAll) {
        // PRD-19: in show-all mode, keep all paths visible but boost the clicked one
        _peHighlightOneAmongAll(capturedDir === 'fwd' ? _peFwdPaths : _peRevPaths, capturedIdx, capturedDir);
      } else {
        _peHighlightPath(
          capturedDir === 'fwd' ? _peFwdPaths[capturedIdx] : _peRevPaths[capturedIdx],
          capturedDir,
          capturedIdx   // rank index → colour gradient
        );
      }
    });

    container.appendChild(row);
  });
}

/* ── Tab switching ───────────────────────────────────────────────── */
function peSelectTab(tab) {
  _peSelectedTab = tab;
  // Stop pulse animation and reset edge colours when switching tabs
  if (_peAnimInterval) { clearInterval(_peAnimInterval); _peAnimInterval = null; }
  if (_peVEdges && !_peShowAll) {
    var reset = _peVEdges.get().map(function (e) {
      return { id: e.id, color: { color: '#374151', highlight: '#6b7280' }, width: 1, dashes: false };
    });
    _peVEdges.update(reset);
  }
  // Toggle path list tabs
  ['fwd', 'rev'].forEach(function (t) {
    var tabId  = 'peTab' + (t === 'fwd' ? 'Fwd' : 'Rev');
    var listId = 'peList' + (t === 'fwd' ? 'Fwd' : 'Rev');
    document.getElementById(tabId).classList.toggle('active', t === tab);
    document.getElementById(listId).classList.toggle('active', t === tab);
  });
  // Audit tab
  var auditTab   = document.getElementById('peTabAudit');
  var auditPanel = document.getElementById('peAuditPanel');
  if (auditTab)   auditTab.classList.toggle('active', tab === 'audit');
  if (auditPanel) auditPanel.classList.toggle('active', tab === 'audit');

  // PRD-19: re-apply show-all overlay for the new active direction
  if (_peShowAll && (tab === 'fwd' || tab === 'rev')) {
    _peShowAllOnTopology(tab === 'fwd' ? _peFwdPaths : _peRevPaths, tab);
  }
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
      label:  _peBiLabel(e),
      color:  { color: '#374151', highlight: '#22c55e' },
      width:  1,
      font:   { color: '#6b7280', size: 9, strokeWidth: 0 },
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

  // ── Filter bar ────────────────────────────────────────────────────
  if (typeof TopoFilterBar === 'function') {
    if (_peFilterBar) _peFilterBar.destroy();
    _peFilterBar = new TopoFilterBar({
      containerId: 'peFilterBar',
      vNodes: _peVNodes,
      vEdges: _peVEdges,
      rawNodes: _peNodes,
      rawEdges: _peEdges,
      network: _peNetwork,
    });
  }
}

/* ── Highlight a path on the topology with rank-quality colour ───── */
function _peHighlightPath(path, dir, rankIdx) {
  if (!_peVEdges || !path) return;

  // Stop any existing pulse animation
  if (_peAnimInterval) { clearInterval(_peAnimInterval); _peAnimInterval = null; }

  // Use rank-based colour (green for best, red for worst).
  // Fall back to direction palette if rankIdx not provided.
  var baseColor, glowColor;
  if (rankIdx !== undefined && rankIdx !== null) {
    baseColor = PE_PATH_COLORS[Math.min(rankIdx, PE_PATH_COLORS.length - 1)];
    glowColor = baseColor;
  } else {
    var palette = PE_COLORS[dir] || PE_COLORS.fwd;
    baseColor = palette.base;
    glowColor = palette.glow;
  }
  var allEdges = _peVEdges.get();

  // Reset all edges to dim grey
  var resetUpd = allEdges.map(function (e) {
    return { id: e.id, color: { color: '#374151', highlight: '#6b7280' }, width: 1, dashes: false };
  });
  _peVEdges.update(resetUpd);

  // Identify path edges
  var pathEdgeSet = new Set(path.edges.map(function (eid) { return String(eid); }));
  var pathEdgeIds = [];
  allEdges.forEach(function (e) {
    if (pathEdgeSet.has(String(e.id))) pathEdgeIds.push(e.id);
  });

  if (!pathEdgeIds.length) return;

  // Initial highlight — rank/direction colour, dashed, wide
  var applyEdges = function (width, color) {
    var upd = pathEdgeIds.map(function (id) {
      return { id: id, color: { color: color, highlight: glowColor }, width: width, dashes: [8, 4] };
    });
    _peVEdges.update(upd);
  };

  applyEdges(4, baseColor);

  // Pulse: alternate widths to create animated dashed effect
  var tick = 0;
  _peAnimInterval = setInterval(function () {
    tick++;
    applyEdges(tick % 2 === 0 ? 3 : 5, tick % 2 === 0 ? baseColor : glowColor);
  }, 600);

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

/* Build a fast lookup: "fromId:toId" → cost, used for bi-directional edge labels */
function _peBuildCostMap() {
  _peCostMap = new Map();
  _peEdges.forEach(function (e) {
    var k = String(e.from) + ':' + String(e.to);
    if (!_peCostMap.has(k)) _peCostMap.set(k, _peEdgeCostRaw(e));
  });
}

/* Return "cost" or "fwd / rev" label for a vis.js edge */
function _peBiLabel(e) {
  var fwd = _peEdgeCostRaw(e);
  var rev = _peCostMap.get(String(e.to) + ':' + String(e.from));
  if (rev !== undefined && rev !== fwd) return fwd + ' / ' + rev;
  return String(fwd);
}

/* ════════════════════════════════════════════════════════════════════
   PRD-19 — 🗂 Show All Paths Simultaneously + SRLG Highlighting
   ════════════════════════════════════════════════════════════════════ */

function peToggleShowAll() {
  _peShowAll = !_peShowAll;
  var btn = document.getElementById('peBtnShowAll');
  if (btn) {
    btn.textContent = _peShowAll ? '🗂 All ON' : '🗂 Show All';
    btn.classList.toggle('active', _peShowAll);
  }
  if (_peAnimInterval) { clearInterval(_peAnimInterval); _peAnimInterval = null; }

  if (_peShowAll) {
    var paths = _peSelectedTab === 'rev' ? _peRevPaths : _peFwdPaths;
    _peShowAllOnTopology(paths, _peSelectedTab);
  } else {
    if (_peVEdges) {
      _peVEdges.update(_peVEdges.get().map(function (e) {
        return { id: e.id, color: { color: '#374151', highlight: '#6b7280' }, width: 1, dashes: false, title: '' };
      }));
    }
  }
}

function _peShowAllOnTopology(paths, dir) {
  if (!_peVEdges || !paths || !paths.length) return;
  if (_peAnimInterval) { clearInterval(_peAnimInterval); _peAnimInterval = null; }

  // Build edge → [pathIndices] usage map
  var edgeUsage = new Map();
  paths.forEach(function (path, idx) {
    (path.edges || []).forEach(function (eid) {
      var k = String(eid);
      if (!edgeUsage.has(k)) edgeUsage.set(k, []);
      edgeUsage.get(k).push(idx);
    });
  });

  var updates = _peVEdges.get().map(function (e) {
    var eid = String(e.id);
    if (!edgeUsage.has(eid)) {
      return { id: e.id, color: { color: '#1f2937', highlight: '#374151' }, width: 1, dashes: false, title: '' };
    }
    var users = edgeUsage.get(eid);
    var isSrlg = users.length >= 2;
    var bestIdx = Math.min.apply(null, users);
    var baseColor = isSrlg ? '#f59e0b' : PE_PATH_COLORS[Math.min(bestIdx, PE_PATH_COLORS.length - 1)];
    var width = isSrlg ? Math.min(2 + users.length, 5) : 2;
    var pathNums = users.map(function (i) { return '#' + (i + 1); }).join(', ');
    var title = isSrlg
      ? '⚠ SRLG: shared by paths ' + pathNums + ' (' + users.length + ' paths — high shared risk)'
      : 'Path ' + pathNums;
    return { id: e.id, color: { color: baseColor, highlight: baseColor }, width: width, dashes: false, title: title };
  });

  _peVEdges.update(updates);
}

/* Highlight one path among all — clicked path pulses, others dimmed but still visible */
function _peHighlightOneAmongAll(paths, selectedIdx, dir) {
  if (!_peVEdges || !paths || !paths.length) return;
  if (_peAnimInterval) { clearInterval(_peAnimInterval); _peAnimInterval = null; }

  // Build per-path edge sets
  var pathEdgeSets = paths.map(function (p) {
    return new Set((p.edges || []).map(String));
  });
  var selectedSet = pathEdgeSets[selectedIdx] || new Set();
  var selectedColor = PE_PATH_COLORS[Math.min(selectedIdx, PE_PATH_COLORS.length - 1)];

  var updates = _peVEdges.get().map(function (e) {
    var eid = String(e.id);
    if (selectedSet.has(eid)) {
      // Selected path: full bright colour, wide, dashed
      return { id: e.id, color: { color: selectedColor, highlight: selectedColor }, width: 5, dashes: [8, 4] };
    }
    // Check if any other path uses this edge (dim but visible)
    var anyOther = false;
    pathEdgeSets.forEach(function (set, i) {
      if (i !== selectedIdx && set.has(eid)) anyOther = true;
    });
    if (anyOther) {
      return { id: e.id, color: { color: '#374151', highlight: '#4b5563' }, width: 1, dashes: false };
    }
    return { id: e.id, color: { color: '#1f2937', highlight: '#374151' }, width: 1, dashes: false };
  });
  _peVEdges.update(updates);

  // Pulse the selected path edges
  var tick = 0;
  _peAnimInterval = setInterval(function () {
    tick++;
    var w = tick % 2 === 0 ? 4 : 6;
    var upd = [];
    _peVEdges.get().forEach(function (e) {
      if (selectedSet.has(String(e.id))) upd.push({ id: e.id, width: w });
    });
    if (upd.length) _peVEdges.update(upd);
  }, 600);

  // Focus on selected path nodes
  if (_peNetwork && paths[selectedIdx] && paths[selectedIdx].nodes.length) {
    _peNetwork.fit({ nodes: paths[selectedIdx].nodes, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
  }
}

/* ════════════════════════════════════════════════════════════════════
   PRD-21 — 📊 Path Diversity Score
   ════════════════════════════════════════════════════════════════════ */

function _peDiversity(pathA, pathB) {
  if (!pathA || !pathB || !pathA.edges || !pathB.edges) return 0;
  var setA = new Set(pathA.edges.map(String));
  var setB = new Set(pathB.edges.map(String));
  var intersection = 0;
  setA.forEach(function (e) { if (setB.has(e)) intersection++; });
  var union = setA.size + setB.size - intersection;
  return union === 0 ? 100 : Math.round((1 - intersection / union) * 100);
}

/* ════════════════════════════════════════════════════════════════════
   PRD-20 — 🎯 Constraint-Based Path Filtering
   ════════════════════════════════════════════════════════════════════ */

function peAddConstraint(type, nodeId) {
  if (!nodeId) return;
  var list = _peConstraints[type];
  if (list.indexOf(nodeId) === -1) {
    list.push(nodeId);
    _peRenderConstraintChips(type);
  }
}

function peRemoveConstraint(type, nodeId) {
  _peConstraints[type] = _peConstraints[type].filter(function (n) { return n !== nodeId; });
  _peRenderConstraintChips(type);
}

function peClearConstraints() {
  _peConstraints = { mustPass: [], mustAvoid: [] };
  _peRenderConstraintChips('mustPass');
  _peRenderConstraintChips('mustAvoid');
}

function _peRenderConstraintChips(type) {
  var containerId = type === 'mustPass' ? 'peConstraintPassChips' : 'peConstraintAvoidChips';
  var container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  _peConstraints[type].forEach(function (nodeId) {
    var n = _peNodes.find(function (x) { return String(x.id) === String(nodeId); });
    var lbl = n ? (n.label || String(n.id)) : String(nodeId);
    var chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;background:#1e2a38;border:1px solid #3d5066;border-radius:12px;padding:2px 8px;font-size:11px;color:#c8d8e8;margin:2px;';
    chip.innerHTML = _peEscHtml(lbl) + '<button onclick="peRemoveConstraint(\'' + type + '\',\'' + _peEscHtml(nodeId) + '\')" style="background:none;border:none;color:#f87171;cursor:pointer;padding:0;font-size:12px;line-height:1;">×</button>';
    container.appendChild(chip);
  });
  var countId = type === 'mustPass' ? 'pePassCount' : 'peAvoidCount';
  var countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = _peConstraints[type].length ? '(' + _peConstraints[type].length + ')' : '';
}

function _peConstraintNodeSearch(inputId, type) {
  var query = (document.getElementById(inputId) || {}).value || '';
  query = query.toLowerCase().trim();
  var listId = type === 'mustPass' ? 'peConstraintPassResults' : 'peConstraintAvoidResults';
  var results = document.getElementById(listId);
  if (!results) return;
  if (!query) { results.style.display = 'none'; return; }
  var matches = _peNodes.filter(function (n) {
    return (n.label || '').toLowerCase().includes(query) || String(n.id).toLowerCase().includes(query);
  }).slice(0, 10);
  if (!matches.length) { results.style.display = 'none'; return; }
  results.innerHTML = matches.map(function (n) {
    var lbl = n.label || String(n.id);
    return '<div class="il-search-item" style="padding:3px 8px;cursor:pointer;font-size:11px;color:#c8d8e8;" onclick="peAddConstraint(\'' + type + '\',\'' + _peEscHtml(String(n.id)) + '\');document.getElementById(\'' + inputId + '\').value=\'\';document.getElementById(\'' + listId + '\').style.display=\'none\';">' + _peEscHtml(lbl) + '</div>';
  }).join('');
  results.style.display = 'block';
}

function _peFilterByConstraints(paths) {
  var mustPass  = _peConstraints.mustPass;
  var mustAvoid = _peConstraints.mustAvoid;
  if (!mustPass.length && !mustAvoid.length) return paths;
  return paths.filter(function (path) {
    var nodeSet = new Set(path.nodes.map(String));
    if (mustAvoid.some(function (n) { return nodeSet.has(String(n)); })) return false;
    if (mustPass.length && !mustPass.every(function (n) { return nodeSet.has(String(n)); })) return false;
    return true;
  });
}

function peToggleConstraints() {
  var body = document.getElementById('peConstraintBody');
  var toggle = document.getElementById('peConstraintToggle');
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  var cnt = (_peConstraints.mustPass.length + _peConstraints.mustAvoid.length);
  toggle.textContent = (isOpen ? '▶' : '▼') + ' Path Constraints ' + (cnt ? '(' + cnt + ' active)' : '');
}

/* ════════════════════════════════════════════════════════════════════
   PRD-14 — ⚡ Asymmetry Audit
   ════════════════════════════════════════════════════════════════════ */

function peRunAudit() {
  var countries = _peAdjFwd ? KSP_atypeCountries(_peNodes) : [];
  if (countries.length < 2) {
    document.getElementById('peAuditSummary').textContent =
      '⚠ Load a topology with at least 2 A-type countries first.';
    return;
  }

  var btn = document.getElementById('peBtnRunAudit');
  btn.disabled = true;
  btn.textContent = '⏳ Running…';
  document.getElementById('peAuditSummary').textContent = 'Computing all-pairs paths…';
  document.getElementById('peAuditRows').innerHTML = '';

  // Yield to browser then compute synchronously (fast for N≤20)
  setTimeout(function () {
    var results = [];
    for (var i = 0; i < countries.length; i++) {
      for (var j = 0; j < countries.length; j++) {
        if (i === j) continue;
        var src = countries[i], dst = countries[j];
        var fwdPair = KSP_bestPair(src, dst, _peNodes, _peAdjFwd);
        var revPair = KSP_bestPair(dst, src, _peNodes, _peAdjFwd);
        var fwdCost = fwdPair ? fwdPair.cost : Infinity;
        var revCost = revPair ? revPair.cost : Infinity;

        var delta = (isFinite(fwdCost) && isFinite(revCost)) ? (revCost - fwdCost) : null;
        var pct   = (delta !== null && fwdCost > 0) ? Math.abs(delta) / fwdCost * 100 : null;
        var sev   = _peAuditSeverity(pct, fwdCost, revCost);

        results.push({ src: src, dst: dst, fwdCost: fwdCost, revCost: revCost,
                       delta: delta, pct: pct, sev: sev });
      }
    }

    _peAuditResults = results;
    btn.disabled = false;
    btn.textContent = '▶ Run Audit';
    document.getElementById('peBtnAuditTsv').style.display = '';
    peAuditFilterByThreshold();
  }, 0);
}

function _peAuditSeverity(pct, fwdCost, revCost) {
  if (!isFinite(fwdCost) || !isFinite(revCost)) return 'NONE';  // no route one/both ways
  if (pct === null) return 'NONE';
  if (pct < 1)   return 'SYM';
  if (pct < 5)   return 'LOW';
  if (pct < 15)  return 'MED';
  return 'HIGH';
}

function _peAuditSevLabel(sev, pct) {
  var badges = { HIGH:'🔴 HIGH', MED:'🟡 MED', LOW:'🔵 LOW', SYM:'🟢 SYM', NONE:'⚫ NO ROUTE' };
  return badges[sev] || sev;
}

function peAuditFilterByThreshold() {
  var threshold = parseFloat(document.getElementById('peAuditThreshold').value) || 0;
  var tbody = document.getElementById('peAuditRows');
  tbody.innerHTML = '';

  if (!_peAuditResults.length) return;

  var shown = 0, highCount = 0, medCount = 0, symCount = 0, noRouteCount = 0;

  _peAuditResults.forEach(function (r) {
    // Filter: always show NO ROUTE and above-threshold
    var aboveThreshold = (r.pct !== null && r.pct >= threshold) || r.sev === 'NONE';
    if (!aboveThreshold && r.sev !== 'HIGH' && r.sev !== 'MED') return;
    if (r.pct !== null && r.pct < threshold) return;

    shown++;
    if (r.sev === 'HIGH') highCount++;
    else if (r.sev === 'MED') medCount++;
    else if (r.sev === 'SYM' || r.sev === 'LOW') symCount++;
    else noRouteCount++;

    var tr = document.createElement('tr');
    tr.className = 'audit-row';
    var fwdStr = isFinite(r.fwdCost) ? r.fwdCost : '∞';
    var revStr = isFinite(r.revCost) ? r.revCost : '∞';
    var deltaStr = r.delta !== null ? (r.delta >= 0 ? '+' : '') + r.delta : '—';
    var pctStr  = r.pct !== null ? r.pct.toFixed(1) + '%' : '—';
    var sevHtml = '<span class="audit-sev-' + r.sev + '">' + _peAuditSevLabel(r.sev, r.pct) + '</span>';
    var viewBtn = '<button class="pe-audit-view-btn" onclick="peAuditViewPair(\'' +
                  r.src + '\',\'' + r.dst + '\')">🛤 View</button>';

    tr.innerHTML =
      '<td>' + _peEscHtml(r.src) + ' → ' + _peEscHtml(r.dst) + '</td>' +
      '<td>' + fwdStr + '</td>' +
      '<td>' + revStr + '</td>' +
      '<td>' + deltaStr + '</td>' +
      '<td>' + pctStr  + '</td>' +
      '<td>' + sevHtml + '</td>' +
      '<td>' + viewBtn + '</td>';
    tbody.appendChild(tr);
  });

  var total = _peAuditResults.filter(function (r) { return r.sev !== 'NONE'; }).length;
  document.getElementById('peAuditSummary').textContent =
    'Found ' + shown + ' pairs at threshold ≥' + threshold + '% · ' +
    highCount + ' HIGH · ' + medCount + ' MED · ' + symCount + ' LOW/SYM · ' +
    noRouteCount + ' NO ROUTE · ' + total + ' total pairs computed';
}

function peAuditViewPair(src, dst) {
  // Switch to Paths tab and select this country pair
  peSelectTab('fwd');
  var srcSel = document.getElementById('peSrcCountry');
  var dstSel = document.getElementById('peDstCountry');
  if (srcSel) {
    for (var i = 0; i < srcSel.options.length; i++) {
      if (srcSel.options[i].value === src) { srcSel.selectedIndex = i; break; }
    }
  }
  if (dstSel) {
    for (var j = 0; j < dstSel.options.length; j++) {
      if (dstSel.options[j].value === dst) { dstSel.selectedIndex = j; break; }
    }
  }
  // Trigger path computation
  if (typeof peComputePaths === 'function') peComputePaths();
}

function peAuditCopyTsv() {
  if (!_peAuditResults.length) return;
  var threshold = parseFloat(document.getElementById('peAuditThreshold').value) || 0;
  var lines = ['Pair\tFWD Cost\tREV Cost\tDelta\t% Asymmetry\tSeverity'];
  _peAuditResults.forEach(function (r) {
    if (r.pct !== null && r.pct < threshold && r.sev !== 'NONE') return;
    lines.push([
      r.src + ' → ' + r.dst,
      isFinite(r.fwdCost) ? r.fwdCost : 'inf',
      isFinite(r.revCost) ? r.revCost : 'inf',
      r.delta !== null ? r.delta : '',
      r.pct !== null ? r.pct.toFixed(1) + '%' : '',
      r.sev
    ].join('\t'));
  });
  try {
    navigator.clipboard.writeText(lines.join('\n'));
    peSetStatus('✓ TSV copied to clipboard (' + lines.length + ' rows)');
  } catch (e) {
    peSetStatus('⚠ Clipboard unavailable — open browser console for TSV');
    console.log(lines.join('\n'));
  }
}
