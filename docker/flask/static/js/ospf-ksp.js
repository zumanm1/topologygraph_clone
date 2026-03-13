/**
 * ospf-ksp.js  — OSPF K-Shortest Paths Library
 * ==============================================
 * Standalone, self-contained — NO vis.js globals, NO jQuery.
 * Accepts raw nodesList/edgesList arrays from upload-ospf-lsdb-from-js response.
 *
 * PUBLIC API
 * ----------
 *   KSP_expandEcmpEdges(edgesList)           — expand parent ECMP edges to directed sub-edges
 *   KSP_normaliseGraphData(data)             — normalise upload-ospf-lsdb-from-js response
 *   KSP_buildDirAdjList(nodesList, edgesList, overrides)
 *   KSP_dijkstra(srcId, adjList, excludedNodeSet, excludedEdgeSet)
 *   KSP_reconstructPath(srcId, dstId, prev, dist)
 *   KSP_yen(srcId, dstId, K, adjList)
 *   KSP_parseAtype(hostname)
 *   KSP_atypeCountries(nodesList)
 *   KSP_atypeGateways(nodesList)
 *   KSP_bestPair(srcCountry, dstCountry, nodesList, adjList)
 *
 * Algorithm complexity (Yen's K-SP):
 *   ~K * avgPathLen * Dijkstra_cost = K * L * O((E + V) log V)
 *   For K=10, L=8, 50k edges ≈ 400ms in JS.
 *
 * Edge data format (from upload-ospf-lsdb-from-js):
 *   Parent edges aggregate ECMP groups.  Each parent has inside_ecmp_edges_ll
 *   containing the actual directed OSPF edges with individual costs.
 *   Use KSP_expandEcmpEdges() to flatten before calling KSP_buildDirAdjList.
 */

/* ============================================================
 * Section 1 — MinHeap (priority queue for Dijkstra)
 * ============================================================ */

/**
 * Minimal binary min-heap.
 * Items: { dist: number, id: any }
 */
function _KSP_MinHeap() {
  this._h = [];
}
_KSP_MinHeap.prototype.push = function (item) {
  this._h.push(item);
  this._siftUp(this._h.length - 1);
};
_KSP_MinHeap.prototype.pop = function () {
  if (this._h.length === 0) return undefined;
  var top = this._h[0];
  var last = this._h.pop();
  if (this._h.length > 0) { this._h[0] = last; this._siftDown(0); }
  return top;
};
_KSP_MinHeap.prototype.isEmpty = function () { return this._h.length === 0; };
_KSP_MinHeap.prototype._siftUp = function (i) {
  var h = this._h;
  while (i > 0) {
    var p = (i - 1) >> 1;
    if (h[p].dist <= h[i].dist) break;
    var tmp = h[p]; h[p] = h[i]; h[i] = tmp; i = p;
  }
};
_KSP_MinHeap.prototype._siftDown = function (i) {
  var h = this._h, n = h.length;
  while (true) {
    var l = 2 * i + 1, r = 2 * i + 2, s = i;
    if (l < n && h[l].dist < h[s].dist) s = l;
    if (r < n && h[r].dist < h[s].dist) s = r;
    if (s === i) break;
    var tmp = h[s]; h[s] = h[i]; h[i] = tmp; i = s;
  }
};


/* ============================================================
 * Section 2 — Edge cost extractor
 * ============================================================ */

/**
 * Extract numeric OSPF cost from a raw edge object.
 * Tries .cost, .weight, .value, title pattern "cost: N", and label (if pure digit).
 */
function _KSP_edgeCost(e) {
  var cost = e.cost || e.weight || e.value || 0;
  if (!cost && e.title) {
    var m = String(e.title).match(/cost[:\s]*(\d+)/i);
    if (m) cost = parseInt(m[1], 10);
  }
  if (!cost && e.label) {
    var lbl = String(e.label).trim();
    if (/^\d+$/.test(lbl)) cost = parseInt(lbl, 10);
  }
  return (isNaN(cost) || cost <= 0) ? 1 : cost;
}


/* ============================================================
 * Section 3 — Build Directed Adjacency List
 * ============================================================ */

