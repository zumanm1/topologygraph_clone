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
var _tdFilterBar = null; // TopoFilterBar instance (dual topology)
var _tdPairs  = null;

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  var gtDefault = _tdParam('graph_time') || _tdLS('ospf_graph_time') || '';
  tdLoadGraphTimes(gtDefault);
});

/* ── Graph time dropdowns ────────────────────────────────────────── */
function tdLoadGraphTimes(defaultGt) {
  fetch('/api/graph-times')
    .then(function (r) { return r.ok ? r.json() : { graph_time_list: [] }; }).catch(function () { return { graph_time_list: [] }; })
    .then(function (data) {
      var list = data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []);
      if (!Array.isArray(list)) list = [];
      // Ensure the default graph_time is always in the list
      if (defaultGt && list.indexOf(defaultGt) === -1) list = [defaultGt].concat(list);
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
      document.getElementById('tdBtnCompare').disabled = list.length === 0;
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
    return KSP_loadTopology(gt);
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

    // ── Filter bar (controls both topologies simultaneously) ────────
    if (typeof TopoFilterBar === 'function') {
      if (_tdFilterBar) _tdFilterBar.destroy();
      _tdFilterBar = new TopoFilterBar({
        containerId:       'tdFilterBar',
        vNodes:            _tdVNA,
        vEdges:            _tdVEA,
        rawNodes:          _tdNodesA,
        rawEdges:          _tdEdgesA,
        network:           _tdNetA,
        secondaryVNodes:   _tdVNB,
        secondaryVEdges:   _tdVEB,
        secondaryRawNodes: _tdNodesB,
      });
    }

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

/* ════════════════════════════════════════════════════════════════════
   PRD-18 — 📅 Snapshot Timeline / Change History Explorer
   ════════════════════════════════════════════════════════════════════ */

/* ── Mode switching ──────────────────────────────────────────────── */
var _tdAllGraphTimes = [];  // full list loaded at startup

function tdSelectMode(mode) {
  var comparePanel  = document.getElementById('tdComparePanel');
  var timelinePanel = document.getElementById('tdTimelinePanel');
  var tabCompare    = document.getElementById('tdTabCompare');
  var tabTimeline   = document.getElementById('tdTabTimeline');

  if (mode === 'timeline') {
    comparePanel.style.display  = 'none';
    timelinePanel.classList.add('active');
    tabCompare.classList.remove('active');
    tabTimeline.classList.add('active');
    // Populate date selectors if not yet done
    if (_tdAllGraphTimes.length) _tdPopulateDateSelectors(_tdAllGraphTimes);
  } else {
    comparePanel.style.display  = '';
    timelinePanel.classList.remove('active');
    tabCompare.classList.add('active');
    tabTimeline.classList.remove('active');
  }
}

/* ── Extend tdLoadGraphTimes to cache full list ──────────────────── */
var _tdOrigLoadGraphTimes = tdLoadGraphTimes;
tdLoadGraphTimes = function (defaultGt) {
  _tdOrigLoadGraphTimes(defaultGt);
  // Fetch again to cache (may re-use browser cache) for timeline date selectors
  fetch('/api/graph-times')
    .then(function (r) { return r.ok ? r.json() : { graph_time_list: [] }; })
    .catch(function () { return { graph_time_list: [] }; })
    .then(function (data) {
      var list = data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []);
      if (!Array.isArray(list)) list = [];
      _tdAllGraphTimes = list;
      // Enable run button if list available
      var btn = document.getElementById('tdBtnRunTimeline');
      if (btn) btn.disabled = list.length < 2;
      _tdPopulateDateSelectors(list);
    });
};

/* ── Date selector population ────────────────────────────────────── */
var MONTHS_TL = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function _tdParseGraphTimeDate(gt) {
  // "11Mar2026_21h17m14s_84_hosts" → Date(2026, 2, 11)
  var m = String(gt).match(/^(\d{2})([A-Za-z]{3})(\d{4})/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), MONTHS_TL[m[2]] !== undefined ? MONTHS_TL[m[2]] : 0, parseInt(m[1], 10));
}

function _tdDateLabel(gt) {
  // Return just the date portion "11Mar2026"
  var m = String(gt).match(/^(\d{2}[A-Za-z]{3}\d{4})/);
  return m ? m[1] : gt;
}

