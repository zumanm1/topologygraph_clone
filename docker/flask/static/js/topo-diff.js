/**
 * topo-diff.js  —  OSPF Topology Diff Page Logic
 * =================================================
 * PRD-12: /topo-diff
 *
 * Features:
 *  - Dual snapshot selector
 *  - Edge diff table: cost↑/↓, new/lost adjacencies, sorted by |delta|
 *  - Country pair cost comparison using KSP_countryPairDiff
 *  - Dual vis.js topology panels with color-coded edges
 *  - CSV export
 */

/* ── State ───────────────────────────────────────────────────────── */
var _tdNodesA = [], _tdEdgesA = [];
var _tdNodesB = [], _tdEdgesB = [];
var _tdNetA   = null, _tdNetB = null;
var _tdVNA    = null, _tdVEA  = null;
var _tdVNB    = null, _tdVEB  = null;
var _tdDiff   = null;
var _tdPairs  = null;

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  var gtDefault = _tdParam('graph_time') || _tdLS('ospf_graph_time') || '';
  tdLoadGraphTimes(gtDefault);
});

/* ── Graph time dropdowns ────────────────────────────────────────── */
function tdLoadGraphTimes(defaultGt) {
  fetch('/api/diagram/list')
    .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
    .then(function (data) {
      var list = data.graph_time_list || data.timestamps || data || [];
      if (!Array.isArray(list)) list = [];
      var selA = document.getElementById('tdSnapA');
      var selB = document.getElementById('tdSnapB');
      selA.innerHTML = '<option value="">— select —</option>';
      selB.innerHTML = '<option value="">— select —</option>';
      list.forEach(function (t, idx) {
        var oA = new Option(t, t); var oB = new Option(t, t);
        if (t === defaultGt || idx === list.length - 1) oA.selected = true;
        if (idx === list.length - 1) oB.selected = true;
        selA.appendChild(oA); selB.appendChild(oB);
      });
      if (list.length >= 2) document.getElementById('tdBtnCompare').disabled = false;
      else if (list.length === 1) { document.getElementById('tdBtnCompare').disabled = false; }
    });
}

/* ── Compare ─────────────────────────────────────────────────────── */
function tdCompare() {
  var gtA = document.getElementById('tdSnapA').value;
  var gtB = document.getElementById('tdSnapB').value;
  if (!gtA || !gtB) { tdSetStatus('⚠ Select both snapshots.'); return; }

  tdSetStatus('<span class="td-spinner"></span> Loading both snapshots…');
  document.getElementById('tdBtnCompare').disabled = true;

  var load = function (gt) {
    return Promise.all([
      fetch('/api/diagram/' + encodeURIComponent(gt) + '/nodes').then(function(r){ return r.ok?r.json():[]; }).catch(function(){ return []; }),
      fetch('/api/diagram/' + encodeURIComponent(gt) + '/edges').then(function(r){ return r.ok?r.json():[]; }).catch(function(){ return []; })
    ]).then(function (res) {
      var n = res[0] || []; var e = res[1] || [];
      if (n.nodes) n = n.nodes; if (e.edges) e = e.edges;
      if (!Array.isArray(n)) n = []; if (!Array.isArray(e)) e = [];
      return { nodes: n, edges: e };
    });
  };

  Promise.all([load(gtA), load(gtB)]).then(function (snaps) {
    _tdNodesA = snaps[0].nodes; _tdEdgesA = snaps[0].edges;
    _tdNodesB = snaps[1].nodes; _tdEdgesB = snaps[1].edges;

    _tdDiff  = KSP_topoDiff(_tdNodesA, _tdEdgesA, _tdNodesB, _tdEdgesB);
    _tdPairs = KSP_countryPairDiff(_tdNodesA, _tdEdgesA, _tdNodesB, _tdEdgesB);

    _tdBuildVis('A', _tdNodesA, _tdEdgesA, _tdDiff);
    _tdBuildVis('B', _tdNodesB, _tdEdgesB, _tdDiff);
    _tdRenderDiffTable();
    _tdRenderPairTable();

    var totalChanges = _tdDiff.costChanged.length + _tdDiff.newEdges.length + _tdDiff.lostEdges.length;
    tdSetStatus('Diff complete: ' + totalChanges + ' edge changes, ' + _tdPairs.length + ' country pair changes.');
  }).catch(function (err) {
    tdSetStatus('⚠ Error: ' + err.message);
  }).finally(function () {
    document.getElementById('tdBtnCompare').disabled = false;
  });
}

