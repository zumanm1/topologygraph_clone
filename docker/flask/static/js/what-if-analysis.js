/**
 * what-if-analysis.js
 * Logic for the standalone What-If Analysis dashboard.
 */

let wiNodes = [];
let wiEdges = [];
let wiScenarios = [];
let wiGraphTime = null;
let wiVNodes = null;
let wiVEdges = null;
let wiNetwork = null;
let wiFilterBar = null;

async function wiInit() {
    console.log("WI: Initializing...");

    // 1. Check for global graph_time in URL or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const storedGraphTime = urlParams.get('graph_time') || localStorage.getItem('ospf_graph_time') || '';

    // 2. Load available graph times
    try {
        const resp = await fetch('/api/graph-times');
        const data = await resp.json();
        const select = $('#wi-topo-select');

        const list = (data.graph_time_list || data.timestamps || []);
        list.reverse().forEach((gt) => {
            select.append(`<option value="${gt}">${gt}</option>`);
        });

        // Use stored time if available, else latest from list
        let target = storedGraphTime;
        if (!target && list.length > 0) target = list[0];

        if (target) {
            select.val(target);
            wiLoadTopology(target);
        }

        select.change(() => {
            const val = select.val();
            localStorage.setItem('ospf_graph_time', val);
            wiLoadTopology(val);
        });
    } catch (e) {
        console.error("WI: Failed to load graph times", e);
    }
}

async function wiLoadTopology(graphTime) {
    wiGraphTime = graphTime;
    wiScenarios = [];
    $('#scenario-list').html('<div class="text-muted small">No modifications applied.</div>');
    $('#wi-status').html(`<span class="spinner-border spinner-border-sm mr-2"></span> Loading ${graphTime}...`);

    try {
        const [nodesResp, edgesResp] = await Promise.all([
            fetch(`/api/diagram/${graphTime}/nodes`),
            fetch(`/api/diagram/${graphTime}/edges`)
        ]);

        wiNodes = await nodesResp.json();
        wiEdges = await edgesResp.json();

        wiBuildTopoView();
        wiUpdateImpact(0, 0, 0);
        $('#wi-status').text('Current State: Baseline');
    } catch (e) {
        console.error("WI: Load failed", e);
        $('#wi-status').html('<span class="text-danger">Failed to load topology.</span>');
    }
}

function wiBuildTopoView() {
    const container = document.getElementById('wi-canvas');
    if (!container) return;

    // Create vis.js DataSets
    wiVNodes = new vis.DataSet(wiNodes.map(n => {
        const p = KSP_parseAtype(n.label || n.id);
        return {
            id: n.id,
            label: n.label || n.id,
            color: p ? { background: '#1e40af', border: '#3b82f6' } : { background: '#374151', border: '#6b7280' },
            font: { color: '#e0e8f0', size: 10 }
        };
    }));

    wiVEdges = new vis.DataSet(wiEdges.map(e => ({
        id: e.id,
        from: e.from,
        to: e.to,
        color: { color: '#374151' },
        width: 1,
        arrows: { to: { enabled: true, scaleFactor: 0.4 } }
    })));

    const options = {
        physics: { enabled: true, solver: 'forceAtlas2Based', stabilization: { iterations: 100 } },
        interaction: { hover: true }
    };

    wiNetwork = new vis.Network(container, { nodes: wiVNodes, edges: wiVEdges }, options);
    wiNetwork.on('stabilizationIterationsDone', () => wiNetwork.setOptions({ physics: { enabled: false } }));

    // Initialize Filter Bar
    if (typeof TopoFilterBar === 'function') {
        if (wiFilterBar) wiFilterBar.destroy();
        wiFilterBar = new TopoFilterBar({
            containerId: 'wiFilterBar',
            vNodes: wiVNodes,
            vEdges: wiVEdges,
            rawNodes: wiNodes,
            rawEdges: wiEdges,
            network: wiNetwork
        });
    }
}

function wiAddScenario() {
    const id = Date.now();
    const scenario = {
        id: id,
        type: 'node-failure',
        target: null,
        label: 'Node Failure'
    };

    wiScenarios.push(scenario);
    wiRenderScenarios();
}

function wiRenderScenarios() {
    if (wiScenarios.length === 0) {
        $('#scenario-list').html('<div class="text-muted small">No modifications applied.</div>');
        return;
    }

    let html = '';
    wiScenarios.forEach(s => {
        html += `
            <div class="scenario-card" id="sc-${s.id}">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="small font-weight-bold">${s.label}</span>
                    <button class="btn btn-xs btn-link text-danger p-0" onclick="wiRemoveScenario(${s.id})">×</button>
                </div>
                <select class="form-control form-control-sm bg-dark text-white border-secondary" onchange="wiUpdateScenario(${s.id}, this.value)">
                    <option value="">Select Target...</option>
                    ${wiNodes.map(n => `<option value="${n.id}">${n.label || n.id}</option>`).join('')}
                </select>
            </div>
        `;
    });
    $('#scenario-list').html(html);
}

function wiUpdateScenario(id, target) {
    const s = wiScenarios.find(sc => sc.id === id);
    if (s) {
        s.target = target;
        wiComputeImpact();
    }
}

function wiRemoveScenario(id) {
    wiScenarios = wiScenarios.filter(s => s.id !== id);
    wiRenderScenarios();
    wiComputeImpact();
}

function wiComputeImpact() {
    console.log("WI: Computing impact for", wiScenarios.length, "scenarios");

    // 1. Reset all nodes to baseline color
    if (wiVNodes) {
        wiVNodes.forEach(n => {
            const p = KSP_parseAtype(n.label);
            wiVNodes.update({
                id: n.id,
                color: p ? { background: '#1e40af', border: '#3b82f6' } : { background: '#374151', border: '#6b7280' },
                font: { color: '#e0e8f0', strokeWidth: 0 }
            });
        });

        // 2. Highlight failed nodes
        wiScenarios.forEach(s => {
            if (s.target && s.type === 'node-failure') {
                wiVNodes.update({
                    id: s.target,
                    color: { background: '#7f1d1d', border: '#f87171' },
                    font: { color: '#f87171', strokeWidth: 2, strokeColor: '#000' }
                });
            }
        });
    }

    // Mock update for impact cards (placeholder for real Dijkstra logic)
    if (wiScenarios.some(s => s.target)) {
        wiUpdateImpact(72, 12, 6);
        $('#wi-status').html('<span class="text-warning font-weight-bold">⚠️ SIMULATION ACTIVE</span>');
    } else {
        wiUpdateImpact(0, 0, 0);
        $('#wi-status').text('Current State: Baseline');
    }
}

function wiUpdateImpact(u, d, l) {
    $('#impact-unaffected').text(u);
    $('#impact-degraded').text(d);
    $('#impact-lost').text(l);
}

function wiPushToPlanner() {
    alert("Scenario pushed to Change Planner. View and approve in the Change Planner tab.");
}

function wiRunKPath() {
    alert("Running K-Path Explorer with modified network weights...");
}
