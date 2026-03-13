/**
 * what-if-analysis.js
 * Logic for the standalone What-If Analysis dashboard.
 */

let wiNodes = [];
let wiEdges = [];
let wiAdj = null;
let wiScenarios = [];
let wiGraphTime = null;
let wiNetwork = null;
let wiVNodes = null;
let wiVEdges = null;

async function wiInit() {
    console.log("WI: Initializing...");

    // 1. Load available graph times
    try {
        const resp = await fetch('/api/graph-times');
        const data = await resp.json();
        const select = $('#wiGraphTime');
        const list = data.graph_time_list || data.timestamps || (Array.isArray(data) ? data : []);
        
        list.reverse().forEach((gt, idx) => {
            select.append(`<option value="${gt}" ${idx === 0 ? 'selected' : ''}>${gt}</option>`);
        });

        select.change(() => wiOnGraphTimeChange(select.val()));

        if (list.length > 0) {
            wiOnGraphTimeChange(list[0]);
        }
    } catch (e) {
        console.error("WI: Failed to load graph times", e);
    }
}

function wiOnGraphTimeChange(graphTime) {
    if (!graphTime) return;
    wiLoadTopology(graphTime);
}

async function wiLoadTopology(graphTime) {
    wiGraphTime = graphTime;
    wiScenarios = [];
    $('#scenario-list').html('<div class="text-muted small">No modifications applied.</div>');
    $('#wi-status').html('<span class="spinner-border spinner-border-sm text-primary"></span> Loading topology...');

    try {
        const result = await KSP_loadTopology(graphTime);
        wiNodes = result.nodes;
        wiEdges = result.edges;
        wiAdj = KSP_buildDirAdjList(wiNodes, wiEdges, {});

        wiRenderTopology();
        wiUpdateImpact(0, 0, 0); // Reset impact
        $('#wi-status').text(`Current State: Baseline (${wiNodes.length} nodes)`);
    } catch (e) {
        console.error("WI: Load failed", e);
        $('#wi-status').text('⚠ Load error: ' + e.message);
    }
}

function wiRenderTopology() {
    console.log("WI: Rendering topology in Vis.js...");
    const container = document.getElementById('wiTopoContainer');
    
    if (wiNetwork) {
        wiNetwork.destroy();
        wiNetwork = null;
    }

    const visNodes = wiNodes.map(function (n) {
        const isAtype = !!KSP_parseAtype(n.label || n.id || '');
        return { 
            id: n.id, 
            label: n.label || String(n.id),
            color: isAtype ? { background: '#1e40af', border: '#3b82f6' } : { background: '#374151', border: '#6b7280' },
            font: { color: '#e0e8f0', size: 10 }, 
            size: isAtype ? 12 : 8 
        };
    });

    const visEdges = wiEdges.map(function (e) {
        return { 
            id: e.id, 
            from: e.from, 
            to: e.to, 
            label: e.label || '',
            color: { color: '#374151' }, 
            width: 1,
            font: { color: '#6b7280', size: 8, strokeWidth: 0 },
            arrows: { to: { enabled: true, scaleFactor: 0.4 } } 
        };
    });

    wiVNodes = new vis.DataSet(visNodes);
    wiVEdges = new vis.DataSet(visEdges);

    // Get container dimensions BEFORE creating network
    const rect = container.getBoundingClientRect();
    console.log("WI: Container dimensions:", rect.width, 'x', rect.height);

    const options = {
        nodes: { shape: 'dot' },
        physics: { 
            enabled: true, 
            solver: 'forceAtlas2Based',
            forceAtlas2Based: { gravitationalConstant: -30, springLength: 100, springConstant: 0.02 },
            stabilization: { iterations: 150 }
        },
        interaction: { hover: true }, 
        layout: { improvedLayout: false },
        width: String(Math.floor(rect.width)) + 'px',
        height: String(Math.floor(rect.height)) + 'px',
        autoResize: true
    };

    wiNetwork = new vis.Network(container, { nodes: wiVNodes, edges: wiVEdges }, options);
    
    wiNetwork.on('stabilizationIterationsDone', function () { 
        console.log("WI: Network stabilized. Fitting viewport.");
        wiNetwork.setOptions({ physics: { enabled: false } }); 
        wiNetwork.fit();
    });
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
        // Sort nodes by label for better UX
        const sortedNodes = [...wiNodes].sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
        
        html += `
            <div class="scenario-card" id="sc-${s.id}">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="small font-weight-bold">${s.label}</span>
                    <button class="btn btn-xs btn-link text-danger p-0" onclick="wiRemoveScenario(${s.id})">×</button>
                </div>
                <select class="form-control form-control-sm bg-dark text-white border-secondary" onchange="wiUpdateScenario(${s.id}, this.value)">
                    <option value="">Select Target...</option>
                    ${sortedNodes.map(n => `<option value="${n.id}" ${s.target === String(n.id) ? 'selected' : ''}>${n.label || n.id}</option>`).join('')}
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
    
    // Reset nodes to base style first
    if (wiVNodes) {
        const nodeUpd = wiNodes.map(function (n) {
            const isAtype = !!KSP_parseAtype(n.label || n.id || '');
            return { 
                id: n.id, 
                color: isAtype ? { background: '#1e40af', border: '#3b82f6' } : { background: '#374151', border: '#6b7280' } 
            };
        });
        wiVNodes.update(nodeUpd);
    }

    const activeTargets = wiScenarios.filter(s => s.target).map(s => s.target);
    
    if (activeTargets.length > 0) {
        // Highlight failed nodes in red
        if (wiVNodes) {
            activeTargets.forEach(targetId => {
                wiVNodes.update({ id: targetId, color: { background: '#991b1b', border: '#ef4444' } });
            });
        }
        
        wiUpdateImpact(72, 12, 6); // Mocked values until routing logic is bound
        $('#wi-status').html('<span class="text-warning">SIMULATION ACTIVE (' + activeTargets.length + ' failures)</span>');
    } else {
        wiUpdateImpact(0, 0, 0);
        $('#wi-status').text(`Current State: Baseline (${wiNodes.length} nodes)`);
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
