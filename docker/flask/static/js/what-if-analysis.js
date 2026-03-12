/**
 * what-if-analysis.js
 * Logic for the standalone What-If Analysis dashboard.
 */

let wiNodes = [];
let wiEdges = [];
let wiScenarios = [];
let wiGraphTime = null;
let wiCys = null; // Cytoscape instances

async function wiInit() {
    console.log("WI: Initializing...");

    // 1. Load available graph times
    try {
        const resp = await fetch('/api/graph-times');
        const data = await resp.json();
        const select = $('#wi-topo-select');
        data.graph_time_list.reverse().forEach((gt, idx) => {
            select.append(`<option value="${gt}" ${idx === 0 ? 'selected' : ''}>${gt}</option>`);
        });

        select.change(() => wiLoadTopology(select.val()));

        if (data.graph_time_list.length > 0) {
            wiLoadTopology(data.graph_time_list[data.graph_time_list.length - 1]);
        }
    } catch (e) {
        console.error("WI: Failed to load graph times", e);
    }
}

async function wiLoadTopology(graphTime) {
    wiGraphTime = graphTime;
    wiScenarios = [];
    $('#scenario-list').html('<div class="text-muted small">No modifications applied.</div>');

    try {
        const [nodesResp, edgesResp] = await Promise.all([
            fetch(`/api/diagram/${graphTime}/nodes`),
            fetch(`/api/diagram/${graphTime}/edges`)
        ]);

        wiNodes = await nodesResp.json();
        wiEdges = await edgesResp.json();

        wiRenderTopology();
        wiUpdateImpact(0, 0, 0); // Reset impact
    } catch (e) {
        console.error("WI: Load failed", e);
    }
}

function wiRenderTopology() {
    // Logic to initialize Cytoscape in #wi-canvas
    // Using global topolograph.js logic if possible or local init
    console.log("WI: Rendering topology...");
    // Mocking for now, will integrate with Cytoscape next
    $('#wi-canvas').html('<div class="p-4 text-muted">Cytoscape rendering engine initialized... (Baseline loaded)</div>');
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
    // 1. Build modified adj list
    // 2. Run Dijkstra for all countries
    // 3. Update Impact Cards

    // Mock update
    if (wiScenarios.some(s => s.target)) {
        wiUpdateImpact(72, 12, 6); // Mocked values for now
        $('#wi-status').html('<span class="text-warning">SIMULATION ACTIVE</span>');
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
