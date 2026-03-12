/**
 * cost-matrix.js
 * Logic for the standalone Cost Matrix dashboard.
 */

let rmFullMatrix = null;
let rmCountries = [];
let rmNodes = [];
let rmEdges = [];
let rmGraphTime = null;

async function rmInit() {
    console.log("RM: Initializing...");

    // 1. Load available graph times
    try {
        const resp = await fetch('/api/graph-times');
        const data = await resp.json();
        const select = $('#matrix-topo-select');
        data.graph_time_list.reverse().forEach((gt, idx) => {
            select.append(`<option value="${gt}" ${idx === 0 ? 'selected' : ''}>${gt}</option>`);
        });

        select.change(() => rmLoadTopology(select.val()));

        if (data.graph_time_list.length > 0) {
            rmLoadTopology(data.graph_time_list[data.graph_time_list.length - 1]);
        }
    } catch (e) {
        console.error("RM: Failed to load graph times", e);
    }
}

async function rmLoadTopology(graphTime) {
    rmGraphTime = graphTime;
    $('#matrix-display').html(`
        <div class="d-flex justify-content-center align-items-center h-100">
            <div class="text-center">
                <div class="spinner-border text-primary mb-3"></div>
                <p class="text-muted">Loading topology ${graphTime}...</p>
            </div>
        </div>
    `);

    try {
        const [nodesResp, edgesResp] = await Promise.all([
            fetch(`/api/diagram/${graphTime}/nodes`),
            fetch(`/api/diagram/${graphTime}/edges`)
        ]);

        rmNodes = await nodesResp.json();
        rmEdges = await edgesResp.json();

        // Find A-type countries
        const countrySet = new Set();
        rmNodes.forEach(n => {
            const p = KSP_parseAtype(n.label || n.id || '');
            if (p && p.country) countrySet.add(p.country.toUpperCase());
        });

        rmCountries = Array.from(countrySet).sort();
        console.log(`RM: Found ${rmCountries.length} countries`);

        if (rmCountries.length < 2) {
            $('#matrix-display').html('<div class="alert alert-warning m-4">No A-type countries found in this topology.</div>');
            return;
        }

        // Compute Base Matrix
        const adj = KSP_buildDirAdjList(rmNodes, rmEdges, {});
        rmFullMatrix = KSP_reachabilityMatrix(rmCountries, rmNodes, adj, new Set());

        rmRenderMatrix();
    } catch (e) {
        console.error("RM: Load failed", e);
        $('#matrix-display').html('<div class="alert alert-danger m-4">Error loading topology.</div>');
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