/**
 * KSP_buildDirAdjList(nodesList, edgesList, overrides)
 *
 * Builds a directed adjacency list from raw API data.
 * OSPF edges are directed — the DataSet stores each direction
 * as a separate edge (from→to only, not reversed).
 *
 * @param {Array} nodesList  — array of node objects {id, label, ...}
 * @param {Array} edgesList  — array of edge objects {id, from, to, cost|label|title, ...}
 * @param {Object} overrides — optional per-edge cost override:
 *   { edgeId: { sym: newCost } }          // same cost both directions
 *   { edgeId: { fwd: fwdCost, rev: revCost } }  // asymmetric override
 *   "sym" applies to the direction stored in edgesList (from→to);
 *   "fwd"/"rev" apply to from→to and to→from respectively.
 *
 * @returns {Map<nodeId, Array<{to, cost, edgeId}>>}
 */
function KSP_buildDirAdjList(nodesList, edgesList, overrides) {
  overrides = overrides || {};
  var adj = new Map();

  // Initialise all nodes (even isolated ones)
  if (nodesList) {
    nodesList.forEach(function (n) {
      if (!adj.has(n.id)) adj.set(n.id, []);
    });
  }

  if (!edgesList) return adj;

  // Pre-compute the set of explicitly stored directed pairs.
  // OSPF LSDBs typically store each physical link as ONE directed entry
  // (from the advertising router's perspective). We synthesise the reverse
  // direction for any link that has no explicit reverse edge, making the
  // graph bidirectional as OSPF routing requires.
  var explicitPairs = new Set();
  edgesList.forEach(function (e) {
    if (e.from !== undefined && e.to !== undefined) {
      explicitPairs.add(String(e.from) + ':' + String(e.to));
    }
  });

  edgesList.forEach(function (e) {
    if (e.hidden === true) return;
    if (e.from === undefined || e.to === undefined) return;

    var baseCost = _KSP_edgeCost(e);
    var ov = overrides[e.id] || overrides[String(e.id)] || null;
    var fwdCost, revCost;

    if (ov) {
      if (ov.sym !== undefined) {
        fwdCost = (ov.sym > 0) ? ov.sym : 1;
        revCost = fwdCost;
      } else {
        fwdCost = (ov.fwd !== undefined && ov.fwd > 0) ? ov.fwd : baseCost;
        revCost = (ov.rev !== undefined && ov.rev > 0) ? ov.rev : baseCost;
      }
    } else {
      fwdCost = baseCost;
      // OSPF bidirectional: use weight_rev for the opposite direction if the
      // LSDB recorded it (asymmetric link); otherwise mirror the forward cost.
      var revBase = (e.weight_rev !== undefined && Number(e.weight_rev) > 0)
        ? Number(e.weight_rev) : baseCost;
      revCost = revBase;
    }

    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to))   adj.set(e.to,   []);

    // Forward direction (always add)
    adj.get(e.from).push({ to: e.to, cost: fwdCost, edgeId: e.id });

    // Reverse direction: add a synthetic entry ONLY when there is no explicit
    // edge in the opposite direction already in edgesList. This avoids
    // duplicating an entry that will be processed on its own iteration.
    var reverseKey = String(e.to) + ':' + String(e.from);
    if (!explicitPairs.has(reverseKey)) {
      adj.get(e.to).push({ to: e.from, cost: revCost, edgeId: e.id + '_rev' });
    }
  });

  return adj;
}


/* ============================================================
 * Section 4 — Dijkstra with Exclusion Sets
 * ============================================================ */

/**
 * KSP_dijkstra(srcId, adjList, excludedNodeSet, excludedEdgeSet)
 *
 * Standard single-source Dijkstra that skips excluded nodes/edges.
 * Used by Yen's K-SP to compute spur paths.
 *
 * @param {*}   srcId           — source node ID
 * @param {Map} adjList         — from KSP_buildDirAdjList
 * @param {Set} excludedNodeSet — Set of node IDs to treat as removed (optional)
 * @param {Set} excludedEdgeSet — Set of edgeIds to treat as removed (optional)
 *
 * @returns {{ dist: Map<id,cost>, prev: Map<id,{from,edgeId}> }}
 */
function KSP_dijkstra(srcId, adjList, excludedNodeSet, excludedEdgeSet) {
  excludedNodeSet = excludedNodeSet || new Set();
  excludedEdgeSet = excludedEdgeSet || new Set();

  var dist = new Map();
  var prev = new Map();   // id → { from: prevId, edgeId }
  var heap = new _KSP_MinHeap();

  dist.set(srcId, 0);
  heap.push({ dist: 0, id: srcId });

  while (!heap.isEmpty()) {
    var u = heap.pop();
    if (u.dist > (dist.has(u.id) ? dist.get(u.id) : Infinity)) continue; // stale

    var nbrs = adjList.get(u.id) || [];
    for (var i = 0; i < nbrs.length; i++) {
      var nb = nbrs[i];
      if (excludedNodeSet.has(nb.to))   continue;
      if (excludedEdgeSet.has(nb.edgeId)) continue;

      var nd = u.dist + nb.cost;
      var existing = dist.has(nb.to) ? dist.get(nb.to) : Infinity;
      if (nd < existing) {
        dist.set(nb.to, nd);
        prev.set(nb.to, { from: u.id, edgeId: nb.edgeId });
        heap.push({ dist: nd, id: nb.to });
      }
    }
  }

  return { dist: dist, prev: prev };
}


