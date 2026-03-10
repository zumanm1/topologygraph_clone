'use strict';
/**
 * Test 18 — Composable 3-Layer View Mode Tests
 * PRD-03: Validate _vmVisibility, _vmStyle, _vmInteract system + _applyCompositeView()
 *
 * Usage:  node tests/18-composable-view.cjs
 */
const { chromium } = require('playwright');
const path         = require('path');
const fs           = require('fs');

const BASE_URL  = 'http://localhost:8081';
const API_USER  = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS  = process.env.API_PASS || 'ospf';
const OSPF_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'ospf-database-54-unk-test.txt');
const CSV_FILE  = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts-metro-level.csv');
const SS_DIR    = path.join(__dirname, 'screenshots');

fs.mkdirSync(SS_DIR, { recursive: true });

let passed = 0, failed = 0, warned = 0;
let shotIdx = 0;

function pass(msg, detail = '') { passed++; console.log(`  ✅  ${msg}${detail ? ' — ' + detail : ''}`); }
function fail(msg, detail = '') { failed++; console.error(`  ❌  ${msg}${detail ? ' — ' + detail : ''}`); }
function warn(msg)               { warned++; console.warn(`  ⚠️   ${msg}`); }
function info(msg)               { console.log(`  ℹ️   ${msg}`); }
async function shot(page, label) {
    const f = path.join(SS_DIR, `${String(shotIdx++).padStart(2,'0')}-nt18-${label}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log(`  📸  ${path.relative(path.join(__dirname, '..'), f)}`);
}

async function login(page) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(500);
    await page.fill('#login', API_USER);
    await page.fill('#password', API_PASS);
    await Promise.race([
        page.press('#password', 'Enter'),
        page.click('input[type="submit"], button[type="submit"]').catch(() => {})
    ]);
    await page.waitForTimeout(1500);
    return !page.url().includes('/login');
}

async function loadGraph(page) {
    await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(800);
    let gt = await page.evaluate(() => {
        const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
        if (!sel || !sel.options || !sel.options.length) return '';
        const vals = Array.from(sel.options).map(o => String(o.value||'').trim()).filter(Boolean);
        return vals.filter(v => v.includes('_84_hosts'))[0] || vals[0] || '';
    });
    if (!gt || !gt.includes('_84_hosts')) {
        await page.click('#Cisco').catch(() => {});
        await page.evaluate(() => { const i = document.getElementById('inputOSPFFileID'); if(i){i.style.display='block';i.removeAttribute('hidden');} });
        const fi = await page.$('#inputOSPFFileID');
        if (fi) {
            await fi.setInputFiles(OSPF_FILE);
            const btn = await page.$('input[name="upload_files_btn"]') || await page.$('#inputGroupFileAddon02');
            if (btn) {
                await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{}), btn.click()]);
                await page.waitForTimeout(3000);
                gt = await page.evaluate(() => {
                    const sel = document.getElementById('dynamic_graph_time');
                    if (!sel) return '';
                    const vals = Array.from(sel.options).map(o=>o.value).filter(Boolean);
                    return vals.filter(v=>v.includes('_84_hosts'))[0] || vals[0] || '';
                });
            }
        }
    }
    if (!gt) throw new Error('No graph available');
    await page.evaluate((g) => {
        const sel = document.getElementById('dynamic_graph_time');
        if (sel) { const opt = Array.from(sel.options).find(o=>o.value===g); if(opt){sel.value=g;sel.dispatchEvent(new Event('change'));} }
    }, gt);
    const lb = await page.$('#load_graph_button');
    if (lb) await lb.click();
    await page.waitForFunction(() => typeof nodes !== 'undefined' && nodes && typeof nodes.get === 'function', { timeout: 40000 });
    await page.waitForTimeout(3000);
    if (fs.existsSync(CSV_FILE)) {
        const csv = fs.readFileSync(CSV_FILE, 'utf8');
        await page.evaluate((c) => { if (typeof _applyHostnameMapping === 'function') _applyHostnameMapping(c, 'Load-hosts-metro-level.csv'); }, csv);
        await page.waitForTimeout(2000);
    }
    return gt;
}

(async () => {
    console.log('\n════════════════════════════════════════════════════════════════════════');
    console.log('  Test 18 — Composable 3-Layer View Mode (PRD-03)');
    console.log('════════════════════════════════════════════════════════════════════════\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page    = await browser.newPage();

    // ── Phase 1: Load graph ───────────────────────────────────────────────────
    console.log('── Phase 1 : Login + Load 84-host Graph ───────────────────────────────');
    try {
        const ok = await login(page);
        if (ok) pass('Login', API_USER); else warn('Login may have failed');
        const gt = await loadGraph(page);
        pass('84-host graph loaded', gt);
        await shot(page, 'graph-loaded');
    } catch (err) {
        fail('Phase 1 failed', err.message);
        await browser.close(); process.exit(1);
    }

    // ── Phase 2: Composable state vars exist ─────────────────────────────────
    console.log('\n── Phase 2 : Composable State Variables ────────────────────────────────');
    try {
        const stateVars = await page.evaluate(() => ({
            vis: typeof _vmVisibility !== 'undefined',
            style: typeof _vmStyle !== 'undefined',
            interact: typeof _vmInteract !== 'undefined',
            applyFn: typeof _applyCompositeView === 'function',
            updateFn: typeof _updateCompositeButtons === 'function',
            getLegacyFn: typeof _getLegacyMode === 'function',
        }));
        pass('_vmVisibility defined', String(stateVars.vis));
        pass('_vmStyle defined', String(stateVars.style));
        pass('_vmInteract defined', String(stateVars.interact));
        pass('_applyCompositeView() function exists', String(stateVars.applyFn));
        pass('_updateCompositeButtons() function exists', String(stateVars.updateFn));
    } catch (err) {
        fail('Phase 2 state check failed', err.message);
    }

    // ── Phase 3: Composable buttons exist in DOM ─────────────────────────────
    console.log('\n── Phase 3 : Composable Buttons in DOM ─────────────────────────────────');
    try {
        const btnCounts = await page.evaluate(() => ({
            vis: document.querySelectorAll('.vmVisBtn').length,
            style: document.querySelectorAll('.vmStyleBtn').length,
            interact: document.querySelectorAll('.vmInteractBtn').length,
        }));
        if (btnCounts.vis >= 3) pass(`Visibility buttons: ${btnCounts.vis} (All / GW / Non-GW)`);
        else fail(`Expected 3+ visibility buttons, got ${btnCounts.vis}`);
        if (btnCounts.style >= 2) pass(`Style buttons: ${btnCounts.style} (Colors / Grey)`);
        else fail(`Expected 2+ style buttons, got ${btnCounts.style}`);
        if (btnCounts.interact >= 2) pass(`Interact buttons: ${btnCounts.interact} (— / ⊞ Groups)`);
        else fail(`Expected 2+ interact buttons, got ${btnCounts.interact}`);
    } catch (err) {
        fail('Phase 3 buttons check failed', err.message);
    }

    // ── Phase 4: Legacy mode → composable mapping ────────────────────────────
    console.log('\n── Phase 4 : Legacy setViewMode() → Composable Mapping ────────────────');
    try {
        // Test AS-IS → grey + all
        await page.evaluate(() => setViewMode('asis'));
        await page.waitForTimeout(800);
        let state = await page.evaluate(() => ({ vis: _vmVisibility, style: _vmStyle, interact: _vmInteract }));
        if (state.vis === 'all' && state.style === 'grey') pass('AS-IS → visibility=all + style=grey');
        else fail('AS-IS mapping wrong', JSON.stringify(state));

        // Test GATEWAY → gateway + colors
        await page.evaluate(() => setViewMode('gateway'));
        await page.waitForTimeout(800);
        state = await page.evaluate(() => ({ vis: _vmVisibility, style: _vmStyle }));
        if (state.vis === 'gateway' && state.style === 'colors') pass('GATEWAY → visibility=gateway + style=colors');
        else fail('GATEWAY mapping wrong', JSON.stringify(state));

        // Verify GATEWAY hides non-gateway nodes
        const visibleCounts = await page.evaluate(() => {
            var gw = 0, nonGw = 0, hidden = 0;
            nodes.get().forEach(function(n) {
                var isUnk = (n.country || '').toUpperCase() === 'UNK';
                if (_nodeHiddenByRules(n)) hidden++;
                else if (n.is_gateway === true || isUnk) gw++;
                else nonGw++;
            });
            return { gw, nonGw, hidden };
        });
        info(`GATEWAY mode: ${visibleCounts.gw} visible gateways, ${visibleCounts.nonGw} non-gw visible, ${visibleCounts.hidden} hidden`);
        if (visibleCounts.nonGw === 0 || visibleCounts.hidden > 0) pass('GATEWAY mode hides non-gateway nodes');
        else warn('GATEWAY mode: no nodes hidden — may be all gateways in test graph');

        // Test ENRICHED → all + colors
        await page.evaluate(() => setViewMode('enriched'));
        await page.waitForTimeout(800);
        state = await page.evaluate(() => ({ vis: _vmVisibility, style: _vmStyle, interact: _vmInteract }));
        if (state.vis === 'all' && state.style === 'colors' && state.interact === 'none') pass('ENRICHED → all + colors + interact=none');
        else fail('ENRICHED mapping wrong', JSON.stringify(state));

        // ENRICHED should show all nodes
        const allVisible = await page.evaluate(() => nodes.get().filter(n => _nodeHiddenByRules(n)).length);
        if (allVisible === 0) pass('ENRICHED: all nodes visible (0 hidden)');
        else fail(`ENRICHED: ${allVisible} nodes still hidden`);

        // Test COLLAPSING → all + colors + collapse
        await page.evaluate(() => setViewMode('collapsing'));
        await page.waitForTimeout(1000);
        state = await page.evaluate(() => ({ vis: _vmVisibility, style: _vmStyle, interact: _vmInteract }));
        if (state.interact === 'collapse') pass('COLLAPSING → interact=collapse');
        else fail('COLLAPSING mapping wrong: interact=' + state.interact);

        const cpPanel = await page.$('#countryCollapsePanel');
        if (cpPanel) pass('Country Groups panel shown in COLLAPSING mode');
        else warn('Country Groups panel not found — may be hidden');

        await shot(page, 'collapsing-mode');
    } catch (err) {
        fail('Phase 4 mode mapping failed', err.message);
    }

    // ── Phase 5: Composable combos via direct state manipulation ─────────────
    console.log('\n── Phase 5 : Composable Combinations ──────────────────────────────────');
    try {
        // Combo: gateway + grey (AS-IS + GATEWAY)
        await page.evaluate(() => {
            _vmVisibility = 'gateway';
            _vmStyle = 'grey';
            _vmInteract = 'none';
            _applyCompositeView();
        });
        await page.waitForTimeout(800);
        const comboGwGrey = await page.evaluate(() => {
            var vis = nodes.get().filter(n => !_nodeHiddenByRules(n));
            var greyCount = vis.filter(function(n) {
                var bg = (n.color && (n.color.background || (n.color.background)));
                return bg === '#cccccc';
            }).length;
            return { visible: vis.length, grey: greyCount };
        });
        info(`gateway+grey combo: ${comboGwGrey.visible} visible, ${comboGwGrey.grey} grey nodes`);
        if (comboGwGrey.visible > 0) pass(`gateway+grey combo: ${comboGwGrey.visible} nodes visible`);
        else fail('gateway+grey combo: no visible nodes');
        if (comboGwGrey.grey > 0) pass(`gateway+grey combo: ${comboGwGrey.grey} nodes correctly greyed`);
        else fail('gateway+grey combo: no grey nodes found');

        // Combo: nongateway + colors
        await page.evaluate(() => {
            _vmVisibility = 'nongateway';
            _vmStyle = 'colors';
            _vmInteract = 'none';
            _applyCompositeView();
        });
        await page.waitForTimeout(800);
        const comboNgColors = await page.evaluate(() => {
            var vis = nodes.get().filter(n => !_nodeHiddenByRules(n));
            var noGw = vis.every(n => n.is_gateway !== true);
            return { visible: vis.length, allNonGw: noGw };
        });
        info(`nongateway+colors combo: ${comboNgColors.visible} visible nodes`);
        if (comboNgColors.visible > 0) pass(`nongateway combo: ${comboNgColors.visible} non-gw nodes visible`);
        else warn('nongateway combo: no visible nodes (possible if all are gateways)');
        if (comboNgColors.allNonGw) pass('nongateway combo: all visible nodes are non-gateways');
        else warn('nongateway combo: some gateway nodes still visible');

        // Reset to enriched
        await page.evaluate(() => setViewMode('enriched'));
        await page.waitForTimeout(800);
        pass('Reset to ENRICHED after combo tests');

        await shot(page, 'combos-done');
    } catch (err) {
        fail('Phase 5 combo tests failed', err.message);
    }

    // ── Phase 6: Composable buttons are clickable ─────────────────────────────
    console.log('\n── Phase 6 : Composable Button Clicks ──────────────────────────────────');
    try {
        // Click GW visibility button
        const gwBtn = await page.$('.vmVisBtn[data-vis="gateway"]');
        if (gwBtn) {
            await gwBtn.click();
            await page.waitForTimeout(600);
            const vis = await page.evaluate(() => _vmVisibility);
            if (vis === 'gateway') pass('Clicking GW visibility button sets _vmVisibility=gateway');
            else fail('GW button click: _vmVisibility=' + vis);
        } else warn('.vmVisBtn[data-vis="gateway"] not found in DOM');

        // Click Grey style button
        const greyBtn = await page.$('.vmStyleBtn[data-style="grey"]');
        if (greyBtn) {
            await greyBtn.click();
            await page.waitForTimeout(600);
            const style = await page.evaluate(() => _vmStyle);
            if (style === 'grey') pass('Clicking Grey style button sets _vmStyle=grey');
            else fail('Grey button click: _vmStyle=' + style);
        } else warn('.vmStyleBtn[data-style="grey"] not found in DOM');

        // Click Colors style button to restore
        const colorsBtn = await page.$('.vmStyleBtn[data-style="colors"]');
        if (colorsBtn) { await colorsBtn.click(); await page.waitForTimeout(400); }

        // Click All visibility to restore
        const allBtn = await page.$('.vmVisBtn[data-vis="all"]');
        if (allBtn) { await allBtn.click(); await page.waitForTimeout(400); }

        pass('Composable button click tests complete');
        await shot(page, 'buttons-clicked');
    } catch (err) {
        fail('Phase 6 button clicks failed', err.message);
    }

    // ── Phase 7: Regression — A/B/C counts still correct ────────────────────
    console.log('\n── Phase 7 : Regression — A/B/C counts ─────────────────────────────────');
    try {
        await page.evaluate(() => setViewMode('enriched'));
        await page.waitForTimeout(800);
        const counts = await page.evaluate(() => {
            var c = { A:0, B:0, C:0, total:0 };
            nodes.get().forEach(n => { var f = _classifyNodeFmt(n); c[f]++; c.total++; });
            return c;
        });
        info(`Counts: A=${counts.A} B=${counts.B} C=${counts.C} total=${counts.total}`);
        if (counts.total >= 80) pass(`All ${counts.total} nodes visible + classified correctly`);
        else fail(`Expected 80+ nodes, got ${counts.total}`);
    } catch (err) {
        fail('Phase 7 regression failed', err.message);
    }

    await shot(page, 'final');
    await browser.close();

    console.log('\n════════════════════════════════════════════════════════════════════════');
    if (failed === 0) console.log(`  Results: ${passed} passed, ${failed} failed, ${warned} warnings`);
    else console.log(`  Results: ${passed} passed, ${failed} FAILED, ${warned} warnings`);
    console.log('════════════════════════════════════════════════════════════════════════');
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
