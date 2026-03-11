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

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  _cpGraphTime = _cpParam('graph_time') || _cpLS('ospf_graph_time') || '';
  cpLoadGraphTimes().then(function () {
    if (_cpGraphTime) cpLoadTopology(_cpGraphTime);
  });
});

/* ── Graph time dropdown ─────────────────────────────────────────── */
function cpLoadGraphTimes() {
  return fetch('/api/diagram/list')
    .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
    .then(function (data) {
      var sel = document.getElementById('cpGraphTime');
      var list = data.graph_time_list || data.timestamps || data || [];
      if (!Array.isArray(list)) list = [];
      sel.innerHTML = '';
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

/* ── Load topology ───────────────────────────────────────────────── */
function cpLoadTopology(gt) {
  if (!gt) return;
  cpSetStatus('<span class="cp-spinner"></span> Loading topology…');
  document.getElementById('cpBtnAnalyse').disabled = true;

  Promise.all([
    fetch('/api/diagram/' + encodeURIComponent(gt) + '/nodes').then(function(r){ return r.ok?r.json():[]; }).catch(function(){ return []; }),
    fetch('/api/diagram/' + encodeURIComponent(gt) + '/edges').then(function(r){ return r.ok?r.json():[]; }).catch(function(){ return []; })
  ]).then(function (res) {
    _cpNodes = res[0] || [];
    _cpEdges = res[1] || [];
    if (_cpNodes.nodes) _cpNodes = _cpNodes.nodes;
    if (_cpEdges.edges) _cpEdges = _cpEdges.edges;
    if (!Array.isArray(_cpNodes)) _cpNodes = [];
    if (!Array.isArray(_cpEdges)) _cpEdges = [];
    _cpAdjBefore = KSP_buildDirAdjList(_cpNodes, _cpEdges, {});
    _cpBuildVis();
    cpSetStatus('Loaded ' + _cpNodes.length + ' nodes, ' + _cpEdges.length + ' edges. Add changes and click Analyse.');
    document.getElementById('cpBtnAnalyse').disabled = false;
  }).catch(function (err) {
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

  cpSetStatus('<span class="cp-spinner"></span> Computing impact across all country pairs…');
  document.getElementById('cpBtnAnalyse').disabled = true;

  setTimeout(function () {
    try {
      _cpAdjAfter = KSP_buildDirAdjList(_cpNodes, _cpEdges, ov);
      _cpImpact = _cpComputeImpact();
      _cpRenderImpact();
      document.getElementById('cpBtnAnimate').disabled = false;
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
    var sign = p.delta > 0 ? '+' : '';
    tr.innerHTML = '<td>' + p.src + '→' + p.dst + '</td>' +
      '<td>' + (p.before === Infinity ? '∞' : p.before) + '</td>' +
      '<td>' + (p.after  === Infinity ? '∞' : p.after)  + '</td>' +
      '<td>' + sign + p.delta + '</td>';
    tbody.appendChild(tr);
  });
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