/* ============================================================
 * Section 5 — Path Reconstruction
 * ============================================================ */

/**
 * KSP_reconstructPath(srcId, dstId, prev, dist)
 *
 * Walk the predecessor map backwards from dstId to srcId.
 *
 * @param {*}   srcId — source node ID
 * @param {*}   dstId — destination node ID
 * @param {Map} prev  — from KSP_dijkstra: id → { from, edgeId }
 * @param {Map} dist  — from KSP_dijkstra: id → cost (for hopCosts)
 *
 * @returns {{ nodes: [], edges: [], hopCosts: [], totalCost: number } | null}
 *   nodes[0] = srcId, nodes[last] = dstId
 *   edges[i] = edgeId between nodes[i] and nodes[i+1]
 *   hopCosts[i] = cost of edge i
 */
function KSP_reconstructPath(srcId, dstId, prev, dist) {
  if (!prev.has(dstId) && srcId !== dstId) return null;
  if (!dist || !dist.has(dstId)) return null;

  var nodes  = [];
  var edges  = [];
  var costs  = [];
  var cur = dstId;
  var visited = new Set();

  while (cur !== srcId) {
    if (visited.has(cur)) return null; // cycle guard
    visited.add(cur);
    var info = prev.get(cur);
    if (!info) return null; // disconnected
    nodes.unshift(cur);
    edges.unshift(info.edgeId);
    // hopCost = dist[cur] - dist[prev]
    var dCur  = dist.has(cur)       ? dist.get(cur)       : 0;
    var dPrev = dist.has(info.from) ? dist.get(info.from) : 0;
    costs.unshift(dCur - dPrev);
    cur = info.from;
  }
  nodes.unshift(srcId);

  return {
    nodes:     nodes,
    edges:     edges,
    hopCosts:  costs,
    totalCost: dist.get(dstId)
  };
}


/* ============================================================
 * Section 6 — Yen's K-Shortest Paths
 * ============================================================ */

/**
 * KSP_yen(srcId, dstId, K, adjList)
 *
 * Finds up to K loopless simple paths from srcId to dstId,
 * ordered by ascending total cost.
 *
 * @param {*}   srcId   — source node ID
 * @param {*}   dstId   — destination node ID
 * @param {number} K    — maximum number of paths (1–20)
 * @param {Map} adjList — from KSP_buildDirAdjList
 *
 * @returns {Array<{nodes, edges, hopCosts, totalCost}>}
 *   Up to K path objects, sorted by totalCost ascending.
 */
