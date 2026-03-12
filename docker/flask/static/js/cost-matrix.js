/**
 * cost-matrix.js
 * Logic for the standalone Cost Matrix dashboard.
 */

let rmFullMatrix = null;
let rmCountries = [];
let rmNodes = [];
let rmEdges = [];
let rmGraphTime = null;
let rmAsymmetryMode = false;
let rmMiniNetwork = null;

async function rmInit() {
    console.log("RM: Initializing...");
    rmGraphTime = rmParam('graph_time') || rmLS('ospf_graph_time') || '';

    rmLoadGraphTimes().then(() => {
        if (rmGraphTime) rmLoadTopology(rmGraphTime);
    });
}

function rmParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

function rmLS(name) {
    try { return localStorage.getItem(name); } catch (e) { return null; }
}

async function rmLoadGraphTimes() {
    try {
        const resp = await fetch('/api/graph-times');
        const data = await resp.json();
        const sel = document.getElementById('rmGraphTime');
        const list = data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []);

        sel.innerHTML = '';
        if (list.length === 0) {
            sel.innerHTML = '<option value="">No graphs found</option>';
            return;
        }

        list.reverse().forEach(t => {
            const opt = document.createElement('option');
            opt.value = t; opt.textContent = t;
            if (t === rmGraphTime) opt.selected = true;
            sel.appendChild(opt);
        });

        if (!rmGraphTime && list.length) rmGraphTime = list[0];
    } catch (e) {
        console.error("RM: Failed to load graph times", e);
        $('#rmStatus').text("Failed to load snapshots.");
    }
}

function rmOnGraphTimeChange(t) {
    rmGraphTime = t;
    localStorage.setItem('ospf_graph_time', t);
    rmLoadTopology(t);
}

async function rmLoadTopology(graphTime) {
    rmGraphTime = graphTime;
    const status = $('#rmStatus');
    const display = $('#matrix-display');

    status.html('<span class="il-spinner"></span> Loading topology…');
    display.html(`
        <div class="d-flex justify-content-center align-items-center h-100">
            <div class="text-center">
                <div class="spinner-border text-primary mb-3"></div>
                <p class="text-muted">Loading topology ${graphTime}...</p>
            </div>
        </div>
    `);

    try {
        console.log("RM: Loading via KSP_loadTopology:", graphTime);
        const result = await KSP_loadTopology(graphTime);
        rmNodes = result.nodes;
        rmEdges = result.edges;

        status.text(`Loaded ${rmNodes.length} nodes, ${rmEdges.length} edges.`);

        console.log(`RM: Loaded ${rmNodes.length} nodes, ${rmEdges.length} edges`);

        // Find A-type countries
        const countrySet = new Set();
        rmNodes.forEach(n => {
            const p = KSP_parseAtype(n.label || n.id || '');
            if (p && p.country) countrySet.add(p.country.toUpperCase());
        });

        rmCountries = Array.from(countrySet).sort();
        console.log(`RM: Found ${rmCountries.length} countries`);

        if (rmCountries.length < 2) {
            status.text('No A-type countries found.');
            display.html('<div class="alert alert-warning m-4"><h5>⚠️ No Countries Found</h5><p>This topology does not contain enough nodes matching the {country}-{city}-{airport}-... naming convention required for a cost matrix.</p></div>');
            return;
        }

        status.html('<span class="il-spinner"></span> Computing matrix…');
        display.html(`
            <div class="d-flex justify-content-center align-items-center h-100">
                <div class="text-center">
                    <div class="spinner-border text-info mb-3"></div>
                    <p class="text-info">Computing ${rmCountries.length}x${rmCountries.length} reachability matrix...</p>
                </div>
            </div>
        `);

        // Compute Base Matrix
        const adj = KSP_buildDirAdjList(rmNodes, rmEdges, {});
        rmFullMatrix = KSP_reachabilityMatrix(rmCountries, rmNodes, adj, new Set());
        rmRenderMatrix();
        status.text(`Loaded ${rmNodes.length} nodes, ${rmEdges.length} edges. Matrix computed.`);
    } catch (e) {
        console.error("RM: Load failed", e);
        status.text('Load failed.');
        display.html(`<div class="alert alert-danger m-4"><h5>❌ Load Failed</h5><p>${e.message}</p></div>`);
    }
}

