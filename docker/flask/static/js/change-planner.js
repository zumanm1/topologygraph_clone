/**
 * change-planner.js  —  OSPF Change Planner Page Logic
 * ======================================================
 * PRD-10: /change-planner
 *
 * Features:
 *  - Multi-router cost change table (bulk edits)
 *  - Impact analysis (before vs after Dijkstra across all A-type country pairs)
 *  - Animated topology: old paths (red, fade) → new paths (green, grow)
 *  - Affected A-type country label pulsing (orange, 3×)
 *  - Count-up animation for summary numbers
 *  - CSV export
 */

/* ── State ───────────────────────────────────────────────────────── */
var _cpNodes    = [];
var _cpEdges    = [];
var _cpAdjBefore = null;
var _cpAdjAfter  = null;
var _cpNetwork   = null;
var _cpVNodes    = null;
var _cpVEdges    = null;
var _cpPlanRows  = [];  // { id, edgeId, mode, fwd, rev }
var _cpRowIdSeq  = 0;
var _cpImpact    = null; // last computed impact
var _cpAnimating = false;
var _cpGraphTime = '';
var _cpSelectedEdgeId  = null;  // edge selected via topology click
var _cpPrevHighlightId = null;  // previously highlighted edge (reset on next select)

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  _cpGraphTime = _cpParam('graph_time') || _cpLS('ospf_graph_time') || '';
  cpLoadGraphTimes().then(function () {
    if (_cpGraphTime) cpLoadTopology(_cpGraphTime);
  });
});

/* ── Graph time dropdown ─────────────────────────────────────────── */
function cpLoadGraphTimes() {
  return fetch('/api/graph-times')
    .then(function (r) { return r.ok ? r.json() : { graph_time_list: [] }; }).catch(function () { return { graph_time_list: [] }; })
    .then(function (data) {
      var sel = document.getElementById('cpGraphTime');
      var list = data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []);
      if (!Array.isArray(list)) list = [];
      if (_cpGraphTime && list.indexOf(_cpGraphTime) === -1) list = [_cpGraphTime].concat(list);
      sel.innerHTML = '';
      if (list.length === 0) {
        sel.innerHTML = '<option value="">No graphs — load one on the main page</option>';
        return;
      }
      list.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        if (t === _cpGraphTime) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!_cpGraphTime && list.length) _cpGraphTime = list[list.length - 1];
    });
}

function cpOnGraphTimeChange(t) {
  _cpGraphTime = t;
  cpLoadTopology(t);
}

/* ── Load topology via POST /upload-ospf-lsdb-from-js ───────────── */
function cpLoadTopology(gt) {
  if (!gt) return;
  cpSetStatus('<span class="cp-spinner"></span> Loading topology…');
  document.getElementById('cpBtnAnalyse').disabled = true;

  KSP_loadTopology(gt)
    .then(function (result) {
      _cpNodes = result.nodes;
      _cpEdges = result.edges;
      _cpAdjBefore = KSP_buildDirAdjList(_cpNodes, _cpEdges, {});
      _cpBuildVis();
      _cpPopulateNodeDropdowns();
      _cpSetupEdgeClickHandler();
      cpSetStatus('Loaded ' + _cpNodes.length + ' nodes, ' + _cpEdges.length + ' edges. Add changes and click Analyse.');
      document.getElementById('cpBtnAnalyse').disabled = false;
    })
    .catch(function (err) {
      cpSetStatus('⚠ Load error: ' + err.message);
    });
}

/* ── Vis.js topology ─────────────────────────────────────────────── */
function _cpBuildVis() {
  var container = document.getElementById('cpTopoContainer');
  var visNodes = _cpNodes.map(function (n) {
    var isAtype = !!KSP_parseAtype(n.label || n.id || '');
    return {
      id: n.id, label: n.label || String(n.id),
      color: isAtype ? { background:'#1e40af', border:'#3b82f6' } : { background:'#374151', border:'#6b7280' },
      font:  { color:'#e0e8f0', size:10 }, size: isAtype ? 12 : 8
    };
  });
  var visEdges = _cpEdges.map(function (e) {
    return { id:e.id, from:e.from, to:e.to, label:e.label||'', color:{color:'#374151'}, width:1,
      font:{ color:'#6b7280', size:8, strokeWidth:0 }, arrows:{ to:{ enabled:true, scaleFactor:0.4 } } };
  });
  _cpVNodes = new vis.DataSet(visNodes);
  _cpVEdges = new vis.DataSet(visEdges);
  _cpNetwork = new vis.Network(container, { nodes:_cpVNodes, edges:_cpVEdges }, {
    physics:{ enabled:true, solver:'forceAtlas2Based',
      forceAtlas2Based:{ gravitationalConstant:-30, springLength:100, springConstant:0.02 },
      stabilization:{ iterations:150 }
    },
    interaction:{ hover:true }, layout:{ improvedLayout:false }
  });
  _cpNetwork.on('stabilizationIterationsDone', function () { _cpNetwork.setOptions({ physics:{ enabled:false } }); });
}

/* ── Plan row management ─────────────────────────────────────────── */
function cpAddRow() {
  _cpPlanRows.push({ id: ++_cpRowIdSeq, edgeId:'', mode:'sym', fwd:'', rev:'' });
  cpRenderPlanTable();
}

function cpClearPlan() {
  _cpPlanRows = [];
  cpRenderPlanTable();
  document.getElementById('cpImpactSection').style.display = 'none';
  document.getElementById('cpBtnAnimate').disabled = true;
}