function KSP_yen(srcId, dstId, K, adjList) {
  if (!srcId || !dstId || srcId === dstId) return [];
  K = Math.min(Math.max(1, K || 10), 20);

  // ---- First path: standard Dijkstra ----
  var r0 = KSP_dijkstra(srcId, adjList, new Set(), new Set());
  if (!r0.dist.has(dstId)) return []; // no path exists

  var p0 = KSP_reconstructPath(srcId, dstId, r0.prev, r0.dist);
  if (!p0) return [];

  var A = [p0];          // confirmed K-shortest paths
  var B = [];            // candidate heap: { cost, path }
  var seen = new Set();  // serialized node sequences (dedup)
  seen.add(p0.nodes.join(','));

  // Helper: min-cost candidate extraction from B array (small K → linear scan OK)
  function _popMinB() {
    var minIdx = 0;
    for (var i = 1; i < B.length; i++) {
      if (B[i].cost < B[minIdx].cost) minIdx = i;
    }
    return B.splice(minIdx, 1)[0];
  }

  // ---- Main Yen's loop ----
  for (var k = 0; k < K - 1; k++) {
    var prevPath = A[k];

    // Spur node loop: every node in prevPath except last
    for (var i = 0; i < prevPath.nodes.length - 1; i++) {
      var spurNode = prevPath.nodes[i];
      // rootPath = prevPath.nodes[0..i]
      var rootNodes = prevPath.nodes.slice(0, i + 1);
      var rootEdges = prevPath.edges.slice(0, i);
      var rootCosts = prevPath.hopCosts.slice(0, i);
      var rootCost  = 0;
      for (var c = 0; c < rootCosts.length; c++) rootCost += rootCosts[c];

      // Build exclusion sets
      var exclEdges = new Set();
      var exclNodes = new Set(rootNodes.slice(0, i)); // exclude root nodes except spurNode

      // Exclude edges that share the same root prefix with paths already in A or B
      var allPaths = A.concat(B.map(function(b){ return b.path; }));
      for (var pi = 0; pi < allPaths.length; pi++) {
        var pNodes = allPaths[pi].nodes;
        var pEdges = allPaths[pi].edges;
        // Check if this path shares same root prefix with rootNodes
        var sameRoot = true;
        if (pNodes.length < i + 2) { sameRoot = false; }
        if (sameRoot) {
          for (var ri = 0; ri <= i; ri++) {
            if (pNodes[ri] !== rootNodes[ri]) { sameRoot = false; break; }
          }
        }
        if (sameRoot && pEdges.length > i) {
          exclEdges.add(pEdges[i]); // exclude spur edge
        }
      }

      // Run Dijkstra from spurNode with exclusions
      var spurResult = KSP_dijkstra(spurNode, adjList, exclNodes, exclEdges);
      if (!spurResult.dist.has(dstId)) continue;

      // Reconstruct spur portion
      var spurPath = KSP_reconstructPath(spurNode, dstId, spurResult.prev, spurResult.dist);
      if (!spurPath) continue;

      // Combine root + spur into candidate
      var candNodes    = rootNodes.concat(spurPath.nodes.slice(1));
      var candEdges    = rootEdges.concat(spurPath.edges);
      var candHopCosts = rootCosts.concat(spurPath.hopCosts);
      var candCost     = rootCost + spurPath.totalCost;

      // Deduplication by node sequence
      var key = candNodes.join(',');
      if (seen.has(key)) continue;
      seen.add(key);

      B.push({
        cost: candCost,
        path: {
          nodes:     candNodes,
          edges:     candEdges,
          hopCosts:  candHopCosts,
          totalCost: candCost
        }
      });
    }

    if (B.length === 0) break;
    var best = _popMinB();
    A.push(best.path);
  }

  return A;
}


/* ============================================================
 * Section 7 — A-Type Hostname Utilities
 * ============================================================ */

/**
 * KSP_parseAtype(hostname)
 *
 * Parse an A-type hostname of the form:
 *   {country}-{city}-{airport}-{role}{num}
 *   e.g. "fra-par-mar-r1" → { country:'FRA', city:'PAR', airport:'MAR', role:'R', num:'1' }
 *
 * @param {string} hostname
 * @returns {{ country, city, airport, role, num, raw } | null}
 */
function KSP_parseAtype(hostname) {
  var h = String(hostname || '').trim().toLowerCase();
  if (!h) return null;
  var m = h.match(/^([a-z]{2,3})-([a-z]{2,3})-([a-z]{2,3})-([a-z]+)(\d+.*)$/);
  if (!m) return null;
  return {
    raw:     h,
    country: m[1].toUpperCase(),
    city:    m[2].toUpperCase(),
    airport: m[3].toUpperCase(),
    role:    m[4].toUpperCase(),
    num:     m[5]
  };
}

/**
 * KSP_atypeCountries(nodesList)
 *
 * Extract sorted list of unique country codes that appear as A-type nodes.
 *
 * @param {Array} nodesList
 * @returns {string[]} e.g. ['CAN', 'FRA', 'GBR', 'USA']
 */
function KSP_atypeCountries(nodesList) {
  if (!nodesList) return [];
  var seen = {};
  nodesList.forEach(function (n) {
    var label = n.label || n.id || '';
    var parsed = KSP_parseAtype(label);
    if (parsed) seen[parsed.country] = true;
  });
  return Object.keys(seen).sort();
}

/**
 * KSP_atypeGateways(nodesList)
 *
 * Return a map of country → array of A-type node IDs.
 * These are used as src/dst for inter-country path searches.
 *
 * @param {Array} nodesList
 * @returns {Object<string, Array>}  { 'FRA': [id1, id2, ...], ... }
 */
