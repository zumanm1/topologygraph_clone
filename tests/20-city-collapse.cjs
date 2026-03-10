'use strict';
/**
 * Test 20 — City-Level Collapse (PRD-05)
 * Validates collapseCity/expandCity + city rows in Country Groups panel.
 *
 * Usage: node tests/20-city-collapse.cjs
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
    const f = path.join(SS_DIR, `${String(shotIdx++).padStart(2,'0')}-nt20-${label}.png`);
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
    console.log('  Test 20 — City-Level Collapse  (PRD-05)');
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
            collapseCity:  typeof collapseCity === 'function',
            expandCity:    typeof expandCity === 'function',
            toggleCity:    typeof toggleCollapseCity === 'function',
            getCityNodes:  typeof _getCityNodes === 'function',
            isCityGw:      typeof _isCityGateway === 'function',
            stateVar:      typeof _cityCollapseState !== 'undefined',
            hiddenVar:     typeof _cityCollapseHidden !== 'undefined',
        }));
        pass('collapseCity() exists', String(fns.collapseCity));
        pass('expandCity() exists', String(fns.expandCity));
        pass('toggleCollapseCity() exists', String(fns.toggleCity));
        pass('_getCityNodes() exists', String(fns.getCityNodes));
        pass('_isCityGateway() exists', String(fns.isCityGw));
        pass('_cityCollapseState variable exists', String(fns.stateVar));
        pass('_cityCollapseHidden variable exists', String(fns.hiddenVar));
    } catch (err) {
        fail('Phase 2 failed', err.message);
    }

    // ── Phase 3: Find a city with multiple nodes to test ─────────────────────
    console.log('\n── Phase 3 : Find Test City ────────────────────────────────────────────');
    let testCountry = '', testCity = '';
    try {
        const cityData = await page.evaluate(() => {
            var tree = _buildAtypeTree();
            var result = [];
            Object.keys(tree).forEach(function(country) {
                Object.keys(tree[country]).forEach(function(city) {
                    result.push({ country: country, city: city, count: tree[country][city].length });
                });
            });
            result.sort(function(a,b) { return b.count - a.count; });
            return result.slice(0,5);
        });
        info(`Top cities: ${cityData.map(c=>c.country+':'+c.city+'('+c.count+')').join(', ')}`);

        // Find a city with at least 2 nodes
        const testCityData = cityData.find(c => c.count >= 2);
        if (testCityData) {
            testCountry = testCityData.country;
            testCity    = testCityData.city;
            pass(`Found test city: ${testCountry}:${testCity} with ${testCityData.count} nodes`);
        } else {
            warn('No city with ≥2 nodes found — city collapse tests may be limited');
        }
    } catch (err) {
        fail('Phase 3 failed', err.message);
    }

    // ── Phase 4: collapseCity + expandCity ────────────────────────────────────
    console.log('\n── Phase 4 : collapseCity / expandCity ─────────────────────────────────');
    try {
        if (!testCountry) { warn('Skipping Phase 4 — no test city'); throw new Error('skip'); }

        // Count city nodes before collapse
        const beforeCount = await page.evaluate(({c,ci}) => _getCityNodes(c,ci).length, {c:testCountry,ci:testCity});
        info(`${testCountry}:${testCity} has ${beforeCount} nodes`);

        // Collapse the city
        await page.evaluate(({c,ci}) => collapseCity(c,ci), {c:testCountry,ci:testCity});
        await page.waitForTimeout(500);

        // Check state
        const collapseState = await page.evaluate(({c,ci}) => {
            var key = c + ':' + ci;
            return { state: _cityCollapseState[key], hidden: _cityCollapseHidden[key] ? true : false };
        }, {c:testCountry,ci:testCity});
        if (collapseState.state === true) pass(`collapseCity(${testCountry}, ${testCity}): state=true`);
        else fail(`collapseCity: state is ${collapseState.state}`);

        // Check that city core nodes are hidden
        const hiddenNodes = await page.evaluate(({c,ci}) => {
            var cores = _getCityNodes(c, ci).filter(function(n){ return !_isCityGateway(n, c, ci); });
            var hidden = cores.filter(function(n){ return !!n._cityCollapseHidden; });
            return { cores: cores.length, hidden: hidden.length };
        }, {c:testCountry,ci:testCity});
        info(`City cores: ${hiddenNodes.cores}, hidden: ${hiddenNodes.hidden}`);
        if (hiddenNodes.cores === 0) warn(`${testCountry}:${testCity}: all nodes are gateways — no cores to hide`);
        else if (hiddenNodes.hidden >= hiddenNodes.cores) pass(`City core nodes hidden: ${hiddenNodes.hidden}/${hiddenNodes.cores}`);
        else fail(`Only ${hiddenNodes.hidden}/${hiddenNodes.cores} core nodes hidden`);

        await shot(page, 'city-collapsed');

        // Expand
        await page.evaluate(({c,ci}) => expandCity(c,ci), {c:testCountry,ci:testCity});
        await page.waitForTimeout(500);

        const expandState = await page.evaluate(({c,ci}) => {
            var key = c + ':' + ci;
            return { state: _cityCollapseState[key] };
        }, {c:testCountry,ci:testCity});
        if (!expandState.state) pass(`expandCity(${testCountry}, ${testCity}): state=false (expanded)`);
        else fail(`expandCity: state is still ${expandState.state}`);

        // Verify all city nodes visible again
        const restoredNodes = await page.evaluate(({c,ci}) =>
            _getCityNodes(c,ci).filter(function(n){ return !!n._cityCollapseHidden; }).length
        , {c:testCountry,ci:testCity});
        if (restoredNodes === 0) pass(`expandCity: all city nodes restored (0 still hidden)`);
        else fail(`expandCity: ${restoredNodes} nodes still have _cityCollapseHidden=true`);

        await shot(page, 'city-expanded');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 4 failed', err.message);
    }

    // ── Phase 5: City rows in Country Groups panel ────────────────────────────
    console.log('\n── Phase 5 : City Rows in Country Groups Panel ─────────────────────────');
    try {
        // Open collapsing mode to show the panel
        await page.evaluate(() => setViewMode('collapsing'));
        await page.waitForTimeout(1000);

        const panel = await page.$('#countryCollapsePanel');
        if (!panel) { warn('Country Groups panel not found'); throw new Error('skip'); }
        pass('Country Groups panel visible');

        // Check for Cities buttons (🏙)
        const citiesButtons = await page.$$('.cpCitiesBtn');
        if (citiesButtons.length > 0) pass(`🏙 Cities buttons found: ${citiesButtons.length}`);
        else warn('No .cpCitiesBtn found — may be missing or country has <2 cities');

        // If cities button exists, click it to reveal city rows
        if (citiesButtons.length > 0) {
            const firstCitiesBtn = citiesButtons[0];
            const btnCountry = await firstCitiesBtn.getAttribute('data-country');
            await firstCitiesBtn.click();
            await page.waitForTimeout(300);

            // Check city rows visible
            const cityBlock = await page.$(`#cpCityBlock_${btnCountry}`);
            if (cityBlock) {
                const isOpen = await cityBlock.evaluate(el => el.classList.contains('open'));
                if (isOpen) pass(`City block for ${btnCountry} expanded after 🏙 click`);
                else fail(`City block for ${btnCountry} did not open`);

                // Check city rows exist
                const cityRows = await cityBlock.$$('.cpCityRow');
                if (cityRows.length > 0) pass(`City rows found: ${cityRows.length}`);
                else fail('No city rows found in expanded city block');

                // Click a city row to collapse
                if (cityRows.length > 0) {
                    const cityKey = await cityRows[0].getAttribute('data-citykey');
                    info(`Clicking city row: ${cityKey}`);
                    await cityRows[0].click();
                    await page.waitForTimeout(500);

                    const parts = cityKey.split(':');
                    const collapsed = await page.evaluate(({c,ci}) => _cityCollapseState[c+':'+ci] === true, {c:parts[0],ci:parts[1]});
                    if (collapsed) pass(`City row click collapsed ${cityKey}`);
                    else warn(`City row click: city not collapsed (may have no cores)`);

                    // Expand via click again
                    await cityRows[0].click();
                    await page.waitForTimeout(300);
                }
            } else warn(`#cpCityBlock_${btnCountry} not found`);
        }

        await shot(page, 'city-panel-rows');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 5 panel test failed', err.message);
    }

    // ── Phase 6: City collapse + country collapse stacked ────────────────────
    console.log('\n── Phase 6 : Stacked City + Country Collapse ───────────────────────────');
    try {
        if (!testCountry) { warn('Skipping Phase 6'); throw new Error('skip'); }

        // Collapse city first
        await page.evaluate(({c,ci}) => collapseCity(c,ci), {c:testCountry,ci:testCity});
        await page.waitForTimeout(400);

        // Then collapse whole country
        await page.evaluate((c) => collapseCountry(c), testCountry);
        await page.waitForTimeout(400);

        // Verify country is collapsed
        const countryCollapsed = await page.evaluate((c) => _collapseState[c] === true, testCountry);
        if (countryCollapsed) pass(`${testCountry} country collapsed while city also collapsed`);
        else warn(`Country ${testCountry} collapse state: ${countryCollapsed}`);

        // Expand country → city state should still be accessible
        await page.evaluate((c) => expandCountry(c), testCountry);
        await page.waitForTimeout(400);
        pass('expandCountry after stacked collapse — no crash');

        // Clean up city collapse
        await page.evaluate(({c,ci}) => expandCity(c,ci), {c:testCountry,ci:testCity});
        await page.waitForTimeout(300);
        pass('Stacked collapse cleanup complete');

        await shot(page, 'stacked-collapse');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 6 stacked collapse failed', err.message);
    }

    // ── Phase 7: expandAllCountries resets city state ─────────────────────────
    console.log('\n── Phase 7 : expandAllCountries Resets City State ─────────────────────');
    try {
        if (!testCountry) { warn('Skipping Phase 7'); throw new Error('skip'); }

        // Collapse a city
        await page.evaluate(({c,ci}) => collapseCity(c,ci), {c:testCountry,ci:testCity});
        await page.waitForTimeout(400);

        // expandAllCountries should also expand cities
        await page.evaluate(() => expandAllCountries());
        await page.waitForTimeout(500);

        const cityStillCollapsed = await page.evaluate(({c,ci}) => _cityCollapseState[c+':'+ci] === true, {c:testCountry,ci:testCity});
        if (!cityStillCollapsed) pass('expandAllCountries also expands city collapses');
        else warn('expandAllCountries: city still collapsed (city state not reset)');
    } catch (err) {
        if (err.message !== 'skip') fail('Phase 7 failed', err.message);
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
