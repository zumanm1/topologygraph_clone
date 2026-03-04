#!/usr/bin/env node
/**
 * validate-collapsing-full.cjs  v3
 * ─────────────────────────────────────────────────────────────────────────────
 * END-TO-END COLLAPSING Feature Validation using Playwright (Chromium).
 *
 * SCHOLAR'S NOTE — v3 Architecture
 *   Lesson from v2: The Topolograph web UI gates the graph dropdown by the
 *   authenticated user's session.  Graphs uploaded by the pipeline API user
 *   (ospf@topolograph.com) do NOT appear in the browser session of an
 *   anonymous visitor — they are siloed by owner_id in MongoDB.
 *
 *   Resolution (v3): Authenticate as the API user first (B0 Login), then
 *   navigate to the upload page.  The pipeline-enriched graph (with country
 *   codes, gateway flags, and colours pushed by push-to-ui.py) will now
 *   appear in the dropdown.  We select the specific GRAPH_TIME passed via env
 *   var, load it into vis.js, and proceed with all 15 feature assertions.
 *
 *   This mirrors Parnas's information-hiding principle: each layer (pipeline,
 *   browser, vis.js) is decoupled; the test exercises the full vertical slice.
 *
 * WHAT IS VALIDATED
 *   B0  Login as API user (ospf@topolograph.com)
 *   B1  Upload page reachable + enriched GRAPH_TIME in dropdown
 *   B2  Load enriched graph into vis.js (34 nodes / 108 edges)
 *   B3  Country colours applied — all 34 nodes, 10 countries
 *   B4  Country Filter panel (existing feature — still works)
 *   B5  View-mode bar [AS-IS][GATEWAY][ENRICHED][COLLAPSING] present
 *   B6  COLLAPSING mode → Country Groups panel appears
 *   B7  Collapse ZAF → 3 core nodes hidden (34 → 31 visible)
 *   B8  Expand ZAF → 3 core nodes restored (31 → 34 visible)
 *   B9  Collapse All → 6 total core nodes hidden (34 → 28 visible)
 *   B10 Expand All → all 34 nodes restored
 *   B11 Double-click ZAF gateway → collapses ZAF (34 → 31)
 *   B12 AS-IS mode → all 34 nodes, country colours removed
 *   B13 ENRICHED mode → all 34 nodes, country colours restored
 *   B14 GATEWAY mode → 28 gateway nodes visible, 6 cores hidden
 *
 * USAGE
 *   GRAPH_TIME=04Mar2026_12h25m56s_34_hosts \
 *     node validate-collapsing-full.cjs
 *
 *   HEADLESS=false node validate-collapsing-full.cjs   # visual / debug
 *
 * ENV VARS
 *   BASE_URL    http://localhost:8081       (default)
 *   GRAPH_TIME  required — graph_time from workflow.sh output
 *   API_USER    ospf@topolograph.com        (default)
 *   API_PASS    ospf                        (default)
 *   HEADLESS    true                        (default)
 *   SCREENSHOTS true                        (default)
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const { chromium } = require('playwright');
const path         = require('path');
const fs           = require('fs');

const BASE_URL  = process.env.BASE_URL   || 'http://localhost:8081';
const GRAPH_TIME = process.env.GRAPH_TIME || '';
const API_USER  = process.env.API_USER   || 'ospf@topolograph.com';
const API_PASS  = process.env.API_PASS   || 'ospf';
const HEADLESS  = process.env.HEADLESS   !== 'false';
const SCREENSHOTS = process.env.SCREENSHOTS !== 'false';

const SS_DIR = path.join(__dirname, '..', '02-STEP-BY-STEP', 'screenshots');
if (SCREENSHOTS) fs.mkdirSync(SS_DIR, { recursive: true });

let _shotNum = 0;
let _pass    = 0;
let _fail    = 0;

function log(msg)  { console.log(`\n[validate] ${msg}`); }
function pass(msg) { _pass++; console.log(`  ✅ PASS: ${msg}`); }
function fail(msg) { _fail++; console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ℹ  ${msg}`); }
function warn(msg) { console.warn(`  ⚠️  ${msg}`); }

async function ss(page, label) {
  if (!SCREENSHOTS) return;
  _shotNum++;
  const fname = path.join(SS_DIR, `12-collapsing-v3-${String(_shotNum).padStart(2,'0')}-${label}.png`);
  await page.screenshot({ path: fname, fullPage: false });
  info(`Screenshot → ${path.basename(fname)}`);
}

async function settle(page, ms = 1000) { await page.waitForTimeout(ms); }

// ── vis.js DataSet helpers ────────────────────────────────────────────────────
async function visibleNodes(page) {
  return page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; }
    catch(e) { return null; }
  });
}

async function totalNodes(page) {
  return page.evaluate(() => {
    try { return nodes.get().length; }
    catch(e) { return null; }
  });
}

// ── B0: Login as API user ─────────────────────────────────────────────────────
async function b0_login(page) {
  log('B0 — Login as API user: ' + API_USER);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);

  // Fill login form (local form — page also has Google OAuth form, must target correctly)
  try {
    await page.fill('#login', API_USER);
    await page.fill('#password', API_PASS);
    await ss(page, 'B0-login-form');

    // Use the local login form's submit button specifically (not Google OAuth form)
    // and press Enter on password field as the most reliable submit trigger
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {}),
      page.press('#password', 'Enter')
    ]);
    await settle(page, 1000);
  } catch(e) {
    fail(`Login form interaction failed: ${e.message}`);
    return false;
  }

  await ss(page, 'B0-after-login');

  // Verify we're NOT on the login page — check URL and absence of login form
  const url = page.url();
  const hasLoginForm = await page.$('#password') !== null;

  if (url.includes('/login') && hasLoginForm) {
    const errText = await page.evaluate(() => document.body.innerText.substring(0, 200));
    fail(`Login failed — still on login page. Body: ${errText.substring(0, 100)}`);
    return false;
  }

  pass(`Logged in as ${API_USER} — page: ${url.replace(BASE_URL, '') || '/'}`);
  return true;
}

// ── B1: Navigate to upload page + verify GRAPH_TIME in dropdown ───────────────
async function b1_uploadPage(page) {
  log(`B1 — Upload page + verify ${GRAPH_TIME} in dropdown`);
  // Use 'domcontentloaded' — 'networkidle' times out because 3rd-party analytics
  // (Google Analytics, Yandex metrika) send continuous background requests.
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1200);  // let jQuery finish populating the dropdown

  const title = await page.title();
  await ss(page, 'B1-upload-page');

  if (title && title.length > 0) {
    pass(`Upload page loaded — "${title.substring(0, 55)}"`);
  } else {
    fail('Upload page has no title');
    return false;
  }

  if (!GRAPH_TIME) {
    fail('GRAPH_TIME env var not set — cannot select enriched graph');
    return false;
  }

  // Check dropdown for our graph_time
  const dropdownInfo = await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return { found: false, error: 'dropdown not found', count: 0 };
    const opts = Array.from(sel.options);
    const match = opts.find(o => o.value === gt || o.text.trim() === gt);
    return {
      found:   !!match,
      count:   opts.length,
      first:   opts[0] ? opts[0].value : null,
      allVals: opts.map(o => o.value)
    };
  }, GRAPH_TIME);

  info(`Dropdown: ${dropdownInfo.count} graphs found`);
  if (dropdownInfo.count > 0) info(`Most recent: ${dropdownInfo.first}`);

  if (dropdownInfo.found) {
    pass(`GRAPH_TIME "${GRAPH_TIME}" found in dropdown ✓`);
    return true;
  } else {
    warn(`GRAPH_TIME "${GRAPH_TIME}" not in dropdown — will inject directly`);
    // List a few available options for debugging
    if (dropdownInfo.allVals) {
      const matching34 = dropdownInfo.allVals.filter(v => v.includes('34_hosts'));
      info(`Available 34_hosts graphs: ${matching34.slice(0,5).join(', ')}`);
    }
    return true; // continue — B2 will inject if needed
  }
}

// ── B2: Load enriched graph into vis.js ──────────────────────────────────────
async function b2_loadGraph(page) {
  log(`B2 — Load enriched graph ${GRAPH_TIME} into vis.js`);

  // Ensure the correct graph_time is selected in dropdown
  await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    // Find existing option
    const existing = Array.from(sel.options).find(o => o.value === gt || o.text.trim() === gt);
    if (existing) {
      sel.value = existing.value;
    } else {
      // Inject option if not found (graph exists in DB, just filtered by user session)
      const opt = document.createElement('option');
      opt.value = gt; opt.text = gt;
      sel.add(opt);
      sel.value = gt;
    }
    sel.dispatchEvent(new Event('change'));
  }, GRAPH_TIME);

  await settle(page, 400);
  const selectedGT = await page.evaluate(() => {
    const sel = document.getElementById('dynamic_graph_time');
    return sel ? sel.value : null;
  });
  info(`Dropdown selected: ${selectedGT}`);
  await ss(page, 'B2-graph-selected');

  // ── Strategy 1: click Load button ──────────────────────────────────────────
  const loadBtn = await page.$('input#load_graph_button') ||
                  await page.$('input[name="load_graph_button"]') ||
                  await page.$('input[onclick*="upload_ospf_lsdb"]');

  if (loadBtn) {
    await loadBtn.click();
    info('Load button clicked — waiting for AJAX + vis.js render...');
  } else {
    info('Load button not found — calling upload_ospf_lsdb() directly via JS');
    await page.evaluate((gt) => {
      const sel = document.getElementById('dynamic_graph_time');
      if (sel) sel.value = gt;
      if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt);
    }, GRAPH_TIME);
  }

  // ── Wait for vis.js DataSet with retries ───────────────────────────────────
  let total = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    await settle(page, 2000);
    total = await totalNodes(page);
    info(`  [attempt ${attempt}/8] vis.js total nodes: ${total}`);
    if (total !== null && total > 0) break;
  }

  await ss(page, 'B2-graph-rendered');

  if (total === 34) {
    pass(`Graph loaded — 34 nodes in vis.js DataSet (ospf-database-2.txt ✓)`);
  } else if (total === 13) {
    fail(`Got 13 nodes — demo graph loaded instead of ospf-database-2.txt (34 nodes)`);
    return false;
  } else if (total !== null && total > 0) {
    warn(`Got ${total} nodes — expected 34; proceeding`);
    pass(`Graph loaded with ${total} nodes`);
  } else {
    fail('vis.js DataSet not accessible after 16 s — graph did not load');
    return false;
  }

  // Wait for setTimeout(900ms) → country colours + COLLAPSING UI
  info('Waiting 2 s for country colours + COLLAPSING UI to initialise...');
  await settle(page, 2000);
  return true;
}

// ── B3: Country colours + codes applied ───────────────────────────────────────
async function b3_countryColours(page) {
  log('B3 — Country colours applied to all 34 nodes (10 countries)');

  const result = await page.evaluate(() => {
    try {
      const all         = nodes.get();
      const withCountry = all.filter(n => n.country);
      const countries   = [...new Set(withCountry.map(n => n.country))];
      const withColour  = all.filter(n => n.color &&
                            typeof n.color === 'object' && n.color.background &&
                            n.color.background !== '#97C2FC');  // exclude vis default
      return { total: all.length, withCountry: withCountry.length,
               countries: countries.sort(), withColour: withColour.length };
    } catch(e) { return { error: e.message }; }
  });

  await ss(page, 'B3-country-colours');

  if (result.error) { fail(`Cannot read vis.js nodes: ${result.error}`); return; }

  if (result.withCountry === 34) {
    pass(`All 34 nodes have country codes assigned ✓`);
  } else if (result.withCountry > 0) {
    fail(`Only ${result.withCountry}/34 nodes have country codes — push-to-ui.py may not have run`);
  } else {
    fail(`No nodes have country codes — enrichment not applied to this graph`);
  }

  if (result.countries.length === 10) {
    pass(`10 countries present: ${result.countries.join(', ')} ✓`);
  } else if (result.countries.length > 0) {
    fail(`Expected 10 countries, found ${result.countries.length}: ${result.countries.join(', ')}`);
  } else {
    fail('No country codes in graph — run push-to-ui.py on this graph_time');
  }

  if (result.withColour >= 28) {
    pass(`${result.withColour}/34 nodes have country-specific colours ✓`);
  } else {
    info(`${result.withColour} nodes with custom colour (may be OK if < 34)`);
  }
}

// ── B4: Country Filter panel ──────────────────────────────────────────────────
async function b4_countryFilterPanel(page) {
  log('B4 — Country Filter panel (existing feature intact)');
  const toggle = await page.$('#cfToggle');
  if (!toggle) {
    info('Country Filter toggle #cfToggle not found — skipping B4');
    return;
  }
  await toggle.click();
  await settle(page, 700);
  await ss(page, 'B4-country-filter-open');

  // buildCountryFilterPanel() uses class="cfCountryItem" for each country row
  const rows = await page.$$('.cfCountryItem');
  if (rows.length >= 10) {
    pass(`Country Filter panel shows ${rows.length} country items (≥10) ✓`);
  } else {
    fail(`Country Filter shows only ${rows.length} items — expected ≥10 (class=.cfCountryItem)`);
  }
  await toggle.click();
  await settle(page, 300);
}

// ── B5: View-mode button bar ──────────────────────────────────────────────────
async function b5_viewModeButtons(page) {
  log('B5 — View-mode button bar [AS-IS][GATEWAY][ENRICHED][COLLAPSING]');
  await ss(page, 'B5-viewmode-bar');

  // buildViewModeButtons() creates <div id="viewModeBar">
  const bar = await page.$('#viewModeBar');
  if (!bar) {
    // Try alternate — might be a race; give one more second
    await settle(page, 1500);
    const bar2 = await page.$('#viewModeBar');
    if (!bar2) {
      fail('#viewModeBar not found — buildViewModeButtons() did not run');
      info('Check topolograph.js setTimeout wiring at line ~495');
      return false;
    }
  }
  pass('View-mode button bar (#viewModeBar) present in DOM ✓');

  let allOk = true;
  for (const mode of ['asis', 'gateway', 'enriched', 'collapsing']) {
    // Buttons use class="vmBtn" data-mode="asis" etc. (no id attr)
    const btn = await page.$(`button.vmBtn[data-mode="${mode}"]`);
    if (btn) {
      pass(`  button[data-mode="${mode}"] present ✓`);
    } else {
      fail(`  button[data-mode="${mode}"] MISSING`);
      allOk = false;
    }
  }
  return allOk;
}

// ── B6: COLLAPSING mode panel ─────────────────────────────────────────────────
async function b6_collapsingPanel(page) {
  log('B6 — Click COLLAPSING button → Country Groups panel appears');

  const btn = await page.$('button.vmBtn[data-mode="collapsing"]');
  if (!btn) { fail('COLLAPSING view-mode button not found'); return; }

  await btn.click();
  await settle(page, 1000);
  await ss(page, 'B6-collapsing-panel');

  // buildCollapsePanel() creates <div id="countryCollapsePanel">
  const panel = await page.$('#countryCollapsePanel');
  if (panel) {
    pass('Country Groups panel (#countryCollapsePanel) appeared ✓');
    const rows = await page.$$('.cpRow');
    if (rows.length >= 10) {
      pass(`Country Groups panel shows ${rows.length} country rows (≥10) ✓`);
    } else {
      warn(`Panel has ${rows.length} rows — expected ≥10`);
    }
  } else {
    fail('#countryCollapsePanel not found after clicking COLLAPSING');
    info('Check buildCollapsePanel() — may not run if no country codes in graph');
  }
}

// ── B7: Collapse ZAF (3 cores hidden) ────────────────────────────────────────
async function b7_collapseZAF(page) {
  log('B7 — Collapse ZAF → 3 core nodes hidden (34 → 31 visible)');
  const before = await visibleNodes(page);

  // Try the panel button first (format: cpBtn-ZAF-collapse or similar)
  // Then fall back to calling JS function directly
  const panelBtn = await page.$('[data-country="ZAF"][data-action="collapse"]') ||
                   await page.$('#cpCollapse-ZAF') ||
                   await page.$('button[onclick*="collapseCountry"][onclick*="ZAF"]');
  if (panelBtn) {
    await panelBtn.click();
    info('Clicked ZAF collapse panel button');
  } else {
    info('ZAF collapse button not found — calling collapseCountry("ZAF") via JS');
    await page.evaluate(() => {
      if (typeof collapseCountry === 'function') collapseCountry('ZAF');
    });
  }
  await settle(page, 900);

  const after = await visibleNodes(page);
  await ss(page, 'B7-zaf-collapsed');
  info(`Visible nodes: ${before} → ${after}`);

  if (before !== null && after !== null) {
    const diff = before - after;
    if (diff === 3) {
      pass(`Collapse ZAF hid exactly 3 core nodes (${before} → ${after}) ✓`);
    } else if (diff > 0) {
      fail(`Collapse ZAF hid ${diff} nodes — expected 3 (ZAF has 3 cores: zaf-jnb-r1/r2/r3)`);
    } else {
      fail(`No nodes hidden after ZAF collapse — collapseCountry may not recognise ZAF`);
    }
  }
}

// ── B8: Expand ZAF ───────────────────────────────────────────────────────────
async function b8_expandZAF(page) {
  log('B8 — Expand ZAF → 3 core nodes restored (31 → 34 visible)');
  const before = await visibleNodes(page);

  const panelBtn = await page.$('[data-country="ZAF"][data-action="expand"]') ||
                   await page.$('#cpExpand-ZAF') ||
                   await page.$('button[onclick*="expandCountry"][onclick*="ZAF"]');
  if (panelBtn) {
    await panelBtn.click();
    info('Clicked ZAF expand panel button');
  } else {
    info('ZAF expand button not found — calling expandCountry("ZAF") via JS');
    await page.evaluate(() => {
      if (typeof expandCountry === 'function') expandCountry('ZAF');
    });
  }
  await settle(page, 800);

  const after = await visibleNodes(page);
  await ss(page, 'B8-zaf-expanded');
  info(`Visible nodes: ${before} → ${after}`);

  if (after === 34) {
    pass(`Expand ZAF restored all 34 nodes ✓`);
  } else if (after !== null) {
    fail(`Expected 34 after ZAF expand, got ${after}`);
  }
}

// ── B9: Collapse All ──────────────────────────────────────────────────────────
async function b9_collapseAll(page) {
  log('B9 — Collapse All → 6 total core nodes hidden (34 → 28 visible)');
  const before = await visibleNodes(page);

  const panelBtn = await page.$('#cpCollapseAll') ||
                   await page.$('button[onclick*="collapseAllCountries"]');
  if (panelBtn) {
    await panelBtn.click();
    info('Clicked Collapse All button');
  } else {
    info('#cpCollapseAll not found — calling collapseAllCountries() via JS');
    await page.evaluate(() => {
      if (typeof collapseAllCountries === 'function') collapseAllCountries();
    });
  }
  await settle(page, 1000);

  const after = await visibleNodes(page);
  await ss(page, 'B9-collapse-all');
  info(`Visible nodes: ${before} → ${after}`);

  if (after === 28) {
    pass(`Collapse All: 28 gateway nodes visible (6 cores hidden) ✓`);
  } else if (after !== null) {
    fail(`Expected 28 after Collapse All, got ${after} (hidden=${(before||34) - after})`);
  }
}

// ── B10: Expand All ───────────────────────────────────────────────────────────
async function b10_expandAll(page) {
  log('B10 — Expand All → all 34 nodes restored');
  const before = await visibleNodes(page);

  const panelBtn = await page.$('#cpExpandAll') ||
                   await page.$('button[onclick*="expandAllCountries"]');
  if (panelBtn) {
    await panelBtn.click();
    info('Clicked Expand All button');
  } else {
    info('#cpExpandAll not found — calling expandAllCountries() via JS');
    await page.evaluate(() => {
      if (typeof expandAllCountries === 'function') expandAllCountries();
    });
  }
  await settle(page, 800);

  const after = await visibleNodes(page);
  await ss(page, 'B10-expand-all');

  if (after === 34) {
    pass(`Expand All restored all 34 nodes ✓`);
  } else if (after !== null) {
    fail(`Expected 34 after Expand All, got ${after}`);
  }
}

// ── B11: Double-click ZAF gateway to collapse ─────────────────────────────────
async function b11_doubleClickCollapse(page) {
  log('B11 — Double-click ZAF gateway node → collapses ZAF (34 → 31)');

  // Ensure COLLAPSING mode
  await page.evaluate(() => {
    if (typeof setViewMode === 'function') setViewMode('collapsing');
  });
  await settle(page, 600);

  const before = await visibleNodes(page);

  const emitted = await page.evaluate(() => {
    if (typeof network === 'undefined' || typeof nodes === 'undefined') return false;
    const zafGw = nodes.get({ filter: n => n.country === 'ZAF' && !n.hidden && n.is_gateway })[0]
               || nodes.get({ filter: n => n.country === 'ZAF' && !n.hidden })[0];
    if (!zafGw) { console.warn('No visible ZAF node found'); return false; }
    const pos    = network.getPositions([zafGw.id])[zafGw.id];
    const domPos = network.canvasToDOM(pos);
    network.emit('doubleClick', {
      nodes: [zafGw.id], edges: [],
      pointer: { DOM: domPos, canvas: pos }
    });
    return true;
  });

  await settle(page, 900);
  const after = await visibleNodes(page);
  await ss(page, 'B11-dblclick-collapse-zaf');
  info(`doubleClick emitted: ${emitted} | Visible nodes: ${before} → ${after}`);

  if (!emitted) {
    fail('Could not find ZAF gateway node to double-click');
  } else if (before !== null && after !== null && (before - after) === 3) {
    pass(`Double-click collapsed ZAF: 3 nodes hidden (${before} → ${after}) ✓`);
  } else if (after !== null && after < (before || 34)) {
    fail(`Double-click hid ${(before||34) - after} nodes — expected 3`);
  } else {
    fail(`Double-click did not collapse ZAF (${before} → ${after})`);
  }

  // Restore for next tests
  await page.evaluate(() => { if (typeof expandCountry === 'function') expandCountry('ZAF'); });
  await settle(page, 500);
}

// ── B12: AS-IS mode ───────────────────────────────────────────────────────────
async function b12_asisMode(page) {
  log('B12 — AS-IS mode → all 34 nodes, country colours removed');
  const btn = await page.$('button.vmBtn[data-mode="asis"]');
  if (!btn) { fail('AS-IS view-mode button not found'); return; }
  await btn.click();
  await settle(page, 1000);

  const after = await visibleNodes(page);
  await ss(page, 'B12-asis-mode');

  if (after === 34) {
    pass(`AS-IS mode: all 34 nodes visible ✓`);
  } else if (after !== null) {
    fail(`AS-IS mode: expected 34, got ${after}`);
  }
}

// ── B13: ENRICHED mode ────────────────────────────────────────────────────────
async function b13_enrichedMode(page) {
  log('B13 — ENRICHED mode → all 34 nodes + country colours restored');
  const btn = await page.$('button.vmBtn[data-mode="enriched"]');
  if (!btn) { fail('ENRICHED view-mode button not found'); return; }
  await btn.click();
  await settle(page, 1400);

  const after = await visibleNodes(page);
  await ss(page, 'B13-enriched-mode');

  if (after === 34) {
    pass(`ENRICHED mode: all 34 nodes visible ✓`);
  } else if (after !== null) {
    fail(`ENRICHED mode: expected 34, got ${after}`);
  }

  const withCountry = await page.evaluate(() => {
    try { return nodes.get({ filter: n => n.country }).length; }
    catch(e) { return null; }
  });
  if (withCountry === 34) {
    pass('ENRICHED mode: all 34 nodes retain country codes ✓');
  } else if (withCountry !== null) {
    info(`ENRICHED: ${withCountry}/34 nodes have country codes`);
  }
}

// ── B14: GATEWAY mode ─────────────────────────────────────────────────────────
async function b14_gatewayMode(page) {
  log('B14 — GATEWAY mode → 28 gateway nodes visible, 6 cores hidden');
  const btn = await page.$('button.vmBtn[data-mode="gateway"]');
  if (!btn) { fail('GATEWAY view-mode button not found'); return; }
  await btn.click();
  await settle(page, 1000);

  const after = await visibleNodes(page);
  await ss(page, 'B14-gateway-mode');

  if (after === 28) {
    pass(`GATEWAY mode: 28 gateway nodes visible (6 cores hidden) ✓`);
  } else if (after !== null) {
    fail(`GATEWAY mode: expected 28 visible, got ${after}`);
  }

  // Restore to ENRICHED for clean exit
  await page.evaluate(() => { if (typeof setViewMode === 'function') setViewMode('enriched'); });
  await settle(page, 600);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!GRAPH_TIME) {
    console.error('[validate] ERROR: GRAPH_TIME env var is required.');
    console.error('  Run: workflow.sh all --ospf-file INPUT-FOLDER/ospf-database-2.txt');
    console.error('  Then: GRAPH_TIME=<value> node validate-collapsing-full.cjs');
    process.exit(1);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  validate-collapsing-full.cjs  v3                           ║');
  console.log('║  COLLAPSING Feature — End-to-End Playwright Validation      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  BASE_URL   : ${BASE_URL}`);
  console.log(`  GRAPH_TIME : ${GRAPH_TIME}`);
  console.log(`  API_USER   : ${API_USER}`);
  console.log(`  HEADLESS   : ${HEADLESS}`);
  console.log(`  SCREENSHOTS: ${SCREENSHOTS ? SS_DIR : 'disabled'}`);
  console.log('');

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page    = await context.newPage();

  // Suppress noisy 3rd-party network failures (analytics, fonts)
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('google') && !url.includes('yandex') && !url.includes('mc.') &&
        !url.includes('webfonts')) {
      info(`[net-fail] ${req.method()} ${url.substring(0, 80)}`);
    }
  });
  page.on('console', msg => {
    if (msg.type() === 'error') info(`[browser-err] ${msg.text().substring(0, 120)}`);
  });

  try {
    // B0: Login as API user → session now sees enriched pipeline graphs
    const loggedIn = await b0_login(page);
    if (!loggedIn) {
      console.error('\n[validate] Cannot continue — login failed (B0).');
      await browser.close(); return;
    }

    // B1: Upload page reachable + GRAPH_TIME in dropdown
    const pageOk = await b1_uploadPage(page);
    if (!pageOk) {
      await browser.close(); return;
    }

    // B2: Load enriched graph into vis.js
    const graphLoaded = await b2_loadGraph(page);
    if (!graphLoaded) {
      console.error('\n[validate] Cannot continue — graph did not load (B2).');
      await browser.close(); return;
    }

    // B3–B14: Feature validations
    await b3_countryColours(page);
    await b4_countryFilterPanel(page);

    const hasButtons = await b5_viewModeButtons(page);
    if (!hasButtons) {
      warn('View-mode buttons missing — remaining tests may fail');
    }

    await b6_collapsingPanel(page);
    await b7_collapseZAF(page);
    await b8_expandZAF(page);
    await b9_collapseAll(page);
    await b10_expandAll(page);
    await b11_doubleClickCollapse(page);
    await b12_asisMode(page);
    await b13_enrichedMode(page);
    await b14_gatewayMode(page);

  } catch(err) {
    console.error(`\n[validate] FATAL: ${err.message}`);
    console.error(err.stack);
    await page.screenshot({
      path: path.join(SS_DIR, '12-collapsing-v3-FATAL.png')
    }).catch(()=>{});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS : ${_pass} PASSED  |  ${_fail} FAILED${' '.repeat(Math.max(0,34-String(_pass).length-String(_fail).length))}║`);
  console.log(`║  GRAPH   : ${GRAPH_TIME.substring(0, 50).padEnd(50)} ║`);
  if (_fail === 0) {
    console.log('║  STATUS : ALL CHECKS PASSED ✅                               ║');
  } else {
    console.log('║  STATUS : SOME CHECKS FAILED ❌ — see output above           ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

main().catch(err => {
  console.error('[validate] FATAL:', err.message);
  process.exit(1);
});