function rmRenderMatrix() {
    const search = $('#rm-search').val().toUpperCase();
    const filteredCountries = rmCountries.filter(c => c.includes(search));

    let html = `<table class="rm-table"><thead><tr><th class="rm-hdr-row">SRC\\DST</th>`;
    filteredCountries.forEach(c => {
        html += `<th class="rm-hdr-col">${c}</th>`;
    });
    html += `</tr></thead><tbody>`;

    const showAsym = $('#sw-asymmetry').is(':checked');
    const thLow = parseInt($('#th-low').val());
    const thMed = parseInt($('#th-med').val());
    const thHigh = parseInt($('#th-high').val());

    filteredCountries.forEach(src => {
        html += `<tr><th class="rm-hdr-row">${src}</th>`;
        filteredCountries.forEach(dst => {
            const cost = rmFullMatrix[src][dst];
            let cls = 'rm-cell ';
            let text = cost === Infinity ? '∞' : cost;

            if (src === dst) {
                cls += 'rm-self';
                text = '—';
            } else if (cost === Infinity) {
                cls += 'rm-none';
            } else if (cost < thLow) {
                cls += 'rm-low';
            } else if (cost < thMed) {
                cls += 'rm-med';
            } else if (cost < thHigh) {
                cls += 'rm-high';
            } else {
                cls += 'rm-crit';
            }

            // Asymmetry logic
            if (showAsym && src !== dst) {
                const reverseCost = rmFullMatrix[dst][src];
                if (cost !== reverseCost) {
                    cls += ' rm-asym-warn';
                }
            }

            html += `<td class="${cls}" onclick="rmSelectCell('${src}', '${dst}')" title="${src} -> ${dst}: ${cost}">${text}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;

    $('#matrix-display').html(html);
    $('#matrix-stats').text(`Matrix: ${rmCountries.length}x${rmCountries.length} countries | Visible: ${filteredCountries.length}`);
}

async function rmSelectCell(src, dst) {
    if (src === dst) return;
    const cost = rmFullMatrix[src][dst];
    const reverse = rmFullMatrix[dst][src];

    $('#route-info').html(`
        <div class="mb-2"><strong>${src} ➔ ${dst}</strong></div>
        <div class="d-flex justify-content-between">
            <span>Forward Cost:</span> <span>${cost === Infinity ? 'UNREACHABLE' : cost}</span>
        </div>
        <div class="d-flex justify-content-between">
            <span>Reverse Cost:</span> <span class="${cost !== reverse ? 'text-pink' : ''}">${reverse === Infinity ? 'UNREACHABLE' : reverse}</span>
        </div>
        <hr class="border-secondary">
        <div id="transit-path" class="text-info small">Computing transit nodes...</div>
    `);

    if (cost === Infinity) {
        $('#transit-path').html('<span class="text-danger">No path available.</span>');
        return;
    }

    // Compute path
    const srcId = KSP_countryGateway(src, rmNodes);
    const dstId = KSP_countryGateway(dst, rmNodes);
    const adj = KSP_buildDirAdjList(rmNodes, rmEdges, {});
    const result = KSP_dijkstra(srcId, adj, new Set(), new Set());

    // Trace back
    let pathNodes = [];
    let curr = String(dstId);
    while (curr && result.prev.has(curr)) {
        pathNodes.unshift(curr);
        curr = result.prev.get(curr);
    }
    if (curr === String(srcId)) pathNodes.unshift(curr);

    const transitCountries = new Set();
    pathNodes.forEach(nid => {
        const n = rmNodes.find(node => String(node.id) === nid);
        const p = KSP_parseAtype(n ? (n.label || n.id) : '');
        if (p && p.country) transitCountries.add(p.country.toUpperCase());
    });

    const pathArray = Array.from(transitCountries);
    $('#transit-path').html(`
        <div class="mb-1">Transit Countries (${pathArray.length}):</div>
        <div class="d-flex flex-wrap gap-1">
            ${pathArray.map(c => `<span class="badge badge-secondary mr-1">${c}</span>`).join(' → ')}
        </div>
        <div class="mt-2 small text-muted">Nodes: ${pathNodes.length} hops</div>
    `);

    // Render Mini Topo
    rmRenderMiniTopo(pathNodes);
}

function rmRenderMiniTopo(pathNodes) {
    const container = document.getElementById('mini-topo');
    if (!container) return;

    const pathSet = new Set(pathNodes);

    // Filter nodes and edges involved in the path
    const vNodes = new vis.DataSet(rmNodes.filter(n => pathSet.has(String(n.id))).map(n => {
        const p = KSP_parseAtype(n.label || n.id);
        return {
            id: n.id,
            label: n.label || n.id,
            color: p ? { background: '#1e40af', border: '#3b82f6' } : { background: '#374151', border: '#6b7280' },
            font: { color: '#e0e8f0', size: 8 }
        };
    }));

    const vEdges = new vis.DataSet(rmEdges.filter(e => pathSet.has(String(e.from)) && pathSet.has(String(e.to))).map(e => ({
        id: e.id,
        from: e.from,
        to: e.to,
        color: { color: '#3b82f6' },
        width: 2,
        arrows: { to: { enabled: true, scaleFactor: 0.3 } }
    })));

    if (rmMiniNetwork) rmMiniNetwork.destroy();
    rmMiniNetwork = new vis.Network(container, { nodes: vNodes, edges: vEdges }, {
        physics: { enabled: true, solver: 'forceAtlas2Based', stabilization: { iterations: 50 } },
        interaction: { zoomView: true, dragView: true }
    });
}

function rmFilterMatrix() {
    rmRenderMatrix();
}

function rmApplyThresholds() {
    rmRenderMatrix();
}

function rmToggleAsymmetry() {
    rmRenderMatrix();
}

function rmExportCSV() {
    let csv = "SRC/DST," + rmCountries.join(",") + "\n";
    rmCountries.forEach(src => {
        let row = [src];
        rmCountries.forEach(dst => {
            let val = rmFullMatrix[src][dst];
            row.push(val === Infinity ? "inf" : val);
        });
        csv += row.join(",") + "\n";
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-matrix-${rmGraphTime}.csv`;
    a.click();
}

function rmExportMarkdown() {
    let md = "| SRC\\DST | " + rmCountries.join(" | ") + " |\n";
    md += "| --- | " + rmCountries.map(() => "---").join(" | ") + " |\n";
    rmCountries.forEach(src => {
        md += `| **${src}** | ` + rmCountries.map(dst => {
            let v = rmFullMatrix[src][dst];
            return v === Infinity ? "∞" : v;
        }).join(" | ") + " |\n";
    });

    navigator.clipboard.writeText(md);
    alert("Markdown table copied to clipboard!");
}
