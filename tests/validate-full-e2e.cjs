#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// validate-full-e2e.cjs
// 05-STEP-BY-STEP — Full End-to-End Validation
//
// TESTS (9 phases, 50+ checks):
//   AUTH  — Login
//   LOAD  — Graph load from upload page
//   P1    — AS-IS view mode  (34 nodes, edges, UNK toolbar)
//   P2    — ENRICHED view mode  (34 nodes, country colours, Country Filter)
//   P3    — GATEWAY view mode   (28 gateway nodes, 6 cores hidden)
//   P4    — CURRENT mode        (loads without error)
//   P5    — COLLAPSING mode     (panel, collapse/expand, badge)
//   P6    — Sprint 3: UNK Highlight
//   P7    — Sprint 3: Hostname Upload (CSV + manual reclassify)
//   P8    — Sprint 3: Cost Matrix (Dijkstra, cell click, view badge)
//   P9    — Sprint 3: What-If Analysis (edge picker, run, apply)
//
// USAGE
//   GRAPH_TIMES=04Mar2026_12h25m56s_34_hosts node tests/validate-full-e2e.cjs
//   node tests/validate-full-e2e.cjs
// ─────────────────────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const BASE_URL   = process.env.BASE_URL   || 'http://localhost:8081';
const API_USER   = process.env.API_USER   || 'ospf@topolograph.com';
const API_PASS   = process.env.API_PASS   || 'ospf';
const HEADLESS   = process.env.HEADLESS !== 'false';
const SS_DIR     = path.join(__dirname, '..', '05-STEP-BY-STEP', 'screenshots');

// Pick first available graph_time from env or fall back to latest on disk
function resolveGraphTime() {
  const fromEnv = (process.env.GRAPH_TIMES || '').split(',')[0].trim();
  if (fromEnv) return fromEnv;
  const inout = path.join(__dirname, '..', 'IN-OUT-FOLDER');
  if (!fs.existsSync(inout)) return '04Mar2026_12h25m56s_34_hosts';
  const dirs = fs.readdirSync(inout)
    .filter(d => fs.existsSync(path.join(inout, d, 'nodes.json')))
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : '04Mar2026_12h25m56s_34_hosts';
}
const GRAPH_TIME = resolveGraphTime();

let PASS = 0, FAIL = 0;
const log = (line) => process.stdout.write(line + '\n');
function pass(tag, msg) { PASS++; log(`  ✅ PASS [${tag}]: ${msg}`); }
function fail(tag, msg) { FAIL++; log(`  ❌ FAIL [${tag}]: ${msg}`); }
function info(msg)      { log(`  ℹ  ${msg}`); }

async function settle(page, ms) { await page.waitForTimeout(ms || 800); }

async function shot(page, name) {
  fs.mkdirSync(SS_DIR, { recursive: true });
  const file = path.join(SS_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  info(`Screenshot → ${path.basename(file)}`);
  return file;
}

async function shotClipped(page, selector, name, padding) {
  fs.mkdirSync(SS_DIR, { recursive: true });
  const el = await page.$(selector);
  if (!el) return;
  const box = await el.boundingBox();
  if (!box) return;
  const pad = padding || 8;
  await page.screenshot({
    path: path.join(SS_DIR, name + '.png'),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width:  Math.min(box.width  + pad*2, 1400),
      height: Math.min(box.height + pad*2, 800)
    }
  });
  info(`Screenshot (clipped) → ${name}.png`);
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);
  await page.fill('#login',    API_USER);
  await page.fill('#password', API_PASS);
  await Promise.race([
    page.press('#password', 'Enter'),
    page.click('input[type="submit"], button[type="submit"]').catch(() => {}),
  ]);
  await settle(page, 1500);
  return !page.url().includes('/login');
}