function _tdPopulateDateSelectors(list) {
  var fromSel = document.getElementById('tdTimelineFrom');
  var toSel   = document.getElementById('tdTimelineTo');
  if (!fromSel || !toSel) return;

  // Deduplicate dates
  var seenDates = {}, uniqueDates = [];
  list.forEach(function (gt) {
    var d = _tdDateLabel(gt);
    if (!seenDates[d]) { seenDates[d] = true; uniqueDates.push(d); }
  });
  // Sort chronologically
  uniqueDates.sort(function (a, b) {
    var da = _tdParseGraphTimeDate(a), db = _tdParseGraphTimeDate(b);
    if (!da || !db) return 0;
    return da - db;
  });

  fromSel.innerHTML = '';
  toSel.innerHTML   = '';
  uniqueDates.forEach(function (d, i) {
    var oA = new Option(d, d);
    var oB = new Option(d, d);
    if (i === 0) oA.selected = true;
    if (i === uniqueDates.length - 1) oB.selected = true;
    fromSel.appendChild(oA);
    toSel.appendChild(oB);
  });
}

/* ── Timeline state ──────────────────────────────────────────────── */
var _tdTimelineCancelled = false;
var _tdTimelineResults   = [];   // [{snapA, snapB, diff}] for CSV export

/* ── Run Timeline ────────────────────────────────────────────────── */
function tdRunTimeline() {
  var fromDate = document.getElementById('tdTimelineFrom').value;
  var toDate   = document.getElementById('tdTimelineTo').value;
  var filter   = document.getElementById('tdTimelineFilter').value;
  var maxTrans = parseInt(document.getElementById('tdTimelineMax').value, 10) || 20;

  if (!fromDate || !toDate) { _tdTLStatus('⚠ Select From and To dates.'); return; }

  var fromD = _tdParseGraphTimeDate(fromDate);
  var toD   = _tdParseGraphTimeDate(toDate);
  if (!fromD || !toD) { _tdTLStatus('⚠ Invalid date selection.'); return; }

  // Swap if needed
  if (fromD > toD) {
    var tmp = fromD; fromD = toD; toD = tmp;
    var tmpS = fromDate; fromDate = toDate; toDate = tmpS;
    _tdTLStatus('ℹ Dates swapped (From was after To).');
  }

  // Filter snapshots by date range and topology type
  var filtered = _tdAllGraphTimes.filter(function (gt) {
    var d = _tdParseGraphTimeDate(gt);
    if (!d) return false;
    if (d < fromD || d > toD) return false;
    if (filter && gt.indexOf(filter) === -1) return false;
    return true;
  });

  // Sort chronologically
  filtered.sort(function (a, b) {
    var da = _tdParseGraphTimeDate(a), db = _tdParseGraphTimeDate(b);
    if (!da || !db) return 0;
    return da - db;
  });

  // Cap at maxTrans+1 snapshots
  if (filtered.length > maxTrans + 1) filtered = filtered.slice(0, maxTrans + 1);

  if (filtered.length < 2) {
    _tdTLStatus('⚠ Need ≥2 snapshots in range — widen date range or change filter.');
    return;
  }

  var numTransitions = filtered.length - 1;
  _tdTLStatus('<span class="td-spinner"></span> Starting timeline (' + numTransitions + ' transitions)…');
  _tdTimelineCancelled = false;
  _tdTimelineResults   = [];

  document.getElementById('tdBtnRunTimeline').disabled    = true;
  document.getElementById('tdBtnCancelTimeline').disabled = false;
  document.getElementById('tdBtnExportTimeline').disabled = true;
  document.getElementById('tdTimelineRows').innerHTML     = '';
  document.getElementById('tdTimelineSummary').textContent = '';

  var progressWrap = document.getElementById('tdProgressWrap');
  progressWrap.classList.add('visible');
  _tdSetProgress(0, numTransitions);

  _tdRunSequential(filtered, 0, numTransitions);
}

function _tdRunSequential(snapshots, idx, total) {
  if (_tdTimelineCancelled) {
    _tdFinishTimeline(idx, total, true);
    return;
  }
  if (idx >= total) {
    _tdFinishTimeline(total, total, false);
    return;
  }

  var snapA = snapshots[idx];
  var snapB = snapshots[idx + 1];

  _tdTLStatus('<span class="td-spinner"></span> Processing transition ' + (idx + 1) + ' of ' + total + '…');
  _tdSetProgress(idx, total);

  Promise.all([KSP_loadTopology(snapA), KSP_loadTopology(snapB)])
    .then(function (results) {
      var diff = _tdTimelineDiff(results[0], results[1]);
      var result = { snapA: snapA, snapB: snapB, diff: diff };
      _tdTimelineResults.push(result);
      _tdRenderTransitionRow(result, idx);

      // Continue to next pair
      setTimeout(function () {
        _tdRunSequential(snapshots, idx + 1, total);
      }, 10);
    })
    .catch(function (err) {
      // Mark as error and continue
      var result = { snapA: snapA, snapB: snapB, diff: null, error: err.message };
      _tdTimelineResults.push(result);
      _tdRenderTransitionRow(result, idx);
      setTimeout(function () {
        _tdRunSequential(snapshots, idx + 1, total);
      }, 10);
    });
}

