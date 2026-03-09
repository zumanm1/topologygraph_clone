/**
 * What-If Scenario Manager - Advanced OSPF topology scenario analysis
 */
const WhatIfScenarioManager = (function() {
    'use strict';
    const API_BASE = '/layout-api';
    let currentTopology = null;

    function extractTopologyFromNetwork() {
        if (typeof nodes === 'undefined' || typeof edges === 'undefined') return null;
        return {
            nodes: nodes.get().map(n => ({id: n.id, label: n.label || n.id, country: n.country || 'UNK'})),
            edges: edges.get().map(e => ({source: e.from, target: e.to, cost: _edgeCost ? _edgeCost(e) : (e.cost || 1)}))
        };
    }

    function showScenarioCreator() {
        currentTopology = extractTopologyFromNetwork();
        if (!currentTopology) { alert('Unable to extract topology. Load a graph first.'); return; }
        
        const modal = document.createElement('div');
        modal.id = 'whatifScenarioModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
        
        modal.innerHTML = `<div style="background:#1e2330;border:1px solid #3a4560;border-radius:12px;width:90%;max-width:700px;max-height:85vh;overflow-y:auto;">
            <div style="padding:16px 20px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:12px 12px 0 0;">
                <span style="font-size:16px;font-weight:600;color:#e0e6f0;">🔬 Create What-If Scenario</span>
                <button onclick="WhatIfScenarioManager.closeModal()" style="float:right;background:none;border:none;color:#aab;cursor:pointer;font-size:24px;">×</button>
            </div>
            <div style="padding:20px;">
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-size:12px;color:#9ba8c0;margin-bottom:6px;">Scenario Name *</label>
                    <input type="text" id="scenarioName" placeholder="e.g., Router JNB-01 Failure" style="width:100%;padding:8px 12px;background:#141824;border:1px solid #3a4560;border-radius:6px;color:#e0e6f0;">
                </div>
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-size:12px;color:#9ba8c0;margin-bottom:8px;">Scenario Type *</label>
                    <select id="scenarioType" onchange="WhatIfScenarioManager.updateForm()" style="width:100%;padding:8px 12px;background:#141824;border:1px solid #3a4560;border-radius:6px;color:#e0e6f0;">
                        <option value="node_failure">🖥️ Node Failure</option>
                        <option value="link_failure">🔗 Link Failure</option>
                        <option value="cost_change">💰 Cost Change</option>
                    </select>
                </div>
                <div id="scenarioConfigForm"></div>
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-size:12px;color:#9ba8c0;margin-bottom:6px;">Description</label>
                    <textarea id="scenarioDescription" style="width:100%;padding:8px 12px;background:#141824;border:1px solid #3a4560;border-radius:6px;color:#e0e6f0;min-height:60px;"></textarea>
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button onclick="WhatIfScenarioManager.closeModal()" style="padding:8px 20px;background:#2a3248;border:1px solid #3a4560;border-radius:6px;color:#88aaff;cursor:pointer;">Cancel</button>
                    <button onclick="WhatIfScenarioManager.createScenario()" style="padding:8px 20px;background:#0d6efd;border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:500;">Create</button>
                </div>
                <div id="scenarioLoading" style="display:none;text-align:center;margin-top:16px;color:#88aaff;">⚙️ Calculating...</div>
            </div>
        </div>`;
        
        document.body.appendChild(modal);
        updateForm();
    }

    function updateForm() {
        const type = document.getElementById('scenarioType')?.value;
        const form = document.getElementById('scenarioConfigForm');
        if (!form || !currentTopology) return;

        const nodeOpts = currentTopology.nodes.map(n => `<option value="${n.id}">${n.label || n.id}</option>`).join('');
        
        if (type === 'node_failure') {
            form.innerHTML = `<label style="display:block;font-size:12px;color:#9ba8c0;margin-bottom:6px;">Node to Fail *</label>
                <select id="failedNode" style="width:100%;padding:8px 12px;background:#141824;border:1px solid #3a4560;border-radius:6px;color:#e0e6f0;">
                    <option value="">-- Select --</option>${nodeOpts}</select>`;
        } else if (type === 'link_failure') {
            form.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label style="display:block;font-size:12px;color:#9ba8c0;margin-bottom:6px;">Source *</label>
                    <select id="linkSource" style="width:100%;padding:8px 12px;background:#141824;border:1px solid #3a4560;border-radius:6px;color:#e0e6f0;">
                        <option value="">-- Select --</option>${nodeOpts}</select></div>
                <div><label style="display:block;font-size:12px;color:#9ba8c0;margin-bottom:6px;">Target *</label>
                    <select id="linkTarget" style="width:100%;padding:8px 12px;background:#141824;border:1px solid #3a4560;border-radius:6px;color:#e0e6f0;">
                        <option value="">-- Select --</option>${nodeOpts}</select></div>
            </div>`;
        } else if (type === 'cost_change') {
            form.innerHTML = `<div id="costChanges"></div>
                <button onclick="WhatIfScenarioManager.addCostChange()" type="button" style="padding:6px 12px;background:#2a3248;border:1px solid #3a4560;border-radius:6px;color:#88aaff;cursor:pointer;">+ Add</button>`;
            addCostChange();
        }
    }

    function addCostChange() {
        const container = document.getElementById('costChanges');
        if (!container || !currentTopology) return;
        const nodeOpts = currentTopology.nodes.map(n => `<option value="${n.id}">${n.label || n.id}</option>`).join('');
        const idx = container.children.length;
        const div = document.createElement('div');
        div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 100px 30px;gap:8px;margin-bottom:8px;';
        div.innerHTML = `<select class="costSrc" style="padding:6px;background:#141824;border:1px solid #3a4560;border-radius:4px;color:#e0e6f0;font-size:12px;">${nodeOpts}</select>
            <select class="costTgt" style="padding:6px;background:#141824;border:1px solid #3a4560;border-radius:4px;color:#e0e6f0;font-size:12px;">${nodeOpts}</select>
            <input type="number" class="costVal" min="1" max="65535" placeholder="Cost" style="padding:6px;background:#141824;border:1px solid #3a4560;border-radius:4px;color:#e0e6f0;font-size:12px;">
            <button onclick="this.parentElement.remove()" style="background:#e74c3c;border:none;border-radius:4px;color:#fff;cursor:pointer;">×</button>`;
        container.appendChild(div);
    }

    function createScenario() {
        const name = document.getElementById('scenarioName')?.value.trim();
        const type = document.getElementById('scenarioType')?.value;
        const desc = document.getElementById('scenarioDescription')?.value.trim();
        
        if (!name) { alert('Scenario name required'); return; }
        
        let config = {type};
        if (type === 'node_failure') {
            const node = document.getElementById('failedNode')?.value;
            if (!node) { alert('Select a node'); return; }
            config.node_id = node;
        } else if (type === 'link_failure') {
            const src = document.getElementById('linkSource')?.value;
            const tgt = document.getElementById('linkTarget')?.value;
            if (!src || !tgt) { alert('Select source and target'); return; }
            config.source = src;
            config.target = tgt;
        } else if (type === 'cost_change') {
            const changes = [];
            document.querySelectorAll('#costChanges > div').forEach(div => {
                const src = div.querySelector('.costSrc')?.value;
                const tgt = div.querySelector('.costTgt')?.value;
                const cost = parseInt(div.querySelector('.costVal')?.value);
                if (src && tgt && cost) changes.push({source: src, target: tgt, new_cost: cost});
            });
            if (changes.length === 0) { alert('Add at least one cost change'); return; }
            config.changes = changes;
        }

        document.getElementById('scenarioLoading').style.display = 'block';
        
        fetch(`${API_BASE}/whatif/scenarios`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                graph_id: typeof _graphId !== 'undefined' ? _graphId : 'default',
                graph_time: typeof _graphTime !== 'undefined' ? _graphTime : new Date().toISOString(),
                scenario_name: name,
                scenario_type: type,
                scenario_config: config,
                description: desc || null,
                is_public: false,
                topology_data: currentTopology
            })
        })
        .then(r => r.ok ? r.json() : Promise.reject(r))
        .then(data => {
            alert(`Scenario created! Paths affected: ${data.statistics?.total_paths || 'N/A'}`);
            closeModal();
            if (typeof loadScenarios === 'function') loadScenarios();
        })
        .catch(err => {
            console.error('Scenario creation failed:', err);
            alert('Failed to create scenario. Check console for details.');
        })
        .finally(() => {
            document.getElementById('scenarioLoading').style.display = 'none';
        });
    }

    function closeModal() {
        document.getElementById('whatifScenarioModal')?.remove();
    }

    /**
     * Show scenario list panel
     */
    function showScenarioList() {
        const graphId = typeof _graphId !== 'undefined' ? _graphId : 'default';
        const graphTime = typeof _graphTime !== 'undefined' ? _graphTime : null;

        fetch(`${API_BASE}/whatif/scenarios?graph_id=${graphId}${graphTime ? '&graph_time=' + graphTime : ''}`)
            .then(r => r.ok ? r.json() : Promise.reject(r))
            .then(scenarios => renderScenarioList(scenarios))
            .catch(err => {
                console.error('[WhatIf] Failed to load scenarios:', err);
                alert('Failed to load scenarios. Check console for details.');
            });
    }

    /**
     * Render scenario list panel
     */
    function renderScenarioList(scenarios) {
        const existing = document.getElementById('whatifScenarioListPanel');
        if (existing) { existing.remove(); return; }

        const panel = document.createElement('div');
        panel.id = 'whatifScenarioListPanel';
        panel.style.cssText = 'position:fixed;top:70px;right:20px;z-index:9996;background:#1e2330;border:1px solid #3a4560;border-radius:12px;width:400px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 36px rgba(0,0,0,.7);';

        panel.innerHTML = `
            <div style="padding:16px 20px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:12px 12px 0 0;position:sticky;top:0;z-index:1;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-size:16px;font-weight:600;color:#e0e6f0;">📊 Saved Scenarios</span>
                    <button onclick="WhatIfScenarioManager.closeScenarioList()" style="background:none;border:none;color:#aab;cursor:pointer;font-size:24px;">×</button>
                </div>
                <button onclick="WhatIfScenarioManager.showScenarioCreator()" style="margin-top:10px;width:100%;padding:8px;background:#0d6efd;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:500;">+ Create New Scenario</button>
            </div>
            <div id="scenarioListContent" style="padding:12px;">
                ${scenarios.length === 0 ? '<div style="text-align:center;padding:40px 20px;color:#778;font-size:12px;">No scenarios found. Create one to get started!</div>' : ''}
            </div>
        `;

        document.body.appendChild(panel);

        if (scenarios.length > 0) {
            const content = document.getElementById('scenarioListContent');
            scenarios.forEach(scenario => {
                const card = createScenarioCard(scenario);
                content.appendChild(card);
            });
        }
    }

    /**
     * Create scenario card element
     */
    function createScenarioCard(scenario) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#141824;border:1px solid #3a4560;border-radius:8px;padding:12px;margin-bottom:10px;';

        const typeIcons = {
            node_failure: '🖥️',
            link_failure: '🔗',
            cost_change: '💰',
            multi_change: '🔀'
        };

        const typeLabels = {
            node_failure: 'Node Failure',
            link_failure: 'Link Failure',
            cost_change: 'Cost Change',
            multi_change: 'Multi-Change'
        };

        card.innerHTML = `
            <div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:8px;">
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:600;color:#e0e6f0;margin-bottom:4px;">${escapeHtml(scenario.scenario_name)}</div>
                    <div style="font-size:10px;color:#778;">
                        ${typeIcons[scenario.scenario_type] || '📋'} ${typeLabels[scenario.scenario_type] || scenario.scenario_type}
                        ${scenario.is_public ? ' • 🌐 Public' : ''}
                    </div>
                </div>
                <button onclick="WhatIfScenarioManager.deleteScenario(${scenario.id})" style="background:#e74c3c;border:none;border-radius:4px;color:#fff;cursor:pointer;padding:4px 8px;font-size:11px;">Delete</button>
            </div>
            ${scenario.description ? `<div style="font-size:11px;color:#9ba8c0;margin-bottom:8px;">${escapeHtml(scenario.description)}</div>` : ''}
            ${scenario.statistics ? `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px;font-size:10px;">
                    <div style="background:#1a2030;padding:6px;border-radius:4px;text-align:center;">
                        <div style="color:#778;">Paths</div>
                        <div style="color:#e0e6f0;font-weight:600;">${scenario.statistics.total_paths || 0}</div>
                    </div>
                    <div style="background:#1a2030;padding:6px;border-radius:4px;text-align:center;">
                        <div style="color:#778;">Lost</div>
                        <div style="color:#e74c3c;font-weight:600;">${scenario.statistics.paths_lost || 0}</div>
                    </div>
                    <div style="background:#1a2030;padding:6px;border-radius:4px;text-align:center;">
                        <div style="color:#778;">Improved</div>
                        <div style="color:#27ae60;font-weight:600;">${scenario.statistics.paths_improved || 0}</div>
                    </div>
                </div>
            ` : ''}
            <button onclick="WhatIfMatrixViewer.showComparison(${scenario.id})" style="width:100%;padding:6px;background:#2a3248;border:1px solid #3a4560;border-radius:6px;color:#88aaff;cursor:pointer;font-size:11px;">View Comparison</button>
        `;

        return card;
    }

    /**
     * Delete a scenario
     */
    function deleteScenario(scenarioId) {
        if (!confirm('Delete this scenario? This action cannot be undone.')) return;

        fetch(`${API_BASE}/whatif/scenarios/${scenarioId}`, { method: 'DELETE' })
            .then(r => r.ok ? Promise.resolve() : Promise.reject(r))
            .then(() => {
                showScenarioList(); // Refresh list
            })
            .catch(err => {
                console.error('[WhatIf] Delete failed:', err);
                alert('Failed to delete scenario. Check console for details.');
            });
    }

    /**
     * Close scenario list panel
     */
    function closeScenarioList() {
        document.getElementById('whatifScenarioListPanel')?.remove();
    }

    /**
     * HTML escape utility
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    return {
        showScenarioCreator,
        showScenarioList,
        createScenario,
        deleteScenario,
        closeModal,
        closeScenarioList,
        updateForm,
        addCostChange
    };
})();