function KSP_atypeGateways(nodesList) {
  if (!nodesList) return {};
  var gw = {};
  nodesList.forEach(function (n) {
    var label = n.label || n.id || '';
    var parsed = KSP_parseAtype(label);
    if (parsed) {
      if (!gw[parsed.country]) gw[parsed.country] = [];
      gw[parsed.country].push(n.id);
    }
  });
  return gw;
}


/* ============================================================
 * Section 8 — Best Pair Finder
 * ============================================================ */

/**
 * KSP_bestPair(srcCountry, dstCountry, nodesList, adjList)
 *
 * Find the single (srcId, dstId) pair from the A-type gateways of
 * srcCountry and dstCountry that minimises the shortest-path cost.
 * This is used to pick good default src/dst for Yen's K-SP.
 *
 * @returns {{ srcId, dstId, cost } | null}
 */
function KSP_bestPair(srcCountry, dstCountry, nodesList, adjList) {
  var gw = KSP_atypeGateways(nodesList);
  var srcNodes = gw[srcCountry] || [];
  var dstNodes = gw[dstCountry] || [];
  if (!srcNodes.length || !dstNodes.length) return null;

  var dstSet = new Set(dstNodes);
  var best = null;

  srcNodes.forEach(function (srcId) {
    var result = KSP_dijkstra(srcId, adjList, new Set(), new Set());
    dstNodes.forEach(function (dstId) {
      if (!result.dist.has(dstId)) return;
      var cost = result.dist.get(dstId);
      if (!best || cost < best.cost) {
        best = { srcId: srcId, dstId: dstId, cost: cost };
      }
    });
  });

  return best;
}


/* ============================================================
 * Section 9 — K-SP Between Country Pairs (all gateway pairs)
 * ============================================================ */

/**
 * KSP_countryPaths(srcCountry, dstCountry, K, nodesList, adjList)
 *
 * Run Yen's K-SP for the best gateway pair between two countries.
 * Returns up to K paths in ascending cost order.
 *
 * @returns {Array<{nodes, edges, hopCosts, totalCost}>}
 */
function KSP_countryPaths(srcCountry, dstCountry, K, nodesList, adjList) {
  var pair = KSP_bestPair(srcCountry, dstCountry, nodesList, adjList);
  if (!pair) return [];
  return KSP_yen(pair.srcId, pair.dstId, K, adjList);
}


/* ============================================================
 * Section 10 — Node Label Helpers
 * ============================================================ */

/**
 * KSP_nodeLabel(nodeId, nodesList)
 * Lookup human-readable label for a node ID.
 */
function KSP_nodeLabel(nodeId, nodesList) {
  if (!nodesList) return String(nodeId);
  for (var i = 0; i < nodesList.length; i++) {
    if (nodesList[i].id === nodeId) return nodesList[i].label || String(nodeId);
  }
  return String(nodeId);
}

/**
 * KSP_edgeLabel(edgeId, edgesList, nodesList)
 * Build a human-readable edge label "NodeA → NodeB (cost N)".
 */
function KSP_edgeLabel(edgeId, edgesList, nodesList) {
  if (!edgesList) return String(edgeId);
  for (var i = 0; i < edgesList.length; i++) {
    var e = edgesList[i];
    if (String(e.id) === String(edgeId) || e.id === edgeId) {
      var fromLabel = KSP_nodeLabel(e.from, nodesList);
      var toLabel   = KSP_nodeLabel(e.to,   nodesList);
      var cost      = _KSP_edgeCost(e);
      return fromLabel + ' \u2192 ' + toLabel + ' (' + cost + ')';
    }
  }
  return String(edgeId);
}


/* ============================================================
 * Section 11 — Blast Radius (for Impact Lab)
 * ============================================================ */

/**
 * KSP_blastRadius(failedNodeId, failedEdgeIds, nodesList, edgesList, adjList, K)
 *
 * Compute which nodes/countries lose reachability when a set of
 * nodes/edges fail.  Returns blast rings:
 *   ring0 — directly connected to failure point
 *   ring1 — primary path lost (Dijkstra shortest path changes)
 *   ring2 — backup paths exhausted (K-SP ≥ 2 no longer exist)
 *   unreachable — completely disconnected from failure node
 *
 * @param {*}      failedNodeId  — node that failed (null if edge-failure)
 * @param {Array}  failedEdgeIds — edges that failed (may be empty)
 * @param {Array}  nodesList
 * @param {Array}  edgesList
 * @param {Map}    adjList       — normal topology adj list
 * @param {number} K             — paths to check for backup
 *
 * @returns {{ ring0: Set, ring1: Set, ring2: Set, unreachable: Set, countries: Object }}
 */
