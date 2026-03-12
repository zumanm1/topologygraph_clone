'use strict';
/**
 * 24-v4-parity-validation.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates 100% UI and functional parity for Cost Matrix and What-If Analysis.
 *
 * Targets:
 *   - Sidebar labels: "📅 Graph Snapshot"
 *   - Status Reporting: Exact count-based strings
 *   - Target Graph: 11Mar2026_21h17m14s_84_hosts
 */

const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const TARGET_GT = '11Mar2026_21h17m14s_84_hosts';

const pass = [], fail = [];
function ok(n) { pass.push(n); console.log('  ✅  ' + n); }
function ko(n, m) { fail.push(n); console.log('  ❌  ' + n + ' — ' + m); }

(async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => console.log('  [CONSOLE]', msg.text()));
    page.on('pageerror', err => console.log('  [ERROR]', err.message));
    page.on('requestfailed', request => console.log('  [REQ-FAIL]', request.url(), request.failure().errorText));

    console.log('\n════ Starting V4 Parity Validation ════');

    // 1. Login
    try {
        await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        await page.fill('#login', API_USER);
        await page.fill('#password', API_PASS);
        await page.press('#password', 'Enter');
        await page.waitForTimeout(3000);
        if (page.url().includes('/login')) throw new Error('Still on login page: ' + page.url());
        ok('Login succeeded');
    } catch (e) {
        ko('Login failed', e.message);
        await browser.close(); process.exit(1);
    }

    // 2. Validate What-If Analysis
    console.log('\nTesting What-If Analysis...');
    try {
        await page.goto(`${BASE}/what-if?graph_time=${TARGET_GT}`, { waitUntil: 'domcontentloaded' });

        // Scope Check
        const kspReady = await page.evaluate(() => typeof KSP_loadTopology === 'function');
        console.log('  KSP_loadTopology status:', kspReady ? 'FUNCTION' : 'UNDEFINED');
        if (!kspReady) ko('What-If KSP', 'KSP_loadTopology is NOT a function in browser');

        await page.waitForTimeout(15000);

        // Label check
        const label = await page.textContent('h6:has-text("📅 Graph Snapshot")');
        label ? ok('What-If: "📅 Graph Snapshot" label found') : ko('What-If label', 'missing emoji or text');

        // Status check
        const status = await page.textContent('#wiStatus');
        console.log('  Status observed:', status);
        if (status.includes('Loaded 84 nodes, 104 edges. Select a failure and click Compute.')) {
            ok('What-If: Exact status string verified');
        } else {
            ko('What-If status', 'Expected "Loaded 84 nodes, 104 edges...", got: ' + status);
        }
    } catch (e) {
        ko('What-If Page', e.message);
    }

    // 3. Validate Cost Matrix
    console.log('\nTesting Cost Matrix...');
    try {
        await page.goto(`${BASE}/cost-matrix?graph_time=${TARGET_GT}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(15000); // Matrix takes longer to compute

        // Label check
        const label = await page.textContent('h6:has-text("📅 Graph Snapshot")');
        label ? ok('Cost Matrix: "📅 Graph Snapshot" label found') : ko('Cost Matrix label', 'missing emoji or text');

        // Status check
        const status = await page.textContent('#rmStatus');
        console.log('  Status observed:', status);
        if (status.includes('Loaded 84 nodes, 104 edges. Matrix computed.')) {
            ok('Cost Matrix: Exact status string verified');
        } else {
            ko('Cost Matrix status', 'Expected "Loaded 84 nodes, 104 edges. Matrix computed.", got: ' + status);
        }

        // Check matrix data
        const rowCount = await page.locator('.rm-table tbody tr').count();
        rowCount > 0 ? ok(`Cost Matrix: Rendered ${rowCount} rows`) : ko('Cost Matrix data', 'Table is empty');
    } catch (e) {
        ko('Cost Matrix Page', e.message);
    }

    await browser.close();
    console.log('\n════════════════════════════════════════════════════════');
    console.log('  PASSED: ' + pass.length + ' | FAILED: ' + fail.length);
    process.exit(fail.length ? 1 : 0);
})();
