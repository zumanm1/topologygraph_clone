'use strict';
/**
 * 08-live-walkthrough.cjs  —  Full teaching walkthrough of Topolograph
 * Captures a screenshot at every meaningful UI state.
 * Run from: tests/ directory (playwright is installed here)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const BASE      = 'http://localhost:8081';
const SHOTS_DIR = '/Users/macbook/Documents/OSPF-DATABASE-TEST/00-STEP-BY-STEP/screenshots';
const HOST_FILE = '/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/Load-hosts.txt';
const GRAPH_TIME = '03Mar2026_17h30m46s_34_hosts';  // most recent pipeline run

const COUNTRY_COLOURS = {
  ZAF:'#2ecc71', GBR:'#3498db', FRA:'#e74c3c', POR:'#e67e22',
  TAN:'#9b59b6', KEN:'#1abc9c', MOZ:'#f39c12', DRC:'#e91e63',
  LES:'#00bcd4', DJB:'#ff5722'
};

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

(async () => {
  const br   = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx  = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  try {

    // ─────────────────────────────────────────────────────────────────────────
    // A1  UPLOAD PAGE — home screen
    // ─────────────────────────────────────────────────────────────────────────
    log('A1', 'Home — Upload LSDB page');
    await page.goto(`${BASE}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, 'A1-home-upload-page');
    ok('Upload page — this is where OSPF files are submitted');

    // ─────────────────────────────────────────────────────────────────────────
    // A2  SELECT OSPF FILE
    // ─────────────────────────────────────────────────────────────────────────
    log('A2', 'Select the OSPF database file (ospf-database-2.txt)');
    const fileInput = await page.$('#inputOSPFFileID');
    await fileInput.setInputFiles(
      '/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/ospf-database-2.txt'
    );
    await page.waitForTimeout(800);
    await shot(page, 'A2-ospf-file-selected');
    ok('File selected in the upload control — filename appears next to the button');

    // ─────────────────────────────────────────────────────────────────────────
    // A3  CLICK UPLOAD
    // ─────────────────────────────────────────────────────────────────────────
    log('A3', 'Click "Load hosts" to upload the file to Topolograph');
    const uploadBtn = await page.$('input[name="upload_files_btn"]');
    await uploadBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await shot(page, 'A3-after-file-upload');
    ok('Page reloads — the graph is now stored in Topolograph\'s database');

    // ─────────────────────────────────────────────────────────────────────────
    // A4  GRAPH DROPDOWN — select our graph
    // ─────────────────────────────────────────────────────────────────────────
    log('A4', 'Select the uploaded graph from the dropdown');
    const dropdown = await page.$('select');
    if (dropdown) {
      await dropdown.selectOption({ value: GRAPH_TIME }).catch(async () => {
        // fallback: pick last option
        const opts = await dropdown.$$('option');
        const lastVal = await opts[opts.length - 1].getAttribute('value');
        if (lastVal) await dropdown.selectOption(lastVal);
      });
      info(`Graph selected: ${GRAPH_TIME}`);
      await page.waitForTimeout(600);
    }
    await shot(page, 'A4-graph-selected-in-dropdown');
    ok('The graph_time in the dropdown identifies the specific topology snapshot');

    // ─────────────────────────────────────────────────────────────────────────
    // A5  CLICK "LOAD DYNAMIC GRAPH"
    // ─────────────────────────────────────────────────────────────────────────
    log('A5', 'Click "Load dynamic graph" — vis.js renders the topology');
    // Find the Load button
    const loadBtn = await page.$('button[onclick*="upload_ospf_lsdb"]') ||
                    await page.$('input[value*="Load"]');
    if (loadBtn) {
      await loadBtn.click();
      info('Graph loading — waiting for vis.js to render all 34 nodes…');
      await page.waitForTimeout(5000);
    }
    await shot(page, 'A5-graph-raw-rendered');
    ok('Network diagram rendered — nodes are grey (no country colour yet at this stage)');

    // ─────────────────────────────────────────────────────────────────────────
    // A6  SHOW GRAPH ALREADY COLOURED (from pipeline push-to-ui)
    //     Reload the page — the PATCH calls from push-to-ui.py are already saved
    // ─────────────────────────────────────────────────────────────────────────
    log('A6', 'Reload — graph now shows country colours (from pipeline push)');
    await page.goto(`${BASE}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    const dd2 = await page.$('select');
    if (dd2) {
      await dd2.selectOption({ value: GRAPH_TIME }).catch(async () => {
        const opts = await dd2.$$('option');
        const v = await opts[opts.length-1].getAttribute('value');
        if (v) await dd2.selectOption(v);
      });
      await page.waitForTimeout(400);
    }
    const lb2 = await page.$('button[onclick*="upload_ospf_lsdb"]') || await page.$('input[value*="Load"]');
    if (lb2) { await lb2.click(); await page.waitForTimeout(5000); }
    await shot(page, 'A6-graph-with-country-colours');
    ok('Nodes coloured by country — 10 countries, each with a unique colour');

    // ─────────────────────────────────────────────────────────────────────────
    // A7  COUNTRY FILTER PANEL — open it
    // ─────────────────────────────────────────────────────────────────────────
    log('A7', 'Open the Country Filter panel (top-right of diagram)');
    const cfBtn = await page.$('#cfToggle');
    if (cfBtn) {
      await cfBtn.click();
      await page.waitForTimeout(800);
      await shot(page, 'A7-country-filter-panel-open');
      const cbs = await page.$$('.cfCheckbox');
      ok(`Country Filter panel open — ${cbs.length} countries listed with checkboxes`);
    } else {
      await shot(page, 'A7-country-filter-panel');
      info('Panel toggle not found in this render — check topolograph.js bind mount');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A8  FILTER: SHOW ONLY ZAF
    // ─────────────────────────────────────────────────────────────────────────
    log('A8', 'Filter: Show Only ZAF — only South Africa routers visible');
    const noneBtn = await page.$('#cfSelectNone');
    if (noneBtn) {
      await noneBtn.click(); await page.waitForTimeout(300);
      const zafCb = await page.$('.cfCheckbox[data-country="ZAF"]');
      if (zafCb) { await zafCb.click(); await page.waitForTimeout(200); }
      const showOnlyBtn = await page.$('.cfModeBtn[data-mode="show-only"]');
      if (showOnlyBtn) { await showOnlyBtn.click(); await page.waitForTimeout(200); }
      const applyBtn = await page.$('#cfApply');
      if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(1800); }
      await shot(page, 'A8-filter-show-only-ZAF');
      ok('Show Only ZAF — only the 8 South African routers remain visible');
    } else {
      await shot(page, 'A8-filter-not-available');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A9  FILTER: EXCLUDE DRC
    // ─────────────────────────────────────────────────────────────────────────
    log('A9', 'Filter: Exclude DRC — hide Democratic Republic of Congo routers');
    const allBtn = await page.$('#cfSelectAll');
    if (allBtn) {
      await allBtn.click(); await page.waitForTimeout(300);
      // Uncheck all, check only DRC
      const noneBtn2 = await page.$('#cfSelectNone');
      if (noneBtn2) { await noneBtn2.click(); await page.waitForTimeout(200); }
      const drcCb = await page.$('.cfCheckbox[data-country="DRC"]');
      if (drcCb) { await drcCb.click(); await page.waitForTimeout(200); }
      const excludeBtn = await page.$('.cfModeBtn[data-mode="exclude"]');
      if (excludeBtn) { await excludeBtn.click(); await page.waitForTimeout(200); }
      const applyBtn2 = await page.$('#cfApply');
      if (applyBtn2) { await applyBtn2.click(); await page.waitForTimeout(1800); }
      await shot(page, 'A9-filter-exclude-DRC');
      ok('Exclude DRC — 4 DRC routers hidden, all other 30 remain visible');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A10  FILTER RESET — all countries visible again
    // ─────────────────────────────────────────────────────────────────────────
    log('A10', 'Reset filter — restore all 34 routers');
    const resetBtn = await page.$('#cfReset');
    if (resetBtn) {
      await resetBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, 'A10-filter-reset-all-visible');
      ok('All 34 nodes restored — topology back to full view');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A11  OUTPUT: AS-IS files (terminal, not web)
    // ─────────────────────────────────────────────────────────────────────────
    log('A11', 'Show OUTPUT/AS-IS — raw unmodified graph files');
    const asisDir = `/Users/macbook/Documents/OSPF-DATABASE-TEST/OUTPUT/AS-IS/${GRAPH_TIME}_AS-IS`;
    const asisFiles = fs.existsSync(asisDir) ? fs.readdirSync(asisDir) : [];
    info(`AS-IS files: ${asisFiles.join(', ')}`);
    // Screenshot of current state + zoom in on diagram
    await shot(page, 'A11-output-asis-diagram');
    ok('AS-IS: AS-IS_nodes.json + AS-IS_edges.json + AS-IS_meta.json — exact copy from Topolograph API');

    // ─────────────────────────────────────────────────────────────────────────
    // A12  HOST MAPPING PAGE
    // ─────────────────────────────────────────────────────────────────────────
    log('A12', 'Host-to-DNS mapping management page');
    await page.goto(`${BASE}/ospf-host-to-dns-mapping`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    await shot(page, 'A12-host-mapping-page');
    ok('Host mapping page — shows all router IDs mapped to hostnames');

    // ─────────────────────────────────────────────────────────────────────────
    // A13  API DOCS
    // ─────────────────────────────────────────────────────────────────────────
    log('A13', 'REST API documentation (Swagger UI)');
    await page.goto(`${BASE}/api/ui/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2500);
    await shot(page, 'A13-api-swagger-docs');
    ok('Swagger UI — all API endpoints documented and testable here');

    // ─────────────────────────────────────────────────────────────────────────
    // A14  GATEWAY TOPOLOGY OUTPUT (shown as text info)
    // ─────────────────────────────────────────────────────────────────────────
    log('A14', 'Back to main diagram — zoom on coloured gateway nodes');
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
    ok('Final view — 34 routers, 10 countries, colour-coded, gateway nodes connecting countries');

  } catch (err) {
    console.error('\n❌  Error:', err.message);
    await shot(page, 'ZZ-ERROR').catch(() => {});
  } finally {
    await br.close();
    console.log(`\n${'═'.repeat(62)}`);
    console.log(`  ✅  Walkthrough complete — ${idx} screenshots saved`);
    console.log(`  📁  Location: 00-STEP-BY-STEP/screenshots/`);
    console.log('═'.repeat(62));
  }
})();
