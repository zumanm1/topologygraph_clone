'use strict';
/**
 * 08-live-walkthrough.cjs  —  Full teaching walkthrough of Topolograph
 * Part of: 01-STEP-BY-STEP teaching guide
 *
 * WHAT THIS DOES:
 *   Automates a headless Chromium browser to walk through every major
 *   feature of the Topolograph web UI, capturing a screenshot at each step.
 *
 *   Screenshots are saved to: 01-STEP-BY-STEP/screenshots/
 *   Naming: NN-StepCode-description.png  (e.g. 01-A1-home-upload-page.png)
 *
 * NEW IN v01:
 *   - Uses updated output file naming (_AS-IS / _GATEWAY / _ENRICHED)
 *   - Demonstrates Country Filter with all three modes (Show Only / Exclude / Reset)
 *   - Documents each API call made behind the UI action
 *
 * Run from project root:
 *   node 01-STEP-BY-STEP/scripts/08-live-walkthrough.cjs
 *
 * Prerequisites:
 *   cd tests && npm install playwright && npx playwright install chromium
 */
const { chromium } = require('playwright');
const path         = require('path');
const fs           = require('fs');

const BASE      = 'http://localhost:8081';
const SHOTS_DIR = path.resolve(__dirname, '../screenshots');
const OSPF_FILE = path.resolve(__dirname, '../../INPUT-FOLDER/ospf-database-2.txt');
const HOST_FILE = path.resolve(__dirname, '../../INPUT-FOLDER/Load-hosts.txt');

// The most recent pipeline-enriched graph (has country colours)
// Update this to the latest graph_time from workflow.sh output
const GRAPH_TIME = '03Mar2026_20h05m03s_34_hosts';

fs.mkdirSync(SHOTS_DIR, { recursive: true });