function cpRenderPlanTable() {
  var tbody = document.getElementById('cpPlanRows');
  tbody.innerHTML = '';
  _cpPlanRows.forEach(function (row) {
    var tr = document.createElement('tr');
    var cid = row.id;
    tr.innerHTML =
      '<td><input type="text" placeholder="edge ID" value="' + _cpEsc(row.edgeId) + '" ' +
        'onchange="cpRowUpdate(' + cid + ',\'edgeId\',this.value)"></td>' +
      '<td><select onchange="cpRowUpdate(' + cid + ',\'mode\',this.value)">' +
        '<option value="sym"' + (row.mode==='sym'?' selected':'') + '>SYM</option>' +
        '<option value="asym"' + (row.mode==='asym'?' selected':'') + '>ASYM</option>' +
      '</select></td>' +
      '<td><input type="number" min="1" placeholder="fwd" value="' + (row.fwd||'') + '" ' +
        'onchange="cpRowUpdate(' + cid + ',\'fwd\',this.value)"></td>' +
      '<td><input type="number" min="1" placeholder="rev" value="' + (row.rev||'') + '" ' +
        (row.mode==='sym'?'disabled ':'') +
        'onchange="cpRowUpdate(' + cid + ',\'rev\',this.value)" id="cpRev' + cid + '"></td>' +
      '<td><button class="cp-del-btn" onclick="cpRowDelete(' + cid + ')">✕</button></td>';
    tbody.appendChild(tr);
  });
}

function cpRowUpdate(id, field, value) {
  var row = _cpPlanRows.find(function(r){ return r.id===id; });
  if (!row) return;
  row[field] = value;
  if (field === 'mode') {
    var rev = document.getElementById('cpRev' + id);
    if (rev) rev.disabled = (value === 'sym');
  }
}

function cpRowDelete(id) {
  _cpPlanRows = _cpPlanRows.filter(function(r){ return r.id!==id; });
  cpRenderPlanTable();
}

/* ── Build override map from plan rows ───────────────────────────── */
function _cpBuildOverrides() {
  var ov = {};
  _cpPlanRows.forEach(function (row) {
    var eid = String(row.edgeId).trim();
    if (!eid) return;
    var fwd = parseFloat(row.fwd);
    var rev = parseFloat(row.rev);
    if (row.mode === 'sym' && !isNaN(fwd) && fwd > 0) {
      ov[eid] = { sym: fwd };
    } else if (row.mode === 'asym' && !isNaN(fwd) && fwd > 0 && !isNaN(rev) && rev > 0) {
      ov[eid] = { fwd: fwd, rev: rev };
    }
  });
  return ov;
}

/* ── Analyse impact ──────────────────────────────────────────────── */
function cpAnalyse() {
  if (!_cpAdjBefore) { cpSetStatus('⚠ Load a topology first.'); return; }
  var ov = _cpBuildOverrides();
  if (!Object.keys(ov).length) { cpSetStatus('⚠ Add at least one cost change to the plan.'); return; }
  // Warn about unknown edge IDs (non-blocking)
  var _edgeIdSet = new Set(_cpEdges.map(function(e){ return String(e.id); }));
  var _unknownIds = _cpPlanRows.map(function(r){ return String(r.edgeId).trim(); })
    .filter(function(eid){ return eid && !_edgeIdSet.has(eid); });
  if (_unknownIds.length) {
    cpSetStatus('⚠ Unknown edge IDs: ' + _unknownIds.join(', ') + ' — verify they exist in the loaded topology.');
  }

  cpSetStatus('<span class="cp-spinner"></span> Computing impact across all country pairs…');
  document.getElementById('cpBtnAnalyse').disabled = true;

  setTimeout(function () {
    try {
      _cpAdjAfter = KSP_buildDirAdjList(_cpNodes, _cpEdges, ov);
      _cpImpact = _cpComputeImpact();
      _cpRenderImpact();
      document.getElementById('cpBtnAnimate').disabled = false;
      _cpEnableReport();
      cpSetStatus('Analysis complete. ' + _cpImpact.affected + ' country pairs affected.');
    } catch (err) {
      cpSetStatus('⚠ Analysis error: ' + err.message);
    }
    document.getElementById('cpBtnAnalyse').disabled = false;
  }, 20);
}

function _cpComputeImpact() {
  var gw = KSP_atypeGateways(_cpNodes);
  var countries = Object.keys(gw).sort();
  var affected = 0, improved = 0, degraded = 0;
  var pairs = [];

  for (var i = 0; i < countries.length; i++) {
    for (var j = 0; j < countries.length; j++) {
      if (i === j) continue;
      var srcC = countries[i], dstC = countries[j];
      var pairB = KSP_bestPair(srcC, dstC, _cpNodes, _cpAdjBefore);
      var pairA = KSP_bestPair(srcC, dstC, _cpNodes, _cpAdjAfter);
      var costB = pairB ? pairB.cost : Infinity;
      var costA = pairA ? pairA.cost : Infinity;
      if (costA === costB) continue;
      affected++;
      var delta = costA - costB;
      if (delta < 0) improved++; else degraded++;
      pairs.push({ src: srcC, dst: dstC, before: costB, after: costA, delta: delta });
    }
  }
  pairs.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });

  var risk = 'LOW';
  if (degraded > 5 || (degraded / Math.max(affected, 1)) > 0.5) risk = 'HIGH';
  else if (degraded > 0) risk = 'MEDIUM';

  return { affected: affected, improved: improved, degraded: degraded, pairs: pairs, risk: risk };
}