/* ── Build vis.js topology ───────────────────────────────────────── */
function _tdBuildVis(side, nodesList, edgesList, diff) {
  var containerId = 'tdTopo' + side;
  var container = document.getElementById(containerId);

  // Changed edge ID sets for coloring
  var costUpSet  = new Set(diff.costChanged.filter(function(c){ return c.delta > 0; }).map(function(c){ return String(c.edge.id); }));
  var costDnSet  = new Set(diff.costChanged.filter(function(c){ return c.delta < 0; }).map(function(c){ return String(c.edge.id); }));
  var newEdgeSet = new Set(diff.newEdges.map(function(e){ return String(e.id); }));
  var lostEdgeSet = new Set(diff.lostEdges.map(function(e){ return String(e.id); }));

  var visNodes = nodesList.map(function (n) {
    var isAtype = !!KSP_parseAtype(n.label || n.id || '');
    return { id:n.id, label:n.label||String(n.id),
      color: isAtype ? { background:'#1e40af', border:'#3b82f6' } : { background:'#374151', border:'#6b7280' },
      font:{ color:'#e0e8f0', size:10 }, size: isAtype ? 12 : 8 };
  });

  var visEdges = edgesList.map(function (e) {
    var eid = String(e.id);
    var color, width;
    if (lostEdgeSet.has(eid))      { color='#6b7280'; width=1; }
    else if (costUpSet.has(eid))   { color='#ef4444'; width=3; }
    else if (costDnSet.has(eid))   { color='#22c55e'; width=3; }
    else if (newEdgeSet.has(eid))  { color='#3b82f6'; width=3; }
    else                           { color='#374151'; width=1; }
    return { id:e.id, from:e.from, to:e.to, label:e.label||'',
      color:{ color:color }, width:width,
      font:{ color:'#6b7280', size:8, strokeWidth:0 },
      arrows:{ to:{ enabled:true, scaleFactor:0.4 } } };
  });

  var vNodes = new vis.DataSet(visNodes);
  var vEdges = new vis.DataSet(visEdges);

  if (side === 'A') { _tdVNA = vNodes; _tdVEA = vEdges; }
  else              { _tdVNB = vNodes; _tdVEB = vEdges; }

  var net = new vis.Network(container, { nodes:vNodes, edges:vEdges }, {
    physics:{ enabled:true, solver:'forceAtlas2Based',
      forceAtlas2Based:{ gravitationalConstant:-30, springLength:100, springConstant:0.02 },
      stabilization:{ iterations:120 }
    },
    interaction:{ hover:true }, layout:{ improvedLayout:false }
  });
  net.on('stabilizationIterationsDone', function () { net.setOptions({ physics:{ enabled:false } }); });

  if (side === 'A') _tdNetA = net; else _tdNetB = net;
}

