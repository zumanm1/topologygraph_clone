/**
 * cost-matrix.js
 * Logic for the standalone Cost Matrix dashboard.
 * Enhanced: cell-click bottom drawer with FWD/REV hop tables, country chain,
 * router/country view toggle, and per-cell detail CSV export.
 */

let rmFullMatrix = null;
let rmCountries = [];
let rmNodes = [];
let rmEdges = [];
let rmGraphTime = null;
let rmDetailHopView = 'router'; // 'router' | 'country'
let rmLastSrc = null;
let rmLastDst = null;
let rmLastFwdHops = [];
let rmLastRevHops = [];

/* ─────────────────────────────────────────────────────────────────────────
   INIT & TOPOLOGY LOAD
───────────────────────────────────────────────────────────────────────── */

function _rmLSGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
}

function _rmGetParam(name) {
    try {
        var u = new URLSearchParams(window.location.search);
        return u.get(name) || '';
    } catch (e) { return ''; }
}

function rmInit() {
    var savedTime = _rmGetParam('graph_time') || _rmLSGet('ospf_graph_time') || '';
    console.log('RM: Initializing… saved graph_time=' + (savedTime || '(none)'));

    fetch('/api/graph-times')
        .then(function (r) { return r.ok ? r.json() : { graph_time_list: [] }; })
        .catch(function () { return { graph_time_list: [] }; })
        .then(function (data) {
            var list = data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []);
            if (!Array.isArray(list)) list = [];

            if (savedTime && list.indexOf(savedTime) === -1) list = [savedTime].concat(list);

            var sel = document.getElementById('matrix-topo-select');
            sel.innerHTML = '';
            if (list.length === 0) {
                sel.innerHTML = '<option value="">No graphs — load one on the main page</option>';
                $('#matrix-display').html('<div class="alert alert-warning m-4">No topology snapshots found. Upload an OSPF LSDB from the main page first.</div>');
                return;
            }

            list.forEach(function (t) {
                var opt = document.createElement('option');
                opt.value = t; opt.textContent = t;
                if (t === savedTime) opt.selected = true;
                sel.appendChild(opt);
            });

            if (!savedTime) savedTime = list[list.length - 1];
            sel.addEventListener('change', function () { rmLoadTopology(sel.value); });

            rmLoadTopology(savedTime || list[list.length - 1]);
        });
}

async function rmLoadTopology(graphTime) {
    rmGraphTime = graphTime;
    rmLastSrc = null; rmLastDst = null;
    rmCloseDrawer();
    $('#matrix-display').html(`
        <div class="d-flex justify-content-center align-items-center h-100">
            <div class="text-center">
                <div class="spinner-border text-primary mb-3"></div>
                <p class="text-muted">Loading topology ${graphTime}…</p>
            </div>
        </div>`);

    try {
        // Use session-auth endpoint (same as path-explorer, change-planner, impact-lab)
        const topo = await KSP_loadTopology(graphTime);
        rmNodes = topo.nodes;
        rmEdges = topo.edges;

        const countrySet = new Set();
        rmNodes.forEach(n => {
            const p = KSP_parseAtype(n.label || n.id || '');
            if (p && p.country) countrySet.add(p.country.toUpperCase());
        });

        rmCountries = Array.from(countrySet).sort();
        console.log(`RM: Found ${rmCountries.length} countries, ${rmNodes.length} nodes, ${rmEdges.length} edges`);

        if (rmCountries.length < 2) {
            $('#matrix-display').html('<div class="alert alert-warning m-4">No A-type countries found in this topology.</div>');
            return;
        }

        const adj = KSP_buildDirAdjList(rmNodes, rmEdges, {});
        rmFullMatrix = KSP_reachabilityMatrix(rmCountries, rmNodes, adj, new Set());
        rmRenderMatrix();
    } catch (e) {
        console.error("RM: Load failed", e);
        $('#matrix-display').html('<div class="alert alert-danger m-4">Error loading topology: ' + e.message + '</div>');
    }
}

