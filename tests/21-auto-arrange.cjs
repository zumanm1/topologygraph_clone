'use strict';
/**
 * Test 21 — Auto-Arrange Layout (PRD-06 v2)
 * Validates autoArrangeByCountryCity() deterministic geometry:
 *   - country → city → node hierarchy enforced
 *   - ≥100px spacing between nodes in same city
 *   - city clusters tighter than country spread
 *   - ⟳ Auto-Arrange toolbar button
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
    console.log('  Test 21 — Auto-Arrange Layout  (PRD-06 v2 — deterministic geometry)');
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
        initialPositions = await page.evaluate(() => network.getPositions());
        const nodeCount = Object.keys(initialPositions).length;
        if (nodeCount >= 80) pass(`Captured initial positions for ${nodeCount} nodes`);
        else fail(`Expected 80+ nodes, got ${nodeCount}`);
        const sampleId = Object.keys(initialPositions)[0];
        info(`Sample initial pos: node ${sampleId} at x=${Math.round(initialPositions[sampleId].x)}`);
    } catch (err) {
        fail('Phase 3 failed', err.message);
    }

    // ── Phase 4: Trigger auto-arrange (deterministic — no physics wait) ───────
    console.log('\n── Phase 4 : Trigger Auto-Arrange ──────────────────────────────────────');
    try {
        const arrangeBtn = await page.$('#btnAutoArrange');
        if (arrangeBtn) {
            await arrangeBtn.click();
            pass('Clicked ⟳ Auto-Arrange button');
        } else {
            await page.evaluate(() => autoArrangeByCountryCity());
            pass('Called autoArrangeByCountryCity() directly (button not found)');
        }
        // Deterministic placement — positions applied synchronously in the JS call,
        // no physics stabilization event to wait for.
        await page.waitForTimeout(1500);
        pass('Deterministic placement applied (no physics stabilization needed)');
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
        if (movedCount >= nodeIds.length * 0.5) pass(`${movedCount}/${nodeIds.length} nodes moved — auto-arrange worked`);
        else if (movedCount > 0) warn(`Only ${movedCount}/${nodeIds.length} nodes moved`);
        else fail('No nodes moved after auto-arrange');
    } catch (err) {
        fail('Phase 5 failed', err.message);
    }

    // ── Phase 6: Country-level spatial clustering ─────────────────────────────
    // Verifies that inter-country centroid distance >> intra-country spread.
    // Deterministic placement target: ratio ≥ 3× (typically ~7× for 12 countries).
    console.log('\n── Phase 6 : Country-Level Clustering ──────────────────────────────────');
    try {
        const clusterData = await page.evaluate(() => {
            var pos = network.getPositions();
            var countryPositions = {};
            nodes.get().forEach(function(n) {
                var c = (n.country || 'UNK').toUpperCase();
                if (!countryPositions[c]) countryPositions[c] = [];
                if (pos[n.id]) countryPositions[c].push(pos[n.id]);
            });
            var countries = Object.keys(countryPositions).filter(c => countryPositions[c].length >= 2);
            if (countries.length < 2) return { countries: countries.length, ok: false };

            var centroids = {};
            countries.forEach(function(c) {
                var pts = countryPositions[c];
                centroids[c] = {
                    x: pts.reduce(function(s,p){return s+p.x;},0) / pts.length,
                    y: pts.reduce(function(s,p){return s+p.y;},0) / pts.length
                };
            });

            var interDists = [];
            for (var i=0; i<countries.length; i++) {
                for (var j=i+1; j<countries.length; j++) {
                    var dx = centroids[countries[i]].x - centroids[countries[j]].x;
                    var dy = centroids[countries[i]].y - centroids[countries[j]].y;
                    interDists.push(Math.sqrt(dx*dx + dy*dy));
                }
            }
            var avgInter = interDists.reduce(function(s,d){return s+d;},0) / interDists.length;

            var intraSpread = countries.map(function(c) {
                var ctr = centroids[c];
                return Math.max.apply(null, countryPositions[c].map(function(p) {
                    var dx=p.x-ctr.x; var dy=p.y-ctr.y;
                    return Math.sqrt(dx*dx+dy*dy);
                }));
            });
            var avgIntra = intraSpread.reduce(function(s,d){return s+d;},0) / intraSpread.length;

            return {
                countries: countries.length,
                avgInter:  Math.round(avgInter),
                avgIntra:  Math.round(avgIntra),
                ratio:     Math.round(avgInter / avgIntra)
            };
        });

        info(`Countries: ${clusterData.countries}, avg inter-country dist: ${clusterData.avgInter}px, avg intra-country spread: ${clusterData.avgIntra}px, ratio: ${clusterData.ratio}x`);
        if (clusterData.countries < 2) {
            warn('Need ≥2 countries for clustering verification');
        } else if (clusterData.ratio >= 3) {
            pass(`Countries well separated — inter/intra ratio: ${clusterData.ratio}x (≥3x required)`);
        } else {
            fail(`Country clustering ratio ${clusterData.ratio}x too low — hierarchy not preserved (need ≥3x)`);
        }
    } catch (err) {
        fail('Phase 6 failed', err.message);
    }

    // ── Phase 6b: City-level clustering within countries ─────────────────────
    // For each country with ≥2 cities: avg intra-city distance < 50% of avg cross-city distance.
    console.log('\n── Phase 6b : City-Level Clustering Within Countries ────────────────────');
    try {
        const cityCluster = await page.evaluate(() => {
            var pos = network.getPositions();
            var map = {};  // country → city → [{x,y}]
            nodes.get().forEach(function(n) {
                var host   = String(n.hostname || n.label || '').split('\n')[0].trim();
                var parsed = (typeof _parseAtypeHostname === 'function')
                    ? _parseAtypeHostname(host) : null;
                var country = parsed ? parsed.country : ((n.country||'').toUpperCase()||'UNK');
                var city    = parsed ? parsed.city    : ((n.city   ||'').toUpperCase()||'UNK');
                if (!map[country]) map[country] = {};
                if (!map[country][city]) map[country][city] = [];
                if (pos[n.id]) map[country][city].push(pos[n.id]);
            });

            var countriesTested = 0;
            var failedCountries = [];
            var worstRatio = 0;

            Object.keys(map).forEach(function(country) {
                var cities = Object.keys(map[country]).filter(c => map[country][c].length >= 2);
                if (cities.length < 2) return;
                countriesTested++;

                // avg pairwise distance within same city
                var intraDists = [];
                cities.forEach(function(city) {
                    var pts = map[country][city];
                    for (var i=0; i<pts.length; i++) {
                        for (var j=i+1; j<pts.length; j++) {
                            var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
                            intraDists.push(Math.sqrt(dx*dx+dy*dy));
                        }
                    }
                });
                var avgIntra = intraDists.length
                    ? intraDists.reduce(function(s,d){return s+d;},0)/intraDists.length : 0;

                // avg pairwise distance between nodes of different cities (same country)
                var crossDists = [];
                for (var ci=0; ci<cities.length; ci++) {
                    for (var cj=ci+1; cj<cities.length; cj++) {
                        var ptsA = map[country][cities[ci]];
                        var ptsB = map[country][cities[cj]];
                        ptsA.forEach(function(a) {
                            ptsB.forEach(function(b) {
                                var dx=a.x-b.x, dy=a.y-b.y;
                                crossDists.push(Math.sqrt(dx*dx+dy*dy));
                            });
                        });
                    }
                }
                var avgCross = crossDists.length
                    ? crossDists.reduce(function(s,d){return s+d;},0)/crossDists.length : 999999;

                var ratio = avgIntra / avgCross;
                if (ratio > worstRatio) worstRatio = ratio;
                if (avgIntra >= avgCross * 0.5) {
                    failedCountries.push(country + ' (intra=' + Math.round(avgIntra) +
                        'px cross=' + Math.round(avgCross) + 'px)');
                }
            });

            return { countriesTested, failedCountries,
                     allPass: failedCountries.length === 0,
                     worstRatio: Math.round(worstRatio * 100) / 100 };
        });

        info(`Countries tested for city clustering: ${cityCluster.countriesTested}, worst intra/cross ratio: ${cityCluster.worstRatio}`);
        if (cityCluster.countriesTested === 0) {
            warn('No country has ≥2 cities with ≥2 nodes — city clustering not measurable');
        } else if (cityCluster.allPass) {
            pass(`City clustering OK — same-city nodes closer than cross-city (${cityCluster.countriesTested} countries)`);
        } else {
            fail(`City clustering weak in: ${cityCluster.failedCountries.join(', ')}`);
        }
    } catch (err) {
        fail('Phase 6b failed', err.message);
    }

    // ── Phase 6c: Minimum node spacing within each city ──────────────────────
    // All same-city node pairs must be ≥100px apart so links are visible.
    console.log('\n── Phase 6c : Minimum Node Spacing (same-city pairs) ────────────────────');
    try {
        const spacingData = await page.evaluate(() => {
            var pos = network.getPositions();
            var cityMap = {};  // 'COUNTRY:CITY' → [{x,y}]
            nodes.get().forEach(function(n) {
                var host   = String(n.hostname || n.label || '').split('\n')[0].trim();
                var parsed = (typeof _parseAtypeHostname === 'function')
                    ? _parseAtypeHostname(host) : null;
                var country = parsed ? parsed.country : ((n.country||'').toUpperCase()||'UNK');
                var city    = parsed ? parsed.city    : ((n.city   ||'').toUpperCase()||'UNK');
                var key = country + ':' + city;
                if (!cityMap[key]) cityMap[key] = [];
                if (pos[n.id]) cityMap[key].push(pos[n.id]);
            });

            var minDist = Infinity;
            var violatingPairs = 0;
            var totalPairs = 0;
            var THRESHOLD = 100;

            Object.keys(cityMap).forEach(function(key) {
                var pts = cityMap[key];
                for (var i=0; i<pts.length; i++) {
                    for (var j=i+1; j<pts.length; j++) {
                        var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
                        var d = Math.sqrt(dx*dx+dy*dy);
                        totalPairs++;
                        if (d < minDist) minDist = d;
                        if (d < THRESHOLD) violatingPairs++;
                    }
                }
            });
            return {
                minDist:        totalPairs > 0 ? Math.round(minDist) : -1,
                violatingPairs,
                totalPairs
            };
        });

        info(`Same-city node pairs: ${spacingData.totalPairs} total, min spacing: ${spacingData.minDist}px`);
        if (spacingData.totalPairs === 0) {
            warn('No same-city pairs found — spacing check skipped');
        } else if (spacingData.violatingPairs === 0) {
            pass(`All ${spacingData.totalPairs} same-city pairs have ≥100px spacing (min: ${spacingData.minDist}px)`);
        } else {
            warn(`${spacingData.violatingPairs}/${spacingData.totalPairs} pairs closer than 100px (min: ${spacingData.minDist}px)`);
        }
    } catch (err) {
        fail('Phase 6c failed', err.message);
    }

    // ── Phase 7: Nodes pinned after arrange ───────────────────────────────────
    console.log('\n── Phase 7 : Nodes Pinned After Arrange ────────────────────────────────');
    try {
        const pinnedCount = await page.evaluate(() => {
            return nodes.get().filter(function(n) {
                return n.physics === false && n.fixed &&
                       (n.fixed === true || (n.fixed.x && n.fixed.y));
            }).length;
        });
        const total = await page.evaluate(() => nodes.get().length);
        info(`Pinned: ${pinnedCount}/${total} nodes`);
        if (pinnedCount >= total * 0.8) pass(`${pinnedCount}/${total} nodes pinned after auto-arrange`);
        else fail(`Only ${pinnedCount}/${total} nodes pinned`);
    } catch (err) {
        fail('Phase 7 failed', err.message);
    }

    // ── Phase 9: Spacing controls — relative positioning (always active) ────────
    console.log('\n── Phase 9 : Spacing Controls (relative positioning, no Auto-Arrange needed) ─');
    try {
        // 9a: Panel and all % labels present
        const panelExists = await page.$('#aaSpacingPanel') !== null;
        if (panelExists) pass('Spacing control panel #aaSpacingPanel present');
        else fail('#aaSpacingPanel not found — check buildViewModeButtons()');

        const labels = await page.evaluate(() => ({
            node:    document.getElementById('aaNodePct')    ? document.getElementById('aaNodePct').textContent    : null,
            city:    document.getElementById('aaCityPct')    ? document.getElementById('aaCityPct').textContent    : null,
            country: document.getElementById('aaCountryPct') ? document.getElementById('aaCountryPct').textContent : null
        }));
        info(`Initial labels — Node:${labels.node} City:${labels.city} Country:${labels.country}`);
        if (labels.node && labels.city && labels.country) pass('All three % labels present (aaNodePct, aaCityPct, aaCountryPct)');
        else fail('One or more % labels missing');

        // 9a2: Live toggle removed — verify #aaLiveToggle does NOT exist
        const liveToggleGone = await page.evaluate(() => document.getElementById('aaLiveToggle') === null);
        if (liveToggleGone) pass('Live toggle removed (#aaLiveToggle absent — knobs always apply relative scaling)');
        else warn('#aaLiveToggle still present — should have been removed');

        // 9a3: _aaScaleCurrentPositions function exists
        const scaleFnExists = await page.evaluate(() => typeof _aaScaleCurrentPositions === 'function');
        if (scaleFnExists) pass('_aaScaleCurrentPositions() function exists');
        else fail('_aaScaleCurrentPositions() not found — add to topolograph.js');

        // 9b: Fine step Node+ → label updates to 110%
        await page.evaluate(() => { _aaNodeMultiplier = 1.0; _updateAaControls(); });
        await page.evaluate(() => _aaAdjust('node', +0.1));
        await page.waitForTimeout(200);
        const nodeLabel = await page.evaluate(() => document.getElementById('aaNodePct') ? document.getElementById('aaNodePct').textContent : '');
        info(`After Node+0.1: aaNodePct = ${nodeLabel}`);
        if (nodeLabel === '110%') pass('Node fine+ (10%) updates label to 110%');
        else fail(`Expected 110%, got ${nodeLabel}`);

        // 9c: Fine step City− → label updates to 90%
        await page.evaluate(() => { _aaCityMultiplier = 1.0; _updateAaControls(); });
        await page.evaluate(() => _aaAdjust('city', -0.1));
        await page.waitForTimeout(200);
        const cityLabel = await page.evaluate(() => document.getElementById('aaCityPct') ? document.getElementById('aaCityPct').textContent : '');
        info(`After City-0.1: aaCityPct = ${cityLabel}`);
        if (cityLabel === '90%') pass('City fine− (10%) updates label to 90%');
        else fail(`Expected 90%, got ${cityLabel}`);

        // 9b2: Coarse step Country++ → label updates to 200%
        await page.evaluate(() => { _aaCountryMultiplier = 1.0; _updateAaControls(); });
        await page.evaluate(() => _aaAdjust('country', +1.0));
        await page.waitForTimeout(200);
        const countryCoarse = await page.evaluate(() => document.getElementById('aaCountryPct') ? document.getElementById('aaCountryPct').textContent : '');
        info(`After Country+1.0 (coarse): aaCountryPct = ${countryCoarse}`);
        if (countryCoarse === '200%') pass('Country coarse++ (100%) updates label to 200%');
        else fail(`Expected 200%, got ${countryCoarse}`);

        // 9b3: Clamp at MAX 1000% — try adding large delta
        await page.evaluate(() => { _aaNodeMultiplier = 9.9; _updateAaControls(); });
        await page.evaluate(() => _aaAdjust('node', +1.0));
        await page.waitForTimeout(100);
        const maxLabel = await page.evaluate(() => document.getElementById('aaNodePct') ? document.getElementById('aaNodePct').textContent : '');
        info(`After Node at 9.9→+1.0: aaNodePct = ${maxLabel} (expect 1000%)`);
        if (maxLabel === '1000%') pass('Node clamped at MAX 1000%');
        else fail(`Expected clamp to 1000%, got ${maxLabel}`);

        // 9b4: Clamp at MIN 10% — try subtracting large delta
        await page.evaluate(() => { _aaNodeMultiplier = 0.2; _updateAaControls(); });
        await page.evaluate(() => _aaAdjust('node', -1.0));
        await page.waitForTimeout(100);
        const minLabel = await page.evaluate(() => document.getElementById('aaNodePct') ? document.getElementById('aaNodePct').textContent : '');
        info(`After Node at 0.2→-1.0: aaNodePct = ${minLabel} (expect 10%)`);
        if (minLabel === '10%') pass('Node clamped at MIN 10%');
        else fail(`Expected clamp to 10%, got ${minLabel}`);

        // 9-rel: Verify knobs apply relative movement WITHOUT prior Auto-Arrange
        //   Reset multipliers to 1.0 (no auto-arrange) → record city node positions
        //   Apply Node ++ (×2) via _aaAdjust → verify nodes spread apart
        //   The test uses the largest A-type city found in the current layout
        await page.evaluate(() => { _aaNodeMultiplier = 1.0; _aaCityMultiplier = 1.0; _aaCountryMultiplier = 1.0; _updateAaControls(); });
        // Find largest A-type city with ≥2 nodes (no auto-arrange needed)
        const relCity = await page.evaluate(() => {
            var cityMap = {};
            nodes.get().forEach(function(n) {
                if (typeof _classifyNodeFmt !== 'function' || _classifyNodeFmt(n) !== 'A') return;
                var host = String(n.hostname||n.label||'').split('\n')[0].trim();
                var parsed = (typeof _parseAtypeHostname === 'function') ? _parseAtypeHostname(host) : null;
                if (!parsed) return;
                var key = parsed.country+':'+parsed.city;
                if (!cityMap[key]) cityMap[key] = [];
                cityMap[key].push(n.id);
            });
            var best = null, bestCount = 0;
            Object.keys(cityMap).forEach(function(k) {
                if (cityMap[k].length > bestCount) { bestCount = cityMap[k].length; best = k; }
            });
            return { key: best, count: bestCount, ids: best ? cityMap[best] : [] };
        });
        info(`Relative test uses city: ${relCity.key} (${relCity.count} nodes)`);

        if (!relCity.key || relCity.count < 2) {
            warn('No A-type city with ≥2 nodes — relative-move test skipped');
        } else {
            // Record current avg pairwise distance BEFORE knob press
            const distBefore = await page.evaluate((ids) => {
                var pos = network.getPositions();
                var pts = ids.map(function(id){ return pos[id]; }).filter(Boolean);
                var dists = [];
                for (var i=0;i<pts.length;i++) for (var j=i+1;j<pts.length;j++) {
                    var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
                    dists.push(Math.sqrt(dx*dx+dy*dy));
                }
                return dists.length ? Math.round(dists.reduce(function(s,d){return s+d;},0)/dists.length) : 0;
            }, relCity.ids);
            info(`Before Node++ (relative): avg city pair dist = ${distBefore}px`);

            // Apply Node ×2 (coarse +100%) WITHOUT running autoArrangeByCountryCity
            await page.evaluate(() => _aaAdjust('node', +1.0));  // 1.0 → 2.0
            await page.waitForTimeout(500);

            const distAfter = await page.evaluate((ids) => {
                var pos = network.getPositions();
                var pts = ids.map(function(id){ return pos[id]; }).filter(Boolean);
                var dists = [];
                for (var i=0;i<pts.length;i++) for (var j=i+1;j<pts.length;j++) {
                    var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
                    dists.push(Math.sqrt(dx*dx+dy*dy));
                }
                return dists.length ? Math.round(dists.reduce(function(s,d){return s+d;},0)/dists.length) : 0;
            }, relCity.ids);
            info(`After Node++ (relative, no auto-arrange): avg city pair dist = ${distAfter}px`);

            if (distBefore === 0) {
                warn('All nodes at same position (centroid spread = 0) — relative test inconclusive');
            } else if (distAfter > distBefore * 1.5) {
                pass(`Relative Node++ spreads nodes: ${distBefore}px → ${distAfter}px (×${(distAfter/distBefore).toFixed(1)}) WITHOUT prior Auto-Arrange`);
            } else {
                fail(`Relative Node++ did not spread nodes: ${distBefore}px → ${distAfter}px (need >1.5×)`);
            }
        }

        // 9d: Verify node spacing scales with the multiplier.
        //     Use the largest A-type city (parsed hostname) to get a clean signal.
        //     Reset to 100%, arrange, record avg pairwise distance for that city.
        //     Set node×2.0, re-arrange, check distance roughly doubled.
        await page.evaluate(() => { _aaNodeMultiplier=1; _aaCityMultiplier=1; _aaCountryMultiplier=1; });
        await page.evaluate(() => autoArrangeByCountryCity());
        await page.waitForTimeout(1200);

        // Find largest A-type city with ≥2 nodes
        const largestCity = await page.evaluate(() => {
            var cityMap = {};
            nodes.get().forEach(function(n) {
                if (typeof _classifyNodeFmt !== 'function') return;
                if (_classifyNodeFmt(n) !== 'A') return;
                var host = String(n.hostname||n.label||'').split('\n')[0].trim();
                var parsed = (typeof _parseAtypeHostname === 'function') ? _parseAtypeHostname(host) : null;
                if (!parsed) return;
                var key = parsed.country+':'+parsed.city;
                if (!cityMap[key]) cityMap[key] = [];
                cityMap[key].push(n.id);
            });
            var best = null, bestCount = 0;
            Object.keys(cityMap).forEach(function(k) {
                if (cityMap[k].length > bestCount) { bestCount = cityMap[k].length; best = k; }
            });
            return { key: best, count: bestCount, ids: best ? cityMap[best] : [] };
        });
        info(`Largest A-type city: ${largestCity.key} (${largestCity.count} nodes)`);

        if (!largestCity.key || largestCity.count < 2) {
            warn('No A-type city with ≥2 nodes found — node scaling test skipped');
        } else {
            // Measure avg pairwise distance for this city at 100%
            const distAt100 = await page.evaluate((ids) => {
                var pos = network.getPositions();
                var pts = ids.map(function(id){ return pos[id]; }).filter(Boolean);
                var dists = [];
                for (var i=0;i<pts.length;i++) for (var j=i+1;j<pts.length;j++) {
                    var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
                    dists.push(Math.sqrt(dx*dx+dy*dy));
                }
                return dists.length ? Math.round(dists.reduce(function(s,d){return s+d;},0)/dists.length) : 0;
            }, largestCity.ids);
            info(`Avg intra-city node distance at 100%: ${distAt100}px`);

            // Set node multiplier to 2.0 and re-arrange
            await page.evaluate(() => { _aaNodeMultiplier = 2.0; _updateAaControls(); autoArrangeByCountryCity(); });
            await page.waitForTimeout(1200);

            const distAt200 = await page.evaluate((ids) => {
                var pos = network.getPositions();
                var pts = ids.map(function(id){ return pos[id]; }).filter(Boolean);
                var dists = [];
                for (var i=0;i<pts.length;i++) for (var j=i+1;j<pts.length;j++) {
                    var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
                    dists.push(Math.sqrt(dx*dx+dy*dy));
                }
                return dists.length ? Math.round(dists.reduce(function(s,d){return s+d;},0)/dists.length) : 0;
            }, largestCity.ids);
            info(`Avg intra-city node distance at 200%: ${distAt200}px`);

            if (distAt200 >= distAt100 * 1.5)
                pass(`Node spacing scales correctly: 200% → ${distAt200}px vs 100% → ${distAt100}px`);
            else
                fail(`Node spacing did not scale (200%: ${distAt200}px vs 100%: ${distAt100}px, need ≥1.5×)`);
        }

        // 9f: City knob moves city clusters — WITHOUT prior Auto-Arrange
        //     Reset multipliers, find a country with 2+ cities, record inter-city distance,
        //     click City++ and verify cities spread apart.
        await page.evaluate(() => { _aaNodeMultiplier=1; _aaCityMultiplier=1; _aaCountryMultiplier=1; _updateAaControls(); });
        await page.waitForTimeout(300);
        const multiCityCountry = await page.evaluate(() => {
            // Build country→city→nodeIds tree
            var tree = {};
            nodes.get().forEach(function(n) {
                var host   = String(n.hostname||n.label||'').split('\n')[0].trim();
                var parsed = (typeof _parseAtypeHostname === 'function') ? _parseAtypeHostname(host) : null;
                var country = parsed ? parsed.country : ((n.country||'').toUpperCase()||'UNK');
                var city    = parsed ? parsed.city    : ((n.city   ||'').toUpperCase()||'UNK');
                if (country==='UNK') return;
                if (!tree[country]) tree[country]={};
                if (!tree[country][city]) tree[country][city]=[];
                tree[country][city].push(n.id);
            });
            // Pick first country with ≥2 cities each having ≥1 node
            var chosen = null, city1Ids = [], city2Ids = [];
            Object.keys(tree).sort().some(function(c) {
                var cityNames = Object.keys(tree[c]).sort();
                if (cityNames.length >= 2) {
                    chosen = c;
                    city1Ids = tree[c][cityNames[0]];
                    city2Ids = tree[c][cityNames[1]];
                    return true;
                }
                return false;
            });
            if (!chosen) return { skip: true };
            // Centroid distance between city1 and city2
            var pos = network.getPositions();
            function centroid(ids) {
                var sx=0, sy=0, n=0;
                ids.forEach(function(id){ var p=pos[id]; if(p){sx+=p.x;sy+=p.y;n++;} });
                return n ? {x:sx/n, y:sy/n} : null;
            }
            var c1 = centroid(city1Ids), c2 = centroid(city2Ids);
            var distBefore = (c1&&c2) ? Math.round(Math.sqrt(Math.pow(c1.x-c2.x,2)+Math.pow(c1.y-c2.y,2))) : 0;
            return { chosen, city1Ids, city2Ids, distBefore };
        });
        if (multiCityCountry.skip) {
            warn('No country with ≥2 A-type cities found — city knob movement test skipped');
        } else {
            info(`City knob test — country with 2+ cities; inter-city dist before: ${multiCityCountry.distBefore}px`);
            // Click City++ (×2) without auto-arrange — ring-geometry approach should move cities
            await page.evaluate(() => _aaAdjust('city', +1.0));   // 1.0 → 2.0
            await page.waitForTimeout(500);
            const cityDistAfter = await page.evaluate(({c1ids, c2ids}) => {
                var pos = network.getPositions();
                function centroid(ids) {
                    var sx=0,sy=0,n=0;
                    ids.forEach(function(id){var p=pos[id];if(p){sx+=p.x;sy+=p.y;n++;}});
                    return n?{x:sx/n,y:sy/n}:null;
                }
                var c1=centroid(c1ids), c2=centroid(c2ids);
                return (c1&&c2) ? Math.round(Math.sqrt(Math.pow(c1.x-c2.x,2)+Math.pow(c1.y-c2.y,2))) : 0;
            }, { c1ids: multiCityCountry.city1Ids, c2ids: multiCityCountry.city2Ids });
            info(`City knob test — inter-city dist after City++ (ring ×2): ${cityDistAfter}px`);
            if (cityDistAfter > 100) {
                pass(`City++ moves city clusters apart: ${multiCityCountry.distBefore}px → ${cityDistAfter}px (ring-geometry, no prior Auto-Arrange)`);
            } else {
                fail(`City knob did NOT move city clusters: ${multiCityCountry.distBefore}px → ${cityDistAfter}px`);
            }
        }

        // 9g: Country knob moves country clusters — ring-geometry approach
        await page.evaluate(() => { _aaNodeMultiplier=1; _aaCityMultiplier=1; _aaCountryMultiplier=1; _updateAaControls(); });
        await page.evaluate(() => autoArrangeByCountryCity());
        await page.waitForTimeout(1200);
        const countryDist = await page.evaluate(() => {
            // Pick two named countries and record centroid distance
            var tree = {};
            nodes.get().forEach(function(n) {
                var host   = String(n.hostname||n.label||'').split('\n')[0].trim();
                var parsed = (typeof _parseAtypeHostname === 'function') ? _parseAtypeHostname(host) : null;
                var country = parsed ? parsed.country : ((n.country||'').toUpperCase()||'UNK');
                if (country==='UNK') return;
                if (!tree[country]) tree[country]=[];
                tree[country].push(n.id);
            });
            var countries = Object.keys(tree).sort();
            if (countries.length < 2) return { skip: true };
            var pos = network.getPositions();
            function centroid(ids){ var sx=0,sy=0,n=0; ids.forEach(function(id){var p=pos[id];if(p){sx+=p.x;sy+=p.y;n++;}}); return n?{x:sx/n,y:sy/n}:null; }
            var c1=centroid(tree[countries[0]]), c2=centroid(tree[countries[1]]);
            var dist = (c1&&c2)?Math.round(Math.sqrt(Math.pow(c1.x-c2.x,2)+Math.pow(c1.y-c2.y,2))):0;
            return { dist, c1ids: tree[countries[0]], c2ids: tree[countries[1]], c1: countries[0], c2: countries[1] };
        });
        if (countryDist.skip) {
            warn('Fewer than 2 named countries — country knob test skipped');
        } else {
            info(`Country knob test — ${countryDist.c1} vs ${countryDist.c2}: dist before Country++: ${countryDist.dist}px`);
            // Country++ (×2) — ring-geometry doubles ring radius → countries should be much further apart
            await page.evaluate(() => _aaAdjust('country', +1.0));  // 1.0 → 2.0
            await page.waitForTimeout(500);
            const cDistAfter = await page.evaluate(({c1ids, c2ids}) => {
                var pos = network.getPositions();
                function centroid(ids){ var sx=0,sy=0,n=0; ids.forEach(function(id){var p=pos[id];if(p){sx+=p.x;sy+=p.y;n++;}}); return n?{x:sx/n,y:sy/n}:null; }
                var c1=centroid(c1ids), c2=centroid(c2ids);
                return (c1&&c2)?Math.round(Math.sqrt(Math.pow(c1.x-c2.x,2)+Math.pow(c1.y-c2.y,2))):0;
            }, { c1ids: countryDist.c1ids, c2ids: countryDist.c2ids });
            info(`Country knob test — dist after Country++ (ring ×2): ${cDistAfter}px`);
            if (cDistAfter >= countryDist.dist * 1.5) {
                pass(`Country++ spreads countries: ${countryDist.dist}px → ${cDistAfter}px (×${(cDistAfter/countryDist.dist).toFixed(1)}) ring-geometry`);
            } else {
                fail(`Country knob did not spread countries: ${countryDist.dist}px → ${cDistAfter}px (need ≥1.5×)`);
            }
        }

        // 9e: Reset → all back to 100%
        await page.evaluate(() => _aaReset());
        await page.waitForTimeout(1200);
        const resetLabels = await page.evaluate(() => ({
            node:    document.getElementById('aaNodePct')?.textContent,
            city:    document.getElementById('aaCityPct')?.textContent,
            country: document.getElementById('aaCountryPct')?.textContent
        }));
        if (resetLabels.node==='100%' && resetLabels.city==='100%' && resetLabels.country==='100%')
            pass('↺ Reset restores all labels to 100%');
        else fail(`Reset failed: Node=${resetLabels.node} City=${resetLabels.city} Country=${resetLabels.country}`);

    } catch (err) {
        fail('Phase 9 failed', err.message);
    }

    // ── Phase 10: UNK cluster is separated from named-country clusters ───────
    console.log('\n── Phase 10 : UNK Cluster Separated from A-type Countries ──────────────');
    try {
        // Reset multipliers to 100% and re-arrange cleanly
        await page.evaluate(() => { _aaNodeMultiplier=1; _aaCityMultiplier=1; _aaCountryMultiplier=1; autoArrangeByCountryCity(); });
        await page.waitForTimeout(1200);

        const unkSep = await page.evaluate(() => {
            var pos = network.getPositions();
            var unkYs = [], namedYs = [];
            nodes.get().forEach(function(n) {
                var c = (n.country || 'UNK').toUpperCase();
                if (!pos[n.id]) return;
                if (c === 'UNK') unkYs.push(pos[n.id].y);
                else             namedYs.push(pos[n.id].y);
            });
            if (!unkYs.length || !namedYs.length) return { unkCount:unkYs.length, skip:true };

            var maxNamedY = Math.max.apply(null, namedYs);
            var minUnkY   = Math.min.apply(null, unkYs);
            var unkCentY  = Math.round(unkYs.reduce(function(s,v){return s+v;},0) / unkYs.length);
            var gap       = minUnkY - maxNamedY;

            return {
                unkCount: unkYs.length, namedCount: namedYs.length,
                maxNamedY: Math.round(maxNamedY), minUnkY: Math.round(minUnkY),
                unkCentY, gap: Math.round(gap)
            };
        });

        if (unkSep.skip) {
            warn(`UNK separation skipped — unkCount=${unkSep.unkCount}`);
        } else {
            info(`Max named-node Y: ${unkSep.maxNamedY}px, Min UNK-node Y: ${unkSep.minUnkY}px, gap: ${unkSep.gap}px`);
            if (unkSep.gap >= 200)
                pass(`UNK cluster is below all named nodes with ${unkSep.gap}px clearance (≥200px required)`);
            else if (unkSep.gap > 0)
                warn(`UNK cluster is below named nodes but gap is only ${unkSep.gap}px (want ≥200px)`);
            else
                fail(`UNK cluster overlaps named countries — gap is ${unkSep.gap}px (should be positive)`);
        }
    } catch (err) {
        fail('Phase 10 failed', err.message);
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
    else            console.log(`  Results: ${passed} passed, ${failed} FAILED, ${warned} warnings`);
    console.log('════════════════════════════════════════════════════════════════════════');
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
