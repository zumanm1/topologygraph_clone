/**
 * What-If Matrix Comparison Viewer
 * Visualizes before/after cost matrices with color-coded differences
 * 
 * Information Architecture:
 * - Dual-panel layout: Baseline (left) | Modified (right)
 * - Color semantics: Green (↓cost), Red (↑cost), Black (∞/lost), Gray (unchanged)
 * - Statistical summary: Aggregate metrics for decision support
 * - Export capabilities: CSV, screenshot for documentation
 * 
 * Cognitive Design Principles:
 * - Gestalt proximity: Related data grouped spatially
 * - Preattentive processing: Color channels for instant pattern recognition
 * - Progressive disclosure: Summary → Details on demand
 */

const WhatIfMatrixViewer = (function() {
    'use strict';

    const API_BASE = '/layout-api';
    const COLOR_SCHEME = {
        improved: '#27ae60',    // Green: cost decreased
        degraded: '#e74c3c',    // Red: cost increased
        lost: '#2c3e50',        // Dark: path lost (infinity)
        unchanged: '#34495e',   // Gray: no change
        text: '#e0e6f0',
        textDim: '#9ba8c0',
        background: '#1e2330',
        border: '#3a4560'
    };

    /**
     * Display scenario comparison with before/after matrices
     * @param {number} scenarioId - Scenario ID from database
     */
    function showComparison(scenarioId) {
        if (!scenarioId) {
            console.error('[MatrixViewer] No scenario ID provided');
            return;
        }

        // Fetch scenario data with matrix diff
        fetch(`${API_BASE}/whatif/matrix-diff/${scenarioId}`)
            .then(r => r.ok ? r.json() : Promise.reject(r))
            .then(data => renderComparisonPanel(data))
            .catch(err => {
                console.error('[MatrixViewer] Failed to load scenario:', err);
                alert('Failed to load scenario comparison. Check console for details.');
            });
    }

    /**
     * Render the comparison panel with dual matrices and statistics
     */
    function renderComparisonPanel(data) {
        // Remove existing panel
        const existing = document.getElementById('whatifMatrixComparisonPanel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'whatifMatrixComparisonPanel';
        panel.style.cssText = `
            position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
            z-index: 9998; background: ${COLOR_SCHEME.background};
            border: 1px solid ${COLOR_SCHEME.border}; border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6); width: 95%; max-width: 1400px;
            max-height: 90vh; overflow-y: auto; color: ${COLOR_SCHEME.text};
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;

        // Header
        const header = createHeader(data);
        panel.appendChild(header);

        // Statistics Summary
        const stats = createStatisticsSummary(data.statistics);
        panel.appendChild(stats);

        // Matrix Comparison (side-by-side)
        const matrices = createMatrixComparison(data.baseline_matrix, data.modified_matrix, data.diff);
        panel.appendChild(matrices);

        // Action buttons
        const actions = createActionButtons(data);
        panel.appendChild(actions);

        document.body.appendChild(panel);
    }

    /**
     * Create panel header with title and close button
     */
    function createHeader(data) {
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px; border-bottom: 1px solid ${COLOR_SCHEME.border};
            background: #262d42; border-radius: 12px 12px 0 0;
            position: sticky; top: 0; z-index: 10;
        `;

        header.innerHTML = `
            <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: ${COLOR_SCHEME.text};">
                    📊 Cost Matrix Comparison - Scenario #${data.scenario_id}
                </h3>
                <p style="margin: 4px 0 0; font-size: 11px; color: ${COLOR_SCHEME.textDim};">
                    Before/After Analysis • Color-coded differences
                </p>
            </div>
            <button onclick="WhatIfMatrixViewer.close()" 
                style="background: none; border: none; color: #aab; cursor: pointer; font-size: 24px; padding: 0;">
                ×
            </button>
        `;

        return header;
    }

    /**
     * Create statistics summary panel
     */
    function createStatisticsSummary(stats) {
        if (!stats) return document.createElement('div');

        const container = document.createElement('div');
        container.style.cssText = `
            padding: 20px; background: #141824; margin: 16px;
            border-radius: 8px; border-left: 4px solid #0d6efd;
        `;

        const metrics = [
            { label: 'Total Paths', value: stats.total_paths, icon: '🔗' },
            { label: 'Paths Lost', value: stats.paths_lost, icon: '❌', color: COLOR_SCHEME.lost },
            { label: 'Paths Improved', value: stats.paths_improved, icon: '✅', color: COLOR_SCHEME.improved },
            { label: 'Paths Degraded', value: stats.paths_degraded, icon: '⚠️', color: COLOR_SCHEME.degraded },
            { label: 'Avg Cost Change', value: `${stats.avg_cost_change_percent}%`, icon: '📈' }
        ];

        const grid = document.createElement('div');
        grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px;';

        metrics.forEach(metric => {
            const card = document.createElement('div');
            card.style.cssText = `
                padding: 12px; background: ${COLOR_SCHEME.background};
                border-radius: 6px; border: 1px solid ${COLOR_SCHEME.border};
            `;
            card.innerHTML = `
                <div style="font-size: 11px; color: ${COLOR_SCHEME.textDim}; margin-bottom: 4px;">
                    ${metric.icon} ${metric.label}
                </div>
                <div style="font-size: 20px; font-weight: 600; color: ${metric.color || COLOR_SCHEME.text};">
                    ${metric.value}
                </div>
            `;
            grid.appendChild(card);
        });

        container.appendChild(grid);

        // Isolated nodes warning
        if (stats.isolated_nodes && stats.isolated_nodes.length > 0) {
            const warning = document.createElement('div');
            warning.style.cssText = `
                margin-top: 12px; padding: 10px 12px; background: #3a1a0e;
                border: 1px solid #8b3a0e; border-radius: 6px; color: #ff8c42;
                font-size: 11px;
            `;
            warning.innerHTML = `⚠️ <strong>Isolated Nodes:</strong> ${stats.isolated_nodes.join(', ')}`;
            container.appendChild(warning);
        }

        return container;
    }

    /**
     * Create side-by-side matrix comparison
     */
    function createMatrixComparison(baseline, modified, diff) {
        const container = document.createElement('div');
        container.style.cssText = 'padding: 0 16px 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;';

        // Baseline matrix
        const baselinePanel = createMatrixPanel('Baseline (Before)', baseline, null);
        container.appendChild(baselinePanel);

        // Modified matrix with diff highlighting
        const modifiedPanel = createMatrixPanel('Modified (After)', modified, diff);
        container.appendChild(modifiedPanel);

        return container;
    }

    /**
     * Create individual matrix panel
     */
    function createMatrixPanel(title, matrix, diff) {
        const panel = document.createElement('div');
        panel.style.cssText = `
            background: #141824; border-radius: 8px; padding: 16px;
            border: 1px solid ${COLOR_SCHEME.border};
        `;

        // Title
        const titleEl = document.createElement('h4');
        titleEl.style.cssText = `margin: 0 0 12px; font-size: 13px; font-weight: 600; color: ${COLOR_SCHEME.text};`;
        titleEl.textContent = title;
        panel.appendChild(titleEl);

        // Matrix table
        const table = createMatrixTable(matrix, diff);
        panel.appendChild(table);

        return panel;
    }

    /**
     * Create matrix table with optional diff highlighting
     */
    function createMatrixTable(matrix, diff) {
        const nodes = Object.keys(matrix).sort();
        
        // Limit display for large matrices
        const displayLimit = 20;
        const truncated = nodes.length > displayLimit;
        const displayNodes = truncated ? nodes.slice(0, displayLimit) : nodes;

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%; border-collapse: collapse; font-size: 10px;
            table-layout: fixed;
        `;

        // Header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = '<th style="width: 80px; padding: 4px; border: 1px solid #2a3248; background: #1a2030; color: #9ba8c0; text-align: left; font-weight: 600;"></th>';
        displayNodes.forEach(node => {
            const th = document.createElement('th');
            th.style.cssText = 'padding: 4px; border: 1px solid #2a3248; background: #1a2030; color: #9ba8c0; text-align: center; font-weight: 600; overflow: hidden; text-overflow: ellipsis;';
            th.textContent = truncateLabel(node);
            th.title = node;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body rows
        const tbody = document.createElement('tbody');
        displayNodes.forEach(src => {
            const row = document.createElement('tr');
            
            // Row header
            const th = document.createElement('th');
            th.style.cssText = 'padding: 4px; border: 1px solid #2a3248; background: #1a2030; color: #9ba8c0; text-align: left; font-weight: 600; overflow: hidden; text-overflow: ellipsis;';
            th.textContent = truncateLabel(src);
            th.title = src;
            row.appendChild(th);

            // Data cells
            displayNodes.forEach(dst => {
                const cost = matrix[src]?.[dst];
                const cell = document.createElement('td');
                cell.style.cssText = 'padding: 4px; border: 1px solid #2a3248; text-align: center;';

                // Apply diff coloring if available
                if (diff && diff[src]?.[dst]) {
                    const diffData = diff[src][dst];
                    const bgColor = getCellColor(diffData.status);
                    cell.style.background = bgColor;
                    cell.style.fontWeight = '600';
                    cell.title = `${diffData.baseline} → ${diffData.modified} (Δ${diffData.delta !== null ? diffData.delta : '∞'})`;
                } else {
                    cell.style.background = src === dst ? '#1a2030' : COLOR_SCHEME.unchanged;
                    cell.style.color = '#778';
                }

                cell.textContent = cost === Infinity ? '∞' : (cost || '-');
                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        if (truncated) {
            const note = document.createElement('div');
            note.style.cssText = `margin-top: 8px; font-size: 10px; color: ${COLOR_SCHEME.textDim}; font-style: italic;`;
            note.textContent = `Showing first ${displayLimit} of ${nodes.length} nodes. Use export for full matrix.`;
            const wrapper = document.createElement('div');
            wrapper.appendChild(table);
            wrapper.appendChild(note);
            return wrapper;
        }

        return table;
    }

    /**
     * Get cell background color based on diff status
     */
    function getCellColor(status) {
        switch(status) {
            case 'improved': return COLOR_SCHEME.improved;
            case 'degraded': return COLOR_SCHEME.degraded;
            case 'lost': return COLOR_SCHEME.lost;
            default: return COLOR_SCHEME.unchanged;
        }
    }

    /**
     * Truncate node labels for display
     */
    function truncateLabel(label, maxLen = 8) {
        return label.length > maxLen ? label.substring(0, maxLen) + '…' : label;
    }

    /**
     * Create action buttons panel
     */
    function createActionButtons(data) {
        const container = document.createElement('div');
        container.style.cssText = `
            padding: 16px; border-top: 1px solid ${COLOR_SCHEME.border};
            display: flex; gap: 10px; justify-content: flex-end;
            background: #141824; border-radius: 0 0 12px 12px;
        `;

        container.innerHTML = `
            <button onclick="WhatIfMatrixViewer.exportCSV(${data.scenario_id})"
                style="padding: 8px 16px; background: #2a3248; border: 1px solid ${COLOR_SCHEME.border};
                border-radius: 6px; color: #88aaff; cursor: pointer; font-size: 12px;">
                📥 Export CSV
            </button>
            <button onclick="WhatIfMatrixViewer.close()"
                style="padding: 8px 16px; background: ${COLOR_SCHEME.border}; border: none;
                border-radius: 6px; color: ${COLOR_SCHEME.text}; cursor: pointer; font-size: 12px;">
                Close
            </button>
        `;

        return container;
    }

    /**
     * Export matrix comparison to CSV
     */
    function exportCSV(scenarioId) {
        fetch(`${API_BASE}/whatif/matrix-diff/${scenarioId}`)
            .then(r => r.ok ? r.json() : Promise.reject(r))
            .then(data => {
                const csv = generateCSV(data);
                downloadCSV(csv, `scenario_${scenarioId}_comparison.csv`);
            })
            .catch(err => {
                console.error('[MatrixViewer] Export failed:', err);
                alert('Failed to export CSV. Check console for details.');
            });
    }

    /**
     * Generate CSV content from matrix data
     */
    function generateCSV(data) {
        const nodes = Object.keys(data.baseline_matrix).sort();
        let csv = 'Source,Destination,Baseline Cost,Modified Cost,Delta,Status\n';

        nodes.forEach(src => {
            nodes.forEach(dst => {
                if (src === dst) return; // Skip diagonal
                const baseline = data.baseline_matrix[src]?.[dst] || Infinity;
                const modified = data.modified_matrix[src]?.[dst] || Infinity;
                const diff = data.diff[src]?.[dst];
                
                if (diff) {
                    csv += `"${src}","${dst}",${baseline},${modified},${diff.delta || 'INF'},"${diff.status}"\n`;
                }
            });
        });

        return csv;
    }

    /**
     * Trigger CSV download
     */
    function downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Close the comparison panel
     */
    function close() {
        const panel = document.getElementById('whatifMatrixComparisonPanel');
        if (panel) panel.remove();
    }

    // Public API
    return {
        showComparison,
        exportCSV,
        close
    };
})();