function _cpRenderImpact() {
  var imp = _cpImpact;
  document.getElementById('cpImpactSection').style.display = '';

  // Animate counters
  _cpCountUp('cpStatAffected', imp.affected);
  _cpCountUp('cpStatImproved', imp.improved);
  _cpCountUp('cpStatDegraded', imp.degraded);

  // Risk badge
  var riskClass = { LOW:'risk-low', MEDIUM:'risk-medium', HIGH:'risk-high' }[imp.risk] || 'risk-low';
  document.getElementById('cpRiskBadge').innerHTML = '<span class="risk-badge ' + riskClass + '">' + imp.risk + '</span>';

  // Diff table
  var tbody = document.getElementById('cpDiffRows');
  tbody.innerHTML = '';
  imp.pairs.slice(0, 50).forEach(function (p) {
    var tr = document.createElement('tr');
    tr.className = p.delta < 0 ? 'improved' : 'degraded';
    tr.style.cursor = 'pointer';
    tr.title = 'Click to see before/after path detail';
    var sign = p.delta > 0 ? '+' : '';
    tr.innerHTML = '<td>' + _cpEsc(p.src) + '→' + _cpEsc(p.dst) + ' <span style="font-size:9px;color:#6b7280;">▼ paths</span></td>' +
      '<td>' + (p.before === Infinity ? '∞' : p.before) + '</td>' +
      '<td>' + (p.after  === Infinity ? '∞' : p.after)  + '</td>' +
      '<td>' + sign + p.delta + '</td>';
    var capturedP = p;
    tr.addEventListener('click', function () { cpExpandPairDetail(capturedP, tr, tbody); });
    tbody.appendChild(tr);
  });
}

/* ════════════════════════════════════════════════════════════════════
   PRD-22 — K-Path Before/After Detail View (click row in impact table)
   ════════════════════════════════════════════════════════════════════ */

var _cpDetailRow = null;  // currently expanded detail <tr>

function cpExpandPairDetail(pair, clickedTr, tbody) {
  // Remove any existing detail row
  if (_cpDetailRow && _cpDetailRow.parentNode) {
    _cpDetailRow.parentNode.removeChild(_cpDetailRow);
    _cpDetailRow = null;
    // If same row was clicked again, just collapse
    if (clickedTr.dataset.expanded === 'true') {
      clickedTr.dataset.expanded = 'false';
      return;
    }
  }
  // Mark all rows as not expanded
  tbody.querySelectorAll('tr[data-expanded]').forEach(function (r) { r.dataset.expanded = 'false'; });
  clickedTr.dataset.expanded = 'true';

  var src = pair.src;
  var dst = pair.dst;
  var K3 = 3;

  // Get gateways for this pair
  var gw = KSP_atypeGateways(_cpNodes);
  var srcGws = gw[src] || [];
  var dstGws = gw[dst] || [];

  function gatherPaths(adj, srcGwList, dstGwList) {
    var all = [], seen = new Set();
    srcGwList.forEach(function (s) {
      dstGwList.forEach(function (d) {
        if (s === d) return;
        KSP_yen(s, d, K3, adj).forEach(function (p) {
          var k = p.nodes.join(',');
          if (!seen.has(k)) { seen.add(k); all.push(p); }
        });
      });
    });
    all.sort(function (a, b) { return a.totalCost - b.totalCost; });
    return all.slice(0, K3);
  }

  var pathsBefore = (_cpAdjBefore && srcGws.length && dstGws.length) ? gatherPaths(_cpAdjBefore, srcGws, dstGws) : [];
  var pathsAfter  = (_cpAdjAfter  && srcGws.length && dstGws.length) ? gatherPaths(_cpAdjAfter,  srcGws, dstGws) : [];

  function renderPathMini(paths, color) {
    if (!paths.length) return '<span style="color:#6b7280;font-size:11px;">No route</span>';
    return paths.map(function (p, i) {
      var hops = p.nodes.map(function (nid) {
        var n = _cpNodes.find(function (x) { return String(x.id) === String(nid); });
        return n ? (n.label || String(nid)) : String(nid);
      }).join('<span style="color:#4a9eff;">→</span>');
      return '<div style="font-size:10px;color:#c8d8e8;margin:2px 0;">' +
        '<span style="color:' + color + ';font-size:9px;font-weight:700;">#' + (i + 1) + ' </span>' +
        '<span style="color:' + color + ';">cost:' + p.totalCost + '</span> ' + hops + '</div>';
    }).join('');
  }

  var detailHtml =
    '<td colspan="4" style="background:#111827;padding:8px 12px;border-top:1px solid #1f2937;">' +
    '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">' +
    '<span style="font-size:11px;color:#9ca3af;">Show on topology:</span>' +
    '<button onclick="cpShowPathsOnTopo(\'' + _cpEsc(src) + '\',\'' + _cpEsc(dst) + '\',\'before\')" style="font-size:10px;background:#7c2d12;color:#fb923c;border:1px solid #f97316;border-radius:3px;padding:2px 8px;cursor:pointer;">🔴 Before</button>' +
    '<button onclick="cpShowPathsOnTopo(\'' + _cpEsc(src) + '\',\'' + _cpEsc(dst) + '\',\'after\')"  style="font-size:10px;background:#14532d;color:#4ade80;border:1px solid #22c55e;border-radius:3px;padding:2px 8px;cursor:pointer;">🟢 After</button>' +
    '<button onclick="cpShowPathsOnTopo(\'' + _cpEsc(src) + '\',\'' + _cpEsc(dst) + '\',\'both\')"  style="font-size:10px;background:#1e3a5f;color:#60a5fa;border:1px solid #3b82f6;border-radius:3px;padding:2px 8px;cursor:pointer;">🔵 Both</button>' +
    '</div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
    '<div style="flex:1;min-width:200px;">' +
    '<div style="font-size:10px;color:#f97316;font-weight:700;margin-bottom:3px;">⬅ Before (cost: ' + (pair.before === Infinity ? '∞' : pair.before) + ')</div>' +
    renderPathMini(pathsBefore, '#f97316') +
    '</div>' +
    '<div style="flex:1;min-width:200px;">' +
    '<div style="font-size:10px;color:#22c55e;font-weight:700;margin-bottom:3px;">➡ After (cost: ' + (pair.after === Infinity ? '∞' : pair.after) + ')</div>' +
    renderPathMini(pathsAfter, '#22c55e') +
    '</div>' +
    '</div>' +
    '</td>';

  var detailTr = document.createElement('tr');
  detailTr.style.background = '#111827';
  detailTr.innerHTML = detailHtml;
  _cpDetailRow = detailTr;
  clickedTr.insertAdjacentElement('afterend', detailTr);

  // Default: show "both" on topology
  cpShowPathsOnTopo(src, dst, 'both');
}