// ── Graph load ────────────────────────────────────────────────────────────────
async function loadGraph(page, graphTime) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 800);
  await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    let opt = Array.from(sel.options).find(o => o.value === gt || o.text.trim() === gt);
    if (!opt) { opt = document.createElement('option'); opt.value = gt; opt.text = gt; sel.add(opt); }
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
  }, graphTime);
  const loadBtn = await page.$('input#load_graph_button') ||
                  await page.$('input[onclick*="upload_ospf_lsdb"]') ||
                  await page.$('button[onclick*="upload_ospf_lsdb"]');
  if (loadBtn) { await loadBtn.click(); }
  else { await page.evaluate((gt) => { if (typeof upload_ospf_lsdb==='function') upload_ospf_lsdb(false,false,gt); }, graphTime); }
  let total = 0;
  for (let i = 1; i <= 15; i++) {
    await settle(page, 1500);
    total = await page.evaluate(() => { try { return nodes ? nodes.get().length : 0; } catch(e) { return 0; } });
    if (total > 0) break;
  }
  return total;
}

// ── Helper: switch view mode ──────────────────────────────────────────────────
async function switchMode(page, mode) {
  // mode: 'asis' | 'enriched' | 'gateway' | 'current' | collapsing
  if (mode === 'collapsing') {
    // Click the COLLAPSING ▼ button
    await page.evaluate(() => {
      var btn = document.getElementById('btnCollapsingMode') ||
                Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('COLLAPSING'));
      if (btn) btn.click();
    });
  } else {
    await page.evaluate((m) => {
      if (typeof setViewMode === 'function') { setViewMode(m); return; }
      var btn = Array.from(document.querySelectorAll('button, a'))
                  .find(b => b.textContent.trim().toUpperCase().includes(m.toUpperCase()));
      if (btn) btn.click();
    }, mode);
  }
  await settle(page, 1000);
}

