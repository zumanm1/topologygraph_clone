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
var _ilFailType   = 'node';   // 'node' | 'edge'
var _ilFailId     = null;
var _ilGraphTime  = '';

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
  _ilFailId = id;
  document.getElementById('ilSelectedFailure').textContent = (_ilFailType === 'node' ? '💥 Node: ' : '🔗 Edge: ') + label;
  document.getElementById('ilSearchResults').style.display = 'none';
  document.getElementById('ilSearchBox').value = label;
}

/* ── Analyse blast radius ────────────────────────────────────────── */
function ilAnalyse() {
  if (!_ilFailId) { ilSetStatus('⚠ Select a failure first.'); return; }
  if (!_ilAdj)    { ilSetStatus('⚠ Load a topology first.'); return; }

  ilSetStatus('<span class="il-spinner"></span> Computing blast radius…');
  document.getElementById('ilBtnAnalyse').disabled = true;

  setTimeout(function () {
    try {
      var failNodeId = _ilFailType === 'node' ? _ilFailId : null;
      var failEdgeIds = _ilFailType === 'edge' ? [_ilFailId] : [];

      var result = KSP_blastRadius(failNodeId, failEdgeIds, _ilNodes, _ilEdges, _ilAdj, 3);
      _ilRenderResult(result, failNodeId, failEdgeIds);
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
  var tbody = document.getElementById('ilCountryRows');
  tbody.innerHTML = '';
  var pairs = Object.keys(result.countries).sort();
  pairs.forEach(function (key) {
    var c = result.countries[key];
    if (c.affected === 0) return;
    var tr = document.createElement('tr');
    var parts = key.split('>');
    tr.innerHTML = '<td>' + _ilEsc(parts[0] || key) + '→' + _ilEsc(parts[1] || '') + '</td>' +
      '<td>' + c.total + '</td>' +
      '<td>' + (c.total - c.affected) + '</td>' +
      '<td style="color:#ef4444">-' + c.affected + '</td>';
    tbody.appendChild(tr);
  });

  // Topology overlay
  _ilApplyTopoOverlay(result, failNodeId, failEdgeIds);
}

function _ilApplyTopoOverlay(result, failNodeId, failEdgeIds) {
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
  // Failed node — bright red
  if (failNodeId) {
    var fn = nodeUpd.find(function(x){ return x.id === failNodeId || String(x.id) === String(failNodeId); });
    if (fn) fn.color = { background:'#991b1b', border:'#ef4444' };
  }
  _ilVNodes.update(nodeUpd);

  // Failed edges — red dashed
  var edgeUpd = _ilEdges.map(function (e) {
    var isFailed = failEdgeIds.includes(e.id) || failEdgeIds.includes(String(e.id));
    return { id: e.id, color: { color: isFailed ? '#ef4444' : '#374151' }, width: isFailed ? 4 : 1 };
  });
  _ilVEdges.update(edgeUpd);

  // Focus on failed element
  if (failNodeId && _ilNetwork) {
    _ilNetwork.focus(failNodeId, { scale: 1.5, animation: { duration: 500 } });
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