function cpShowPathsOnTopo(src, dst, mode) {
  if (!_cpVEdges) return;
  var gw = KSP_atypeGateways(_cpNodes);
  var srcGws = gw[src] || [];
  var dstGws = gw[dst] || [];

  function getTopPath(adj) {
    var best = null;
    srcGws.forEach(function (s) {
      dstGws.forEach(function (d) {
        if (s === d) return;
        var paths = KSP_yen(s, d, 1, adj);
        if (paths.length && (!best || paths[0].totalCost < best.totalCost)) best = paths[0];
      });
    });
    return best;
  }

  var pathBefore = (mode !== 'after'  && _cpAdjBefore) ? getTopPath(_cpAdjBefore) : null;
  var pathAfter  = (mode !== 'before' && _cpAdjAfter)  ? getTopPath(_cpAdjAfter)  : null;

  // Reset all edges to dim
  _cpVEdges.update(_cpVEdges.get().map(function (e) {
    return { id: e.id, color: { color: '#1f2937' }, width: 1, dashes: false };
  }));

  function applyPath(path, color, dashes) {
    if (!path || !path.edges) return;
    var edgeSet = new Set(path.edges.map(String));
    _cpVEdges.update(_cpVEdges.get().filter(function (e) {
      return edgeSet.has(String(e.id));
    }).map(function (e) {
      return { id: e.id, color: { color: color }, width: 4, dashes: dashes };
    }));
  }

  applyPath(pathBefore, '#f97316', [8, 4]);  // orange dashed = old path
  applyPath(pathAfter,  '#22c55e', false);    // green solid = new path
}

/* ── Animation sequence ──────────────────────────────────────────── */
function cpAnimate() {
  if (_cpAnimating || !_cpImpact || !_cpVEdges) return;
  if (!_cpAdjBefore || !_cpAdjAfter) { cpSetStatus('⚠ Run Analyse first.'); return; }

  _cpAnimating = true;
  document.getElementById('cpBtnAnimate').disabled = true;
  var ov = _cpBuildOverrides();

  // Collect changed edge IDs
  var changedEdgeIds = Object.keys(ov);
  var affectedCountries = new Set();
  _cpImpact.pairs.forEach(function (p) { affectedCountries.add(p.src); affectedCountries.add(p.dst); });

  // Step 0: Reset all edges to neutral
  var allEdges = _cpVEdges.get();
  _cpVEdges.update(allEdges.map(function(e){ return { id:e.id, color:{ color:'#374151' }, width:1 }; }));

  // --- Phase 1 (0–500ms): Highlight changed edges RED (old paths) ---
  document.getElementById('cpAnimStatus').textContent = '🔴 Highlighting current paths before change…';
  _cpVEdges.update(changedEdgeIds.map(function (eid) {
    return { id: eid, color:{ color:'#ef4444' }, width:5 };
  }));

  setTimeout(function () {
    // --- Phase 2 (500–1000ms): Fade out red → show green (new) ---
    document.getElementById('cpAnimStatus').textContent = '🟢 Applying changes — new paths emerging…';
    _cpVEdges.update(changedEdgeIds.map(function (eid) {
      return { id: eid, color:{ color:'#374151' }, width:1 };
    }));

    // Recolor changed edges green
    setTimeout(function () {
      _cpVEdges.update(changedEdgeIds.map(function (eid) {
        return { id: eid, color:{ color:'#22c55e' }, width:5 };
      }));

      // --- Phase 3 (1000–1500ms): Pulse affected country nodes ---
      document.getElementById('cpAnimStatus').textContent = '💥 Pulsing affected country nodes…';
      _cpPulseAffectedNodes(affectedCountries, 3);

      setTimeout(function () {
        // --- Phase 4 (1500ms+): Show count-up summary ---
        document.getElementById('cpAnimStatus').textContent = '✅ Change analysis complete — review impact below.';
        _cpCountUp('cpStatAffected', _cpImpact.affected, true);
        _cpCountUp('cpStatImproved', _cpImpact.improved, true);
        _cpCountUp('cpStatDegraded', _cpImpact.degraded, true);

        // Restore neutral after a delay
        setTimeout(function () {
          _cpVEdges.update(changedEdgeIds.map(function (eid) {
            return { id: eid, color:{ color:'#7c3aed' }, width:3 }; // violet = modified
          }));
          document.getElementById('cpAnimStatus').textContent = '🟣 Modified edges shown in violet. Run again to re-animate.';
          _cpAnimating = false;
          document.getElementById('cpBtnAnimate').disabled = false;
        }, 2000);
      }, 500);
    }, 200);
  }, 500);
}

function _cpPulseAffectedNodes(countries, times) {
  if (!_cpVNodes || times <= 0) return;
  var allNodes = _cpVNodes.get();
  var affectedIds = allNodes.filter(function (n) {
    var label = n.label || '';
    var parsed = KSP_parseAtype(label);
    return parsed && countries.has(parsed.country);
  }).map(function (n) { return n.id; });

  var pulseCount = 0;
  var interval = setInterval(function () {
    var orange = (pulseCount % 2 === 0);
    _cpVNodes.update(affectedIds.map(function (id) {
      return { id: id, color: orange ? { background:'#ea580c', border:'#f97316' } : { background:'#1e40af', border:'#3b82f6' } };
    }));
    pulseCount++;
    if (pulseCount >= times * 2) {
      clearInterval(interval);
      // Restore original colors
      _cpVNodes.update(affectedIds.map(function (id) {
        return { id: id, color: { background:'#1e40af', border:'#3b82f6' } };
      }));
    }
  }, 220);
}

