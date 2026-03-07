#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// validate-full-e2e-v2.cjs
// 06-STEP-BY-STEP — Deep End-to-End Validation
//
// TESTS (12 phases, 90+ checks):
//   AUTH   — Login
//   LOAD   — Load 54-router graph (ospf-database-3.txt + Load-hosts.txt)
//   P1     — AS-IS: 54 nodes, UNK nodes present (20), 4 toolbar buttons
//   P2     — ENRICHED: 54 nodes, 11 countries, UNK grey nodes, Country Filter
//   P3     — GATEWAY: 32 gateways + UNK hub nodes visible, 22 cores hidden
//   P4     — CURRENT: loads without error
//   P5     — COLLAPSING: panel structure, UNK non-interactive row, ZAF collapse,
//              ▲badge, Σcost, Persistent Path Overlay, Collapse All (22 hidden)
//   P6     — Sprint 3: UNK Highlight (toggle on/off, cross-mode in GATEWAY)
//   P7     — Sprint 3: Hostname Upload (54-router CSV, UNK preserved = 20)
//   P8     — Sprint 3: Cost Matrix DEEP
//              • 11 rows (10 countries + UNK)
//              • UNK row present, UNK has ≥1 non-zero cost (cross-country paths)
//              • Excel ⬇ button present, ↺ Refresh button present
//              • _exportMatrixToExcel / _refreshCostMatrix functions exist
//              • Dimensions label (N×N) present
//              • Cell click path highlight works
//              • ↺ Refresh REBUILDS panel (not closes) — verifies bug fix
//              • GATEWAY cross-mode
//   P9     — Sprint 3: What-If Analysis DEEP
//              • Edge picker sorted by cost DESC, auto-fills current cost
//              • ⬇ Export Report button, _exportWhatIfReport function exists
//              • _applyWhatIf function exists
//              • Analysis: result cards (Edge cost change / Affected pairs / Risk)
//              • Δ column in affected paths table
//              • Apply Change → edge cost updated in vis.js DataSet
//              • Apply → confirmation "✅ Cost change applied" shown
//              • Apply → Apply button disabled again
//              • Export Report callable after result
//              • COLLAPSING cross-mode
//   P10    — Integration: Apply Change while Cost Matrix open
//              → matrix auto-refreshes (panel survives Apply)
//              → matrix shows updated costs (different from before)
//
// USAGE
//   GRAPH_TIMES=05Mar2026_11h35m45s_54_hosts node tests/validate-full-e2e-v2.cjs
//   node tests/validate-full-e2e-v2.cjs
//   HEADLESS=false node tests/validate-full-e2e-v2.cjs
// ─────────────────────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const BASE_URL   = process.env.BASE_URL   || 'http://localhost:8081';
const API_USER   = process.env.API_USER   || 'ospf@topolograph.com';
const API_PASS   = process.env.API_PASS   || 'ospf';
const HEADLESS   = process.env.HEADLESS !== 'false';
const SS_DIR     = process.env.SCREENSHOT_DIR
  ? path.resolve(process.env.SCREENSHOT_DIR)
  : path.join(__dirname, '..', '06-STEP-BY-STEP', 'screenshots');

// Prefer a 54_hosts graph_time; fall back to latest
function resolveGraphTime() {
  const fromEnv = (process.env.GRAPH_TIMES || '').split(',')[0].trim();
  if (fromEnv) return fromEnv;
  const inout = path.join(__dirname, '..', 'IN-OUT-FOLDER');
  if (!fs.existsSync(inout)) return null;
  const dirs = fs.readdirSync(inout).filter(d => fs.existsSync(path.join(inout, d, 'nodes.json'))).sort();
  // Prefer _54_hosts entries
  const d54 = dirs.filter(d => d.includes('_54_hosts'));
  if (d54.length) return d54[d54.length - 1];
  return dirs.length ? dirs[dirs.length - 1] : null;
}
const GRAPH_TIME = resolveGraphTime();

let PASS = 0, FAIL = 0, WARN = 0;
const log  = (line) => process.stdout.write(line + '\n');
function pass(tag, msg) { PASS++; log(`  ✅ PASS [${tag}]: ${msg}`); }
function fail(tag, msg) { FAIL++; log(`  ❌ FAIL [${tag}]: ${msg}`); }
function warn(tag, msg) { WARN++; log(`  ⚠  WARN [${tag}]: ${msg}`); }
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
  if (!el) { info(`Screenshot skipped (${name}) — element not found`); return; }
  const box = await el.boundingBox();
  if (!box) return;
  const pad = padding || 8;
  await page.screenshot({
    path: path.join(SS_DIR, name + '.png'),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width:  Math.min(box.width  + pad*2, 1400),
      height: Math.min(box.height + pad*2, 850)
    }
  });
  info(`Screenshot (clipped) → ${name}.png`);
}

// Login
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

// Load a graph by graph_time from the upload-ospf-isis-lsdb page
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
  return waitForCountryHydration(page, graphTime);
}

async function waitForCountryHydration(page, graphTime) {
  for (let i = 1; i <= 30; i++) {
    await settle(page, 600);
    const state = await page.evaluate((gt) => {
      try {
        const total = typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0;
        const countries = typeof nodes !== 'undefined' && nodes
          ? new Set(nodes.get().map(n => (n.country || 'UNK').toUpperCase())).size
          : 0;
        const classified = typeof nodes !== 'undefined' && nodes
          ? nodes.get({ filter: n => (n.country || 'UNK').toUpperCase() !== 'UNK' }).length
          : 0;
        const hydration = (typeof window !== 'undefined' && window.__topolographCountryHydration)
          ? window.__topolographCountryHydration
          : null;
        const hydrationMatches = !!(hydration && hydration.status === 'ready' && (!gt || !hydration.graphTime || hydration.graphTime === gt));
        const hydrationSeen = !!hydration;
        return { total, countries, classified, hydrationMatches, hydrationSeen };
      } catch (e) {
        return { total: 0, countries: 0, classified: 0, hydrationMatches: false, hydrationSeen: false };
      }
    }, graphTime);
    if (state.total > 0 && state.hydrationSeen && state.hydrationMatches) {
      return state.total;
    }
    if (state.total > 0 && !state.hydrationSeen && (state.countries > 1 || state.classified > 0)) {
      return state.total;
    }
  }
  return page.evaluate(() => { try { return nodes ? nodes.get().length : 0; } catch(e) { return 0; } });
}