function KSP_blastRadius(failedNodeId, failedEdgeIds, nodesList, edgesList, adjList, K) {
  K = K || 3;
  failedEdgeIds = failedEdgeIds || [];

  // PRD-24: accept failedNodeId as a string, array, or Set for multi-failure support
  var exclNodes;
  if (!failedNodeId) {
    exclNodes = new Set();
  } else if (failedNodeId instanceof Set) {
    exclNodes = failedNodeId;
    failedNodeId = null; // handled via set below
  } else if (Array.isArray(failedNodeId)) {
    exclNodes = new Set(failedNodeId);
    failedNodeId = null;
  } else {
    exclNodes = new Set([failedNodeId]);
  }
  var exclEdges = new Set(failedEdgeIds);

  // Build degraded adj list for post-failure Dijkstra
  var degradedAdj = KSP_buildDirAdjList(nodesList, edgesList.filter(function(e) {
    return !exclEdges.has(e.id) && !exclNodes.has(e.from) && !exclNodes.has(e.to);
  }), {});

  // Identify A-type gateway nodes
  var gateways = KSP_atypeGateways(nodesList);
  var allGWIds = [];
  Object.keys(gateways).forEach(function(c) {
    gateways[c].forEach(function(id) { allGWIds.push({ id: id, country: c }); });
  });

  // Run Dijkstra from each gateway in normal + degraded topology
  var ring0 = new Set(); // directly adjacent to failed node
  var ring1 = new Set(); // primary path cost increased
  var ring2 = new Set(); // backup also lost
  var unreachable = new Set();

  // ring0 = directly connected nodes in normal topology (for all failed nodes)
  exclNodes.forEach(function(fnId) {
    (adjList.get(fnId) || []).forEach(function(nb) { ring0.add(nb.to); });
  });
  failedEdgeIds.forEach(function(eid) {
    edgesList.forEach(function(e) {
      if (e.id === eid) { ring0.add(e.from); ring0.add(e.to); }
    });
  });

  // For each gateway pair: compare normal vs degraded shortest path
  var countryImpact = {}; // country → { affected: count, total: count }

  allGWIds.forEach(function(src) {
    allGWIds.forEach(function(dst) {
      if (src.id === dst.id) return;
      if (src.country === dst.country) return;

      var pair = String(src.id) + '>' + String(dst.id);

      // Skip if src or dst is in the failed node set
      if (exclNodes.has(src.id) || exclNodes.has(dst.id)) return;

      // Normal Dijkstra
      var norm = KSP_dijkstra(src.id, adjList, new Set(), new Set());
      var normCost = norm.dist.has(dst.id) ? norm.dist.get(dst.id) : Infinity;

      // Degraded Dijkstra
      var degr = KSP_dijkstra(src.id, degradedAdj, new Set(), new Set());
      var degrCost = degr.dist.has(dst.id) ? degr.dist.get(dst.id) : Infinity;

      var key = src.country + '>' + dst.country;
      if (!countryImpact[key]) countryImpact[key] = { affected: 0, total: 0, improved: 0, degraded: 0, lost: 0 };
      countryImpact[key].total++;

      if (degrCost === Infinity && normCost !== Infinity) {
        unreachable.add(src.id); unreachable.add(dst.id);
        countryImpact[key].affected++; countryImpact[key].lost++;
      } else if (degrCost > normCost) {
        ring1.add(src.id); ring1.add(dst.id);
        countryImpact[key].affected++; countryImpact[key].degraded++;
      }
    });
  });

  return {
    ring0: ring0,
    ring1: ring1,
    ring2: ring2,
    unreachable: unreachable,
    countries: countryImpact
  };
}


/* ============================================================
 * Section 12 — Topology Diff (for Topo Diff page)
 * ============================================================ */

/**
 * KSP_topoDiff(nodesA, edgesA, nodesB, edgesB)
 *
 * Compare two LSDB snapshots.  Returns structural diff.
 *
 * @returns {{
 *   newNodes:    Array,   // nodes in B but not A
 *   lostNodes:   Array,   // nodes in A but not B
 *   newEdges:    Array,   // edges in B but not A
 *   lostEdges:   Array,   // edges in A but not B
 *   costChanged: Array<{ edge, costA, costB, delta, pct }>,
 *   unchanged:   Array
 * }}
 */