/* ─────────────────────────────────────────────────────────────────────────
   MATRIX RENDER
───────────────────────────────────────────────────────────────────────── */

function rmRenderMatrix() {
    const search = $('#rm-search').val().toUpperCase();
    const filteredCountries = rmCountries.filter(c => c.includes(search));

    const showAsym = $('#sw-asymmetry').is(':checked');
    const thLow  = parseInt($('#th-low').val())  || 500;
    const thMed  = parseInt($('#th-med').val())  || 1500;
    const thHigh = parseInt($('#th-high').val()) || 3000;

    let html = `<table class="rm-table"><thead><tr><th class="rm-hdr-row">SRC \\ DST</th>`;
    filteredCountries.forEach(c => { html += `<th class="rm-hdr-col">${c}</th>`; });
    html += `</tr></thead><tbody>`;

    filteredCountries.forEach(src => {
        html += `<tr><th class="rm-hdr-row">${src}</th>`;
        filteredCountries.forEach(dst => {
            const cost = rmFullMatrix[src][dst];
            let cls = 'rm-cell ';
            let text = cost === Infinity ? '∞' : cost;

            if (src === dst) {
                cls += 'rm-self'; text = '—';
            } else if (cost === Infinity) {
                cls += 'rm-none';
            } else if (cost < thLow)  { cls += 'rm-low';
            } else if (cost < thMed)  { cls += 'rm-med';
            } else if (cost < thHigh) { cls += 'rm-high';
            } else                    { cls += 'rm-crit'; }

            if (showAsym && src !== dst) {
                const rev = rmFullMatrix[dst][src];
                if (cost !== rev) cls += ' rm-asym-warn';
            }

            const isSelected = (src === rmLastSrc && dst === rmLastDst) ? ' rm-selected' : '';
            html += `<td class="${cls}${isSelected}" onclick="rmSelectCell('${src}','${dst}')" title="${src} → ${dst}: ${text}">${text}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;

    $('#matrix-display').html(html);
    $('#matrix-stats').text(`Matrix: ${rmCountries.length}×${rmCountries.length} countries | Visible: ${filteredCountries.length} | Snapshot: ${rmGraphTime || '—'}`);
}

/* ─────────────────────────────────────────────────────────────────────────
   PATH RECONSTRUCTION HELPERS
───────────────────────────────────────────────────────────────────────── */

/**
 * Run Dijkstra from srcId, trace back to dstId.
 * Returns array of { nodeId, label, country, linkCost, cumCost } objects.
 * linkCost = cost of edge arriving at this node (0 for first hop).
 */
function rmTracePath(srcId, dstId) {
    if (!srcId || !dstId) return null;
    const adj = KSP_buildDirAdjList(rmNodes, rmEdges, {});
    const result = KSP_dijkstra(String(srcId), adj, new Set(), new Set());

    // Reconstruct node sequence
    const nodeSeq = [];
    let curr = String(dstId);
    while (curr && result.prev && result.prev.has(curr)) {
        nodeSeq.unshift(curr);
        const p = result.prev.get(curr);
        curr = (p && p.from !== undefined) ? String(p.from) : p;
    }
    if (curr === String(srcId)) nodeSeq.unshift(curr);
    if (nodeSeq.length === 0 || nodeSeq[0] !== String(srcId)) return null;

    // Build edge lookup: "fromId|toId" → cost
    const edgeCostMap = {};
    rmEdges.forEach(e => {
        const key = `${e.from}|${e.to}`;
        const cost = (e.cost !== undefined && e.cost !== null) ? Number(e.cost) :
                     (e.label !== undefined && e.label !== null && !isNaN(Number(e.label))) ? Number(e.label) : 1;
        if (edgeCostMap[key] === undefined || cost < edgeCostMap[key]) {
            edgeCostMap[key] = cost;
        }
    });

    // Build hop objects
    let cumCost = 0;
    return nodeSeq.map((nid, idx) => {
        const node = rmNodes.find(n => String(n.id) === nid);
        const label = node ? (node.label || node.id) : nid;
        const p = KSP_parseAtype(label);
        const country = (p && p.country) ? p.country.toUpperCase() : 'UNK';
        let linkCost = 0;
        if (idx > 0) {
            const prevId = nodeSeq[idx - 1];
            linkCost = edgeCostMap[`${prevId}|${nid}`] || edgeCostMap[`${nid}|${prevId}`] || 0;
            cumCost += linkCost;
        }
        return { nodeId: nid, label, country, linkCost, cumCost };
    });
}

/* ─────────────────────────────────────────────────────────────────────────
   CELL CLICK — OPEN DRAWER
───────────────────────────────────────────────────────────────────────── */

function rmSelectCell(src, dst) {
    if (src === dst) return;

    rmLastSrc = src;
    rmLastDst = dst;

    const fwdCost = rmFullMatrix[src][dst];
    const revCost = rmFullMatrix[dst][src];

    // Compute hop chains
    const srcGw = KSP_countryGateway(src, rmNodes);
    const dstGw = KSP_countryGateway(dst, rmNodes);

    rmLastFwdHops = (fwdCost !== Infinity) ? (rmTracePath(srcGw, dstGw) || []) : [];
    rmLastRevHops = (revCost !== Infinity) ? (rmTracePath(dstGw, srcGw) || []) : [];

    rmRenderDrawer(src, dst, fwdCost, revCost);

    // Highlight selected cell
    document.querySelectorAll('.rm-selected').forEach(el => el.classList.remove('rm-selected'));
    document.querySelectorAll(`.rm-cell`).forEach(el => {
        if (el.getAttribute('onclick') === `rmSelectCell('${src}','${dst}')`) {
            el.classList.add('rm-selected');
        }
    });
}

/* ─────────────────────────────────────────────────────────────────────────
   DRAWER RENDER
───────────────────────────────────────────────────────────────────────── */

function rmRenderDrawer(src, dst, fwdCost, revCost) {
    const asymFlag = fwdCost !== revCost ? '<span class="rm-asym-badge">⚠ ASYMMETRIC</span>' : '';
    const viewLabel = rmDetailHopView === 'router' ? 'Router Detail' : 'Country Summary';
    const toggleLabel = rmDetailHopView === 'router' ? '🌍 Country View' : '🖧 Router View';

    const drawerHtml = `
    <div id="rm-detail-drawer" class="rm-drawer rm-drawer-open">
      <div class="rm-drawer-header">
        <div class="rm-drawer-title">
          <span class="rm-dir-badge rm-fwd-badge">FWD</span>
          <strong>${src}</strong> <span class="rm-arrow">→</span> <strong>${dst}</strong>
          &nbsp;|&nbsp;
          <span class="rm-dir-badge rm-rev-badge">REV</span>
          <strong>${dst}</strong> <span class="rm-arrow">→</span> <strong>${src}</strong>
          ${asymFlag}
        </div>
        <div class="rm-drawer-actions">
          <button class="rm-btn rm-btn-sm" onclick="rmToggleHopView()">${toggleLabel}</button>
          <button class="rm-btn rm-btn-sm rm-btn-export" onclick="rmExportDetailCSV()">⬇ Export Detail CSV</button>
          <button class="rm-btn rm-btn-close" onclick="rmCloseDrawer()">✕</button>
        </div>
      </div>
      <div class="rm-drawer-body">
        <div class="rm-path-panel">
          <div class="rm-panel-heading rm-fwd-heading">
            ➔ Forward: <strong>${src} → ${dst}</strong>
            <span class="rm-cost-badge">${fwdCost === Infinity ? 'UNREACHABLE' : 'Cost: ' + fwdCost}</span>
            ${rmLastFwdHops.length ? `<span class="rm-hops-badge">${rmLastFwdHops.length - 1} hops</span>` : ''}
          </div>
          ${rmRenderHopPanel(rmLastFwdHops, fwdCost, src, dst)}
        </div>
        <div class="rm-path-divider"></div>
        <div class="rm-path-panel">
          <div class="rm-panel-heading rm-rev-heading">
            ↩ Reverse: <strong>${dst} → ${src}</strong>
            <span class="rm-cost-badge">${revCost === Infinity ? 'UNREACHABLE' : 'Cost: ' + revCost}</span>
            ${rmLastRevHops.length ? `<span class="rm-hops-badge">${rmLastRevHops.length - 1} hops</span>` : ''}
          </div>
          ${rmRenderHopPanel(rmLastRevHops, revCost, dst, src)}
        </div>
      </div>
    </div>`;

    // Remove existing drawer
    const existing = document.getElementById('rm-detail-drawer');
    if (existing) existing.remove();

    // Append to matrix-main (inside the layout, not body)
    const matrixMain = document.querySelector('.matrix-main');
    if (matrixMain) {
        matrixMain.insertAdjacentHTML('beforeend', drawerHtml);
    } else {
        document.body.insertAdjacentHTML('beforeend', drawerHtml);
    }
}

function rmRenderHopPanel(hops, cost, fromCountry, toCountry) {
    if (cost === Infinity || hops.length === 0) {
        return `<div class="rm-no-path">No path available from <strong>${fromCountry}</strong> to <strong>${toCountry}</strong></div>`;
    }

    if (rmDetailHopView === 'country') {
        return rmRenderCountrySummary(hops);
    }
    return rmRenderRouterTable(hops);
}

function rmRenderRouterTable(hops) {
    let rows = hops.map((h, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === hops.length - 1;
        const rowClass = isFirst ? 'rm-hop-src' : isLast ? 'rm-hop-dst' : '';
        const linkCostCell = isFirst ? '<td class="rm-td-center">—</td>' : `<td class="rm-td-center rm-link-cost">+${h.linkCost}</td>`;
        return `<tr class="${rowClass}">
            <td class="rm-td-center rm-hop-num">${idx + 1}</td>
            <td class="rm-td-label"><span class="rm-router-icon">🖧</span> ${h.label}</td>
            <td class="rm-td-center"><span class="rm-country-chip">${h.country}</span></td>
            ${linkCostCell}
            <td class="rm-td-center rm-cum-cost">${h.cumCost}</td>
        </tr>`;
    }).join('');

    return `<div class="rm-hop-table-wrap">
        <table class="rm-hop-table">
            <thead><tr>
                <th>#</th><th>Router</th><th>Country</th><th>Link Cost</th><th>Cum. Cost</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function rmRenderCountrySummary(hops) {
    // Group consecutive hops by country
    const segments = [];
    hops.forEach(h => {
        if (segments.length && segments[segments.length - 1].country === h.country) {
            segments[segments.length - 1].nodes.push(h);
        } else {
            segments.push({ country: h.country, nodes: [h] });
        }
    });

    // Country chain badges
    const chain = segments.map((s, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === segments.length - 1;
        const chipClass = isFirst ? 'rm-country-chip rm-chip-src' : isLast ? 'rm-country-chip rm-chip-dst' : 'rm-country-chip';
        const nodeList = s.nodes.map(n => `<div class="rm-country-node">🖧 ${n.label}</div>`).join('');
        return `<div class="rm-segment">
            <span class="${chipClass}">${s.country}</span>
            <div class="rm-segment-nodes">${nodeList}</div>
            ${idx < segments.length - 1 ? '<div class="rm-seg-arrow">↓</div>' : ''}
        </div>`;
    }).join('');

    return `<div class="rm-country-chain">${chain}</div>`;
}

function rmCloseDrawer() {
    const d = document.getElementById('rm-detail-drawer');
    if (d) d.remove();
    rmLastSrc = null; rmLastDst = null;
    document.querySelectorAll('.rm-selected').forEach(el => el.classList.remove('rm-selected'));
}

function rmToggleHopView() {
    rmDetailHopView = rmDetailHopView === 'router' ? 'country' : 'router';
    if (rmLastSrc && rmLastDst) {
        const fwdCost = rmFullMatrix[rmLastSrc][rmLastDst];
        const revCost = rmFullMatrix[rmLastDst][rmLastSrc];
        rmRenderDrawer(rmLastSrc, rmLastDst, fwdCost, revCost);
    }
}

/* ─────────────────────────────────────────────────────────────────────────
   FILTER / THRESHOLD / ASYMMETRY
───────────────────────────────────────────────────────────────────────── */

function rmFilterMatrix()    { rmRenderMatrix(); }
function rmApplyThresholds() { rmRenderMatrix(); }
function rmToggleAsymmetry() { rmRenderMatrix(); }

/* ─────────────────────────────────────────────────────────────────────────
   EXPORT — MATRIX CSV
───────────────────────────────────────────────────────────────────────── */

function rmExportCSV() {
    if (!rmFullMatrix) return;
    let csv = `Cost Matrix Export — Snapshot: ${rmGraphTime}\n`;
    csv += "SRC/DST," + rmCountries.join(",") + "\n";
    rmCountries.forEach(src => {
        let row = [src];
        rmCountries.forEach(dst => {
            const val = rmFullMatrix[src][dst];
            row.push(val === Infinity ? "inf" : val);
        });
        csv += row.join(",") + "\n";
    });
    rmDownloadCSV(csv, `cost-matrix-${rmGraphTime}.csv`);
}

function rmExportMarkdown() {
    let md = "| SRC\\DST | " + rmCountries.join(" | ") + " |\n";
    md += "| --- | " + rmCountries.map(() => "---").join(" | ") + " |\n";
    rmCountries.forEach(src => {
        md += `| **${src}** | ` + rmCountries.map(dst => {
            const v = rmFullMatrix[src][dst];
            return v === Infinity ? "∞" : v;
        }).join(" | ") + " |\n";
    });
    navigator.clipboard.writeText(md);
    alert("Markdown table copied to clipboard!");
}

/* ─────────────────────────────────────────────────────────────────────────
   EXPORT — DETAIL (per-cell FWD + REV hop tables)
───────────────────────────────────────────────────────────────────────── */

function rmExportDetailCSV() {
    if (!rmLastSrc || !rmLastDst) return;
    const src = rmLastSrc, dst = rmLastDst;
    const fwdCost = rmFullMatrix[src][dst];
    const revCost = rmFullMatrix[dst][src];

    let csv = `Path Detail Export — Snapshot: ${rmGraphTime}\n`;
    csv += `Source Country,${src}\nDestination Country,${dst}\n\n`;

    csv += `FORWARD PATH: ${src} → ${dst}\n`;
    csv += `Total Cost,${fwdCost === Infinity ? 'UNREACHABLE' : fwdCost}\n`;
    if (rmLastFwdHops.length > 0) {
        csv += `Hop,Router,Country,Link Cost,Cumulative Cost\n`;
        rmLastFwdHops.forEach((h, i) => {
            csv += `${i + 1},"${h.label}",${h.country},${i === 0 ? '' : h.linkCost},${h.cumCost}\n`;
        });
    } else {
        csv += `No path available\n`;
    }

    csv += `\nREVERSE PATH: ${dst} → ${src}\n`;
    csv += `Total Cost,${revCost === Infinity ? 'UNREACHABLE' : revCost}\n`;
    if (rmLastRevHops.length > 0) {
        csv += `Hop,Router,Country,Link Cost,Cumulative Cost\n`;
        rmLastRevHops.forEach((h, i) => {
            csv += `${i + 1},"${h.label}",${h.country},${i === 0 ? '' : h.linkCost},${h.cumCost}\n`;
        });
    } else {
        csv += `No path available\n`;
    }

    rmDownloadCSV(csv, `path-detail-${src}-to-${dst}-${rmGraphTime}.csv`);
}

function rmDownloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
}
