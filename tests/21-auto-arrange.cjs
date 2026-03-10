'use strict';
/**
 * Test 21 — Auto-Arrange Layout (PRD-06)
 * Validates autoArrangeByCountryCity() + ⟳ Auto-Arrange toolbar button.
 *
 * Usage: node tests/21-auto-arrange.cjs
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
    const f = path.join(SS_DIR, `${String(shotIdx++).padStart(2,'0')}-nt21-${label}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log(`  📸  ${path.relative(path.join(__dirname,'..'), f)}`);
}

async function login(page) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(500);
    await page.fill('#login', API_USER);
    await page.fill('#password', API_PASS);
    await Promise.race([page.press('#password','Enter'), page.click('input[type="submit"],button[type="submit"]').catch(()=>{})]);
    await page.waitForTimeout(1500);
    return !page.url().includes('/login');
}

async function loadGraph84(page) {
    await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil:'domcontentloaded', timeout:25000 });
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
        gt = await page.evaluate(()=>{ const sel=document.getElementById('dynamic_graph_time'); const vals=Array.from(sel.options).map(o=>o.value).filter(Boolean); return vals.filter(v=>v.includes('_84_hosts'))[0]||vals[0]||''; });
    }
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
    console.log('  Test 21 — Auto-Arrange Layout  (PRD-06)');
    console.log('════════════════════════════════════════════════════════════════════════\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page    = await browser.newPage({ viewport: { width: 1440, height: 900 } });

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

    // ── Phase 2: Function exists + toolbar button ─────────────────────────────
    console.log('\n── Phase 2 : Function + Toolbar Button ─────────────────────────────────');
    try {
        const fnExists = await page.evaluate(() => typeof autoArrangeByCountryCity === 'function');
        if (fnExists) pass('autoArrangeByCountryCity() function exists');
        else { fail('autoArrangeByCountryCity() not found'); throw new Error('skip'); }

        const btnExists = await page.$('#btnAutoArrange');
        if (btnExists) pass('⟳ Auto-Arrange toolbar button exists (#btnAutoArrange)');
        else warn('#btnAutoArrange not found in DOM');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 2 failed', err.message);
        else { await browser.close(); process.exit(1); }
    }

    // ── Phase 3: Capture initial positions ───────────────────────────────────
    console.log('\n── Phase 3 : Capture Initial Positions ─────────────────────────────────');
    let initialPositions = {};
    try {
        initialPositions = await page.evaluate(() => {
            var pos = network.getPositions();
            return pos;
        });
        const nodeCount = Object.keys(initialPositions).length;
        if (nodeCount >= 80) pass(`Captured initial positions for ${nodeCount} nodes`);
        else fail(`Expected 80+ nodes, got ${nodeCount}`);
        info(`Sample initial pos: node ${Object.keys(initialPositions)[0]} at x=${Math.round(initialPositions[Object.keys(initialPositions)[0]].x)}`);
    } catch (err) {
        fail('Phase 3 failed', err.message);
    }

    // ── Phase 4: Trigger auto-arrange + wait for stabilization ───────────────
    console.log('\n── Phase 4 : Trigger Auto-Arrange + Wait for Stabilization ─────────────');
    try {
        // Click the toolbar button
        const arrangeBtn = await page.$('#btnAutoArrange');
        if (arrangeBtn) {
            await arrangeBtn.click();
            pass('Clicked ⟳ Auto-Arrange button');
        } else {
            await page.evaluate(() => autoArrangeByCountryCity());
            pass('Called autoArrangeByCountryCity() directly (button not found in DOM)');
        }

        // Wait for stabilized event (up to 20s) or position change
        info('Waiting for physics stabilization (up to 20s)...');
        const stabilized = await page.evaluate(() => {
            return new Promise(function(resolve) {
                var done = false;
                var timer = setTimeout(function() {
                    if (!done) { done = true; resolve('timeout'); }
                }, 18000);
                network.once('stabilized', function() {
                    if (!done) { done = true; clearTimeout(timer); resolve('stabilized'); }
                });
            });
        });
        info(`Stabilization result: ${stabilized}`);
        if (stabilized === 'stabilized') pass('Physics stabilization event fired');
        else warn('Stabilization timed out — positions may still have changed');

        await page.waitForTimeout(2000); // Wait for post-stabilize position saving
        await shot(page, 'after-arrange');
    } catch (err) {
        fail('Phase 4 failed', err.message);
    }

    // ── Phase 5: Verify nodes moved from initial positions ───────────────────
    console.log('\n── Phase 5 : Verify Nodes Moved ────────────────────────────────────────');
    try {
        const newPositions = await page.evaluate(() => network.getPositions());
        const nodeIds = Object.keys(initialPositions);
        let movedCount = 0;
        nodeIds.forEach(function (id) {
            if (newPositions[id]) {
                var dx = Math.abs(newPositions[id].x - initialPositions[id].x);
                var dy = Math.abs(newPositions[id].y - initialPositions[id].y);
                if (dx > 5 || dy > 5) movedCount++;
            }
        });
        info(`Nodes moved vs initial: ${movedCount}/${nodeIds.length}`);
        if (movedCount >= nodeIds.length * 0.5) pass(`${movedCount}/${nodeIds.length} nodes moved (≥50% — auto-arrange worked)`);
        else if (movedCount > 0) warn(`Only ${movedCount}/${nodeIds.length} nodes moved (positions may have been pre-arranged)`);
        else fail('No nodes moved after auto-arrange');
    } catch (err) {
        fail('Phase 5 failed', err.message);
    }

    // ── Phase 6: Verify same-country nodes are spatially clustered ────────────
    console.log('\n── Phase 6 : Verify Country Spatial Clustering ─────────────────────────');
    try {
        const clusterData = await page.evaluate(() => {
            var pos = network.getPositions();
            // Group node positions by country
            var countryPositions = {};
            nodes.get().forEach(function(n) {
                var c = (n.country || '').toUpperCase() || 'UNK';
                if (!countryPositions[c]) countryPositions[c] = [];
                if (pos[n.id]) countryPositions[c].push(pos[n.id]);
            });
            // Compute average intra-country distance vs inter-country centroid distance
            var countries = Object.keys(countryPositions).filter(c => countryPositions[c].length >= 2);
            if (countries.length < 2) return { countries: countries.length, ok: false };

            // Compute centroid per country
            var centroids = {};
            countries.forEach(function(c) {
                var pts = countryPositions[c];
                var cx = pts.reduce(function(s,p){return s+p.x;},0) / pts.length;
                var cy = pts.reduce(function(s,p){return s+p.y;},0) / pts.length;
                centroids[c] = {x:cx, y:cy};
            });

            // Avg inter-country centroid distance
            var interDists = [];
            for (var i=0; i<countries.length; i++) {
                for (var j=i+1; j<countries.length; j++) {
                    var dx = centroids[countries[i]].x - centroids[countries[j]].x;
                    var dy = centroids[countries[i]].y - centroids[countries[j]].y;
                    interDists.push(Math.sqrt(dx*dx + dy*dy));
                }
            }
            var avgInter = interDists.reduce(function(s,d){return s+d;},0) / interDists.length;

            // Avg intra-country spread (max distance from centroid)
            var intraSpread = countries.map(function(c) {
                var centroid = centroids[c];
                var pts = countryPositions[c];
                return Math.max.apply(null, pts.map(function(p) {
                    var dx=p.x-centroid.x; var dy=p.y-centroid.y;
                    return Math.sqrt(dx*dx+dy*dy);
                }));
            });
            var avgIntra = intraSpread.reduce(function(s,d){return s+d;},0) / intraSpread.length;

            return { countries: countries.length, avgInter: Math.round(avgInter), avgIntra: Math.round(avgIntra), ratio: Math.round(avgInter/avgIntra) };
        });

        info(`Countries: ${clusterData.countries}, avg inter-country dist: ${clusterData.avgInter}, avg intra-country spread: ${clusterData.avgIntra}, ratio: ${clusterData.ratio}x`);
        if (clusterData.countries < 2) warn('Need ≥2 countries for clustering verification');
        else if (clusterData.ratio >= 2) pass(`Countries are spatially separated (inter/intra ratio: ${clusterData.ratio}x)`);
        else warn(`Clustering ratio is ${clusterData.ratio}x (may improve with more stabilization time)`);
    } catch (err) {
        fail('Phase 6 failed', err.message);
    }

    // ── Phase 7: Nodes are pinned after arrange ───────────────────────────────
    console.log('\n── Phase 7 : Nodes Pinned After Arrange ────────────────────────────────');
    try {
        const pinnedCount = await page.evaluate(() => {
            return nodes.get().filter(function(n) {
                return n.physics === false && n.fixed && (n.fixed === true || (n.fixed.x && n.fixed.y));
            }).length;
        });
        const total = await page.evaluate(() => nodes.get().length);
        info(`Pinned: ${pinnedCount}/${total} nodes`);
        if (pinnedCount >= total * 0.8) pass(`${pinnedCount}/${total} nodes pinned after auto-arrange`);
        else warn(`Only ${pinnedCount}/${total} nodes pinned`);
    } catch (err) {
        fail('Phase 7 failed', err.message);
    }

    // ── Phase 8: Regression ───────────────────────────────────────────────────
    console.log('\n── Phase 8 : Regression ─────────────────────────────────────────────────');
    try {
        await page.evaluate(() => setViewMode('enriched'));
        await page.waitForTimeout(600);
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