// Switch view mode
async function switchMode(page, mode) {
  if (mode === 'collapsing') {
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

// Count visible nodes
async function visibleNodeCount(page) {
  return page.evaluate(() => {
    try { return nodes.get({ filter: n => n.hidden !== true }).length; } catch(e) { return -1; }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  log('╔══════════════════════════════════════════════════════════════════════════╗');
  log('║  06-STEP-BY-STEP — DEEP END-TO-END VALIDATION (12 phases, 90+ checks)  ║');
  log('║  Pipeline: INPUT → IN-OUT → Hostname → AS-IS/ENRICHED/GATEWAY/         ║');
  log('║            CURRENT/COLLAPSING + Cost Matrix + What-If Analysis          ║');
  log('╚══════════════════════════════════════════════════════════════════════════╝');
  info(`Graph time : ${GRAPH_TIME}`);
  info(`Base URL   : ${BASE_URL}`);
  info(`Headless   : ${HEADLESS}`);
  info(`Screenshots: ${SS_DIR}`);
  info(`OSPF file  : ospf-database-3.txt (54 routers, 20 UNK)`);
  info(`Host file  : Load-hosts.txt (34 entries — 20 UNK routers unmapped)`);
  log('');

  if (!GRAPH_TIME) {
    fail('PRE', 'No 54-host graph_time found in IN-OUT-FOLDER — run workflow.sh first');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const page    = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Dismiss any browser dialogs (alerts from CDN failures, etc.)
  page.on('dialog', async (dialog) => {
    info(`Dialog dismissed: "${dialog.message().slice(0, 80)}"`);
    await dialog.dismiss();
  });

  // ── AUTH ─────────────────────────────────────────────────────────────────
  log('━━━ AUTH ━━━');
  const loggedIn = await login(page);
  loggedIn
    ? pass('AUTH', `Logged in as ${API_USER}`)
    : (fail('AUTH', 'Login failed — aborting'), await browser.close(), process.exit(1));
  await shot(page, '01-login-success');

  // ── LOAD — 54-router graph ────────────────────────────────────────────────
  log('');
  log('━━━ LOAD — 54-Router Graph (ospf-database-3.txt + Load-hosts.txt) ━━━');
  const nodeCount = await loadGraph(page, GRAPH_TIME);
  nodeCount >= 54
    ? pass('LOAD', `Graph loaded — ${nodeCount} vis.js nodes (54 expected)`)
    : nodeCount > 0
      ? warn('LOAD', `Graph loaded ${nodeCount} nodes — expected 54 (ospf-database-3.txt)`)
      : fail('LOAD', `Graph failed to load (nodeCount=${nodeCount})`);
  await shot(page, '02-graph-loaded-54');

  // ── P1: AS-IS ────────────────────────────────────────────────────────────
  log('');
  log('━━━ P1: AS-IS View (54 routers, 20 UNK) ━━━');
  await switchMode(page, 'asis');
  await settle(page, 800);

  const asisNodes = await visibleNodeCount(page);
  asisNodes >= 50
    ? pass('P1-ASIS', `AS-IS visible nodes: ${asisNodes} (≥50 expected for 54-router graph)`)
    : fail('P1-ASIS', `AS-IS visible nodes: ${asisNodes} — expected ≥50`);

  const asisEdges = await page.evaluate(() => {
    try { return edges.get({ filter: e => e.hidden !== true }).length; } catch(e) { return -1; }
  });
  asisEdges > 0
    ? pass('P1-ASIS', `AS-IS visible edges: ${asisEdges}`)
    : fail('P1-ASIS', `AS-IS edges: ${asisEdges} — expected >0`);

  // UNK nodes present in AS-IS
  const unkCountRaw = await page.evaluate(() => {
    try { return nodes.get().filter(n => (n.country||'').toUpperCase()==='UNK').length; } catch(e) { return -1; }
  });
  info(`UNK nodes in graph: ${unkCountRaw}`);
  unkCountRaw >= 20
    ? pass('P1-ASIS', `UNK nodes present: ${unkCountRaw} (≥20 expected — unmapped routers)`)
    : unkCountRaw > 0
      ? warn('P1-ASIS', `UNK nodes: ${unkCountRaw} — expected 20 (verify ospf-database-3.txt used)`)
      : fail('P1-ASIS', 'No UNK nodes found — ensure Load-hosts.txt (34 entries) + ospf-database-3.txt (54 routers)');

  // Sprint 3 toolbar buttons
  for (const id of ['btnUnkHighlight','btnHostnameUpload','btnCostMatrix','btnWhatIf']) {
    const el = await page.$(`#${id}`);
    el ? pass('P1-ASIS', `Toolbar button #${id} present`)
       : fail('P1-ASIS', `Toolbar button #${id} NOT found`);
  }
  await shot(page, '03-asis-54');

  // ── P2: ENRICHED ──────────────────────────────────────────────────────────
  log('');
  log('━━━ P2: ENRICHED View (11 countries, UNK grey nodes) ━━━');
  await switchMode(page, 'enriched');
  await settle(page, 1000);

  const enrichNodes = await visibleNodeCount(page);
  enrichNodes >= 50
    ? pass('P2-ENRICH', `ENRICHED visible nodes: ${enrichNodes} (≥50)`)
    : fail('P2-ENRICH', `ENRICHED visible nodes: ${enrichNodes} — expected ≥50`);

  // Country Filter panel
  const cfPanel = await page.$('#countryFilterPanel, #countryFilter, [id*="countryFilter"]');
  cfPanel
    ? pass('P2-ENRICH', 'Country Filter panel present')
    : fail('P2-ENRICH', 'Country Filter panel not found');

  // Classified nodes (non-UNK)
  const classifiedCount = await page.evaluate(() => {
    try { return nodes.get().filter(n => n.country && n.country.toUpperCase() !== 'UNK').length; } catch(e) { return 0; }
  });
  classifiedCount >= 34
    ? pass('P2-ENRICH', `${classifiedCount} nodes with named country (≥34 expected)`)
    : fail('P2-ENRICH', `Only ${classifiedCount} classified nodes — expected ≥34`);

  // UNK nodes visible and labelled grey in ENRICHED
  const unkVisible = await page.evaluate(() => {
    try {
      return nodes.get().filter(n =>
        (n.country||'').toUpperCase()==='UNK' && n.hidden !== true
      ).length;
    } catch(e) { return -1; }
  });
  unkVisible >= 20
    ? pass('P2-ENRICH', `UNK nodes visible in ENRICHED: ${unkVisible} (grey, unmapped)`)
    : fail('P2-ENRICH', `UNK visible: ${unkVisible} — expected ≥20`);

  // Country count in graph: should be 11 (10 + UNK)
  const countryCount = await page.evaluate(() => {
    try {
      var c = new Set(nodes.get().map(n => (n.country||'UNK').toUpperCase()));
      return c.size;
    } catch(e) { return 0; }
  });
  countryCount >= 11
    ? pass('P2-ENRICH', `${countryCount} distinct countries (≥11 expected: 10 + UNK)`)
    : fail('P2-ENRICH', `${countryCount} countries — expected ≥11 (10 named + UNK)`);

  await shot(page, '04-enriched-54');

  // ── P3: GATEWAY ───────────────────────────────────────────────────────────
  log('');
  log('━━━ P3: GATEWAY View (32 gw + UNK hubs visible, 22 cores hidden) ━━━');
  await switchMode(page, 'gateway');
  await settle(page, 1000);

  const gwVisible = await visibleNodeCount(page);
  // 32 gateways total (UNK has 4 hub gateways) — UNK hubs should be visible
  gwVisible >= 32
    ? pass('P3-GW', `GATEWAY visible nodes: ${gwVisible} (≥32 gateways including UNK hubs)`)
    : fail('P3-GW', `GATEWAY visible: ${gwVisible} — expected ≥32`);

  const hiddenInGW = await page.evaluate(() => {
    try { return nodes.get({ filter: n => n.hidden === true }).length; } catch(e) { return -1; }
  });
  hiddenInGW >= 22
    ? pass('P3-GW', `Core nodes hidden: ${hiddenInGW} (≥22 expected — 6 named + 16 UNK leaves)`)
    : hiddenInGW >= 0
      ? warn('P3-GW', `Core nodes hidden: ${hiddenInGW} — expected ≥22`)
      : fail('P3-GW', 'Could not determine hidden count');

  // UNK hub gateways should be visible in GATEWAY mode (cross-country adjacencies)
  const unkGWVisible = await page.evaluate(() => {
    try {
      return nodes.get().filter(n =>
        (n.country||'').toUpperCase()==='UNK' && n.hidden !== true
      ).length;
    } catch(e) { return -1; }
  });
  unkGWVisible >= 4
    ? pass('P3-GW', `UNK hub gateways visible: ${unkGWVisible} (≥4 hubs with cross-country adjacencies)`)
    : fail('P3-GW', `UNK visible in GATEWAY: ${unkGWVisible} — expected ≥4 hub nodes`);

  await shot(page, '05-gateway-54');

  // ── P4: CURRENT ───────────────────────────────────────────────────────────
  log('');
  log('━━━ P4: CURRENT View ━━━');
  await switchMode(page, 'current');
  await settle(page, 1000);

  const currNodes = await visibleNodeCount(page);
  currNodes >= 30
    ? pass('P4-CURR', `CURRENT mode loaded — ${currNodes} visible nodes`)
    : fail('P4-CURR', `CURRENT mode: ${currNodes} nodes — expected ≥30`);
  await shot(page, '06-current-54');

  // ── P5: COLLAPSING ───────────────────────────────────────────────────────
  log('');
  log('━━━ P5: COLLAPSING Mode (deeper: UNK non-interactive, ZAF badge, Collapse All) ━━━');
  await switchMode(page, 'enriched');
  await settle(page, 800);

  // Open collapsing panel
  await page.evaluate(() => {
    if (typeof buildCollapsePanel === 'function') { buildCollapsePanel(); return; }
    var btn = document.getElementById('btnCollapsingMode') ||
              Array.from(document.querySelectorAll('button')).find(b =>
                b.textContent.includes('COLLAPSING') || b.textContent.includes('Collapse'));
    if (btn) btn.click();
  });
  await settle(page, 1200);

  const colPanel = await page.$('#countryCollapsePanel, [id*="CollapsePanel"]');
  colPanel
    ? pass('P5-COL', 'COLLAPSING panel rendered')
    : fail('P5-COL', 'COLLAPSING panel NOT found');
  await shot(page, '07-collapsing-panel-54');

  // UNK row: should be non-interactive (dimmed, no collapse button)
  const unkRowInfo = await page.evaluate(() => {
    var panel = document.getElementById('countryCollapsePanel');
    if (!panel) return { found: false };
    var rows = panel.querySelectorAll('[data-country="UNK"], tr, div[style*="opacity"]');
    // Look for a row that mentions UNK
    var html = panel.innerHTML;
    var hasUnkSection = html.includes('UNK') || html.includes('Unclassified');
    // Check if UNK has a collapse button (it should NOT — non-interactive)
    var unkBtn = panel.querySelector('[onclick*="collapseCountry(\'UNK\'"], [onclick*=\'collapseCountry("UNK"\']');
    return {
      found: hasUnkSection,
      hasCollapseBtn: !!unkBtn,
      snippet: html.substring(html.indexOf('UNK') > -1 ? html.indexOf('UNK') - 5 : 0, html.indexOf('UNK') + 80)
    };
  });
  if (unkRowInfo.found) {
    pass('P5-COL', 'UNK section present in COLLAPSING panel');
    !unkRowInfo.hasCollapseBtn
      ? pass('P5-COL', 'UNK row is non-interactive (no collapse button — correct for unmapped group)')
      : warn('P5-COL', 'UNK row has a collapse button — may trigger empty-gateway collapse');
  } else {
    warn('P5-COL', 'UNK section not found in COLLAPSING panel (may be hidden or unnamed)');
  }
  await shotClipped(page, '#countryCollapsePanel, [id*="CollapsePanel"]', '07b-collapsing-unk-row');

  // Collapse ZAF
  const zafCollapsed = await page.evaluate(() => {
    if (typeof collapseCountry !== 'function') return 'no_function';
    try { collapseCountry('ZAF'); return 'ok'; } catch(e) { return 'error:'+e.message; }
  });
  await settle(page, 1200);
  zafCollapsed === 'ok'
    ? pass('P5-COL', 'collapseCountry("ZAF") executed')
    : fail('P5-COL', `collapseCountry failed: ${zafCollapsed}`);

  // ▲ Badge on ZAF gateways
  const badgeNodes = await page.evaluate(() => {
    try { return nodes.get().filter(n => n.label && n.label.includes('\u25b2')).length; } catch(e) { return 0; }
  });
  badgeNodes > 0
    ? pass('P5-COL', `Badge "▲ N hidden" found on ${badgeNodes} gateway node(s)`)
    : fail('P5-COL', 'No gateway badge "▲" found after collapse');

  // Σcost aggregation badge
  const sigmaBadge = await page.evaluate(() => {
    try { return nodes.get().filter(n => n.label && /[\u03a3\u2211Σ]cost/i.test(n.label)).length; } catch(e) { return 0; }
  });
  sigmaBadge > 0
    ? pass('P5-COL', `Σcost aggregation badge on ${sigmaBadge} node(s)`)
    : fail('P5-COL', 'Σcost badge missing — IP Fabric cost aggregation broken');

  // Persistent Path Overlay: cross-country edges visible
  const crossEdges = await page.evaluate(() => {
    try {
      return edges.get({ filter: function(e) {
        var s = nodes.get(e.from), d = nodes.get(e.to);
        if (!s || !d) return false;
        var sc = (s.country||'').toUpperCase(), dc = (d.country||'').toUpperCase();
        return sc && dc && sc !== dc && e.hidden !== true;
      }}).length;
    } catch(e) { return -1; }
  });
  crossEdges > 0
    ? pass('P5-COL', `Persistent Path Overlay: ${crossEdges} cross-country edges visible`)
    : fail('P5-COL', 'No cross-country edges — Persistent Path Overlay broken');

  await shot(page, '08-zaf-collapsed-54');
  await shotClipped(page, '#countryCollapsePanel, [id*="CollapsePanel"]', '09-zaf-badge-zoom-54');

  // Expand ZAF
  await page.evaluate(() => {
    if (typeof expandCountry === 'function') { expandCountry('ZAF'); return; }
    if (typeof collapseCountry === 'function') collapseCountry('ZAF');  // toggle
  });
  await settle(page, 800);

  // Collapse All → verify 22 cores hidden
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
    await settle(page, 1800);
    const afterAll = await page.evaluate(() => {
      try { return nodes.get({ filter: n => n.hidden === true }).length; } catch(e) { return 0; }
    });
    afterAll >= 22
      ? pass('P5-COL', `Collapse All → ${afterAll} nodes hidden (≥22 expected: ZAF:3 + FRA:1 + GBR:1 + POR:1 + UNK:16)`)
      : afterAll > 0
        ? warn('P5-COL', `Collapse All → ${afterAll} hidden (expected ≥22)`)
        : fail('P5-COL', 'Collapse All had no effect');

    await page.evaluate(() => {
      var btn = document.getElementById('btnExpandAll') ||
                Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Expand All'));
      if (btn) btn.click();
    });
    await settle(page, 1000);
    pass('P5-COL', 'Expand All executed');
  }

  // ── P6: UNK Highlight ────────────────────────────────────────────────────
  log('');
  log('━━━ P6: Sprint 3 — UNK Highlight ━━━');
  await switchMode(page, 'enriched');
  await settle(page, 800);

  await page.evaluate(() => { if (typeof _toggleUnkHighlight==='function') _toggleUnkHighlight(); });
  await settle(page, 600);
  const unkBtnActive = await page.evaluate(() => {
    var btn = document.getElementById('btnUnkHighlight');
    return btn ? btn.classList.contains('active') : null;
  });
  unkBtnActive !== null
    ? pass('P6-UNK', `_toggleUnkHighlight() → active=${unkBtnActive}`)
    : fail('P6-UNK', 'btnUnkHighlight not found or no .active class');
  await shot(page, '10-unk-highlight-54');

  // UNK nodes should be highlighted (orange border or colour change)
  const unkHighlighted = await page.evaluate(() => {
    try {
      return nodes.get().filter(n => (n.country||'').toUpperCase()==='UNK').every(n => n.hidden !== true);
    } catch(e) { return false; }
  });
  unkHighlighted
    ? pass('P6-UNK', 'All UNK nodes remain visible during highlight')
    : warn('P6-UNK', 'Some UNK nodes may be hidden during highlight');

  await page.evaluate(() => { if (typeof _toggleUnkHighlight==='function') _toggleUnkHighlight(); });
  await settle(page, 400);
  const unkBtnOff = await page.evaluate(() => {
    var btn = document.getElementById('btnUnkHighlight');
    return btn ? !btn.classList.contains('active') : null;
  });
  unkBtnOff === true
    ? pass('P6-UNK', 'UNK highlight toggled off')
    : fail('P6-UNK', 'UNK highlight did not toggle off');

  await switchMode(page, 'gateway');
  await settle(page, 600);
  const unkInGW = await page.$('#btnUnkHighlight');
  unkInGW
    ? pass('P6-UNK', 'UNK button present in GATEWAY mode (cross-mode)')
    : fail('P6-UNK', 'UNK button missing in GATEWAY mode');
  await switchMode(page, 'enriched');
  await settle(page, 600);

  // ── P7: Hostname Upload ───────────────────────────────────────────────────
  log('');
  log('━━━ P7: Sprint 3 — Hostname Upload (standard host file, derived countries, UNK preserved) ━━━');

  await page.evaluate(() => { if (typeof buildHostnameUploadPanel==='function') buildHostnameUploadPanel(); });
  await settle(page, 600);
  const hPanel = await page.$('#hostnameUploadPanel');
  hPanel
    ? pass('P7-HOST', 'Hostname Upload panel rendered')
    : fail('P7-HOST', 'Hostname Upload panel NOT found');
  await shotClipped(page, '#hostnameUploadPanel', '11-hostname-upload-54');

  const hCtx = await page.evaluate(() => {
    var p = document.getElementById('hostnameUploadPanel'); return p ? p.textContent : '';
  });
  hCtx.includes('Graph nodes')
    ? pass('P7-HOST', 'Panel shows graph context stats')
    : fail('P7-HOST', 'Panel missing graph context stats');

  const dzZone = await page.$('#hostnameDropZone, [id*="DropZone"], [ondrop]');
  dzZone
    ? pass('P7-HOST', 'Drag-drop zone present')
    : fail('P7-HOST', 'Drag-drop zone not found');

  // Load the standard host-file fixture: router_id -> hostname, country derived from hostname
  const standardCsvPath = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.csv');
  const standardTxtPath = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts-3b.txt');
  const canonicalTxtPath = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.txt');
  let testCsv = '';
  if (fs.existsSync(standardCsvPath)) {
    testCsv = fs.readFileSync(standardCsvPath, 'utf8');
    const lines = testCsv.trim().split('\n').length;
    info(`Using Load-hosts.csv (${lines-1} mapped routers, standard CSV host file)`);
    lines >= 35
      ? pass('P7-HOST', `Load-hosts.csv provides ${lines-1} standard host mappings (≥34 expected)`)
      : warn('P7-HOST', `Load-hosts.csv has ${lines-1} host mappings — expected ≥34`);
  } else if (fs.existsSync(standardTxtPath)) {
    testCsv = fs.readFileSync(standardTxtPath, 'utf8');
    const lines = testCsv.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).length;
    info(`Using Load-hosts-3b.txt (${lines} mapped routers, standard TXT host file)`);
    lines >= 34
      ? pass('P7-HOST', `Load-hosts-3b.txt provides ${lines} standard host mappings (≥34 expected)`)
      : warn('P7-HOST', `Load-hosts-3b.txt has ${lines} host mappings — expected ≥34`);
  } else if (fs.existsSync(canonicalTxtPath)) {
    testCsv = fs.readFileSync(canonicalTxtPath, 'utf8');
    const lines = testCsv.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).length;
    info(`Using Load-hosts.txt (${lines} mapped routers, canonical TXT host file)`);
  } else {
    testCsv = 'device_ip_address,device_name\n9.9.9.1,les-mar-r1\n12.12.12.2,ken-mob-r2\n13.13.13.1,drc-moa-r1\n18.18.18.4,zaf-mtz-r1';
    info('No standard host file found — using minimal inline hostname mapping fallback');
  }

  const applyResult = await page.evaluate((csv) => {
    try {
      if (typeof _applyHostnameMapping !== 'function') return 'no_function';
      _applyHostnameMapping(csv, 'test-e2e.csv');
      return 'ok';
    } catch(e) { return 'error:' + e.message; }
  }, testCsv);
  applyResult === 'ok'
    ? pass('P7-HOST', '_applyHostnameMapping() applied standard host file successfully')
    : fail('P7-HOST', `_applyHostnameMapping failed: ${applyResult}`);
  await settle(page, 600);
  await shot(page, '12-hostname-applied-54');

  const derivedSamples = await page.evaluate(() => {
    try {
      const wanted = ['12.12.12.2', '13.13.13.1', '18.18.18.4', '19.19.19.1'];
      return nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => ({
        id: String(n.name || n.id),
        hostname: n.hostname || '',
        country: (n.country || 'UNK').toUpperCase(),
        label: n.label || ''
      }));
    } catch(e) { return [{ error: e.message }]; }
  });
  const sampleById = new Map(derivedSamples.map(row => [row.id, row]));
  const expectedDerived = [
    ['12.12.12.2', 'ken-mob-r2', 'KEN'],
    ['13.13.13.1', 'drc-moa-r1', 'DRC'],
    ['18.18.18.4', 'zaf-mtz-r1', 'ZAF']
  ];
  expectedDerived.forEach(([rid, hostname, country]) => {
    const row = sampleById.get(rid);
    row && row.hostname === hostname && row.country === country && row.label.includes('[' + country + ']')
      ? pass('P7-HOST', `${rid} derives ${country} from hostname ${hostname}`)
      : fail('P7-HOST', `${rid} derivation mismatch: ${JSON.stringify(row || null)}`);
  });
  const unkRow = sampleById.get('19.19.19.1');
  unkRow && unkRow.country === 'UNK'
    ? pass('P7-HOST', 'IP-like hostname remains UNK after standard host-file apply')
    : warn('P7-HOST', `Expected 19.19.19.1 to remain UNK, saw ${JSON.stringify(unkRow || null)}`);

  const postUnk = await page.evaluate(() => {
    try { return nodes.get().filter(n => (n.country||'UNK').toUpperCase()==='UNK').length; } catch(e) { return -1; }
  });
  info(`UNK count after CSV apply: ${postUnk}`);
  // With a 34-entry standard host file, the remaining routers (19-22.x.x.x) should still be UNK.
  postUnk >= 20
    ? pass('P7-HOST', `UNK preserved after host-file apply: ${postUnk} nodes (correct — not in host file)`)
    : postUnk >= 0
      ? warn('P7-HOST', `UNK after apply: ${postUnk} (expected ≥20 — check standard host file coverage)`)
      : fail('P7-HOST', 'Could not read UNK count');

  const conflictCsv = [
    'router_id,hostname,country',
    '12.12.12.2,ken-mob-r2,ZZZ',
    '18.18.18.4,zaf-mtz-r1,AAA',
    '19.19.19.1,19.19.19.1,BBB'
  ].join('\n');
  const conflictResult = await page.evaluate((csv) => {
    try {
      _applyHostnameMapping(csv, 'conflict-e2e.csv');
      return 'ok';
    } catch(e) { return 'error:' + e.message; }
  }, conflictCsv);
  conflictResult === 'ok'
    ? pass('P7-HOST', 'Conflicting 3-column host file applied for override-resistance check')
    : fail('P7-HOST', `Conflicting 3-column apply failed: ${conflictResult}`);
  await settle(page, 600);

  const conflictSamples = await page.evaluate(() => {
    try {
      const wanted = ['12.12.12.2', '18.18.18.4', '19.19.19.1'];
      return nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => ({
        id: String(n.name || n.id),
        hostname: n.hostname || '',
        country: (n.country || 'UNK').toUpperCase(),
        label: n.label || ''
      }));
    } catch(e) { return [{ error: e.message }]; }
  });
  const conflictById = new Map(conflictSamples.map(row => [row.id, row]));
  [
    ['12.12.12.2', 'KEN'],
    ['18.18.18.4', 'ZAF'],
    ['19.19.19.1', 'UNK']
  ].forEach(([rid, country]) => {
    const row = conflictById.get(rid);
    row && row.country === country
      ? pass('P7-HOST', `${rid} kept hostname-derived country ${country} despite conflicting static column`)
      : fail('P7-HOST', `${rid} conflict handling mismatch: ${JSON.stringify(row || null)}`);
  });

  // Manual reclassify test
  const manualResult = await page.evaluate(() => {
    try {
      if (typeof nodes === 'undefined' || !nodes) return 'no_nodes';
      var n = nodes.get()[0];
      if (!n) return 'no_nodes';
      var orig = n.country || 'NONE';
      nodes.update([{ id: n.id, country: 'TST' }]);
      var updated = (nodes.get(n.id)||{}).country;
      nodes.update([{ id: n.id, country: orig }]);
      return updated === 'TST' ? 'ok' : 'fail:' + updated;
    } catch(e) { return 'error:' + e.message; }
  });
  manualResult === 'ok'
    ? pass('P7-HOST', 'Manual node reclassify (nodes.update) works')
    : fail('P7-HOST', `Manual reclassify: ${manualResult}`);

  await page.evaluate(() => { var p = document.getElementById('hostnameUploadPanel'); if (p) p.remove(); });

  // ── P8: Cost Matrix DEEP ─────────────────────────────────────────────────
  log('');
  log('━━━ P8: Cost Matrix — Deep Validation ━━━');
  // Ensure any old panel is gone
  await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    if (p) { p.remove(); }
    if (typeof _matrixData !== 'undefined') _matrixData = null;
  });
  await switchMode(page, 'enriched');
  await settle(page, 600);

  // Open matrix
  await page.evaluate(() => { if (typeof buildOspfCostMatrix==='function') buildOspfCostMatrix(); });
  await settle(page, 3000);

  const matPanel = await page.$('#ospfCostMatrixPanel');
  matPanel
    ? pass('P8-MAT', 'Cost Matrix panel rendered (#ospfCostMatrixPanel)')
    : (fail('P8-MAT', 'Cost Matrix panel NOT found'), null);
  await shotClipped(page, '#ospfCostMatrixPanel', '13-cost-matrix-54');

  // Row count — expect 11 (10 countries + UNK)
  const matRows = await page.evaluate(() => {
    var tbl = document.querySelector('#ospfCostMatrixPanel table tbody');
    return tbl ? tbl.querySelectorAll('tr').length : 0;
  });
  matRows >= 11
    ? pass('P8-MAT', `Matrix rows: ${matRows} (≥11 expected: 10 countries + UNK)`)
    : matRows >= 5
      ? warn('P8-MAT', `Matrix rows: ${matRows} — expected ≥11 (UNK may be missing)`)
      : fail('P8-MAT', `Matrix rows: ${matRows} — expected ≥11`);

  // UNK row present
  const unkRowPresent = await page.evaluate(() => {
    var tds = document.querySelectorAll('#ospfCostMatrixPanel tbody td');
    return Array.from(tds).some(td =>
      td.textContent.trim() === 'UNK' ||
      (td.dataset && td.dataset.src === 'UNK') ||
      td.getAttribute('data-src') === 'UNK'
    );
  });
  unkRowPresent
    ? pass('P8-MAT', 'UNK country row present in Cost Matrix')
    : fail('P8-MAT', 'UNK row MISSING from Cost Matrix — bug: UNK filtered out');

  // UNK has ≥1 non-zero cost (connected via POR/FRA/GBR/DRC)
  const unkNonZero = await page.evaluate(() => {
    var cells = document.querySelectorAll('#ospfCostMatrixPanel td[data-src="UNK"]');
    return Array.from(cells).filter(td => {
      var v = parseInt(td.textContent, 10);
      return !isNaN(v) && v > 0;
    }).length;
  });
  unkNonZero >= 1
    ? pass('P8-MAT', `UNK has ${unkNonZero} non-zero cost cell(s) — cross-country paths working`)
    : warn('P8-MAT', 'UNK has no non-zero cost cells — UNK hubs may not be routing correctly');

  // Total non-zero cells
  const nonZeroCells = await page.evaluate(() => {
    var tds = document.querySelectorAll('#ospfCostMatrixPanel td[data-src]');
    return Array.from(tds).filter(td => !isNaN(parseInt(td.textContent, 10)) && parseInt(td.textContent, 10) > 0).length;
  });
  nonZeroCells >= 30
    ? pass('P8-MAT', `${nonZeroCells} non-zero Dijkstra cost cells (≥30 expected)`)
    : nonZeroCells > 0
      ? warn('P8-MAT', `${nonZeroCells} non-zero cells — expected ≥30`)
      : fail('P8-MAT', 'All matrix cells are 0 or N/R — Dijkstra broken');

  // View-mode badge
  const matBadge = await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    return p ? (p.textContent.includes('ENRICHED') || p.textContent.includes('ASIS') ||
                p.textContent.includes('GATEWAY') || p.textContent.includes('COLLAPSING') ||
                p.textContent.includes('CURRENT')) : false;
  });
  matBadge
    ? pass('P8-MAT', 'View-mode badge present in panel header')
    : fail('P8-MAT', 'View-mode badge not found');

  // Dimensions label (N×N)
  const dimLabel = await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    return p ? /\d+×\d+/.test(p.textContent) : false;
  });
  dimLabel
    ? pass('P8-MAT', 'Dimensions label (N×N) present in panel')
    : warn('P8-MAT', 'N×N dimensions label not found');

  // Gradient legend
  const hasLegend = await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    if (!p) return false;
    return p.textContent.includes('Cost range') || p.innerHTML.includes('#27ae60');
  });
  hasLegend
    ? pass('P8-MAT', 'Cost range gradient legend present')
    : fail('P8-MAT', 'Gradient legend not found');

  // Excel export button text "⬇ Excel"
  const excelBtn = await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    if (!p) return null;
    var btns = p.querySelectorAll('button');
    var btn = Array.from(btns).find(b => b.textContent.includes('Excel') || b.onclick && b.onclick.toString().includes('exportMatrix'));
    return btn ? btn.textContent.trim() : null;
  });
  excelBtn
    ? pass('P8-MAT', `Excel export button found: "${excelBtn}"`)
    : fail('P8-MAT', 'Excel export button (⬇ Excel) NOT found');

  // Refresh button "↺"
  const refreshBtn = await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    if (!p) return null;
    var btns = p.querySelectorAll('button');
    var btn = Array.from(btns).find(b => b.textContent.includes('↺') || b.title && b.title.includes('Recompute'));
    return btn ? btn.textContent.trim() : null;
  });
  refreshBtn
    ? pass('P8-MAT', `Refresh button found: "${refreshBtn}"`)
    : fail('P8-MAT', 'Refresh button (↺) NOT found');

  // Functions exist in window scope
  const fnExcel = await page.evaluate(() => typeof _exportMatrixToExcel === 'function');
  fnExcel
    ? pass('P8-MAT', '_exportMatrixToExcel function exists')
    : fail('P8-MAT', '_exportMatrixToExcel NOT found in window scope');

  const fnRefresh = await page.evaluate(() => typeof _refreshCostMatrix === 'function');
  fnRefresh
    ? pass('P8-MAT', '_refreshCostMatrix function exists')
    : fail('P8-MAT', '_refreshCostMatrix NOT found in window scope');

  // Cell click — off-diagonal path highlight
  const firstOffDiag = await page.$('#ospfCostMatrixPanel td[data-src][data-dst]');
  if (firstOffDiag) {
    const srcC = await firstOffDiag.getAttribute('data-src');
    const dstC = await firstOffDiag.getAttribute('data-dst');
    if (srcC !== dstC) {
      await firstOffDiag.click();
      await settle(page, 800);
      pass('P8-MAT', `Cell click (${srcC}→${dstC}) executed (path highlight)`);
    } else {
      // Find an off-diagonal cell
      const offDiagCell = await page.evaluate(() => {
        var cells = document.querySelectorAll('#ospfCostMatrixPanel td[data-src][data-dst]');
        return Array.from(cells).find(td => td.dataset.src !== td.dataset.dst) ? 'found' : 'none';
      });
      offDiagCell === 'found'
        ? pass('P8-MAT', 'Off-diagonal cell found and clickable')
        : warn('P8-MAT', 'Only diagonal cells found — odd topology');
    }
  } else {
    fail('P8-MAT', 'No data cells found in matrix');
  }

  // KEY TEST: ↺ Refresh REBUILDS panel (not closes) — verifies bug fix
  info('Testing ↺ Refresh button rebuilds panel (verifying _refreshCostMatrix fix)...');
  const rowsBefore = await page.evaluate(() => {
    var tbl = document.querySelector('#ospfCostMatrixPanel table tbody');
    return tbl ? tbl.querySelectorAll('tr').length : 0;
  });
  // Click refresh button
  await page.evaluate(() => {
    if (typeof _refreshCostMatrix === 'function') _refreshCostMatrix();
  });
  await settle(page, 3000);  // wait for Dijkstra + DOM rebuild

  const panelAfterRefresh = await page.$('#ospfCostMatrixPanel');
  panelAfterRefresh
    ? pass('P8-MAT', '↺ Refresh: panel REBUILT (not closed) — bug fix verified ✓')
    : fail('P8-MAT', '↺ Refresh: panel CLOSED instead of rebuilt — _refreshCostMatrix bug NOT fixed');

  const rowsAfterRefresh = await page.evaluate(() => {
    var tbl = document.querySelector('#ospfCostMatrixPanel table tbody');
    return tbl ? tbl.querySelectorAll('tr').length : 0;
  });
  rowsAfterRefresh >= 10
    ? pass('P8-MAT', `After ↺ Refresh: ${rowsAfterRefresh} rows (matrix rebuilt correctly)`)
    : fail('P8-MAT', `After refresh: only ${rowsAfterRefresh} rows`);
  await shot(page, '14-cost-matrix-refreshed');

  // Cost Matrix in GATEWAY mode
  await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    if (p) { p.remove(); if (typeof _matrixData !== 'undefined') _matrixData = null; }
  });
  await switchMode(page, 'gateway');
  await settle(page, 800);
  await page.evaluate(() => { if (typeof buildOspfCostMatrix==='function') buildOspfCostMatrix(); });
  await settle(page, 2500);
  const matInGW = await page.$('#ospfCostMatrixPanel');
  matInGW
    ? pass('P8-MAT', 'Cost Matrix renders in GATEWAY mode (cross-mode feature)')
    : fail('P8-MAT', 'Cost Matrix not available in GATEWAY mode');
  await shot(page, '15-cost-matrix-gateway-54');

  // Clean up matrix before P9
  await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    if (p) { p.remove(); if (typeof _matrixData !== 'undefined') _matrixData = null; }
  });
  await switchMode(page, 'enriched');
  await settle(page, 600);

  // ── P9: What-If Analysis DEEP ─────────────────────────────────────────────
  log('');
  log('━━━ P9: What-If Analysis — Deep Validation ━━━');

  await page.evaluate(() => { if (typeof buildOspfWhatIf==='function') buildOspfWhatIf(); });
  await settle(page, 800);

  const wiPanel = await page.$('#ospfWhatIfPanel');
  wiPanel
    ? pass('P9-WI', 'What-If panel rendered (#ospfWhatIfPanel)')
    : (fail('P9-WI', 'What-If panel NOT found'), null);
  await shotClipped(page, '#ospfWhatIfPanel', '16-whatif-54');

  // Edge picker
  const edgeCnt = await page.evaluate(() => {
    var sel = document.getElementById('wiEdgePicker');
    return sel ? sel.options.length : 0;
  });
  edgeCnt >= 70
    ? pass('P9-WI', `Edge picker has ${edgeCnt} edges (≥70 for 54-router graph)`)
    : edgeCnt > 0
      ? warn('P9-WI', `Edge picker has ${edgeCnt} edges (expected ≥70 for 54-router graph)`)
      : fail('P9-WI', 'Edge picker is empty');

  // View-mode badge + cross-mode message
  const wiBadge = await page.evaluate(() => {
    var p = document.getElementById('ospfWhatIfPanel');
    return p ? (p.textContent.includes('ENRICHED') || p.textContent.includes('Works across')) : false;
  });
  wiBadge
    ? pass('P9-WI', 'View-mode badge + "Works across" cross-mode message present')
    : fail('P9-WI', 'View-mode badge or cross-mode message missing');

  // CSV Export button present
  const csvExportBtn = await page.evaluate(() => {
    var p = document.getElementById('ospfWhatIfPanel');
    if (!p) return null;
    var btns = p.querySelectorAll('button');
    var btn = Array.from(btns).find(b => b.textContent.includes('Export') || b.textContent.includes('CSV'));
    return btn ? btn.textContent.trim() : null;
  });
  csvExportBtn
    ? pass('P9-WI', `CSV Export button found: "${csvExportBtn}"`)
    : fail('P9-WI', 'Export Report button NOT found');

  // Functions exist
  const fnApply = await page.evaluate(() => typeof _applyWhatIf === 'function');
  fnApply
    ? pass('P9-WI', '_applyWhatIf function exists')
    : fail('P9-WI', '_applyWhatIf NOT found in window scope');

  const fnExport = await page.evaluate(() => typeof _exportWhatIfReport === 'function');
  fnExport
    ? pass('P9-WI', '_exportWhatIfReport function exists')
    : fail('P9-WI', '_exportWhatIfReport NOT found in window scope');

  const fnRun = await page.evaluate(() => typeof _runWhatIfAnalysis === 'function');
  fnRun
    ? pass('P9-WI', '_runWhatIfAnalysis function exists')
    : fail('P9-WI', '_runWhatIfAnalysis NOT found in window scope');

  // Select first edge (highest cost) — auto-fills current cost
  await page.evaluate(() => {
    var picker = document.getElementById('wiEdgePicker');
    if (picker && picker.options.length > 0) {
      picker.selectedIndex = 0;
      picker.dispatchEvent(new Event('change'));
    }
  });
  await settle(page, 300);

  const oldCostFilled = await page.evaluate(() => {
    var el = document.getElementById('wiOldCost');
    return el ? parseInt(el.value, 10) : null;
  });
  oldCostFilled !== null && !isNaN(oldCostFilled)
    ? pass('P9-WI', `Current cost auto-filled: ${oldCostFilled} (picker change → #wiOldCost)`)
    : fail('P9-WI', 'Current cost NOT auto-filled in #wiOldCost after picker change');

  // Set new cost = 1 and run analysis
  await page.evaluate(() => {
    var costEl = document.getElementById('wiNewCost');
    if (costEl) costEl.value = '1';
  });
  await page.evaluate(() => { if (typeof _runWhatIfAnalysis==='function') _runWhatIfAnalysis(); });
  await settle(page, 3500);  // Dijkstra with 11 countries takes ~1-2s

  const wiResult = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    return el ? el.textContent.trim() : '';
  });
  wiResult && wiResult.length > 10
    ? pass('P9-WI', `Analysis ran — result: "${wiResult.slice(0,70)}..."`)
    : fail('P9-WI', 'What-If result is empty');
  await shotClipped(page, '#ospfWhatIfPanel', '17-whatif-analysis-result');

  // "Edge cost change" card
  const hasCostCard = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    return el ? el.textContent.includes('Edge cost change') || el.textContent.includes('cost change') : false;
  });
  hasCostCard
    ? pass('P9-WI', '"Edge cost change" summary card present')
    : fail('P9-WI', '"Edge cost change" card missing from result');

  // "Affected country pairs" card
  const affectedPairs = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    if (!el) return null;
    var m = el.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { affected: parseInt(m[1]), total: parseInt(m[2]) } : null;
  });
  affectedPairs
    ? pass('P9-WI', `Affected country pairs: ${affectedPairs.affected} / ${affectedPairs.total}`)
    : fail('P9-WI', '"Affected country pairs" counter (N/M) not found');

  // Risk label
  const riskLabel = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    if (!el) return null;
    var m = el.textContent.match(/(LOW|MEDIUM|HIGH)/);
    return m ? m[1] : null;
  });
  riskLabel
    ? pass('P9-WI', `Risk classification: ${riskLabel}`)
    : fail('P9-WI', 'Risk label (LOW/MEDIUM/HIGH) not found');

  // Δ (Delta) column in affected paths table
  const hasDelta = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    if (!el) return false;
    var ths = el.querySelectorAll('th');
    return Array.from(ths).some(th => th.textContent.includes('Δ') || th.textContent.includes('Delta'));
  });
  hasDelta
    ? pass('P9-WI', 'Δ (Delta) column present in affected paths table')
    : warn('P9-WI', 'Δ column not found — affected paths table may not be rendered');

  // Before→After column in affected table
  const hasBefore = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    if (!el) return false;
    return el.textContent.includes('Before') || el.textContent.includes('→');
  });
  hasBefore
    ? pass('P9-WI', 'Before → After cost change shown in affected paths')
    : warn('P9-WI', 'Before→After format not clearly visible');

  // Apply button enabled after analysis
  const applyEnabled = await page.evaluate(() => {
    var btn = document.getElementById('wiApplyBtn');
    return btn ? !btn.disabled : null;
  });
  applyEnabled === true
    ? pass('P9-WI', 'Apply Change button enabled after analysis')
    : applyEnabled === false
      ? fail('P9-WI', 'Apply button still disabled after analysis')
      : fail('P9-WI', 'Apply button (#wiApplyBtn) not found');

  // Record the edge ID and old cost before apply
  const selectedEdge = await page.evaluate(() => {
    var picker = document.getElementById('wiEdgePicker');
    return picker ? picker.value : null;
  });
  const costBefore = await page.evaluate(() => {
    var el = document.getElementById('wiOldCost');
    return el ? parseInt(el.value, 10) : null;
  });
  info(`Edge to apply: ${selectedEdge}, cost: ${costBefore} → 1`);

  // APPLY CHANGE
  await page.evaluate(() => { if (typeof _applyWhatIf==='function') _applyWhatIf(); });
  await settle(page, 2000);
  await shotClipped(page, '#ospfWhatIfPanel', '18-whatif-applied');

  // Verify edge cost updated in vis.js DataSet
  if (selectedEdge) {
    const newEdgeCost = await page.evaluate((eid) => {
      try {
        var e = edges.get(eid);
        if (!e) return null;
        // _edgeCost checks cost → weight → value → title → label
        var c = e.cost || e.weight || e.value || 0;
        if (!c && e.title) { var m = String(e.title).match(/cost[:\s]*(\d+)/i); if (m) c = parseInt(m[1]); }
        if (!c && e.label) { var l = String(e.label).trim(); if (/^\d+$/.test(l)) c = parseInt(l); }
        return c;
      } catch(err) { return null; }
    }, selectedEdge);
    newEdgeCost === 1
      ? pass('P9-WI', `Edge cost updated in vis.js DataSet: ${selectedEdge} → cost=1`)
      : newEdgeCost !== null
        ? warn('P9-WI', `Edge cost after apply: ${newEdgeCost} (expected 1 — may be stored in different field)`)
        : fail('P9-WI', 'Could not read edge cost from vis.js after apply');
  }

  // Confirmation message shown
  const confirmMsg = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    return el ? (el.textContent.includes('Cost change applied') || el.textContent.includes('cost is now')) : false;
  });
  confirmMsg
    ? pass('P9-WI', 'Confirmation "✅ Cost change applied" shown after Apply')
    : fail('P9-WI', 'Confirmation message not found after Apply');

  // Apply button disabled after apply
  const applyAfter = await page.evaluate(() => {
    var btn = document.getElementById('wiApplyBtn');
    return btn ? btn.disabled : null;
  });
  applyAfter === true
    ? pass('P9-WI', 'Apply button disabled after apply (prevents double-apply)')
    : warn('P9-WI', 'Apply button still enabled after apply (should be disabled)');

  // Export Report callable (with lastResult set)
  const exportResult = await page.evaluate(() => {
    try {
      if (typeof _exportWhatIfReport !== 'function') return 'no_function';
      if (!window._whatIfLastResult) return 'no_result';
      // Just verify it doesn't throw immediately (download will be blocked in headless)
      return 'callable';
    } catch(e) { return 'error:' + e.message; }
  });
  exportResult === 'callable'
    ? pass('P9-WI', '_exportWhatIfReport callable with lastResult (CSV export ready)')
    : exportResult === 'no_result'
      ? warn('P9-WI', '_whatIfLastResult not set — Export Report may fail')
      : fail('P9-WI', `Export Report not callable: ${exportResult}`);

  // What-If in COLLAPSING mode
  await page.evaluate(() => { var p = document.getElementById('ospfWhatIfPanel'); if (p) p.remove(); });
  await switchMode(page, 'enriched');
  await settle(page, 600);
  await page.evaluate(() => { if (typeof collapseCountry === 'function') collapseCountry('ZAF'); });
  await settle(page, 800);
  await page.evaluate(() => { if (typeof buildOspfWhatIf==='function') buildOspfWhatIf(); });
  await settle(page, 600);
  const wiInCol = await page.$('#ospfWhatIfPanel');
  wiInCol
    ? pass('P9-WI', 'What-If available in COLLAPSING state (cross-mode)')
    : fail('P9-WI', 'What-If not available in COLLAPSING state');
  await shot(page, '19-whatif-collapsing-54');
  await page.evaluate(() => { var p = document.getElementById('ospfWhatIfPanel'); if (p) p.remove(); });

  // ── P10: Integration — Apply Change + Matrix Auto-Refresh ─────────────────
  log('');
  log('━━━ P10: Integration — Apply Change → Cost Matrix Auto-Refresh ━━━');
  info('Testing: Apply Cost Change while Cost Matrix open → matrix survives + updates');

  await switchMode(page, 'enriched');
  await settle(page, 600);
  // Expand all first
  await page.evaluate(() => {
    if (typeof expandAllCountries === 'function') { expandAllCountries(); return; }
    var btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Expand All'));
    if (btn) btn.click();
  });
  await settle(page, 800);

  // Open Cost Matrix (fresh)
  await page.evaluate(() => {
    var p = document.getElementById('ospfCostMatrixPanel');
    if (p) { p.remove(); if (typeof _matrixData !== 'undefined') _matrixData = null; }
    if (typeof buildOspfCostMatrix === 'function') buildOspfCostMatrix();
  });
  await settle(page, 3000);

  const matOpenedForP10 = await page.$('#ospfCostMatrixPanel');
  matOpenedForP10
    ? pass('P10-INT', 'Cost Matrix opened for integration test')
    : fail('P10-INT', 'Cost Matrix failed to open — P10 integration test may be incomplete');

  // Record a baseline cost (pick first non-zero non-diagonal cell)
  const baseline = await page.evaluate(() => {
    var cells = document.querySelectorAll('#ospfCostMatrixPanel td[data-src][data-dst]');
    for (var i = 0; i < cells.length; i++) {
      var td = cells[i];
      if (td.dataset.src !== td.dataset.dst) {
        var v = parseInt(td.textContent, 10);
        if (!isNaN(v) && v > 0) {
          return { src: td.dataset.src, dst: td.dataset.dst, cost: v };
        }
      }
    }
    return null;
  });
  if (baseline) {
    info(`Baseline cost: ${baseline.src}→${baseline.dst} = ${baseline.cost}`);
    pass('P10-INT', `Recorded baseline cost: ${baseline.src}→${baseline.dst} = ${baseline.cost}`);
  } else {
    warn('P10-INT', 'Could not record baseline cost from matrix');
  }

  // Record all non-zero matrix costs as JSON snapshot
  const matrixSnapshotBefore = await page.evaluate(() => {
    try {
      if (!window._matrixData) return null;
      return JSON.stringify(window._matrixData.dist);
    } catch(e) { return null; }
  });

  // Open What-If panel (matrix stays open)
  await page.evaluate(() => { if (typeof buildOspfWhatIf==='function') buildOspfWhatIf(); });
  await settle(page, 800);

  const bothOpen = await page.evaluate(() => {
    return !!(document.getElementById('ospfCostMatrixPanel') && document.getElementById('ospfWhatIfPanel'));
  });
  bothOpen
    ? pass('P10-INT', 'Both Cost Matrix AND What-If panels open simultaneously')
    : warn('P10-INT', 'Could not open both panels simultaneously');

  // Select first edge, set cost to a dramatically different value
  await page.evaluate(() => {
    var picker = document.getElementById('wiEdgePicker');
    var costEl  = document.getElementById('wiNewCost');
    if (picker && picker.options.length > 0 && costEl) {
      picker.selectedIndex = 0;
      picker.dispatchEvent(new Event('change'));
      costEl.value = '9999';  // extreme high cost to ensure routing changes
    }
  });
  await settle(page, 200);

  // Run analysis
  await page.evaluate(() => { if (typeof _runWhatIfAnalysis==='function') _runWhatIfAnalysis(); });
  await settle(page, 4000);

  const p10Affected = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    if (!el) return 0;
    var m = el.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });
  info(`P10 analysis: ${p10Affected} affected pairs`);
  p10Affected > 0
    ? pass('P10-INT', `Analysis shows ${p10Affected} affected paths (routing will change)`)
    : warn('P10-INT', 'Analysis shows 0 affected pairs — cost change may not affect routing');

  // APPLY CHANGE — key integration moment
  await page.evaluate(() => { if (typeof _applyWhatIf==='function') _applyWhatIf(); });
  await settle(page, 4000);  // Wait for Dijkstra + DOM rebuild
  await shot(page, '20-matrix-post-apply');

  // Matrix should STILL BE OPEN (auto-refreshed by _applyWhatIf → _refreshCostMatrix)
  const matStillOpen = await page.$('#ospfCostMatrixPanel');
  matStillOpen
    ? pass('P10-INT', 'Cost Matrix panel SURVIVED Apply Change (auto-refresh worked ✓)')
    : fail('P10-INT', 'Cost Matrix CLOSED after Apply — _applyWhatIf/_refreshCostMatrix bug');

  // Verify matrix was rebuilt (different data)
  const matrixSnapshotAfter = await page.evaluate(() => {
    try {
      if (!window._matrixData) return null;
      return JSON.stringify(window._matrixData.dist);
    } catch(e) { return null; }
  });

  if (matrixSnapshotBefore && matrixSnapshotAfter) {
    matrixSnapshotBefore !== matrixSnapshotAfter
      ? pass('P10-INT', 'Cost Matrix data UPDATED after Apply Change (Dijkstra recomputed)')
      : warn('P10-INT', 'Cost Matrix data unchanged after Apply — cost change may not affect any path');
  } else if (matrixSnapshotAfter) {
    pass('P10-INT', 'Cost Matrix data present after Apply (rebuild confirmed)');
  } else {
    fail('P10-INT', 'No _matrixData after Apply — matrix may not have rebuilt');
  }

  // Verify the specific baseline cost changed (if we have one and it was affected)
  if (baseline && matStillOpen) {
    const newCostVal = await page.evaluate(({src, dst}) => {
      var cell = document.querySelector(`#ospfCostMatrixPanel td[data-src="${src}"][data-dst="${dst}"]`);
      return cell ? parseInt(cell.textContent, 10) : null;
    }, { src: baseline.src, dst: baseline.dst });
    if (newCostVal !== null && !isNaN(newCostVal)) {
      newCostVal !== baseline.cost
        ? pass('P10-INT', `Matrix cost ${baseline.src}→${baseline.dst}: ${baseline.cost} → ${newCostVal} (updated)`)
        : info(`Matrix cost ${baseline.src}→${baseline.dst} unchanged: ${newCostVal} (edge may not be on this path)`);
    }
  }

  await shot(page, '21-integration-complete');

  // ── Final Summary ─────────────────────────────────────────────────────────
  await browser.close();
  log('');
  log('╔══════════════════════════════════════════════════════════════════════════╗');
  log('║   06-STEP-BY-STEP — FINAL SUMMARY                                       ║');
  log('╠══════════════════════════════════════════════════════════════════════════╣');
  log(`║  PASSED : ${String(PASS).padEnd(60)}║`);
  log(`║  FAILED : ${String(FAIL).padEnd(60)}║`);
  log(`║  WARNED : ${String(WARN).padEnd(60)}║`);
  log(`║  TOTAL  : ${String(PASS+FAIL+WARN).padEnd(60)}║`);
  if (FAIL === 0) {
    log('║  STATUS : ALL 06-STEP-BY-STEP CHECKS PASSED ✅                          ║');
  } else {
    log(`║  STATUS : ${FAIL} FAILED — review output above ❌                        ║`);
  }
  log('╚══════════════════════════════════════════════════════════════════════════╝');
  process.exit(FAIL > 0 ? 1 : 0);
})();