/* ── CSV Export ──────────────────────────────────────────────────── */
function cpExportCSV() {
  if (!_cpImpact) { cpSetStatus('⚠ Run Analyse first.'); return; }
  var rows = [['Route', 'Before', 'After', 'Delta']];
  _cpImpact.pairs.forEach(function (p) {
    rows.push([p.src + '>' + p.dst, p.before, p.after, p.delta]);
  });
  var csv = rows.map(function (r) { return r.join(','); }).join('\n');
  var blob = new Blob([csv], { type:'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ospf-change-impact-' + (_cpGraphTime || 'export') + '.csv';
  a.click();
}

/* ── Utilities ───────────────────────────────────────────────────── */
function cpSetStatus(html) { document.getElementById('cpStatus').innerHTML = html; }

function _cpCountUp(elId, target, animate) {
  var el = document.getElementById(elId);
  if (!el) return;
  if (!animate) { el.textContent = target; return; }
  var start = 0, duration = 600, step = Math.ceil(target / 20) || 1;
  var timer = setInterval(function () {
    start += step;
    if (start >= target) { start = target; clearInterval(timer); el.classList.add('cp-count-anim'); }
    el.textContent = start;
  }, duration / Math.max(target / step, 1));
}

function _cpParam(name) { return new URLSearchParams(window.location.search).get(name) || ''; }
function _cpLS(key) { try { return localStorage.getItem(key) || ''; } catch(e) { return ''; } }
function _cpEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ════════════════════════════════════════════════════════════════════
   PRD-16 — 💾 Save Plan / 📂 Load Plan
   ════════════════════════════════════════════════════════════════════ */

var CP_SCHEMA = 'ospf-change-scenario';

function cpSavePlan() {
  if (!_cpRows || !_cpRows.length) {
    cpSetStatus('⚠ Nothing to save — add at least one change row first.');
    return;
  }
  var desc = (document.getElementById('cpDescription') || {}).value || '';
  var data = {
    version:    '1.0',
    schema:     CP_SCHEMA,
    created:    new Date().toISOString(),
    graph_time: _cpGraphTime || '',
    description: desc.slice(0, 500),
    author:     '',
    changes:    _cpRows.map(function (r) {
      return { id: r.id, edgeId: r.edgeId, mode: r.mode, fwd: r.fwd, rev: r.rev };
    })
  };
  var json  = JSON.stringify(data, null, 2);
  var fname = 'change-plan-' + (_cpGraphTime || 'plan') + '-' +
    new Date().toISOString().slice(0,10).replace(/-/g,'') + '.json';
  var blob = new Blob([json], { type: 'application/json' });
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  cpSetStatus('✓ Plan saved: ' + fname);
}

function cpLoadPlan() {
  var inp = document.getElementById('cpFileInput');
  if (inp) inp.click();
}

function cpOnFileSelected(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    cpSetStatus('⚠ File too large (max 1 MB).');
    event.target.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var data;
    try { data = JSON.parse(e.target.result); } catch (err) {
      cpSetStatus('⚠ Invalid JSON file — cannot load.');
      return;
    }
    if (!data || data.schema !== CP_SCHEMA) {
      cpSetStatus('⚠ Not a valid Change Plan file (wrong schema).');
      return;
    }
    var changes = (data.changes || []).slice(0, 200);  // safety cap
    // Snapshot mismatch warning
    var warn = document.getElementById('cpMismatchWarn');
    if (warn) {
      if (data.graph_time && _cpGraphTime && data.graph_time !== _cpGraphTime) {
        warn.style.display = '';
        warn.textContent = '⚠ This plan was created for snapshot "' + data.graph_time +
          '" but you have "' + _cpGraphTime + '" loaded. Impact results may differ.';
      } else {
        warn.style.display = 'none';
      }
    }
    if (!confirm('Load ' + changes.length + ' change(s) from "' + file.name +
        '"?\nThis will replace your current plan.')) return;

    // Restore description
    var descEl = document.getElementById('cpDescription');
    if (descEl) descEl.value = data.description || '';

    // Rebuild rows
    _cpRows   = [];
    _cpRowSeq = 0;
    changes.forEach(function (c) {
      _cpRowSeq++;
      _cpRows.push({ id: _cpRowSeq, edgeId: c.edgeId || '', mode: c.mode || 'sym',
                     fwd: c.fwd || '', rev: c.rev || '' });
    });
    _cpRenderPlan();
    cpSetStatus('✓ Loaded ' + changes.length + ' change(s) from ' + file.name +
      (changes.length < (data.changes || []).length ? ' (truncated to 200)' : ''));
  };
  reader.readAsText(file);
  event.target.value = '';  // reset so same file can be loaded again
}

/* ════════════════════════════════════════════════════════════════════
   PRD-17 — 📄 Export Change Window Risk Report
   ════════════════════════════════════════════════════════════════════ */

// Called after cpAnalyse() completes successfully — enables the report button
function _cpEnableReport() {
  var btn = document.getElementById('cpBtnReport');
  if (btn) btn.disabled = false;
}

function cpGenerateReport() {
  if (!_cpImpactRows || !_cpImpactRows.length) {
    cpSetStatus('⚠ Run Analyse Impact first.');
    return;
  }
  var meta = {
    generated:   new Date().toISOString().replace('T',' ').slice(0,19) + ' UTC',
    graphTime:   _cpGraphTime || '—',
    description: ((document.getElementById('cpDescription') || {}).value || '(none)').slice(0,500),
    version:     '2.57.x'
  };

  var riskLevel = _cpComputeRisk(_cpImpactRows);
  var riskColors = { LOW:'#166534', MEDIUM:'#713f12', HIGH:'#7c2d12', CRITICAL:'#7f1d1d' };
  var riskEmoji  = { LOW:'🟢', MEDIUM:'🟡', HIGH:'🟠', CRITICAL:'🔴' };

  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<title>OSPF Change Report — ' + _cpEsc(meta.graphTime) + '</title><style>' +
    'body{font-family:-apple-system,Arial,sans-serif;color:#111;margin:20mm;font-size:11pt;}' +
    'h1{font-size:17pt;border-bottom:2px solid #1e3a5f;padding-bottom:6px;}' +
    'h2{font-size:13pt;color:#1e3a5f;margin-top:18px;}' +
    'table{border-collapse:collapse;width:100%;margin:8px 0;font-size:10pt;}' +
    'th{background:#1e3a5f;color:#fff;padding:5px 8px;text-align:left;}' +
    'td{border:1px solid #ddd;padding:4px 8px;}' +
    'tr:nth-child(even)td{background:#f5f7fa;}' +
    '.risk{font-weight:700;font-size:13pt;padding:4px 10px;border-radius:4px;color:#fff;display:inline-block;}' +
    '.tag-deg{color:#c2410c;font-weight:700;}.tag-imp{color:#15803d;font-weight:700;}' +
    '.tag-lost{color:#dc2626;font-weight:700;}.tag-unch{color:#6b7280;}' +
    '@media print{body{margin:10mm;}}' +
    '</style></head><body>' +
    '<h1>OSPF Change Window Risk Report</h1>' +
    '<table>' +
    '<tr><th>Generated</th><td>' + _cpEsc(meta.generated) + '</td></tr>' +
    '<tr><th>Topology Snapshot</th><td>' + _cpEsc(meta.graphTime) + '</td></tr>' +
    '<tr><th>Plan Description</th><td>' + _cpEsc(meta.description) + '</td></tr>' +
    '<tr><th>Changes</th><td>' + _cpRows.length + ' edge override(s)</td></tr>' +
    '</table>' +
    '<h2>Risk Assessment</h2>' +
    '<p><span class="risk" style="background:' + (riskColors[riskLevel] || '#374151') + '">' +
    (riskEmoji[riskLevel] || '') + ' ' + riskLevel + '</span></p>' +
    _cpRiskBullets(_cpImpactRows) +
    '<h2>Change Plan</h2>' +
    _cpChangesTable() +
    '<h2>Affected Country Pairs</h2>' +
    _cpImpactTable() +
    '<hr><p style="font-size:9pt;color:#6b7280;">Generated by Topolograph ' + meta.version +
    ' · ' + meta.generated + '</p>' +
    '</body></html>';

  var fname = 'ospf-change-report-' + (_cpGraphTime || 'report') + '.html';
  var blob  = new Blob([html], { type: 'text/html' });
  var a     = document.createElement('a');
  a.href    = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  cpSetStatus('✓ Report downloaded: ' + fname);
}

function _cpComputeRisk(rows) {
  var degraded = 0, lost = 0;
  rows.forEach(function (r) {
    if (!isFinite(r.afterCost)) lost++;
    else if (r.afterCost > r.beforeCost) degraded++;
  });
  if (lost > 5 || degraded > 12) return 'CRITICAL';
  if (lost > 2 || degraded > 6)  return 'HIGH';
  if (lost > 0 || degraded > 2)  return 'MEDIUM';
  return 'LOW';
}

function _cpRiskBullets(rows) {
  var degraded = 0, lost = 0, improved = 0;
  rows.forEach(function (r) {
    if (!isFinite(r.afterCost)) lost++;
    else if (r.afterCost > r.beforeCost) degraded++;
    else if (r.afterCost < r.beforeCost) improved++;
  });
  var items = [];
  if (lost)     items.push('<li style="color:#dc2626">⚠ ' + lost + ' country pair(s) will lose primary path</li>');
  if (degraded) items.push('<li style="color:#c2410c">↑ ' + degraded + ' pair(s) degraded (higher cost)</li>');
  if (improved) items.push('<li style="color:#15803d">↓ ' + improved + ' pair(s) improved (lower cost)</li>');
  if (!items.length) items.push('<li>No path cost changes detected</li>');
  return '<ul>' + items.join('') + '</ul>';
}

function _cpChangesTable() {
  if (!_cpRows.length) return '<p>No changes defined.</p>';
  var rows = _cpRows.map(function (r) {
    return '<tr><td>' + _cpEsc(r.edgeId || '—') + '</td><td>' + (r.mode || '').toUpperCase() +
      '</td><td>' + (r.fwd || '—') + '</td><td>' + (r.rev || '—') + '</td></tr>';
  }).join('');
  return '<table><thead><tr><th>Edge ID</th><th>Mode</th><th>FWD Override</th>' +
    '<th>REV Override</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function _cpImpactTable() {
  if (!_cpImpactRows || !_cpImpactRows.length) return '<p>No affected pairs.</p>';
  var shown = _cpImpactRows.slice(0, 500);
  var note  = _cpImpactRows.length > 500 ? '<p style="font-size:9pt;color:#6b7280;">First 500 of ' +
    _cpImpactRows.length + ' rows shown.</p>' : '';
  var rows = shown.map(function (r) {
    var bef = isFinite(r.beforeCost) ? r.beforeCost : '∞';
    var aft = isFinite(r.afterCost)  ? r.afterCost  : '∞';
    var delta = (isFinite(r.afterCost) && isFinite(r.beforeCost))
      ? (r.afterCost - r.beforeCost >= 0 ? '+' : '') + (r.afterCost - r.beforeCost) : '—';
    var cls = !isFinite(r.afterCost) ? 'tag-lost' :
              r.afterCost > r.beforeCost ? 'tag-deg' :
              r.afterCost < r.beforeCost ? 'tag-imp' : 'tag-unch';
    var lbl = !isFinite(r.afterCost) ? '⚫ LOST' :
              r.afterCost > r.beforeCost ? '↑ DEGRADED' :
              r.afterCost < r.beforeCost ? '↓ IMPROVED' : '= UNCHANGED';
    return '<tr><td>' + _cpEsc((r.src||'') + ' → ' + (r.dst||'')) + '</td>' +
      '<td>' + bef + '</td><td>' + aft + '</td><td>' + delta + '</td>' +
      '<td class="' + cls + '">' + lbl + '</td></tr>';
  }).join('');
  return '<table><thead><tr><th>Pair</th><th>Before</th><th>After</th><th>Delta</th>' +
    '<th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>' + note;
}

/* ════════════════════════════════════════════════════════════════════
   Edge Picker — Node-Pair Dropdowns + Topology Click Selection
   ════════════════════════════════════════════════════════════════════ */

/* ── Cost extractor ──────────────────────────────────────────────── */
function _cpEdgeCost(e) {
  if (!e) return 0;
  var c = e.cost || e.weight || e.value || 0;
  if (!c && e.label) { var l = String(e.label).trim(); if (/^\d+$/.test(l)) c = parseInt(l, 10); }
  if (!c && e.title) { var mt = String(e.title).match(/cost[:\s]+(\d+)/i); if (mt) c = parseInt(mt[1], 10); }
  return c || 0;
}

/* ── Find edges between two nodes (either direction) ─────────────── */
function _cpFindEdgesByNodes(fromId, toId) {
  return _cpEdges.filter(function (e) {
    return (String(e.from) === fromId && String(e.to) === toId) ||
           (String(e.from) === toId   && String(e.to) === fromId);
  });
}

/* ── Populate From-Node dropdown after topology loads ───────────── */
function _cpPopulateNodeDropdowns() {
  var fromSel = document.getElementById('cpPickFromNode');
  if (!fromSel) return;
  fromSel.innerHTML = '<option value="">— From Node —</option>';
  // Sort: A-type countries first, then rest; alphabetical within each group
  var sorted = _cpNodes.slice().sort(function (a, b) {
    var aIsA = !!KSP_parseAtype(a.label || String(a.id));
    var bIsA = !!KSP_parseAtype(b.label || String(b.id));
    if (aIsA !== bIsA) return aIsA ? -1 : 1;
    return String(a.label || a.id).localeCompare(String(b.label || b.id));
  });
  sorted.forEach(function (n) {
    var lbl = n.label || String(n.id);
    var isA = !!KSP_parseAtype(lbl);
    var opt = new Option((isA ? '🌍 ' : '') + lbl, String(n.id));
    fromSel.appendChild(opt);
  });
  document.getElementById('cpPickToNode').innerHTML   = '<option value="">— select From first —</option>';
  document.getElementById('cpPickEdge').innerHTML     = '<option value="">— select pair —</option>';
  document.getElementById('cpPickEdgeInfo').textContent = '';
  document.getElementById('cpBtnPickAdd').disabled    = true;
}

/* ── From-node changed: rebuild To dropdown ─────────────────────── */
function cpPickFromChanged() {
  var fromId = document.getElementById('cpPickFromNode').value;
  var toSel  = document.getElementById('cpPickToNode');
  toSel.innerHTML = '<option value="">— To Node —</option>';
  document.getElementById('cpPickEdge').innerHTML     = '<option value="">— select pair —</option>';
  document.getElementById('cpPickEdgeInfo').textContent = '';
  document.getElementById('cpBtnPickAdd').disabled    = true;
  if (!fromId) return;

  // Collect all directly-adjacent node IDs (both directions — OSPF is directed but show both)
  var targets = {};
  _cpEdges.forEach(function (e) {
    if (String(e.from) === fromId) targets[String(e.to)]   = true;
    if (String(e.to)   === fromId) targets[String(e.from)] = true;
  });
  var targetKeys = Object.keys(targets);
  if (!targetKeys.length) {
    toSel.innerHTML = '<option value="">No edges from this node</option>';
    return;
  }
  var toNodes = _cpNodes
    .filter(function (n) { return targets[String(n.id)]; })
    .sort(function (a, b) { return String(a.label || a.id).localeCompare(String(b.label || b.id)); });
  toNodes.forEach(function (n) {
    var lbl = n.label || String(n.id);
    var isA = !!KSP_parseAtype(lbl);
    toSel.appendChild(new Option((isA ? '🌍 ' : '') + lbl, String(n.id)));
  });
}

/* ── To-node changed: populate Edge dropdown ────────────────────── */
function cpPickToChanged() {
  var fromId  = document.getElementById('cpPickFromNode').value;
  var toId    = document.getElementById('cpPickToNode').value;
  var edgeSel = document.getElementById('cpPickEdge');
  edgeSel.innerHTML = '<option value="">— Link —</option>';
  document.getElementById('cpPickEdgeInfo').textContent = '';
  document.getElementById('cpBtnPickAdd').disabled = true;
  if (!fromId || !toId) return;

  var edges = _cpFindEdgesByNodes(fromId, toId);
  if (!edges.length) {
    edgeSel.innerHTML = '<option value="">No direct link found</option>';
    return;
  }
  edges.forEach(function (e) {
    var cost = _cpEdgeCost(e);
    var dir  = (String(e.from) === fromId) ? '→' : '←';
    var text = '#' + e.id + ' ' + dir + '  cost:' + cost;
    if (e.label && !/^\d+$/.test(String(e.label).trim())) text += '  [' + e.label + ']';
    edgeSel.appendChild(new Option(text, String(e.id)));
  });
  // Auto-select when there is only one edge between the pair
  if (edges.length === 1) {
    edgeSel.value = String(edges[0].id);
    cpPickEdgeChanged();
  }
}

/* ── Edge dropdown changed: show info + enable Add ──────────────── */
function cpPickEdgeChanged() {
  var eid    = document.getElementById('cpPickEdge').value;
  var addBtn = document.getElementById('cpBtnPickAdd');
  var info   = document.getElementById('cpPickEdgeInfo');
  if (!eid) { addBtn.disabled = true; info.textContent = ''; return; }

  var e = _cpEdges.find(function (x) { return String(x.id) === eid; });
  if (!e) { addBtn.disabled = true; info.textContent = '⚠ Edge not found in loaded topology'; return; }

  var fromNode = _cpNodes.find(function (n) { return String(n.id) === String(e.from); });
  var toNode   = _cpNodes.find(function (n) { return String(n.id) === String(e.to);   });
  var fromLbl  = fromNode ? (fromNode.label || String(e.from)) : String(e.from);
  var toLbl    = toNode   ? (toNode.label   || String(e.to))   : String(e.to);
  var cost     = _cpEdgeCost(e);
  info.textContent = 'Edge #' + eid + '  ' + fromLbl + ' → ' + toLbl + '  current cost: ' + cost;
  addBtn.disabled  = false;
  _cpHighlightEdge(eid);
}

/* ── Add picker-selected edge as a new plan row ──────────────────── */
function cpPickAddToPlan() {
  var eid = document.getElementById('cpPickEdge').value;
  if (!eid) return;
  var e    = _cpEdges.find(function (x) { return String(x.id) === eid; });
  var cost = e ? String(_cpEdgeCost(e)) : '';
  _cpPlanRows.push({ id: ++_cpRowIdSeq, edgeId: eid, mode: 'sym', fwd: cost, rev: '' });
  cpRenderPlanTable();
}

/* ── Highlight an edge in gold in the vis.js network ─────────────── */
function _cpHighlightEdge(eid) {
  if (!_cpVEdges) return;
  // Reset previously highlighted edge
  if (_cpPrevHighlightId && _cpPrevHighlightId !== eid) {
    try {
      _cpVEdges.update({ id: _cpPrevHighlightId, color: { color: '#374151' }, width: 1, dashes: false });
    } catch (e) { /* edge may no longer exist */ }
  }
  if (eid) {
    try {
      _cpVEdges.update({ id: eid, color: { color: '#f59e0b', highlight: '#fbbf24' }, width: 4, dashes: false });
      _cpNetwork.selectEdges([eid]);
    } catch (e) { /* edge may not exist in vis dataset */ }
  }
  _cpPrevHighlightId = eid || null;
}

/* ── Clear edge highlight and dismiss toast ──────────────────────── */
function _cpClearEdgeHighlight() {
  if (_cpPrevHighlightId && _cpVEdges) {
    try { _cpVEdges.update({ id: _cpPrevHighlightId, color: { color: '#374151' }, width: 1 }); } catch (e) {}
    _cpPrevHighlightId = null;
  }
  _cpSelectedEdgeId = null;
  var toast = document.getElementById('cpTopoClickToast');
  if (toast) toast.classList.remove('visible');
}

/* ── Register vis.js click handler on network ────────────────────── */
function _cpSetupEdgeClickHandler() {
  if (!_cpNetwork) return;
  _cpNetwork.on('click', function (params) {
    if (!params.edges || !params.edges.length) return;  // blank-space click — ignore
    var clickedId = String(params.edges[0]);
    _cpSelectedEdgeId = clickedId;
    _cpHighlightEdge(clickedId);

    var e        = _cpEdges.find(function (x) { return String(x.id) === clickedId; });
    var fromNode = e ? _cpNodes.find(function (n) { return String(n.id) === String(e.from); }) : null;
    var toNode   = e ? _cpNodes.find(function (n) { return String(n.id) === String(e.to);   }) : null;
    var fromLbl  = fromNode ? (fromNode.label || String(e.from)) : (e ? String(e.from) : '?');
    var toLbl    = toNode   ? (toNode.label   || String(e.to))   : (e ? String(e.to)   : '?');
    var cost     = e ? _cpEdgeCost(e) : '?';

    var infoEl = document.getElementById('cpToastEdgeInfo');
    var addBtn = document.getElementById('cpToastAddBtn');
    if (infoEl) {
      infoEl.innerHTML =
        '<b>Edge #' + _cpEsc(clickedId) + '</b>&nbsp;&nbsp;' +
        _cpEsc(fromLbl) + ' → ' + _cpEsc(toLbl) +
        '&nbsp;&nbsp;<span style="color:#9ca3af;">current cost: ' + cost + '</span>';
    }
    if (addBtn) addBtn.disabled = false;
    var toast = document.getElementById('cpTopoClickToast');
    if (toast) toast.classList.add('visible');
  });
}

/* ── Toast: Add clicked edge to plan ─────────────────────────────── */
function cpToastAddToPlan() {
  if (!_cpSelectedEdgeId) return;
  var e    = _cpEdges.find(function (x) { return String(x.id) === _cpSelectedEdgeId; });
  var cost = e ? String(_cpEdgeCost(e)) : '';
  _cpPlanRows.push({ id: ++_cpRowIdSeq, edgeId: _cpSelectedEdgeId, mode: 'sym', fwd: cost, rev: '' });
  cpRenderPlanTable();
  var toast = document.getElementById('cpTopoClickToast');
  if (toast) toast.classList.remove('visible');
}

/* ── Toast: Dismiss ──────────────────────────────────────────────── */
function cpToastDismiss() {
  _cpClearEdgeHighlight();
}