function _tdFinishTimeline(done, total, cancelled) {
  document.getElementById('tdBtnRunTimeline').disabled    = false;
  document.getElementById('tdBtnCancelTimeline').disabled = true;
  document.getElementById('tdBtnExportTimeline').disabled = _tdTimelineResults.length === 0;
  document.getElementById('tdProgressWrap').classList.remove('visible');
  _tdSetProgress(done, total);

  var withChanges = _tdTimelineResults.filter(function (r) {
    return r.diff && (r.diff.costChanged.length + r.diff.newEdges.length + r.diff.lostEdges.length) > 0;
  }).length;

  var summary = done + ' transitions processed, ' + withChanges + ' with changes.';
  if (cancelled) summary += ' (cancelled)';
  document.getElementById('tdTimelineSummary').textContent = summary;

  if (cancelled) {
    _tdTLStatus('<span class="td-status-cancelled">Cancelled — showing results so far.</span>');
  } else {
    _tdTLStatus('Timeline complete: ' + summary);
  }
}

/* ── Timeline diff (simpler than full topo diff — edges only) ────── */
function _tdTimelineDiff(snapA, snapB) {
  var edgesA = new Map();
  var edgesB = new Map();
  snapA.edges.forEach(function (e) { edgesA.set(String(e.id), e); });
  snapB.edges.forEach(function (e) { edgesB.set(String(e.id), e); });

  var added   = [];
  var removed = [];
  var changed = [];

  edgesB.forEach(function (e, id) {
    if (!edgesA.has(id)) added.push(e);
  });
  edgesA.forEach(function (e, id) {
    if (!edgesB.has(id)) { removed.push(e); return; }
    var costA = _tdCost(e);
    var costB = _tdCost(edgesB.get(id));
    if (costA !== costB) {
      var delta = costB - costA;
      var pct   = costA !== 0 ? (delta / costA * 100).toFixed(1) : null;
      changed.push({ id: id, edge: e, costA: costA, costB: costB, delta: delta, pct: pct });
    }
  });

  return { newEdges: added, lostEdges: removed, costChanged: changed };
}

/* ── Render a single transition row ─────────────────────────────── */
function _tdRenderTransitionRow(result, idx) {
  var container = document.getElementById('tdTimelineRows');
  var row = document.createElement('div');
  row.className = 'td-transition-row';

  var snapAShort = result.snapA.replace(/_\d+_hosts$/, '').replace(/_/g, ' ');
  var snapBShort = result.snapB.replace(/_\d+_hosts$/, '').replace(/_/g, ' ');

  var nChanges = 0, badgeClass = 'none', badgeText = '✓ No changes';

  if (result.error) {
    badgeClass = 'medium'; badgeText = '⚠ Load error';
  } else if (result.diff) {
    var d = result.diff;
    nChanges = d.costChanged.length + d.newEdges.length + d.lostEdges.length;
    if (nChanges === 0) {
      badgeClass = 'none'; badgeText = '✓ No changes';
    } else {
      var hasSevere = d.costChanged.some(function(c){ return Math.abs(c.pct) >= 50; }) || d.newEdges.length > 1 || d.lostEdges.length > 1;
      if (nChanges > 5 || hasSevere) {
        badgeClass = 'major'; badgeText = '🔴 ' + nChanges + ' changes';
      } else if (nChanges >= 3 || d.newEdges.length || d.lostEdges.length) {
        badgeClass = 'medium'; badgeText = '🟡 ' + nChanges + ' changes';
      } else {
        badgeClass = 'minor'; badgeText = '🔵 ' + nChanges + ' changes';
      }
    }
  }

  var header = document.createElement('div');
  header.className = 'td-transition-header';
  header.innerHTML =
    '<span class="td-tr-times">' + _tdEsc(snapAShort) + ' → ' + _tdEsc(snapBShort) + '</span>' +
    '<span class="td-tr-badge ' + badgeClass + '">' + _tdEsc(badgeText) + '</span>' +
    (nChanges > 0 ? '<span class="td-tr-arrow">▶</span>' : '');

  var detail = document.createElement('div');
  detail.className = 'td-transition-detail';

  if (nChanges > 0 && result.diff) {
    var d = result.diff;
    var allRows = [];
    d.costChanged.forEach(function (c) {
      var sign = c.delta > 0 ? '+' : '';
      var typeClass = c.delta > 0 ? 'td-tr-detail-up' : 'td-tr-detail-dn';
      var typeLabel = c.delta > 0 ? 'cost↑' : 'cost↓';
      allRows.push('<div class="td-tr-detail-row">' +
        '<span class="td-tr-detail-type ' + typeClass + '">' + _tdEsc(typeLabel) + '</span>' +
        '<span class="td-tr-detail-edge">' + _tdEsc(String(c.edge.from)) + '→' + _tdEsc(String(c.edge.to)) + '</span>' +
        '<span class="td-tr-detail-cost">' + c.costA + ' → ' + c.costB +
          ' (' + sign + c.delta + (c.pct !== null ? ', ' + sign + c.pct + '%)' : ')') + '</span>' +
        '</div>');
    });
    d.newEdges.forEach(function (e) {
      allRows.push('<div class="td-tr-detail-row">' +
        '<span class="td-tr-detail-type td-tr-detail-new">new</span>' +
        '<span class="td-tr-detail-edge">' + _tdEsc(String(e.from)) + '→' + _tdEsc(String(e.to)) + '</span>' +
        '<span class="td-tr-detail-cost">— → ' + _tdCost(e) + ' (new adjacency)</span></div>');
    });
    d.lostEdges.forEach(function (e) {
      allRows.push('<div class="td-tr-detail-row">' +
        '<span class="td-tr-detail-type td-tr-detail-lost">lost</span>' +
        '<span class="td-tr-detail-edge">' + _tdEsc(String(e.from)) + '→' + _tdEsc(String(e.to)) + '</span>' +
        '<span class="td-tr-detail-cost">' + _tdCost(e) + ' → — (adjacency removed)</span></div>');
    });

    var MAX_SHOW = 10;
    var shown = allRows.slice(0, MAX_SHOW).join('');
    var remaining = allRows.length - MAX_SHOW;
    detail.innerHTML = shown;
    if (remaining > 0) {
      var showAll = document.createElement('div');
      showAll.className = 'td-tr-show-all';
      showAll.textContent = '▼ Show ' + remaining + ' more…';
      var hiddenHtml = allRows.slice(MAX_SHOW).join('');
      showAll.onclick = function () {
        showAll.insertAdjacentHTML('beforebegin', hiddenHtml);
        showAll.remove();
      };
      detail.appendChild(showAll);
    }
  } else if (result.error) {
    detail.textContent = 'Load error: ' + result.error;
    detail.style.color = '#f59e0b';
  }

  // Toggle on header click
  header.onclick = function () {
    var isOpen = detail.classList.contains('open');
    detail.classList.toggle('open', !isOpen);
    var arrow = header.querySelector('.td-tr-arrow');
    if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
  };

  row.appendChild(header);
  row.appendChild(detail);
  container.appendChild(row);
}