function KSP_topoDiff(nodesA, edgesA, nodesB, edgesB) {
  function edgeKey(e) { return String(e.from) + '>' + String(e.to); }

  var nodeIdsA = new Set((nodesA || []).map(function(n){ return n.id; }));
  var nodeIdsB = new Set((nodesB || []).map(function(n){ return n.id; }));

  var newNodes  = (nodesB || []).filter(function(n){ return !nodeIdsA.has(n.id); });
  var lostNodes = (nodesA || []).filter(function(n){ return !nodeIdsB.has(n.id); });

  // Build edge maps by from>to key
  var edgeMapA = {};
  (edgesA || []).forEach(function(e){ edgeMapA[edgeKey(e)] = e; });
  var edgeMapB = {};
  (edgesB || []).forEach(function(e){ edgeMapB[edgeKey(e)] = e; });

  var keysA = Object.keys(edgeMapA);
  var keysB = Object.keys(edgeMapB);
  var allKeys = new Set(keysA.concat(keysB));

  var newEdges    = [];
  var lostEdges   = [];
  var costChanged = [];
  var unchanged   = [];

  allKeys.forEach(function(k) {
    var eA = edgeMapA[k];
    var eB = edgeMapB[k];
    if (eA && !eB) { lostEdges.push(eA); }
    else if (!eA && eB) { newEdges.push(eB); }
    else {
      var cA = _KSP_edgeCost(eA);
      var cB = _KSP_edgeCost(eB);
      if (cA !== cB) {
        var delta = cB - cA;
        var pct   = cA !== 0 ? Math.round((delta / cA) * 100) : Infinity;
        costChanged.push({ edge: eB, costA: cA, costB: cB, delta: delta, pct: pct });
      } else {
        unchanged.push(eB);
      }
    }
  });

  // Sort cost changes by abs(delta) descending
  costChanged.sort(function(a, b){ return Math.abs(b.delta) - Math.abs(a.delta); });

  return { newNodes: newNodes, lostNodes: lostNodes, newEdges: newEdges, lostEdges: lostEdges, costChanged: costChanged, unchanged: unchanged };
}

/**
 * KSP_countryPairDiff(nodesA, edgesA, nodesB, edgesB)
 *
 * Compare best inter-country shortest-path costs between two snapshots.
 * Returns per-country-pair deltas.
 *
 * @returns {Array<{ srcCountry, dstCountry, costA, costB, delta, pct }>}
 */
function KSP_countryPairDiff(nodesA, edgesA, nodesB, edgesB) {
  var adjA = KSP_buildDirAdjList(nodesA, edgesA, {});
  var adjB = KSP_buildDirAdjList(nodesB, edgesB, {});

  var countriesA = KSP_atypeCountries(nodesA);
  var countriesB = KSP_atypeCountries(nodesB);
  var allCountries = Array.from(new Set(countriesA.concat(countriesB))).sort();

  var results = [];

  for (var i = 0; i < allCountries.length; i++) {
    for (var j = 0; j < allCountries.length; j++) {
      if (i === j) continue;
      var srcC = allCountries[i];
      var dstC = allCountries[j];

      var pairA = KSP_bestPair(srcC, dstC, nodesA, adjA);
      var pairB = KSP_bestPair(srcC, dstC, nodesB, adjB);

      var costA = pairA ? pairA.cost : Infinity;
      var costB = pairB ? pairB.cost : Infinity;

      if (costA === costB) continue; // no change

      var delta = costB - costA;
      var pct = (costA !== Infinity && costA !== 0)
        ? Math.round((delta / costA) * 100)
        : (costB === Infinity ? null : Infinity);

      results.push({ srcCountry: srcC, dstCountry: dstC, costA: costA, costB: costB, delta: delta, pct: pct });
    }
  }

  results.sort(function(a, b){ return Math.abs(b.delta) - Math.abs(a.delta); });
  return results;
}

/* ============================================================
 * Section 8 — Data normalisation helpers
 *   KSP_expandEcmpEdges(edgesList)
 *   KSP_normaliseGraphData(data)
 *   KSP_loadTopology(graphTime)  — async, calls upload-ospf-lsdb-from-js
 * ============================================================ */

/**
 * Expand parent ECMP edges from upload-ospf-lsdb-from-js response.
 *
 * The response returns parent edges that aggregate multiple directed ECMP
 * sub-edges into one vis.js object. The parent's `weight` is an aggregate
 * (sum) that is NOT usable for Dijkstra. The actual directed OSPF costs live
 * in each entry of `inside_ecmp_edges_ll`.
 *
 * This function flattens parent edges → directed sub-edges so Dijkstra gets
 * correct per-hop costs. If a parent has no sub-edges it is kept as-is.
 *
 * @param {Array} edgesList  Raw edges_attr_dd_in_ll from upload response.
 * @returns {Array}          Flat list of directed edge objects.
 */