/* ── Render edge diff table ──────────────────────────────────────── */
function _tdRenderDiffTable() {
  var tbody = document.getElementById('tdDiffRows');
  tbody.innerHTML = '';

  var allChanges = [];

  _tdDiff.costChanged.forEach(function (c) {
    allChanges.push({ type: c.delta > 0 ? 'cost↑' : 'cost↓', cssClass: c.delta > 0 ? 'cost-up' : 'cost-dn',
      from: c.edge.from, to: c.edge.to, costA: c.costA, costB: c.costB, delta: c.delta, pct: c.pct });
  });
  _tdDiff.newEdges.forEach(function (e) {
    allChanges.push({ type: 'new', cssClass: 'new-edge',
      from: e.from, to: e.to, costA: '—', costB: _tdCost(e), delta: '', pct: '' });
  });
  _tdDiff.lostEdges.forEach(function (e) {
    allChanges.push({ type: 'lost', cssClass: 'lost-edge',
      from: e.from, to: e.to, costA: _tdCost(e), costB: '—', delta: '', pct: '' });
  });

  if (!allChanges.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#6b7280;padding:10px;">No edge changes detected between snapshots.</td></tr>';
    return;
  }

  allChanges.forEach(function (row) {
    var tr = document.createElement('tr');
    tr.className = row.cssClass;
    var fromLabel = _tdNodeLabel(row.from, _tdNodesA.concat(_tdNodesB));
    var toLabel   = _tdNodeLabel(row.to,   _tdNodesA.concat(_tdNodesB));
    var sign = (typeof row.delta === 'number' && row.delta > 0) ? '+' : '';
    tr.innerHTML =
      '<td>' + _tdEsc(row.type) + '</td>' +
      '<td>' + _tdEsc(fromLabel) + '→' + _tdEsc(toLabel) + '</td>' +
      '<td>' + row.costA + '</td>' +
      '<td>' + row.costB + '</td>' +
      '<td>' + (row.delta !== '' ? sign + row.delta : '—') + '</td>' +
      '<td>' + (row.pct !== '' && row.pct !== null ? sign + row.pct + '%' : '—') + '</td>';
    tbody.appendChild(tr);
  });
}

/* ── Render country pair table ───────────────────────────────────── */
function _tdRenderPairTable() {
  var tbody = document.getElementById('tdPairRows');
  tbody.innerHTML = '';
  if (!_tdPairs.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#6b7280;">No country pair cost changes.</td></tr>';
    return;
  }
  _tdPairs.forEach(function (p) {
    var tr = document.createElement('tr');
    tr.className = p.delta < 0 ? 'improved' : 'degraded';
    var sign = p.delta > 0 ? '+' : '';
    tr.innerHTML = '<td>' + p.srcCountry + '→' + p.dstCountry + '</td>' +
      '<td>' + (p.costA === Infinity ? '∞' : p.costA) + '</td>' +
      '<td>' + (p.costB === Infinity ? '∞' : p.costB) + '</td>' +
      '<td>' + sign + p.delta + (p.pct !== null ? ' (' + sign + p.pct + '%)' : '') + '</td>';
    tbody.appendChild(tr);
  });
}

/* ── CSV Export ──────────────────────────────────────────────────── */
function tdExportCSV() {
  if (!_tdDiff) { tdSetStatus('⚠ Run Compare first.'); return; }
  var rows = [['Type', 'From', 'To', 'CostA', 'CostB', 'Delta', 'Pct']];
  _tdDiff.costChanged.forEach(function (c) {
    rows.push([c.delta > 0 ? 'cost-up' : 'cost-down', c.edge.from, c.edge.to, c.costA, c.costB, c.delta, c.pct + '%']);
  });
  _tdDiff.newEdges.forEach(function (e) { rows.push(['new', e.from, e.to, '', _tdCost(e), '', '']); });
  _tdDiff.lostEdges.forEach(function (e) { rows.push(['lost', e.from, e.to, _tdCost(e), '', '', '']); });
  var csv = rows.map(function (r) { return r.join(','); }).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
  a.download = 'ospf-topo-diff.csv';
  a.click();
}

/* ── Utilities ───────────────────────────────────────────────────── */
function tdSetStatus(html) { document.getElementById('tdStatus').innerHTML = html; }
function _tdParam(k) { return new URLSearchParams(window.location.search).get(k) || ''; }
function _tdLS(k) { try { return localStorage.getItem(k) || ''; } catch(e) { return ''; } }
function _tdEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _tdCost(e) { var c = e.cost||e.weight||e.value||0; if (!c&&e.label){ var l=String(e.label).trim(); if(/^\d+$/.test(l)) c=parseInt(l,10); } return c||1; }
function _tdNodeLabel(id, nodesList) {
  var n = nodesList.find(function(x){ return x.id === id || String(x.id) === String(id); });
  return n ? (n.label || String(id)) : String(id);
}
