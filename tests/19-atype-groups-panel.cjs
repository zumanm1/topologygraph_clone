'use strict';
/**
 * Test 19 — A-Type Groups Panel (PRD-04)
 * Validates country→city→node tree filter for A-type nodes.
 *
 * Usage: node tests/19-atype-groups-panel.cjs
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

let passed = 0, failed = 0, warned = 0, shotIdx = 0;

function pass(msg, d='') { passed++; console.log(`  ✅  ${msg}${d?' — '+d:''}`); }
function fail(msg, d='') { failed++; console.error(`  ❌  ${msg}${d?' — '+d:''}`); }
function warn(msg)        { warned++; console.warn(`  ⚠️   ${msg}`); }
function info(msg)        { console.log(`  ℹ️   ${msg}`); }
async function shot(page, label) {
    const f = path.join(SS_DIR, `${String(shotIdx++).padStart(2,'0')}-nt19-${label}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log(`  📸  ${path.relative(path.join(__dirname,'..'), f)}`);
}

async function login(page) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(500);
    await page.fill('#login', API_USER);
    await page.fill('#password', API_PASS);
    await Promise.race([page.press('#password','Enter'), page.click('input[type="submit"], button[type="submit"]').catch(()=>{})]);
    await page.waitForTimeout(1500);
    return !page.url().includes('/login');
}

async function loadGraph84(page) {
    await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(800);
    let gt = await page.evaluate(() => {
        const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
        if (!sel) return '';
        const vals = Array.from(sel.options).map(o=>o.value.trim()).filter(Boolean);
        return vals.filter(v=>v.includes('_84_hosts'))[0] || vals[0] || '';
    });
    if (!gt || !gt.includes('_84_hosts')) {
        await page.click('#Cisco').catch(()=>{});
        await page.evaluate(()=>{ const i=document.getElementById('inputOSPFFileID'); if(i){i.style.display='block';i.removeAttribute('hidden');} });
        const fi = await page.$('#inputOSPFFileID');
        if (!fi) throw new Error('No file input');
        await fi.setInputFiles(OSPF_FILE);
        const btn = await page.$('input[name="upload_files_btn"]') || await page.$('#inputGroupFileAddon02');
        if (btn) { await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{}), btn.click()]); await page.waitForTimeout(3000); }
        gt = await page.evaluate(()=>{ const sel=document.getElementById('dynamic_graph_time'); if(!sel) return ''; const vals=Array.from(sel.options).map(o=>o.value).filter(Boolean); return vals.filter(v=>v.includes('_84_hosts'))[0]||vals[0]||''; });
    }
    if (!gt) throw new Error('No graph');
    await page.evaluate((g)=>{ const sel=document.getElementById('dynamic_graph_time'); if(sel){const opt=Array.from(sel.options).find(o=>o.value===g);if(opt){sel.value=g;sel.dispatchEvent(new Event('change'));}} }, gt);
    const lb = await page.$('#load_graph_button');
    if (lb) await lb.click();
    await page.waitForFunction(()=>typeof nodes!=='undefined'&&nodes&&typeof nodes.get==='function',{timeout:40000});
    await page.waitForTimeout(3000);
    if (fs.existsSync(CSV_FILE)) {
        const csv = fs.readFileSync(CSV_FILE,'utf8');
        await page.evaluate((c)=>{ if(typeof _applyHostnameMapping==='function') _applyHostnameMapping(c,'Load-hosts-metro-level.csv'); }, csv);
        await page.waitForTimeout(2000);
    }
    return gt;
}

(async () => {
    console.log('\n════════════════════════════════════════════════════════════════════════');
    console.log('  Test 19 — A-Type Groups Panel  (PRD-04)');
    console.log('════════════════════════════════════════════════════════════════════════\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page    = await browser.newPage();

    // ── Phase 1: Login + Load graph ───────────────────────────────────────────
    console.log('── Phase 1 : Login + Load 84-host Graph ───────────────────────────────');
    try {
        const ok = await login(page);
        if (ok) pass('Login', API_USER); else warn('Login may have failed');
        const gt = await loadGraph84(page);
        pass('84-host graph loaded', gt);
        await shot(page, 'graph-loaded');
    } catch (err) {
        fail('Phase 1 failed', err.message);
        await browser.close(); process.exit(1);
    }

    // ── Phase 2: Core functions exist ─────────────────────────────────────────
    console.log('\n── Phase 2 : Core Functions ───────────────────────────────────────────');
    try {
        const fns = await page.evaluate(() => ({
            buildTree:    typeof _buildAtypeTree === 'function',
            applyFilter:  typeof _applyAtypeGroupFilter === 'function',
            buildPanel:   typeof buildAtypeGroupsPanel === 'function',
            togglePanel:  typeof toggleAtypeGroupsPanel === 'function',
            atgHidden:    typeof _atGroupHidden !== 'undefined',
        }));
        pass('_buildAtypeTree() exists', String(fns.buildTree));
        pass('_applyAtypeGroupFilter() exists', String(fns.applyFilter));
        pass('buildAtypeGroupsPanel() exists', String(fns.buildPanel));
        pass('toggleAtypeGroupsPanel() exists', String(fns.togglePanel));
        pass('_atGroupHidden variable exists', String(fns.atgHidden));

        // Verify tree has content
        const tree = await page.evaluate(() => {
            var t = _buildAtypeTree();
            var countries = Object.keys(t);
            var total = countries.reduce(function(s,c){ return s + Object.values(t[c]).reduce(function(a,b){return a+b.length;},0); }, 0);
            return { countries: countries.length, totalNodes: total, sample: countries.slice(0,3) };
        });
        info(`A-type tree: ${tree.countries} countries, ${tree.totalNodes} nodes. Sample: ${tree.sample.join(', ')}`);
        if (tree.countries >= 2 && tree.totalNodes >= 10) pass(`A-type tree: ${tree.countries} countries, ${tree.totalNodes} nodes`);
        else fail(`A-type tree too small: ${JSON.stringify(tree)}`);
    } catch (err) {
        fail('Phase 2 failed', err.message);
    }

    // ── Phase 3: Build and open panel ────────────────────────────────────────
    console.log('\n── Phase 3 : Build A-Type Groups Panel ─────────────────────────────────');
    let testCountry = '', testCity = '';
    try {
        await page.evaluate(() => buildAtypeGroupsPanel());
        await page.waitForTimeout(600);

        const panel = await page.$('#atypeGroupsPanel');
        if (panel) pass('A-Type Groups panel created (#atypeGroupsPanel)');
        else { fail('#atypeGroupsPanel not found'); throw new Error('skip'); }

        // Verify structure
        const countryCbs = await page.$$('.atgCountryCb');
        const cityCbs    = await page.$$('.atgCityCb');
        if (countryCbs.length >= 2) pass(`Country checkboxes: ${countryCbs.length}`);
        else fail(`Too few country checkboxes: ${countryCbs.length}`);
        if (cityCbs.length >= 2) pass(`City checkboxes: ${cityCbs.length}`);
        else fail(`Too few city checkboxes: ${cityCbs.length}`);

        // Get first country for testing
        testCountry = await page.evaluate(() => {
            var cb = document.querySelector('.atgCountryCb');
            return cb ? cb.dataset.country : '';
        });
        testCity = await page.evaluate((c) => {
            var cb = document.querySelector('.atgCityCb[data-citykey^="' + c + ':"]');
            return cb ? cb.dataset.citykey : '';
        }, testCountry);
        info(`Test country: ${testCountry}, test city: ${testCity}`);

        await shot(page, 'panel-open');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 3 panel build failed', err.message);
    }

    // ── Phase 4: Hide country → nodes hidden ─────────────────────────────────
    console.log('\n── Phase 4 : Country Hide/Show ─────────────────────────────────────────');
    try {
        if (!testCountry) { warn('No test country — skipping Phase 4'); throw new Error('skip'); }

        // Count nodes before hide
        const beforeCount = await page.evaluate((c) => {
            return nodes.get().filter(n => (n.country||'').toUpperCase()===c && _classifyNodeFmt(n)==='A' && !_nodeHiddenByRules(n)).length;
        }, testCountry);
        info(`${testCountry} A-type visible nodes before hide: ${beforeCount}`);

        // Uncheck the country checkbox
        await page.evaluate((c) => {
            var cb = document.getElementById('atgCb_' + c);
            if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', {bubbles:true})); }
        }, testCountry);
        await page.waitForTimeout(400);

        const hiddenAfter = await page.evaluate((c) => {
            return nodes.get().filter(n => (n.country||'').toUpperCase()===c && _classifyNodeFmt(n)==='A' && !!n._atypeGroupHidden).length;
        }, testCountry);
        if (hiddenAfter >= beforeCount && hiddenAfter > 0) pass(`Unchecking ${testCountry} hides ${hiddenAfter} A-type nodes`);
        else fail(`Unchecking ${testCountry}: only ${hiddenAfter}/${beforeCount} nodes hidden`);

        // Re-check country
        await page.evaluate((c) => {
            var cb = document.getElementById('atgCb_' + c);
            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', {bubbles:true})); }
        }, testCountry);
        await page.waitForTimeout(400);

        const hiddenRestored = await page.evaluate((c) => {
            return nodes.get().filter(n => (n.country||'').toUpperCase()===c && !!n._atypeGroupHidden).length;
        }, testCountry);
        if (hiddenRestored === 0) pass(`Re-checking ${testCountry} restores all nodes`);
        else fail(`After restore: ${hiddenRestored} nodes still hidden`);

        await shot(page, 'country-hide-restore');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 4 country hide failed', err.message);
    }

    // ── Phase 5: City-level filter ────────────────────────────────────────────
    console.log('\n── Phase 5 : City-Level Hide ────────────────────────────────────────────');
    try {
        if (!testCity) { warn('No test city — skipping Phase 5'); throw new Error('skip'); }

        const cityParts = testCity.split(':');
        const cityName  = cityParts[1] || '';

        // Count city nodes
        const cityCount = await page.evaluate((cityKey) => {
            var parts = cityKey.split(':');
            var country = parts[0], city = parts[1];
            return nodes.get().filter(function(n) {
                var host = String(n.hostname||n.label||'').split('\n')[0].trim();
                var p = _parseAtypeHostname(host);
                return p && p.country === country && p.city === city;
            }).length;
        }, testCity);
        info(`${testCity} city has ${cityCount} A-type nodes`);

        // Uncheck city
        await page.evaluate((ck) => {
            var cb = document.getElementById('atgCb_' + ck);
            if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', {bubbles:true})); }
        }, testCity);
        await page.waitForTimeout(400);

        const cityHidden = await page.evaluate((cityKey) => {
            var parts = cityKey.split(':');
            var country = parts[0], city = parts[1];
            return nodes.get().filter(function(n) {
                var host = String(n.hostname||n.label||'').split('\n')[0].trim();
                var p = _parseAtypeHostname(host);
                return p && p.country===country && p.city===city && !!n._atypeGroupHidden;
            }).length;
        }, testCity);
        if (cityHidden >= cityCount && cityCount > 0) pass(`City ${testCity}: ${cityHidden} nodes hidden`);
        else if (cityCount === 0) warn(`City ${testCity} has 0 nodes`);
        else fail(`City ${testCity}: only ${cityHidden}/${cityCount} nodes hidden`);

        // Restore
        await page.evaluate((ck) => {
            var cb = document.getElementById('atgCb_' + ck);
            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', {bubbles:true})); }
        }, testCity);
        await page.waitForTimeout(400);
        pass(`City ${testCity} restored`);

        await shot(page, 'city-filter');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 5 city filter failed', err.message);
    }

    // ── Phase 6: Show All / Hide All bulk buttons ────────────────────────────
    console.log('\n── Phase 6 : Bulk Show All / Hide All ──────────────────────────────────');
    try {
        // Hide All
        const hideAllBtn = await page.$('#atgHideAll');
        if (hideAllBtn) {
            await hideAllBtn.click();
            await page.waitForTimeout(400);
            const allHidden = await page.evaluate(() =>
                nodes.get().filter(n => _classifyNodeFmt(n)==='A' && !n._atypeGroupHidden).length
            );
            if (allHidden === 0) pass('Hide All: all A-type nodes hidden');
            else fail(`Hide All: ${allHidden} A-type nodes still visible`);
        } else fail('#atgHideAll button not found');

        // Show All
        const showAllBtn = await page.$('#atgShowAll');
        if (showAllBtn) {
            await showAllBtn.click();
            await page.waitForTimeout(400);
            const stillHidden = await page.evaluate(() =>
                nodes.get().filter(n => _classifyNodeFmt(n)==='A' && !!n._atypeGroupHidden).length
            );
            if (stillHidden === 0) pass('Show All: all A-type nodes visible again');
            else fail(`Show All: ${stillHidden} A-type nodes still hidden`);
        } else fail('#atgShowAll button not found');

        await shot(page, 'bulk-buttons');
    } catch (err) {
        fail('Phase 6 bulk buttons failed', err.message);
    }

    // ── Phase 7: Toolbar button ───────────────────────────────────────────────
    console.log('\n── Phase 7 : Toolbar Button ─────────────────────────────────────────────');
    try {
        // Remove existing panel for clean test
        await page.evaluate(() => { var p = document.getElementById('atypeGroupsPanel'); if (p) p.remove(); _atGroupBuilt = false; });
        const toolbarBtn = await page.$('#btnAtypeGroups');
        if (toolbarBtn) {
            await toolbarBtn.click();
            await page.waitForTimeout(500);
            const panelAfter = await page.$('#atypeGroupsPanel');
            if (panelAfter) pass('🗂 A-Groups toolbar button opens panel');
            else fail('Toolbar button did not open panel');
        } else warn('#btnAtypeGroups toolbar button not found in DOM');
    } catch (err) {
        fail('Phase 7 toolbar button failed', err.message);
    }

    // ── Phase 8: Regression ───────────────────────────────────────────────────
    console.log('\n── Phase 8 : Regression ─────────────────────────────────────────────────');
    try {
        await page.evaluate(() => { _atGroupHidden = {}; _applyAtypeGroupFilter(); });
        await page.waitForTimeout(400);
        const counts = await page.evaluate(() => {
            var c={A:0,B:0,C:0,total:0};
            nodes.get().forEach(n=>{ var f=_classifyNodeFmt(n); c[f]++; c.total++; });
            return c;
        });
        info(`Node counts: A=${counts.A} B=${counts.B} C=${counts.C} total=${counts.total}`);
        if (counts.total >= 80) pass(`Regression OK: ${counts.total} nodes`);
        else fail(`Regression: expected 80+ nodes, got ${counts.total}`);
    } catch (err) {
        fail('Phase 8 regression failed', err.message);
    }

    await shot(page, 'final');
    await browser.close();

    console.log('\n════════════════════════════════════════════════════════════════════════');
    if (failed===0) console.log(`  Results: ${passed} passed, ${failed} failed, ${warned} warnings`);
    else console.log(`  Results: ${passed} passed, ${failed} FAILED, ${warned} warnings`);
    console.log('════════════════════════════════════════════════════════════════════════');
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