function KSP_expandEcmpEdges(edgesList) {
  if (!Array.isArray(edgesList)) return [];
  var result = [];
  edgesList.forEach(function (e) {
    var subs = e.inside_ecmp_edges_ll;
    if (Array.isArray(subs) && subs.length > 0) {
      subs.forEach(function (s) {
        // sub-edges use `labelFrom` (string) as cost — normalise to number
        var cost = Number(s.weight || s.labelFrom || s.cost || s.value || 1);
        result.push(Object.assign({}, s, { weight: cost, cost: cost }));
      });
    } else {
      result.push(e);
    }
  });
  return result;
}

/**
 * Normalise the JSON blob returned by POST /upload-ospf-lsdb-from-js into
 * a plain { nodes, edges } object usable by KSP_buildDirAdjList.
 *
 * Handles both the standard response shape and any legacy/wrapped shapes.
 *
 * @param {Object} data  Response JSON from upload-ospf-lsdb-from-js.
 * @returns {{ nodes: Array, edges: Array, graphId: string, graphTime: string }}
 */
function KSP_normaliseGraphData(data) {
  if (!data || typeof data !== 'object') return { nodes: [], edges: [] };
  var nodes = data.nodes_attr_dd_in_ll || data.nodes || [];
  var rawEdges = data.edges_attr_dd_in_ll || data.edges || [];
  if (!Array.isArray(nodes))    nodes    = [];
  if (!Array.isArray(rawEdges)) rawEdges = [];
  return {
    nodes:     nodes,
    edges:     KSP_expandEcmpEdges(rawEdges),
    graphId:   data.graph_id   || '',
    graphTime: data.start_time_iso || ''
  };
}

/**
 * Async helper: load topology for a given graph_time via the existing
 * POST /upload-ospf-lsdb-from-js endpoint (session-auth, no IP restriction).
 *
 * Returns a normalised { nodes, edges, graphId, graphTime } object,
 * or throws on HTTP error.
 *
 * @param {string} graphTime
 * @returns {Promise<{nodes:Array, edges:Array, graphId:string, graphTime:string}>}
 */
function KSP_loadTopology(graphTime) {
  var fd = new FormData();
  fd.append('dynamic_graph_time', graphTime);
  return fetch('/upload-ospf-lsdb-from-js', { method: 'POST', body: fd })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' loading topology for ' + graphTime);
      return r.json();
    })
    .then(function (data) {
      return KSP_normaliseGraphData(data);
    });
}

/* ════════════════════════════════════════════════════════════════════
   PRD-15 helpers — Country gateway resolution & reachability matrix
   ════════════════════════════════════════════════════════════════════ */

/**
 * Return the first node ID whose A-type country === country (case-insensitive).
 * Returns null if no gateway found.
 */
function KSP_countryGateway(country, nodesList) {
  var c = country.toUpperCase();
  var n = nodesList.find(function (node) {
    var p = KSP_parseAtype(node.label || node.id || '');
    return p && p.country.toUpperCase() === c;
  });
  return n ? n.id : null;
}

/**
 * Build an N×N cost matrix for A-type country pairs.
 * excludedNodeSet: Set of node ID strings to exclude (for failure simulation), or null.
 * Returns: { [srcCountry]: { [dstCountry]: cost | Infinity } }
 */
function KSP_reachabilityMatrix(countries, nodesList, adjList, excludedNodeSet) {
  var excl = excludedNodeSet || new Set();
  var matrix = {};

  countries.forEach(function (src) {
    matrix[src] = {};
    var srcId = KSP_countryGateway(src, nodesList);

    if (!srcId || excl.has(String(srcId))) {
      // Source gateway is excluded or not found — all routes from this country are ∞
      countries.forEach(function (dst) { matrix[src][dst] = Infinity; });
      return;
    }

    var result = KSP_dijkstra(srcId, adjList, excl, new Set());

    countries.forEach(function (dst) {
      if (dst === src) { matrix[src][dst] = 0; return; }
      var dstId = KSP_countryGateway(dst, nodesList);
      if (!dstId || excl.has(String(dstId))) {
        matrix[src][dst] = Infinity;
      } else {
        var d = result.dist.get(String(dstId));
        matrix[src][dst] = (d !== undefined && d !== null) ? d : Infinity;
      }
    });
  });

  return matrix;
}