/* ── Progress bar ────────────────────────────────────────────────── */
function _tdSetProgress(done, total) {
  var pct = total > 0 ? Math.round(done / total * 100) : 0;
  var fill = document.getElementById('tdProgressFill');
  var text = document.getElementById('tdProgressText');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = 'Processing ' + done + ' of ' + total + ' transitions… (' + pct + '%)';
}

/* ── Cancel ──────────────────────────────────────────────────────── */
function tdCancelTimeline() {
  _tdTimelineCancelled = true;
  document.getElementById('tdBtnCancelTimeline').disabled = true;
  _tdTLStatus('<span class="td-status-cancelled">Cancelling…</span>');
}

/* ── Export CSV ──────────────────────────────────────────────────── */
function tdExportTimelineCsv() {
  if (!_tdTimelineResults.length) return;
  var rows = [['transition_from','transition_to','change_type','edge_id','from_node','to_node','cost_before','cost_after','delta','pct_change']];

  _tdTimelineResults.forEach(function (r) {
    if (!r.diff) return;
    var d = r.diff;
    d.costChanged.forEach(function (c) {
      var sign = c.delta > 0 ? '+' : '';
      var type = c.delta > 0 ? 'cost_up' : 'cost_down';
      rows.push([r.snapA, r.snapB, type, c.id, c.edge.from, c.edge.to, c.costA, c.costB, sign + c.delta, (c.pct !== null ? sign + c.pct + '%' : '')]);
    });
    d.newEdges.forEach(function (e) {
      rows.push([r.snapA, r.snapB, 'new_link', e.id, e.from, e.to, '', _tdCost(e), '', '']);
    });
    d.lostEdges.forEach(function (e) {
      rows.push([r.snapA, r.snapB, 'lost_link', e.id, e.from, e.to, _tdCost(e), '', '', '']);
    });
  });

  if (rows.length <= 1) { _tdTLStatus('No changes found to export.'); return; }
  var csv = rows.map(function (r) { return r.map(function(v){ return '"'+String(v||'').replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
  a.download = 'ospf-timeline.csv';
  a.click();
}

/* ── Timeline status helper ──────────────────────────────────────── */
function _tdTLStatus(html) {
  var el = document.getElementById('tdStatus');
  if (el) el.innerHTML = html;
}