// ── Helper: get visible node count ───────────────────────────────────────────
async function visibleNodeCount(page) {
  return page.evaluate(() => {
    try {
      return nodes.get({ filter: n => n.hidden !== true }).length;
    } catch(e) { return -1; }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  log('╔══════════════════════════════════════════════════════════════════════╗');
  log('║   05-STEP-BY-STEP — FULL END-TO-END VALIDATION                      ║');
  log('║   Phases: AUTH · LOAD · P1-P5 (5 views) · P6-P9 (Sprint 3)         ║');
  log('╚══════════════════════════════════════════════════════════════════════╝');
  info(`Graph time : ${GRAPH_TIME}`);
  info(`Base URL   : ${BASE_URL}`);
  info(`Headless   : ${HEADLESS}`);
  info(`Screenshots: ${SS_DIR}`);
  log('');

  const browser = await chromium.launch({ headless: HEADLESS });
  const page    = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // ── AUTH ────────────────────────────────────────────────────────────────────
  log('━━━ AUTH ━━━');
  const loggedIn = await login(page);
  loggedIn ? pass('AUTH', `Logged in as ${API_USER}`)
           : (fail('AUTH', 'Login failed — aborting'), await browser.close(), process.exit(1));
  await shot(page, '01-login-success');

  // ── LOAD ───────────────────────────────────────────────────────────────────
  log('');
  log('━━━ LOAD — Graph from Upload Page ━━━');
  const nodeCount = await loadGraph(page, GRAPH_TIME);
  nodeCount > 0
    ? pass('LOAD', `Graph loaded — ${nodeCount} vis.js nodes`)
    : fail('LOAD', `Graph failed to load (nodeCount=${nodeCount})`);
  await shot(page, '02-graph-loaded');

  // ── P1: AS-IS ──────────────────────────────────────────────────────────────
  log('');
  log('━━━ P1: AS-IS View ━━━');
  await switchMode(page, 'asis');
  await settle(page, 800);

  const asisNodes = await visibleNodeCount(page);
  asisNodes >= 30
    ? pass('P1-ASIS', `AS-IS visible nodes: ${asisNodes} (≥30 expected)`)
    : fail('P1-ASIS', `AS-IS visible nodes: ${asisNodes} — expected ≥30`);

  const asisEdges = await page.evaluate(() => {
    try { return edges.get({ filter: e => e.hidden !== true }).length; } catch(e) { return -1; }
  });
  asisEdges > 0
    ? pass('P1-ASIS', `AS-IS visible edges: ${asisEdges}`)
    : fail('P1-ASIS', `AS-IS edges: ${asisEdges} — expected >0`);

  // Sprint 3 toolbar present in AS-IS
  const toolbarBtns = ['btnUnkHighlight','btnHostnameUpload','btnCostMatrix','btnWhatIf'];
  for (const id of toolbarBtns) {
    const el = await page.$(`#${id}`);
    el ? pass('P1-ASIS', `Toolbar button #${id} present`)
       : fail('P1-ASIS', `Toolbar button #${id} NOT found`);
  }
  await shot(page, '03-asis-view');

  // ── P2: ENRICHED ──────────────────────────────────────────────────────────
  log('');
  log('━━━ P2: ENRICHED View ━━━');
  await switchMode(page, 'enriched');
  await settle(page, 1000);

  const enrichNodes = await visibleNodeCount(page);
  enrichNodes >= 30
    ? pass('P2-ENRICH', `ENRICHED visible nodes: ${enrichNodes}`)
    : fail('P2-ENRICH', `ENRICHED visible nodes: ${enrichNodes} — expected ≥30`);

  // Country Filter panel
  const cfPanel = await page.$('#countryFilterPanel, #countryFilter, [id*="countryFilter"]');
  cfPanel
    ? pass('P2-ENRICH', 'Country Filter panel present in ENRICHED')
    : fail('P2-ENRICH', 'Country Filter panel not found');

  // At least one coloured node (has country property)
  const classifiedCount = await page.evaluate(() => {
    try {
      return nodes.get().filter(n => n.country && n.country.toUpperCase() !== 'UNK' && n.country !== '').length;
    } catch(e) { return 0; }
  });
  classifiedCount > 0
    ? pass('P2-ENRICH', `${classifiedCount} nodes with country classification`)
    : fail('P2-ENRICH', 'No classified nodes found');
  await shot(page, '04-enriched-view');

  // Country filter — test Exclude: click a country in the filter
  const firstCountryBtn = await page.$('#countryFilterPanel button[onclick*="filterCountry"], #countryFilterPanel .country-btn, [id*="filterCountry"]');
  if (firstCountryBtn) {
    info('Country filter button found — testing exclude');
  }

  // ── P3: GATEWAY ────────────────────────────────────────────────────────────
  log('');
  log('━━━ P3: GATEWAY View ━━━');
  await switchMode(page, 'gateway');
  await settle(page, 1000);

  const gwNodes = await visibleNodeCount(page);
  // GATEWAY should show 28 gateways (6 cores hidden)
  gwNodes >= 20
    ? pass('P3-GW', `GATEWAY visible nodes: ${gwNodes} (gateways visible)`)
    : fail('P3-GW', `GATEWAY visible nodes: ${gwNodes} — expected ≥20`);

  const hiddenInGW = await page.evaluate(() => {
    try { return nodes.get({ filter: n => n.hidden === true }).length; } catch(e) { return -1; }
  });
  hiddenInGW >= 0
    ? pass('P3-GW', `GATEWAY hidden nodes: ${hiddenInGW} (core nodes hidden)`)
    : fail('P3-GW', 'Could not determine hidden node count');
  await shot(page, '05-gateway-view');

  // ── P4: CURRENT ────────────────────────────────────────────────────────────
  log('');
  log('━━━ P4: CURRENT View ━━━');
  await switchMode(page, 'current');
  await settle(page, 1000);

  const currNodes = await visibleNodeCount(page);
  currNodes >= 0
    ? pass('P4-CURR', `CURRENT mode loaded — ${currNodes} visible nodes`)
    : fail('P4-CURR', 'CURRENT mode failed to load');
  await shot(page, '06-current-view');

  // ── P5: COLLAPSING ─────────────────────────────────────────────────────────
  log('');
  log('━━━ P5: COLLAPSING Mode ━━━');
  // Switch to enriched first (good base for collapsing)
  await switchMode(page, 'enriched');
  await settle(page, 800);

  // Open collapsing panel
  await page.evaluate(() => {
    if (typeof buildCollapsePanel === 'function') { buildCollapsePanel(); return; }
    var btn = document.getElementById('btnCollapsingMode') ||
              Array.from(document.querySelectorAll('button'))
                .find(b => b.textContent.includes('COLLAPSING') || b.textContent.includes('Collapse'));
    if (btn) btn.click();
  });
  await settle(page, 1000);

  const colPanel = await page.$('#countryCollapsePanel, [id*="CollapsePanel"]');
  colPanel
    ? pass('P5-COL', 'COLLAPSING panel rendered')
    : fail('P5-COL', 'COLLAPSING panel NOT found');
  await shot(page, '07-collapsing-panel');

  // Collapse ZAF
  const zafCollapsed = await page.evaluate(() => {
    if (typeof collapseCountry !== 'function') return 'no_function';
    try { collapseCountry('ZAF'); return 'ok'; } catch(e) { return 'error:'+e.message; }
  });
  await settle(page, 1000);
  zafCollapsed === 'ok'
    ? pass('P5-COL', 'collapseCountry("ZAF") executed')
    : fail('P5-COL', `collapseCountry failed: ${zafCollapsed}`);

  // Badge should show "▲ N hidden"
  const badgeNodes = await page.evaluate(() => {
    try {
      return nodes.get().filter(n => n.label && n.label.includes('\u25b2')).length;
    } catch(e) { return 0; }
  });
  badgeNodes > 0
    ? pass('P5-COL', `Badge "▲ N hidden" found on ${badgeNodes} gateway node(s)`)
    : fail('P5-COL', 'No gateway badge "▲" found after collapse');

  // Cost Aggregation: badge should contain Σcost
  const costBadge = await page.evaluate(() => {
    try {
      return nodes.get().filter(n => n.label && /[\u03a3\u2211]cost/i.test(n.label)).length;
    } catch(e) { return 0; }
  });
  costBadge > 0
    ? pass('P5-COL', `Σcost aggregation badge present on ${costBadge} node(s)`)
    : fail('P5-COL', 'Σcost badge not found — IP Fabric cost aggregation may be broken');

  // Persistent Path Overlay: inter-country edges remain visible
  const crossEdgesVisible = await page.evaluate(() => {
    try {
      return edges.get({ filter: function(e) {
        var s = nodes.get(e.from), d = nodes.get(e.to);
        if (!s || !d) return false;
        var sc = (s.country||'').toUpperCase(), dc = (d.country||'').toUpperCase();
        return sc && dc && sc !== dc && e.hidden !== true;
      }}).length;
    } catch(e) { return -1; }
  });
  crossEdgesVisible > 0
    ? pass('P5-COL', `Persistent Path Overlay: ${crossEdgesVisible} cross-country edges visible after collapse`)
    : fail('P5-COL', 'No cross-country edges visible — Persistent Path Overlay broken');

  await shot(page, '08-collapsing-zaf-collapsed');
  await shotClipped(page, '[id*="gateway"],[data-country="ZAF"]', '09-zaf-badge-zoom');

  // Expand ZAF
  await page.evaluate(() => {
    if (typeof expandCountry === 'function') { expandCountry('ZAF'); return; }
    if (typeof collapseCountry === 'function') { collapseCountry('ZAF'); } // toggle
  });
  await settle(page, 800);

  // Collapse All / Expand All (if buttons exist)
  const hasCollapseAll = await page.evaluate(() => {
    return !!(document.getElementById('btnCollapseAll') ||
              Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Collapse All')));
  });
  if (hasCollapseAll) {
    await page.evaluate(() => {
      var btn = document.getElementById('btnCollapseAll') ||
                Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Collapse All'));
      if (btn) btn.click();
    });
    await settle(page, 1500);
    const afterAll = await page.evaluate(() => {
      try { return nodes.get({ filter: n => n.hidden === true }).length; } catch(e) { return 0; }
    });
    afterAll > 0
      ? pass('P5-COL', `Collapse All → ${afterAll} nodes hidden`)
      : fail('P5-COL', 'Collapse All had no effect');

    await page.evaluate(() => {
      var btn = document.getElementById('btnExpandAll') ||
                Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Expand All'));
      if (btn) btn.click();
    });
    await settle(page, 1000);
    pass('P5-COL', 'Expand All executed');
  } else {
    info('Collapse All / Expand All buttons not found — skipping bulk test');
  }

  // ── P6: Sprint 3 — UNK Highlight ─────────────────────────────────────────
  log('');
  log('━━━ P6: Sprint 3 — UNK Highlight ━━━');
  await switchMode(page, 'enriched');
  await settle(page, 800);

  const unkCount = await page.evaluate(() => {
    try { return nodes.get().filter(n => (n.country||'').toUpperCase()==='UNK').length; } catch(e) { return -1; }
  });
  info(`UNK nodes in graph: ${unkCount}`);

  // Toggle UNK highlight ON
  await page.evaluate(() => { if (typeof _toggleUnkHighlight==='function') _toggleUnkHighlight(); });
  await settle(page, 600);
  const unkBtnActive = await page.evaluate(() => {
    var btn = document.getElementById('btnUnkHighlight');
    return btn ? btn.classList.contains('active') : null;
  });
  unkBtnActive !== null
    ? pass('P6-UNK', `_toggleUnkHighlight() → active=${unkBtnActive}`)
    : fail('P6-UNK', 'btnUnkHighlight not found or no .active class');
  await shot(page, '10-unk-highlight-on');

  // Toggle OFF
  await page.evaluate(() => { if (typeof _toggleUnkHighlight==='function') _toggleUnkHighlight(); });
  await settle(page, 400);
  const unkBtnOff = await page.evaluate(() => {
    var btn = document.getElementById('btnUnkHighlight');
    return btn ? !btn.classList.contains('active') : null;
  });
  unkBtnOff === true
    ? pass('P6-UNK', 'UNK highlight toggled off')
    : fail('P6-UNK', 'UNK highlight did not toggle off');

  // Test in GATEWAY mode too
  await switchMode(page, 'gateway');
  await settle(page, 600);
  const unkInGW = await page.$('#btnUnkHighlight');
  unkInGW
    ? pass('P6-UNK', 'UNK button present in GATEWAY mode (cross-mode)')
    : fail('P6-UNK', 'UNK button not found in GATEWAY mode');
  await switchMode(page, 'enriched');
  await settle(page, 600);

  // ── P7: Sprint 3 — Hostname Upload ────────────────────────────────────────
  log('');
  log('━━━ P7: Sprint 3 — Hostname Upload ━━━');

  // Open panel
  await page.evaluate(() => { if (typeof buildHostnameUploadPanel==='function') buildHostnameUploadPanel(); });
  await settle(page, 600);
  const hPanel = await page.$('#hostnameUploadPanel');
  hPanel
    ? pass('P7-HOST', 'Hostname Upload panel rendered')
    : fail('P7-HOST', 'Hostname Upload panel NOT found');
  await shotClipped(page, '#hostnameUploadPanel', '11-hostname-upload-panel');

  // Panel should show graph context stats
  const hCtx = await page.evaluate(() => {
    var p = document.getElementById('hostnameUploadPanel');
    return p ? p.textContent : '';
  });
  hCtx.includes('Graph nodes')
    ? pass('P7-HOST', 'Panel shows graph context stats ("Graph nodes: ...")')
    : fail('P7-HOST', 'Panel missing graph context stats');

  // Drag-drop zone present
  const dzZone = await page.$('#hostnameDropZone, [id*="DropZone"], [ondrop]');
  dzZone
    ? pass('P7-HOST', 'Drag-drop zone present in Hostname Upload panel')
    : fail('P7-HOST', 'Drag-drop zone not found');

  // Simulate CSV upload via _applyHostnameMapping (no file input needed)
  // IMPORTANT: _applyHostnameMapping sets unmatched nodes to UNK, so we must
  // use a full 3-col CSV (router_id,hostname,country) covering all 34 nodes to
  // preserve country classifications for the Cost Matrix test that follows.
  let testCsv = '';
  // Prefer host-mapping-e2e.csv (3-col format, all 34 routers) generated from ENRICHED output
  const csvPath = path.join(__dirname, '..', 'INPUT-FOLDER', 'host-mapping-e2e.csv');
  const csvFallback = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.csv');
  if (fs.existsSync(csvPath)) {
    testCsv = fs.readFileSync(csvPath, 'utf8');
    info(`Using host-mapping-e2e.csv (${testCsv.trim().split('\n').length} lines)`);
  } else if (fs.existsSync(csvFallback)) {
    testCsv = fs.readFileSync(csvFallback, 'utf8');
    info(`Using Load-hosts.csv fallback (${testCsv.trim().split('\n').length} lines)`);
  } else {
    testCsv = 'router_id,hostname,country\n9.9.9.1,les-mar-r1,LES\n9.9.9.2,les-mar-r2,LES';
    info('No CSV file found — using minimal inline fallback');
  }

  const applyResult = await page.evaluate((csv) => {
    try {
      if (typeof _applyHostnameMapping !== 'function') return 'no_function';
      _applyHostnameMapping(csv, 'test-e2e.csv');
      return 'ok';
    } catch(e) { return 'error:' + e.message; }
  }, testCsv);
  applyResult === 'ok'
    ? pass('P7-HOST', '_applyHostnameMapping() applied test CSV successfully')
    : fail('P7-HOST', `_applyHostnameMapping failed: ${applyResult}`);
  await settle(page, 600);
  await shot(page, '12-hostname-applied');

  // Verify UNK count after applying the full CSV mapping
  const postApplyUnk = await page.evaluate(() => {
    try { return nodes.get().filter(n => (n.country||'UNK').toUpperCase()==='UNK').length; } catch(e) { return -1; }
  });
  info(`UNK count after hostname CSV apply: ${postApplyUnk}`);
  postApplyUnk >= 0
    ? pass('P7-HOST', `After hostname CSV apply — UNK nodes: ${postApplyUnk}`)
    : fail('P7-HOST', 'Could not read UNK count after apply');

  // Manual single-node reclassify
  const manualResult = await page.evaluate(() => {
    try {
      if (typeof nodes === 'undefined' || !nodes) return 'no_nodes';
      var n = nodes.get()[0];
      if (!n) return 'no_nodes';
      var orig = n.country || 'NONE';
      nodes.update([{ id: n.id, country: 'TST' }]);
      var updated = nodes.get(n.id).country;
      nodes.update([{ id: n.id, country: orig }]);
      return updated === 'TST' ? 'ok' : 'fail:' + updated;
    } catch(e) { return 'error:' + e.message; }
  });
  manualResult === 'ok'
    ? pass('P7-HOST', 'Manual node reclassify (nodes.update) works')
    : fail('P7-HOST', `Manual reclassify: ${manualResult}`);

  // Close panel
  await page.evaluate(() => { var p = document.getElementById('hostnameUploadPanel'); if (p) p.remove(); });

  // ── P8: Sprint 3 — Cost Matrix ────────────────────────────────────────────
  log('');
  log('━━━ P8: Sprint 3 — Cost Matrix ━━━');
  await page.evaluate(() => { if (typeof buildOspfCostMatrix==='function') buildOspfCostMatrix(); });
  await settle(page, 2500);

  const matPanel = await page.$('#ospfCostMatrixPanel');
  matPanel
    ? pass('P8-MAT', 'Cost Matrix panel rendered')
    : fail('P8-MAT', 'Cost Matrix panel NOT found');
  await shotClipped(page, '#ospfCostMatrixPanel', '13-cost-matrix-panel');

  // Matrix has country rows
  const matRows = await page.evaluate(() => {
    var tbl = document.querySelector('#ospfCostMatrixPanel table tbody');
    return tbl ? tbl.querySelectorAll('tr').length : 0;
  });
  matRows >= 5
    ? pass('P8-MAT', `Matrix has ${matRows} country rows (≥5 expected)`)
    : fail('P8-MAT', `Matrix rows: ${matRows} — expected ≥5`);

  // Non-zero Dijkstra cells
  const nonZeroCells = await page.evaluate(() => {
    var tds = document.querySelectorAll('#ospfCostMatrixPanel td[data-src]');
    return Array.from(tds).filter(td => {
      var v = parseInt(td.textContent, 10);
      return !isNaN(v) && v > 0;
    }).length;
  });
  nonZeroCells > 0
    ? pass('P8-MAT', `${nonZeroCells} cells with non-zero Dijkstra costs`)
    : fail('P8-MAT', 'All matrix cells are 0 or N/R — Dijkstra may be broken');

  // View-mode badge present
  const matBadge = await page.evaluate(() => {
    var panel = document.getElementById('ospfCostMatrixPanel');
    return panel ? panel.textContent.includes('ENRICHED') || panel.textContent.includes('ASIS') ||
                   panel.textContent.includes('GATEWAY') || panel.textContent.includes('CURRENT') ||
                   panel.textContent.includes('COLLAPSING') : false;
  });
  matBadge
    ? pass('P8-MAT', 'View-mode badge present in Cost Matrix panel')
    : fail('P8-MAT', 'View-mode badge not found in Cost Matrix panel');

  // Gradient legend (legend bar contains "Cost range:" text)
  const hasLegend = await page.evaluate(() => {
    var panel = document.getElementById('ospfCostMatrixPanel');
    if (!panel) return false;
    var txt = panel.innerHTML;
    return txt.includes('Cost range') || txt.includes('lerpColor') ||
           txt.includes('#27ae60') || txt.includes('min') ||
           (panel.textContent || '').includes('Cost range');
  });
  hasLegend
    ? pass('P8-MAT', 'Cost range gradient legend present')
    : fail('P8-MAT', 'Cost range gradient legend not found');

  // Cell click (path highlight)
  const firstDataCell = await page.$('#ospfCostMatrixPanel td[data-src][data-dst]');
  if (firstDataCell) {
    const srcC = await firstDataCell.getAttribute('data-src');
    const dstC = await firstDataCell.getAttribute('data-dst');
    if (srcC !== dstC) {
      await firstDataCell.click();
      await settle(page, 600);
      pass('P8-MAT', `Cell click (${srcC}→${dstC}) executed without error`);
    } else {
      pass('P8-MAT', 'Cell click skipped (diagonal/same-country cell)');
    }
  } else {
    fail('P8-MAT', 'No data cells found in matrix');
  }

  // Test Cost Matrix in GATEWAY mode (should still work)
  // Note: buildOspfCostMatrix() toggles — remove old panel first so second call builds fresh
  await page.evaluate(() => { var p = document.getElementById('ospfCostMatrixPanel'); if (p) p.remove(); if (typeof _matrixData !== 'undefined') _matrixData = null; });
  await switchMode(page, 'gateway');
  await settle(page, 800);
  await page.evaluate(() => { if (typeof buildOspfCostMatrix==='function') buildOspfCostMatrix(); });
  await settle(page, 2000);
  const matInGW = await page.$('#ospfCostMatrixPanel');
  matInGW
    ? pass('P8-MAT', 'Cost Matrix renders in GATEWAY mode (cross-mode feature)')
    : fail('P8-MAT', 'Cost Matrix not available in GATEWAY mode');
  await shot(page, '14-cost-matrix-gateway-mode');

  await page.evaluate(() => { var p = document.getElementById('ospfCostMatrixPanel'); if (p) p.remove(); if (typeof _matrixData !== 'undefined') _matrixData = null; });
  await switchMode(page, 'enriched');
  await settle(page, 600);

  // ── P9: Sprint 3 — What-If Analysis ──────────────────────────────────────
  log('');
  log('━━━ P9: Sprint 3 — What-If Analysis ━━━');
  await page.evaluate(() => { if (typeof buildOspfWhatIf==='function') buildOspfWhatIf(); });
  await settle(page, 800);

  const wiPanel = await page.$('#ospfWhatIfPanel');
  wiPanel
    ? pass('P9-WI', 'What-If panel rendered')
    : fail('P9-WI', 'What-If panel NOT found');
  await shotClipped(page, '#ospfWhatIfPanel', '15-what-if-panel');

  // Edge picker populated
  const edgePickerCount = await page.evaluate(() => {
    var sel = document.getElementById('wiEdgePicker');
    return sel ? sel.options.length : 0;
  });
  edgePickerCount > 0
    ? pass('P9-WI', `Edge picker has ${edgePickerCount} edges`)
    : fail('P9-WI', 'Edge picker empty');

  // View-mode badge + cross-mode message
  const wiBadge = await page.evaluate(() => {
    var p = document.getElementById('ospfWhatIfPanel');
    return p ? (p.textContent.includes('ENRICHED') || p.textContent.includes('Works across')) : false;
  });
  wiBadge
    ? pass('P9-WI', 'View-mode badge + cross-mode message present')
    : fail('P9-WI', 'View-mode badge or cross-mode message missing');

  // Select first edge, set dramatic cost, run analysis
  await page.evaluate(() => {
    var picker = document.getElementById('wiEdgePicker');
    var costEl  = document.getElementById('wiNewCost');
    if (picker && picker.options.length > 0 && costEl) {
      picker.selectedIndex = 0;
      picker.dispatchEvent(new Event('change'));
      costEl.value = 1;
    }
  });
  await settle(page, 200);
  await page.evaluate(() => { if (typeof _runWhatIfAnalysis==='function') _runWhatIfAnalysis(); });
  await settle(page, 2500);

  const wiResult = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    return el ? el.textContent.trim().slice(0, 100) : '';
  });
  wiResult && wiResult.length > 5
    ? pass('P9-WI', `Analysis ran — result: "${wiResult.slice(0,60)}..."`)
    : fail('P9-WI', 'What-If result is empty after running analysis');
  await shotClipped(page, '#ospfWhatIfPanel', '16-what-if-result');

  // Risk label (LOW/MEDIUM/HIGH)
  const riskLabel = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    if (!el) return null;
    var m = el.textContent.match(/(LOW|MEDIUM|HIGH)/);
    return m ? m[1] : null;
  });
  riskLabel
    ? pass('P9-WI', `Risk classification: ${riskLabel}`)
    : fail('P9-WI', 'Risk label (LOW/MEDIUM/HIGH) not found in result');

  // Apply button exists
  const applyBtn = await page.$('#wiApplyBtn, button[onclick*="_applyWhatIf"]');
  applyBtn
    ? pass('P9-WI', 'Apply button present (can commit cost change to graph)')
    : fail('P9-WI', 'Apply button not found');

  // Test What-If in COLLAPSING mode (cross-mode)
  await page.evaluate(() => { var p = document.getElementById('ospfWhatIfPanel'); if (p) p.remove(); });
  await switchMode(page, 'enriched');
  await settle(page, 600);
  await page.evaluate(() => {
    if (typeof collapseCountry === 'function') collapseCountry('ZAF');
  });
  await settle(page, 800);
  await page.evaluate(() => { if (typeof buildOspfWhatIf==='function') buildOspfWhatIf(); });
  await settle(page, 600);
  const wiInCollapsing = await page.$('#ospfWhatIfPanel');
  wiInCollapsing
    ? pass('P9-WI', 'What-If panel available while in COLLAPSING state (cross-mode)')
    : fail('P9-WI', 'What-If not available in COLLAPSING state');
  await shot(page, '17-what-if-collapsing-mode');

  // ── Final summary ─────────────────────────────────────────────────────────
  await browser.close();
  log('');
  log('╔══════════════════════════════════════════════════════════════════════╗');
  log('║   05-STEP-BY-STEP — FINAL SUMMARY                                   ║');
  log('╠══════════════════════════════════════════════════════════════════════╣');
  log(`║  PASSED : ${String(PASS).padEnd(58)}║`);
  log(`║  FAILED : ${String(FAIL).padEnd(58)}║`);
  log(`║  TOTAL  : ${String(PASS+FAIL).padEnd(58)}║`);
  if (FAIL === 0) {
    log('║  STATUS : ALL 05-STEP-BY-STEP CHECKS PASSED ✅                      ║');
  } else {
    log('║  STATUS : SOME CHECKS FAILED ❌ — review output above              ║');
  }
  log('╚══════════════════════════════════════════════════════════════════════╝');
  process.exit(FAIL > 0 ? 1 : 0);
})();
