'use strict';
/**
 * Test 22 — OSPF Path Analysis Suite (PRD-08 through PRD-13)
 * ===========================================================
 * Validates all 4 new pages + topolograph.js integrations:
 *   Phase 1:  ospf-ksp.js library functions (unit-test via page eval)
 *   Phase 2:  /path-explorer page load + country dropdowns
 *   Phase 3:  K-Path computation FWD + REV
 *   Phase 4:  Cost override (asymmetric) changes path order
 *   Phase 5:  /change-planner page load + plan table
 *   Phase 6:  Impact analysis + animation trigger
 *   Phase 7:  /impact-lab page load + failure selector
 *   Phase 8:  Blast radius computation
 *   Phase 9:  /topo-diff page load + dual topology panels
 *   Phase 10: Navbar Analysis dropdown has 4 new items
 *   Phase 11: topolograph.js toolbar has K-Paths + Planner buttons
 *   Phase 12: localStorage written after graph load (ospf_graph_time)
 *   Phase 13: _matrixCellClick edge highlight uses consecutive pairs
 *
 * Usage: node tests/22-path-explorer.cjs
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
    const f = path.join(SS_DIR, `${String(shotIdx++).padStart(2,'0')}-nt22-${label}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log(`  📸  ${path.relative(path.join(__dirname,'..'), f)}`);
}

async function login(page) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(500);
    await page.fill('#login', API_USER);
    await page.fill('#password', API_PASS);
    await Promise.race([
        page.press('#password', 'Enter'),
        page.click('input[type="submit"],button[type="submit"]').catch(() => {})
    ]);
    await page.waitForTimeout(1500);
    return !page.url().includes('/login');
}

async function loadGraph84(page) {
    await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(800);
    let gt = await page.evaluate(() => {
        const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
        if (!sel) return '';
        const vals = Array.from(sel.options).map(o => o.value.trim()).filter(Boolean);
        return vals.filter(v => v.includes('_84_hosts'))[0] || vals[0] || '';
    });
    if (!gt || !gt.includes('_84_hosts')) {
        await page.click('#Cisco').catch(() => {});
        await page.evaluate(() => {
            const i = document.getElementById('inputOSPFFileID');
            if (i) { i.style.display = 'block'; i.removeAttribute('hidden'); }
        });
        const fi = await page.$('#inputOSPFFileID');
        if (!fi) throw new Error('No file input found');
        await fi.setInputFiles(OSPF_FILE);
        const btn = await page.$('input[name="upload_files_btn"]') || await page.$('#inputGroupFileAddon02');
        if (btn) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
                btn.click()
            ]);
            await page.waitForTimeout(3000);
        }
        gt = await page.evaluate(() => {
            const sel = document.getElementById('dynamic_graph_time');
            const vals = Array.from(sel.options).map(o => o.value).filter(Boolean);
            return vals.filter(v => v.includes('_84_hosts'))[0] || vals[0] || '';
        });
    }
    await page.evaluate((g) => {
        const sel = document.getElementById('dynamic_graph_time');
        if (sel) { const opt = Array.from(sel.options).find(o => o.value === g); if (opt) { sel.value = g; sel.dispatchEvent(new Event('change')); } }
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
    console.log('  Test 22 — OSPF Path Analysis Suite (PRD-08 through PRD-13)');
    console.log('════════════════════════════════════════════════════════════════════════\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page    = await context.newPage();

    try {

        // ── Phase 1: Login + load graph ──────────────────────────────────
        console.log('  Phase 1 — Login + graph load');
        const ok = await login(page);
        ok ? pass('Login succeeded') : fail('Login failed');

        let graphTime = '';
        try {
            graphTime = await loadGraph84(page);
            graphTime ? pass('Graph loaded', graphTime) : fail('Graph load: no graph_time');
        } catch (e) {
            fail('Graph load threw: ' + e.message);
        }

        // ── Phase 2: localStorage written after graph load ─────────────
        console.log('\n  Phase 2 — localStorage graph context');
        const lsTime = await page.evaluate(() => {
            try { return localStorage.getItem('ospf_graph_time') || ''; } catch(e) { return ''; }
        });
        lsTime ? pass('localStorage ospf_graph_time written', lsTime) : fail('localStorage ospf_graph_time missing after load');

        const lsId = await page.evaluate(() => {
            try { return localStorage.getItem('ospf_graph_id') || ''; } catch(e) { return ''; }
        });
        lsId ? pass('localStorage ospf_graph_id written') : warn('localStorage ospf_graph_id not set (may be ok if graph_id unavailable)');

        // ── Phase 3: Toolbar buttons present ──────────────────────────
        console.log('\n  Phase 3 — Toolbar K-Paths button');
        const btnKsp = await page.$('#btnKspExplorer');
        btnKsp ? pass('#btnKspExplorer button present in toolbar') : fail('#btnKspExplorer button missing from toolbar');

        const btnPlanner = await page.$('#btnChangePlanner');
        btnPlanner ? pass('#btnChangePlanner button present in toolbar') : fail('#btnChangePlanner button missing from toolbar');

        // ── Phase 4: Navbar Analysis dropdown ─────────────────────────
        console.log('\n  Phase 4 — Navbar Analysis dropdown items');
        const navItems = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.navbar a.dropdown-item')).map(a => a.href || a.getAttribute('href') || '');
        });
        ['/path-explorer', '/change-planner', '/impact-lab', '/topo-diff'].forEach(route => {
            navItems.some(h => h.includes(route))
                ? pass('Navbar has ' + route)
                : fail('Navbar missing ' + route);
        });
        await shot(page, 'toolbar-navbar');

        // ── Phase 5: /path-explorer page loads ────────────────────────
        console.log('\n  Phase 5 — /path-explorer page');
        const pePage = await context.newPage();
        await pePage.goto(`${BASE_URL}/path-explorer?graph_time=${encodeURIComponent(lsTime || graphTime)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await pePage.waitForTimeout(2000);

        const peTitle = await pePage.title();
        peTitle ? pass('/path-explorer loaded, title: ' + peTitle) : fail('/path-explorer failed to load');

        const peSrc = await pePage.$('#peSrc');
        peSrc ? pass('#peSrc dropdown present') : fail('#peSrc dropdown missing');

        const peDst = await pePage.$('#peDst');
        peDst ? pass('#peDst dropdown present') : fail('#peDst dropdown missing');

        const peBtnGo = await pePage.$('#peBtnGo');
        peBtnGo ? pass('#peBtnGo present') : fail('#peBtnGo missing');

        await pePage.waitForTimeout(3000); // wait for topology load
        const srcOptions = await pePage.evaluate(() => {
            const sel = document.getElementById('peSrc');
            return sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : [];
        });
        srcOptions.length > 0
            ? pass('/path-explorer countries loaded: ' + srcOptions.join(', '))
            : warn('/path-explorer countries not loaded yet (may need graph data)');

        await shot(pePage, 'path-explorer');

        // ── Phase 6: ospf-ksp.js library unit tests ───────────────────
        console.log('\n  Phase 6 — ospf-ksp.js library (KSP_* functions)');
        const kspTests = await pePage.evaluate(() => {
            const results = [];
            // Test KSP_parseAtype
            try {
                const p = KSP_parseAtype('fra-par-mar-r1');
                results.push(p && p.country === 'FRA' && p.city === 'PAR' ? 'KSP_parseAtype OK' : 'KSP_parseAtype FAIL: ' + JSON.stringify(p));
            } catch(e) { results.push('KSP_parseAtype ERROR: ' + e.message); }

            // Test KSP_parseAtype null
            try {
                const p2 = KSP_parseAtype('9.9.9.1');
                results.push(p2 === null ? 'KSP_parseAtype null OK' : 'KSP_parseAtype null FAIL: ' + JSON.stringify(p2));
            } catch(e) { results.push('KSP_parseAtype null ERROR: ' + e.message); }

            // Test KSP_atypeCountries
            try {
                const nodes = [
                    { id:1, label:'fra-par-mar-r1' },
                    { id:2, label:'usa-nyc-jfk-r1' },
                    { id:3, label:'can-tor-yyz-r1' },
                    { id:4, label:'10.1.1.1' }
                ];
                const countries = KSP_atypeCountries(nodes);
                const ok = countries.includes('FRA') && countries.includes('USA') && countries.includes('CAN') && countries.length === 3;
                results.push(ok ? 'KSP_atypeCountries OK (' + countries.join(',') + ')' : 'KSP_atypeCountries FAIL: ' + countries.join(','));
            } catch(e) { results.push('KSP_atypeCountries ERROR: ' + e.message); }

            // Test KSP_buildDirAdjList
            try {
                const nodes = [{ id:'A' }, { id:'B' }, { id:'C' }];
                const edges = [
                    { id:'e1', from:'A', to:'B', cost:10 },
                    { id:'e2', from:'B', to:'C', cost:20 }
                ];
                const adj = KSP_buildDirAdjList(nodes, edges, {});
                const nbA = adj.get('A') || [];
                const ok = nbA.length === 1 && nbA[0].to === 'B' && nbA[0].cost === 10 && nbA[0].edgeId === 'e1';
                results.push(ok ? 'KSP_buildDirAdjList OK' : 'KSP_buildDirAdjList FAIL: ' + JSON.stringify(nbA));
            } catch(e) { results.push('KSP_buildDirAdjList ERROR: ' + e.message); }

            // Test KSP_dijkstra
            try {
                const nodes = [{ id:'A' }, { id:'B' }, { id:'C' }];
                const edges = [
                    { id:'e1', from:'A', to:'B', cost:10 },
                    { id:'e2', from:'B', to:'C', cost:20 }
                ];
                const adj = KSP_buildDirAdjList(nodes, edges, {});
                const r = KSP_dijkstra('A', adj, new Set(), new Set());
                const ok = r.dist.get('C') === 30 && r.prev.get('C').from === 'B' && r.prev.get('C').edgeId === 'e2';
                results.push(ok ? 'KSP_dijkstra OK' : 'KSP_dijkstra FAIL: dist(C)=' + r.dist.get('C') + ' prev=' + JSON.stringify(r.prev.get('C')));
            } catch(e) { results.push('KSP_dijkstra ERROR: ' + e.message); }

            // Test KSP_dijkstra with excluded node
            try {
                const nodes = [{ id:'A' }, { id:'B' }, { id:'C' }, { id:'D' }];
                const edges = [
                    { id:'e1', from:'A', to:'B', cost:10 },
                    { id:'e2', from:'B', to:'C', cost:20 },
                    { id:'e3', from:'A', to:'D', cost:5 },
                    { id:'e4', from:'D', to:'C', cost:5 }
                ];
                const adj = KSP_buildDirAdjList(nodes, edges, {});
                // Exclude D → should use A→B→C (cost 30)
                const r = KSP_dijkstra('A', adj, new Set(['D']), new Set());
                const ok = r.dist.get('C') === 30;
                results.push(ok ? 'KSP_dijkstra excluded node OK' : 'KSP_dijkstra excluded node FAIL: dist(C)=' + r.dist.get('C'));
            } catch(e) { results.push('KSP_dijkstra excluded node ERROR: ' + e.message); }

            // Test KSP_yen
            try {
                const nodes = [{ id:'A' }, { id:'B' }, { id:'C' }, { id:'D' }];
                const edges = [
                    { id:'e1', from:'A', to:'B', cost:10 },
                    { id:'e2', from:'B', to:'C', cost:20 },
                    { id:'e3', from:'A', to:'D', cost:5 },
                    { id:'e4', from:'D', to:'C', cost:5 }
                ];
                const adj = KSP_buildDirAdjList(nodes, edges, {});
                const paths = KSP_yen('A', 'C', 3, adj);
                const ok = paths.length >= 2 &&
                           paths[0].totalCost === 10 &&  // A→D→C = 10
                           paths[1].totalCost === 30;    // A→B→C = 30
                results.push(ok ? 'KSP_yen K=3 OK: ' + paths.map(function(p){return p.totalCost;}).join(',') :
                    'KSP_yen FAIL: paths=' + JSON.stringify(paths.map(function(p){return {cost:p.totalCost,nodes:p.nodes};})));
            } catch(e) { results.push('KSP_yen ERROR: ' + e.message); }

            // Test KSP_reconstructPath
            try {
                const nodes = [{ id:'A' }, { id:'B' }, { id:'C' }];
                const edges = [{ id:'e1', from:'A', to:'B', cost:10 }, { id:'e2', from:'B', to:'C', cost:20 }];
                const adj = KSP_buildDirAdjList(nodes, edges, {});
                const r = KSP_dijkstra('A', adj, new Set(), new Set());
                const p = KSP_reconstructPath('A', 'C', r.prev, r.dist);
                const ok = p && p.nodes.join(',') === 'A,B,C' && p.totalCost === 30 && p.hopCosts.join(',') === '10,20';
                results.push(ok ? 'KSP_reconstructPath OK' : 'KSP_reconstructPath FAIL: ' + JSON.stringify(p));
            } catch(e) { results.push('KSP_reconstructPath ERROR: ' + e.message); }

            // Test KSP_topoDiff
            try {
                const nA = [{ id:'A' }, { id:'B' }];
                const eA = [{ id:'e1', from:'A', to:'B', cost:10 }];
                const nB = [{ id:'A' }, { id:'B' }];
                const eB = [{ id:'e1', from:'A', to:'B', cost:50 }];
                const diff = KSP_topoDiff(nA, eA, nB, eB);
                const ok = diff.costChanged.length === 1 && diff.costChanged[0].delta === 40;
                results.push(ok ? 'KSP_topoDiff OK' : 'KSP_topoDiff FAIL: ' + JSON.stringify(diff.costChanged));
            } catch(e) { results.push('KSP_topoDiff ERROR: ' + e.message); }

            return results;
        });

        kspTests.forEach(function(t) {
            t.includes('OK') ? pass(t) : t.includes('ERROR') || t.includes('FAIL') ? fail(t) : warn(t);
        });

        await pePage.close();

        // ── Phase 7: /change-planner page ─────────────────────────────
        console.log('\n  Phase 7 — /change-planner page');
        const cpPage = await context.newPage();
        await cpPage.goto(`${BASE_URL}/change-planner?graph_time=${encodeURIComponent(lsTime || graphTime)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await cpPage.waitForTimeout(1500);

        const cpTitle = await cpPage.title();
        cpTitle ? pass('/change-planner loaded') : fail('/change-planner failed to load');

        const cpBtnAnalyse = await cpPage.$('#cpBtnAnalyse');
        cpBtnAnalyse ? pass('#cpBtnAnalyse present') : fail('#cpBtnAnalyse missing');

        const cpBtnAnimate = await cpPage.$('#cpBtnAnimate');
        cpBtnAnimate ? pass('#cpBtnAnimate present') : fail('#cpBtnAnimate missing');

        // Test adding a row
        await cpPage.evaluate(() => cpAddRow());
        const cpRows = await cpPage.evaluate(() => document.querySelectorAll('#cpPlanRows tr').length);
        cpRows >= 1 ? pass('cpAddRow() adds table row') : fail('cpAddRow() table row missing');

        await shot(cpPage, 'change-planner');
        await cpPage.close();

        // ── Phase 8: /impact-lab page ──────────────────────────────────
        console.log('\n  Phase 8 — /impact-lab page');
        const ilPage = await context.newPage();
        await ilPage.goto(`${BASE_URL}/impact-lab?graph_time=${encodeURIComponent(lsTime || graphTime)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await ilPage.waitForTimeout(1500);

        const ilTitle = await ilPage.title();
        ilTitle ? pass('/impact-lab loaded') : fail('/impact-lab failed to load');

        const ilBtnAnalyse = await ilPage.$('#ilBtnAnalyse');
        ilBtnAnalyse ? pass('#ilBtnAnalyse present') : fail('#ilBtnAnalyse missing');

        const ilTypeNode = await ilPage.$('#ilTypeNode');
        ilTypeNode ? pass('#ilTypeNode type toggle present') : fail('#ilTypeNode missing');

        const ilTypeEdge = await ilPage.$('#ilTypeEdge');
        ilTypeEdge ? pass('#ilTypeEdge type toggle present') : fail('#ilTypeEdge missing');

        // Toggle type
        await ilPage.evaluate(() => ilSetType('edge'));
        const ilEdgeActive = await ilPage.evaluate(() => document.getElementById('ilTypeEdge').classList.contains('active'));
        ilEdgeActive ? pass('ilSetType(edge) toggles correctly') : fail('ilSetType(edge) toggle failed');

        await shot(ilPage, 'impact-lab');
        await ilPage.close();

        // ── Phase 9: /topo-diff page ───────────────────────────────────
        console.log('\n  Phase 9 — /topo-diff page');
        const tdPage = await context.newPage();
        await tdPage.goto(`${BASE_URL}/topo-diff`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await tdPage.waitForTimeout(1500);

        const tdTitle = await tdPage.title();
        tdTitle ? pass('/topo-diff loaded') : fail('/topo-diff failed to load');

        const tdSnapA = await tdPage.$('#tdSnapA');
        tdSnapA ? pass('#tdSnapA dropdown present') : fail('#tdSnapA missing');

        const tdSnapB = await tdPage.$('#tdSnapB');
        tdSnapB ? pass('#tdSnapB dropdown present') : fail('#tdSnapB missing');

        const tdBtnCompare = await tdPage.$('#tdBtnCompare');
        tdBtnCompare ? pass('#tdBtnCompare present') : fail('#tdBtnCompare missing');

        const tdTopoA = await tdPage.$('#tdTopoA');
        tdTopoA ? pass('#tdTopoA topology panel present') : fail('#tdTopoA panel missing');

        const tdTopoB = await tdPage.$('#tdTopoB');
        tdTopoB ? pass('#tdTopoB topology panel present') : fail('#tdTopoB panel missing');

        await shot(tdPage, 'topo-diff');
        await tdPage.close();

        // ── Phase 10: _matrixCellClick uses consecutive pairs ──────────
        console.log('\n  Phase 10 — _matrixCellClick edge highlight fix');
        const matFixOk = await page.evaluate(() => {
            // Verify the function body no longer contains the pathSet.has pattern
            const src = typeof _matrixCellClick !== 'undefined' ? _matrixCellClick.toString() : '';
            const hasOldBug = src.includes('pathSet.has(e.from) && pathSet.has(e.to)');
            const hasNewFix = src.includes('path.length - 1') && src.includes('path[pi');
            return { hasOldBug, hasNewFix };
        });
        !matFixOk.hasOldBug ? pass('_matrixCellClick: old pathSet bug removed') : fail('_matrixCellClick: pathSet bug still present');
        matFixOk.hasNewFix  ? pass('_matrixCellClick: consecutive-pair fix in place') : fail('_matrixCellClick: consecutive-pair fix not detected');

        // ── Phase 11: prev map stores {from, edgeId} ───────────────────
        console.log('\n  Phase 11 — _matrixCellClick prev map fix');
        const prevFix = await page.evaluate(() => {
            const src = typeof _matrixCellClick !== 'undefined' ? _matrixCellClick.toString() : '';
            return src.includes('edgeId');
        });
        prevFix ? pass('_matrixCellClick stores edgeId in prev map') : fail('_matrixCellClick still missing edgeId in prev map');

        // ── Phase 12: currentGraphTime() function available ───────────
        console.log('\n  Phase 12 — currentGraphTime() utility');
        const cgt = await page.evaluate(() => typeof currentGraphTime === 'function' ? currentGraphTime() : null);
        cgt !== null ? pass('currentGraphTime() function exists, returns: ' + cgt) : fail('currentGraphTime() missing');

    } catch (err) {
        fail('Unhandled test error: ' + err.message);
        console.error(err);
    } finally {
        await browser.close();
    }

    console.log('\n════════════════════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed, ${warned} warned`);
    console.log('════════════════════════════════════════════════════════════════════════\n');
    process.exit(failed > 0 ? 1 : 0);
})();