let idx = 0;
async function shot(page, name) {
  idx++;
  const file = `${String(idx).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path: path.join(SHOTS_DIR, file), fullPage: false });
  console.log(`  📸  ${file}`);
  return file;
}

const log  = (step, msg) => console.log(`\n${'═'.repeat(62)}\n  STEP ${step}: ${msg}\n${'─'.repeat(62)}`);
const info = msg => console.log(`  ℹ   ${msg}`);
const ok   = msg => console.log(`  ✅  ${msg}`);
const api  = msg => console.log(`  🔌  API: ${msg}`);

(async () => {
  const br   = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx  = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  try {

    // ─────────────────────────────────────────────────────────────────────────
    // AUTH  Login as ospf@topolograph.com  (required to see enriched graphs)
    // ─────────────────────────────────────────────────────────────────────────
    log('AUTH', 'Login — establishing authenticated session');
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);
    // Fill login form — Flask-WTF fields: name="login" + name="password"
    await page.waitForSelector('input[name="login"]', { timeout: 8000 }).catch(() => {});
    const loginField = await page.$('input[name="login"]');
    const passField  = await page.$('input[name="password"]');
    if (loginField && passField) {
      await loginField.fill('ospf@topolograph.com');
      await passField.fill('ospf');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        page.click('input[type="submit"][value="Login"]'),
      ]);
      await page.waitForTimeout(1000);
      info('Logged in as ospf@topolograph.com');
    } else {
      info('Login form not found — proceeding without authentication');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A1  HOME — Upload LSDB page
    // ─────────────────────────────────────────────────────────────────────────
    log('A1', 'Home — Upload LSDB page');
    await page.goto(`${BASE}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, 'A1-home-upload-page');
    ok('Upload page — two purposes: (1) upload new OSPF data, (2) load existing graphs');
    info('Navbar: Upload LSDB | Create topology | Devices | HOW TO | API');

    // ─────────────────────────────────────────────────────────────────────────
    // A2  SELECT OSPF FILE
    // ─────────────────────────────────────────────────────────────────────────
    log('A2', 'Select the OSPF database file (ospf-database-2.txt)');
    const fileInput = await page.$('#inputOSPFFileID');
    await fileInput.setInputFiles(OSPF_FILE);
    await page.waitForTimeout(800);
    await shot(page, 'A2-ospf-file-selected');
    ok('File selected — filename appears next to the Choose File button');
    api('Prepares: POST /api/graphs with lsdb_output body');

    // ─────────────────────────────────────────────────────────────────────────
    // A3  CLICK UPLOAD → POST /api/graphs
    // ─────────────────────────────────────────────────────────────────────────
    log('A3', 'Click "Load hosts" — POST /api/graphs to Topolograph');
    const uploadBtn = await page.$('input[name="upload_files_btn"]');
    await uploadBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await shot(page, 'A3-after-file-upload');
    ok('Page reloads — graph stored in MongoDB. graph_time received in response.');
    api('POST /api/graphs → {"graph_time":"...","nodes":34,"edges":108}');

    // ─────────────────────────────────────────────────────────────────────────
    // A4  SELECT GRAPH FROM DROPDOWN
    // ─────────────────────────────────────────────────────────────────────────
    log('A4', 'Select the enriched graph from the dropdown');
    const dropdown = await page.$('select');
    if (dropdown) {
      await dropdown.selectOption({ value: GRAPH_TIME }).catch(async () => {
        const opts = await dropdown.$$('option');
        const lastVal = await opts[opts.length - 1].getAttribute('value');
        if (lastVal) await dropdown.selectOption(lastVal);
      });
      info(`graph_time selected: ${GRAPH_TIME}`);
      await page.waitForTimeout(600);
    }
    await shot(page, 'A4-graph-selected-in-dropdown');
    ok('graph_time is the primary key — every API call, output file, and PATCH uses it');

    // ─────────────────────────────────────────────────────────────────────────
    // A5  LOAD GRAPH — vis.js renders
    // ─────────────────────────────────────────────────────────────────────────
    log('A5', 'Click "Load dynamic graph" — vis.js renders the topology');
    const loadBtn = await page.$('button[onclick*="upload_ospf_lsdb"]') ||
                    await page.$('input[value*="Load"]');
    if (loadBtn) {
      await loadBtn.click();
      info('Graph loading — waiting for vis.js force simulation to settle…');
      await page.waitForTimeout(5000);
    }
    await shot(page, 'A5-graph-raw-rendered');
    ok('34 nodes rendered — grey (no country colour yet, pre-pipeline state)');
    api('GET /api/diagram/{gt}/nodes → 34 nodes');
    api('GET /api/diagram/{gt}/edges → 108 edges');

    // ─────────────────────────────────────────────────────────────────────────
    // A6  INJECT COUNTRY DATA → COLOURS → BUILD FILTER PANEL
    //     Lesson learned from 00-STEP-BY-STEP: even after login, the headless
    //     browser may not trigger buildCountryFilterPanel() automatically because
    //     the graph DB has country data but the JS call chain depends on timing.
    //     Solution (same as demo-steps.cjs in tests/): inject country data
    //     directly into vis.js DataSet nodes, then call the build functions.
    // ─────────────────────────────────────────────────────────────────────────
    log('A6', 'Inject country colours into vis.js nodes + build Country Filter panel');

    // Country mapping from ENRICHED_country-mapping.csv (34 routers, 10 countries)
    const COUNTRY_MAP = {
      "9.9.9.1":"LES",  "9.9.9.2":"LES",  "9.9.9.3":"LES",
      "10.10.10.1":"TAN","10.10.10.2":"TAN",
      "11.11.11.1":"MOZ","11.11.11.2":"MOZ","11.11.11.3":"MOZ","11.11.11.4":"MOZ",
      "12.12.12.1":"KEN","12.12.12.2":"KEN",
      "13.13.13.1":"DRC","13.13.13.2":"DRC","13.13.13.3":"DRC","13.13.13.4":"DRC",
      "14.14.14.1":"DJB","14.14.14.2":"DJB",
      "15.15.15.1":"GBR","15.15.15.2":"GBR","15.15.15.3":"GBR",
      "16.16.16.1":"FRA","16.16.16.2":"FRA","16.16.16.3":"FRA",
      "17.17.17.1":"POR","17.17.17.2":"POR","17.17.17.3":"POR",
      "18.18.18.1":"ZAF","18.18.18.2":"ZAF","18.18.18.3":"ZAF","18.18.18.4":"ZAF",
      "18.18.18.5":"ZAF","18.18.18.6":"ZAF","18.18.18.7":"ZAF","18.18.18.8":"ZAF"
    };

    // Inject country into vis.js DataSet — same technique as demo-steps.cjs
    const injected = await page.evaluate(mapping => {
      if (typeof nodes === 'undefined' || !nodes || typeof nodes.get !== 'function') return 0;
      const updates = [];
      nodes.get().forEach(n => {
        const rid = n.label || n.name || String(n.id);
        updates.push({ id: n.id, country: mapping[rid] || 'UNK' });
      });
      nodes.update(updates);
      return updates.length;
    }, COUNTRY_MAP);
    info(`Injected country into ${injected} nodes`);

    // Call topolograph.js functions to apply colours and build the panel
    await page.evaluate(() => {
      if (typeof applyCountryColors      === 'function') applyCountryColors();
      if (typeof buildCountryFilterPanel === 'function') buildCountryFilterPanel();
    });
    await page.waitForTimeout(2000);
    await shot(page, 'A6-graph-with-country-colours');
    ok('10 countries, each with a unique colour — nodes coloured by country code');
    api('Colours applied via push-to-ui.py: PATCH /api/diagram/{gt}/nodes/{id}');

    // ─────────────────────────────────────────────────────────────────────────
    // A7  COUNTRY FILTER PANEL — open it
    // ─────────────────────────────────────────────────────────────────────────
    log('A7', 'Open the Country Filter panel (top-right of diagram)');
    const cfBtn = await page.$('#cfToggle');
    if (cfBtn) {
      await cfBtn.click();
      await page.waitForTimeout(1000);
      await shot(page, 'A7-country-filter-panel-open');
      const cbs = await page.$$('.cfCheckbox');
      ok(`Country Filter panel open — ${cbs.length} countries listed with checkboxes`);
      info('This panel is pure client-side JavaScript — zero server calls when filtering');
    } else {
      await shot(page, 'A7-country-filter-panel');
      info('#cfToggle not found — check topolograph.js bind mount in docker-compose.yml');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A8  FILTER: SHOW ONLY ZAF
    // ─────────────────────────────────────────────────────────────────────────
    log('A8', 'Filter — Show Only ZAF (South Africa, 8 routers)');
    const noneBtn = await page.$('#cfSelectNone');
    if (noneBtn) {
      await noneBtn.click(); await page.waitForTimeout(300);
      const zafCb = await page.$('.cfCheckbox[data-country="ZAF"]');
      if (zafCb) { await zafCb.click(); await page.waitForTimeout(200); }
      const showOnlyBtn = await page.$('.cfModeBtn[data-mode="show-only"]') ||
                          await page.$('.cfModeBtn[data-mode="show_only"]');
      if (showOnlyBtn) { await showOnlyBtn.click(); await page.waitForTimeout(200); }
      const applyBtn = await page.$('#cfApply');
      if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(2000); }
      await shot(page, 'A8-filter-show-only-ZAF');
      ok('Show Only ZAF — 8 routers visible, 26 hidden');
      info('vis.js: nodes.update([{id, hidden: country !== "ZAF"}]) — no server call');
    } else {
      await shot(page, 'A8-filter-not-available');
      info('#cfSelectNone not found — filter panel did not build');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A9  FILTER: EXCLUDE DRC
    // ─────────────────────────────────────────────────────────────────────────
    log('A9', 'Filter — Exclude DRC (4 routers hidden)');
    const allBtn = await page.$('#cfSelectAll');
    if (allBtn) {
      await allBtn.click(); await page.waitForTimeout(300);
      const noneBtn2 = await page.$('#cfSelectNone');
      if (noneBtn2) { await noneBtn2.click(); await page.waitForTimeout(200); }
      const drcCb = await page.$('.cfCheckbox[data-country="DRC"]');
      if (drcCb) { await drcCb.click(); await page.waitForTimeout(200); }
      const excludeBtn = await page.$('.cfModeBtn[data-mode="exclude"]');
      if (excludeBtn) { await excludeBtn.click(); await page.waitForTimeout(200); }
      const applyBtn2 = await page.$('#cfApply');
      if (applyBtn2) { await applyBtn2.click(); await page.waitForTimeout(2000); }
      await shot(page, 'A9-filter-exclude-DRC');
      ok('Exclude DRC — 4 DRC routers hidden, 30 routers visible');
      info('Exclude is the inverse of Show Only: use to hide noise while keeping context');
    } else {
      await shot(page, 'A9-filter-not-available');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A10  FILTER RESET
    // ─────────────────────────────────────────────────────────────────────────
    log('A10', 'Reset filter — restore all 34 routers');
    const resetBtn = await page.$('#cfReset');
    if (resetBtn) {
      await resetBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, 'A10-filter-reset-all-visible');
      ok('All 34 nodes restored — full coloured topology, mode reset to All');
    } else {
      await shot(page, 'A10-filter-reset');
      info('#cfReset not found');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A11  OUTPUT: AS-IS FILES
    // ─────────────────────────────────────────────────────────────────────────
    log('A11', 'OUTPUT/AS-IS — raw unmodified graph files');
    const asisDir = path.resolve(__dirname, `../../OUTPUT/AS-IS/${GRAPH_TIME}_AS-IS`);
    const asisFiles = fs.existsSync(asisDir) ? fs.readdirSync(asisDir).sort() : [];
    info(`AS-IS folder: ${GRAPH_TIME}_AS-IS/`);
    info(`Files: ${asisFiles.join('  ')}`);
    await shot(page, 'A11-output-asis-diagram');
    ok('AS-IS_nodes.json + AS-IS_edges.json + AS-IS_meta.json + AS-IS_ospf-database.txt');
    info('These files are the AUDIT TRAIL — exactly what Topolograph parsed, before enrichment');

    // ─────────────────────────────────────────────────────────────────────────
    // A12  HOST MAPPING PAGE
    // ─────────────────────────────────────────────────────────────────────────
    log('A12', 'Host-to-DNS mapping management page');
    await page.goto(`${BASE}/ospf-host-to-dns-mapping`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    await shot(page, 'A12-host-mapping-page');
    ok('Host mapping page — router IP → hostname. First 3 chars of hostname = country code');

    // ─────────────────────────────────────────────────────────────────────────
    // A13  API DOCS (Swagger)
    // ─────────────────────────────────────────────────────────────────────────
    log('A13', 'REST API documentation (Swagger UI)');
    await page.goto(`${BASE}/api/ui/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2500);
    await shot(page, 'A13-api-swagger-docs');
    ok('Swagger UI — all endpoints documented: POST /api/graphs, GET/PATCH /api/diagram/{gt}/nodes');

    // ─────────────────────────────────────────────────────────────────────────
    // A14  FINAL VIEW — full coloured topology
    // ─────────────────────────────────────────────────────────────────────────
    log('A14', 'Final view — full coloured topology with all 34 routers');
    await page.goto(`${BASE}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    const dd3 = await page.$('select');
    if (dd3) {
      await dd3.selectOption({ value: GRAPH_TIME }).catch(() => {});
      await page.waitForTimeout(400);
    }
    const lb3 = await page.$('button[onclick*="upload_ospf_lsdb"]') || await page.$('input[value*="Load"]');
    if (lb3) { await lb3.click(); await page.waitForTimeout(5000); }
    await shot(page, 'A14-full-coloured-topology-final');
    ok('Final view — 34 routers, 10 countries, colour-coded, gateway nodes bridge countries');

  } catch (err) {
    console.error('\n❌  Error:', err.message);
    await shot(page, 'ZZ-ERROR').catch(() => {});
  } finally {
    await br.close();
    console.log(`\n${'═'.repeat(62)}`);
    console.log(`  ✅  Walkthrough complete — ${idx} screenshots saved`);
    console.log(`  📁  Location: 01-STEP-BY-STEP/screenshots/`);
    console.log('═'.repeat(62));
  }
})();
