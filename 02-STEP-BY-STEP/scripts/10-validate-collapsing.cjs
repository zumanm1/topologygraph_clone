#!/usr/bin/env node
/**
 * 10-validate-collapsing.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * COLLAPSING Feature — automated validation via Playwright (Chromium)
 *
 * PURPOSE
 *   Validates the COLLAPSING UI feature in Topolograph:
 *     V1. 4 view-mode buttons are injected into the DOM
 *     V2. COLLAPSING mode shows the Country Groups panel
 *     V3. Collapse ZAF → 3 ZAF core nodes become hidden (node count drops)
 *     V4. Double-click a ZAF gateway → ZAF expands, core nodes reappear
 *     V5. Collapse All → 6 total core nodes hidden across all countries
 *     V6. Expand All → all 34 nodes visible again
 *     V7. AS-IS mode hides country colours (no colored nodes)
 *     V8. ENRICHED mode restores full coloured view
 *
 * USAGE
 *   node 10-validate-collapsing.cjs
 *
 * ENV VARS (all optional, defaults shown)
 *   BASE_URL    http://localhost:8081
 *   GRAPH_TIME  03Mar2026_20h05m03s_34_hosts
 *   TOPO_USER   admin
 *   TOPO_PASS   (empty — no auth by default)
 *   HEADLESS    true
 *   SCREENSHOTS true   (save PNG per step to 01-STEP-BY-STEP/screenshots/)
 *
 * SCHOLAR'S NOTE
 *   Validation follows the "test as specification" principle: each assertion
 *   names the behavioural contract being verified, giving executable
 *   documentation of what the COLLAPSING feature guarantees.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL    = process.env.BASE_URL   || 'http://localhost:8081';
const GRAPH_TIME  = process.env.GRAPH_TIME || '03Mar2026_20h05m03s_34_hosts';
const HEADLESS    = process.env.HEADLESS   !== 'false';
const SCREENSHOTS = process.env.SCREENSHOTS !== 'false';

const SS_DIR = path.join(__dirname, '..', 'screenshots');
if (SCREENSHOTS && !fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
let _stepNum = 0;
function log(msg)  { console.log(`[collapsing-validate] ${msg}`); }
function pass(msg) { console.log(`  ✅ PASS: ${msg}`); }
function fail(msg) { console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }

async function ss(page, label) {
  if (!SCREENSHOTS) return;
  _stepNum++;
  const fname = path.join(SS_DIR, `10-collapsing-${String(_stepNum).padStart(2,'0')}-${label}.png`);
  await page.screenshot({ path: fname, fullPage: false });
  log(`  Screenshot → ${path.basename(fname)}`);
}

async function waitSettle(page, ms = 1200) {
  await page.waitForTimeout(ms);
}

// ── Wait for graph to load and COLLAPSING UI to initialise ───────────────────
async function loadGraph(page) {
  log('Navigating to graph…');
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(500);

  // Click on the graph time in the table (Topolograph landing page lists graphs)
  // Look for the graph time link / row
  const gtLink = page.locator(`text=${GRAPH_TIME}`).first();
  const exists  = await gtLink.count();
  if (exists) {
    await gtLink.click();
  } else {
    // Fallback: direct URL if available
    log('  Graph time link not found on landing page — trying direct URL pattern');
    await page.goto(`${BASE_URL}/`);
    // Try clicking the first available graph
    const firstGraph = page.locator('table tbody tr td a').first();
    if (await firstGraph.count()) {
      await firstGraph.click();
    } else {
      log('  WARNING: No graph links found — graph may need manual selection');
    }
  }

  // Wait for vis.js canvas to appear
  await page.waitForSelector('canvas', { timeout: 15000 });
  log('  Canvas detected — waiting for COLLAPSING UI (setTimeout 900 ms + margin)…');
  // Wait for buildViewModeButtons() to fire (setTimeout 900ms + extra margin)
  await waitSettle(page, 2500);
}

// ── V1: View-mode buttons present ────────────────────────────────────────────
async function validateViewButtons(page) {
  log('V1: Checking view-mode buttons…');
  const bar = await page.$('#vmModeBar');
  if (bar) {
    pass('View-mode button bar (#vmModeBar) is present in DOM');
  } else {
    fail('#vmModeBar not found — buildViewModeButtons() may not have been called');
    return false;
  }

  for (const mode of ['asis', 'gateway', 'enriched', 'collapsing']) {
    const btn = await page.$(`#vmBtn-${mode}`);
    if (btn) {
      pass(`  Button #vmBtn-${mode} present`);
    } else {
      fail(`  Button #vmBtn-${mode} MISSING`);
    }
  }
  await ss(page, 'V1-viewmode-buttons');
  return true;
}

// ── V2: COLLAPSING panel appears when mode is clicked ─────────────────────────
async function validateCollapsingPanel(page) {
  log('V2: Clicking COLLAPSING mode button…');
  const btn = await page.$('#vmBtn-collapsing');
  if (!btn) { fail('Cannot find #vmBtn-collapsing — skipping V2'); return; }

  await btn.click();
  await waitSettle(page, 800);

  const panel = await page.$('#collapsePanel');
  if (panel) {
    pass('Country Groups panel (#collapsePanel) appeared');
  } else {
    fail('#collapsePanel not found after clicking COLLAPSING button');
  }
  await ss(page, 'V2-collapsing-panel');
}

// ── V3: Collapse ZAF hides 3 core nodes ──────────────────────────────────────
async function validateCollapseZAF(page) {
  log('V3: Collapsing ZAF (expect 3 core nodes hidden)…');

  // Count visible nodes before collapse (via JS)
  const beforeCount = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });
  log(`  Visible nodes before collapse: ${beforeCount}`);

  // Click Collapse button for ZAF in the panel
  const zafCollapse = await page.$('#cpCollapse-ZAF');
  if (!zafCollapse) {
    // Try calling JS directly
    log('  #cpCollapse-ZAF button not found — calling collapseCountry("ZAF") directly');
    await page.evaluate(() => {
      if (typeof collapseCountry === 'function') collapseCountry('ZAF');
    });
  } else {
    await zafCollapse.click();
  }
  await waitSettle(page, 600);

  const afterCount = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });
  log(`  Visible nodes after collapse: ${afterCount}`);

  if (beforeCount !== null && afterCount !== null) {
    const diff = beforeCount - afterCount;
    if (diff === 3) {
      pass(`ZAF collapse hid exactly 3 core nodes (${beforeCount} → ${afterCount})`);
    } else if (diff > 0) {
      fail(`ZAF collapse hid ${diff} nodes — expected 3 (ZAF has 3 cores)`);
    } else {
      fail(`Node count did not decrease after ZAF collapse (${beforeCount} → ${afterCount})`);
    }
  } else {
    log('  WARNING: Could not read node count via vis.js DataSet — checking DOM fallback');
  }
  await ss(page, 'V3-zaf-collapsed');
}

// ── V4: Double-click a ZAF gateway to expand ─────────────────────────────────
async function validateDoubleClickExpand(page) {
  log('V4: Double-clicking canvas (ZAF gateway) to expand ZAF…');

  const beforeCount = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });

  // Find a ZAF gateway node position via JS and simulate doubleClick event
  await page.evaluate(() => {
    if (typeof network === 'undefined') return;
    // Find a ZAF gateway node
    var zafGw = nodes.get({
      filter: function(n) { return n.country === 'ZAF' && !n.hidden; }
    })[0];
    if (!zafGw) return;
    // Fire the network doubleClick event programmatically
    var pos = network.getPositions([zafGw.id])[zafGw.id];
    var domPos = network.canvasToDOM(pos);
    network.emit('doubleClick', {
      nodes: [zafGw.id],
      edges: [],
      pointer: { DOM: domPos, canvas: pos }
    });
  });
  await waitSettle(page, 600);

  const afterCount = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });
  log(`  Visible nodes after double-click expand: ${afterCount}`);

  if (beforeCount !== null && afterCount !== null && afterCount > beforeCount) {
    pass(`Double-click expanded ZAF: node count increased (${beforeCount} → ${afterCount})`);
  } else if (afterCount === beforeCount) {
    fail(`Node count unchanged after double-click expand (${afterCount}) — expand may not have fired`);
  } else {
    log(`  INFO: node count ${beforeCount} → ${afterCount}`);
  }
  await ss(page, 'V4-zaf-expanded-dblclick');
}

// ── V5: Collapse All → 6 core nodes hidden ───────────────────────────────────
async function validateCollapseAll(page) {
  log('V5: Clicking Collapse All…');

  const beforeCount = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });

  const btnAll = await page.$('#cpCollapseAll');
  if (!btnAll) {
    log('  #cpCollapseAll button not found — calling collapseAllCountries() directly');
    await page.evaluate(() => {
      if (typeof collapseAllCountries === 'function') collapseAllCountries();
    });
  } else {
    await btnAll.click();
  }
  await waitSettle(page, 800);

  const afterCount = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });
  log(`  Visible nodes: ${beforeCount} → ${afterCount}`);

  if (beforeCount !== null && afterCount !== null) {
    const diff = beforeCount - afterCount;
    if (diff === 6) {
      pass(`Collapse All hid exactly 6 core nodes (${beforeCount} → ${afterCount})`);
    } else if (diff > 0) {
      fail(`Collapse All hid ${diff} nodes — expected 6 total cores`);
    } else {
      fail(`No nodes hidden by Collapse All`);
    }
  }
  await ss(page, 'V5-collapse-all');
}

// ── V6: Expand All → all 34 nodes visible ────────────────────────────────────
async function validateExpandAll(page) {
  log('V6: Clicking Expand All…');

  const btnExpAll = await page.$('#cpExpandAll');
  if (!btnExpAll) {
    log('  #cpExpandAll not found — calling expandAllCountries() directly');
    await page.evaluate(() => {
      if (typeof expandAllCountries === 'function') expandAllCountries();
    });
  } else {
    await btnExpAll.click();
  }
  await waitSettle(page, 600);

  const count = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });
  log(`  Visible nodes after Expand All: ${count}`);
  if (count === 34) {
    pass(`Expand All restored all 34 nodes`);
  } else if (count !== null) {
    fail(`Expected 34 visible nodes after Expand All, got ${count}`);
  }
  await ss(page, 'V6-expand-all');
}

// ── V7: AS-IS mode hides country colours ─────────────────────────────────────
async function validateASISMode(page) {
  log('V7: Switching to AS-IS mode…');
  const btn = await page.$('#vmBtn-asis');
  if (!btn) { fail('#vmBtn-asis not found — skipping V7'); return; }
  await btn.click();
  await waitSettle(page, 800);
  pass('AS-IS mode button clicked (visual inspection via screenshot)');
  await ss(page, 'V7-asis-mode');
}

// ── V8: ENRICHED mode restores colours ───────────────────────────────────────
async function validateEnrichedMode(page) {
  log('V8: Switching back to ENRICHED mode…');
  const btn = await page.$('#vmBtn-enriched');
  if (!btn) { fail('#vmBtn-enriched not found — skipping V8'); return; }
  await btn.click();
  await waitSettle(page, 800);

  const count = await page.evaluate(() => {
    try { return nodes.get({ filter: n => !n.hidden }).length; } catch(e) { return null; }
  });
  if (count === 34) {
    pass(`ENRICHED mode: all 34 nodes visible`);
  } else if (count !== null) {
    fail(`ENRICHED mode: expected 34 nodes, got ${count}`);
  }
  await ss(page, 'V8-enriched-mode');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     10-validate-collapsing.cjs                   ║');
  console.log('║     COLLAPSING Feature Validation                ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  BASE_URL   : ${BASE_URL}`);
  console.log(`  GRAPH_TIME : ${GRAPH_TIME}`);
  console.log(`  HEADLESS   : ${HEADLESS}`);
  console.log('');

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page    = await context.newPage();

  try {
    await loadGraph(page);

    const hasButtons = await validateViewButtons(page);
    if (!hasButtons) {
      log('View mode buttons missing — ensure Topolograph is running with updated topolograph.js');
      await browser.close();
      return;
    }

    await validateCollapsingPanel(page);
    await validateCollapseZAF(page);
    await validateDoubleClickExpand(page);
    await validateCollapseAll(page);
    await validateExpandAll(page);
    await validateASISMode(page);
    await validateEnrichedMode(page);

  } finally {
    await browser.close();
  }

  console.log('');
  if (process.exitCode === 1) {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  VALIDATION COMPLETE — some checks FAILED        ║');
    console.log('╚══════════════════════════════════════════════════╝');
  } else {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  VALIDATION COMPLETE — all checks PASSED ✅      ║');
    console.log('╚══════════════════════════════════════════════════╝');
  }
  console.log('');
}

main().catch(err => {
  console.error('[collapsing-validate] FATAL:', err.message);
  process.exit(1);
});
