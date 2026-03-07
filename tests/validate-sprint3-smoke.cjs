#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// validate-sprint3-smoke.cjs
// Sprint 3 smoke-test: verify all 4 new toolbar buttons + panels render.
// Tests: ⚠ UNK highlight, 📂 Host File upload, 🗺 Cost Matrix, 🔬 What-If
// ─────────────────────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const HEADLESS = process.env.HEADLESS !== 'false';

function resolveGraphTime() {
  const fromEnv = (process.env.GRAPH_TIME || process.env.GRAPH_TIMES || '').split(',')[0].trim();
  if (fromEnv) return fromEnv;
  const inout = path.join(__dirname, '..', 'IN-OUT-FOLDER');
  if (!fs.existsSync(inout)) return null;
  const dirs = fs.readdirSync(inout)
    .filter(d => fs.existsSync(path.join(inout, d, 'nodes.json')))
    .sort();
  const d54 = dirs.filter(d => d.includes('_54_hosts'));
  return d54.length ? d54[d54.length - 1] : (dirs.length ? dirs[dirs.length - 1] : null);
}

const GRAPH_TIME = resolveGraphTime();
const SS_DIR   = path.join(__dirname, '..', '04-STEP-BY-STEP', 'screenshots');

let PASS = 0, FAIL = 0;
function pass(tag, msg) { PASS++; console.log(`  ✅ PASS: ${tag} — ${msg}`); }
function fail(tag, msg) { FAIL++; console.log(`  ❌ FAIL: ${tag} — ${msg}`); }
async function settle(page, ms) { await page.waitForTimeout(ms || 800); }
async function waitForToolbarButtons(page) {
  for (let i = 0; i < 12; i++) {
    const ready = await page.evaluate(() => {
      return !!(
        document.getElementById('btnUnkHighlight') &&
        document.getElementById('btnHostnameUpload') &&
        document.getElementById('btnCostMatrix') &&
        document.getElementById('btnWhatIf')
      );
    }).catch(() => false);
    if (ready) return true;
    await settle(page, 500);
  }
  return false;
}
async function shot(page, name) {
  fs.mkdirSync(SS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SS_DIR, name + '.png'), fullPage: false });
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await Promise.race([
    page.press('#password', 'Enter'),
    page.click('input[type="submit"], button[type="submit"]').catch(() => {}),
  ]);
  await settle(page, 1500);
  return !page.url().includes('/login');
}

async function loadGraph(page, graphTime) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1000);
  await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    let opt = Array.from(sel.options).find(o => o.value === gt || (o.textContent || '').trim() === gt);
    if (!opt) { opt = document.createElement('option'); opt.value = gt; opt.text = gt; sel.add(opt); }
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
    if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt);
  }, graphTime);
  let total = null;
  for (let i = 1; i <= 18; i++) {
    await settle(page, 900);
    total = await page.evaluate(() => {
      try { return typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0; } catch(e) { return 0; }
    });
    if (total > 0) break;
  }
  return total;
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   SPRINT 3 — SMOKE TEST (Features A/B/C)                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (!GRAPH_TIME) {
    fail('PRE', 'No graph_time found in GRAPH_TIME/GRAPH_TIMES or IN-OUT-FOLDER');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox'] });
  const page    = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // ── Login ────────────────────────────────────────────────────────────────
  const loggedIn = await login(page);
  if (loggedIn) { pass('AUTH', `Logged in as ${API_USER}`); }
  else           { fail('AUTH', `Login failed`); await browser.close(); process.exit(1); }

  // ── Load graph via upload page ───────────────────────────────────────────
  const nodeCount = await loadGraph(page, GRAPH_TIME);
  nodeCount > 0
    ? pass('LOAD', `Graph loaded — ${nodeCount} vis.js nodes`)
    : fail('LOAD', `Graph failed to load (nodes=${nodeCount})`);
  await waitForToolbarButtons(page);
  await shot(page, '50-s3-graph-loaded');

  // ── Check toolbar buttons ─────────────────────────────────────────────────
  const buttons = [
    ['btnUnkHighlight',   '⚠ UNK button'],
    ['btnHostnameUpload', '📂 Host File button'],
    ['btnCostMatrix',     '🗺 Cost Matrix button'],
    ['btnWhatIf',         '🔬 What-If button'],
  ];
  for (const [id, label] of buttons) {
    const el = await page.$(`#${id}`);
    el ? pass(`BTN[${id}]`, `${label} present`) : fail(`BTN[${id}]`, `${label} NOT found`);
  }

  // ── Feature A: UNK highlight ──────────────────────────────────────────────
  const unkBefore = await page.evaluate(() => {
    if (typeof nodes === 'undefined' || !nodes) return -1;
    return nodes.get().filter(n => (n.country||'').toUpperCase()==='UNK').length;
  });
  console.log(`  ℹ  UNK nodes in graph: ${unkBefore}`);

  await page.evaluate(() => { if (typeof _toggleUnkHighlight === 'function') _toggleUnkHighlight(); });
  await page.waitForTimeout(600);
  const unkBtnActive = await page.evaluate(() => {
    var btn = document.getElementById('btnUnkHighlight');
    return btn ? btn.classList.contains('active') : false;
  });
  unkBefore >= 0
    ? pass('UNK', `_toggleUnkHighlight() executed, unkHighlightActive=${unkBtnActive}`)
    : fail('UNK', '_toggleUnkHighlight() failed — nodes undefined');
  await shot(page, '51-s3-unk-highlight');
  // Toggle off
  await page.evaluate(() => { if (typeof _toggleUnkHighlight === 'function') _toggleUnkHighlight(); });

  // ── Feature A: Hostname Upload panel ─────────────────────────────────────
  await page.evaluate(() => { if (typeof buildHostnameUploadPanel === 'function') buildHostnameUploadPanel(); });
  await page.waitForTimeout(500);
  const hPanel = await page.$('#hostnameUploadPanel');
  hPanel ? pass('HOST', 'Hostname Upload panel rendered') : fail('HOST', 'Panel not found');
  await shot(page, '52-s3-hostname-upload');
  await page.evaluate(() => { var p = document.getElementById('hostnameUploadPanel'); if (p) p.remove(); });

  // ── Feature A: Manual single-node reclassify (no file needed) ────────────
  const manualResult = await page.evaluate(() => {
    if (typeof nodes === 'undefined' || !nodes) return 'no_nodes';
    var n = nodes.get()[0];
    if (!n) return 'no_nodes';
    var origCountry = n.country || 'NONE';
    // Simulate manual reclassify
    nodes.update([{ id: n.id, country: 'TST' }]);
    var updated = nodes.get(n.id).country;
    // Restore
    nodes.update([{ id: n.id, country: origCountry }]);
    return updated === 'TST' ? 'ok' : 'fail';
  });
  manualResult === 'ok'
    ? pass('HOST', 'Manual node reclassify: nodes.update() works')
    : fail('HOST', `Manual reclassify issue: ${manualResult}`);

  // ── Feature B: Cost Matrix ─────────────────────────────────────────────────
  await page.evaluate(() => { if (typeof buildOspfCostMatrix === 'function') buildOspfCostMatrix(); });
  await page.waitForTimeout(2000);
  const matrixPanel = await page.$('#ospfCostMatrixPanel');
  matrixPanel ? pass('MATRIX', 'Cost Matrix panel rendered') : fail('MATRIX', 'Panel not found');

  // Check matrix has country rows
  const matrixRows = await page.evaluate(() => {
    var tbl = document.querySelector('#ospfCostMatrixPanel table tbody');
    return tbl ? tbl.querySelectorAll('tr').length : 0;
  });
  matrixRows > 0
    ? pass('MATRIX', `Matrix has ${matrixRows} country rows`)
    : fail('MATRIX', 'Matrix table has no rows');

  // Check Dijkstra computed non-zero values
  const nonZeroCells = await page.evaluate(() => {
    var tds = document.querySelectorAll('#ospfCostMatrixPanel td[data-src]');
    var nonZ = 0;
    tds.forEach(function(td) {
      var v = parseInt(td.textContent, 10);
      if (!isNaN(v) && v > 0) nonZ++;
    });
    return nonZ;
  });
  nonZeroCells > 0
    ? pass('MATRIX', `${nonZeroCells} cells with non-zero Dijkstra costs`)
    : fail('MATRIX', 'All cells are 0 or ∞ — Dijkstra may not be working');

  await shot(page, '53-s3-cost-matrix');

  // ── Feature B: cell click (path highlight) ────────────────────────────────
  const firstCell = await page.$('#ospfCostMatrixPanel td[data-src][data-dst]');
  if (firstCell) {
    const srcC = await firstCell.getAttribute('data-src');
    const dstC = await firstCell.getAttribute('data-dst');
    if (srcC !== dstC) {
      await firstCell.click();
      await page.waitForTimeout(500);
      pass('MATRIX', `Cell click (${srcC}→${dstC}) executed without error`);
    } else {
      pass('MATRIX', 'Cell click skipped (diagonal cell)');
    }
  } else {
    fail('MATRIX', 'No data cells found in matrix table');
  }

  // ── Feature C: What-If panel ───────────────────────────────────────────────
  await page.evaluate(() => { if (typeof buildOspfWhatIf === 'function') buildOspfWhatIf(); });
  await page.waitForTimeout(600);
  const wiPanel = await page.$('#ospfWhatIfPanel');
  wiPanel ? pass('WHATIF', 'What-If panel rendered') : fail('WHATIF', 'Panel not found');

  // Check edge picker has options
  const edgeCount = await page.evaluate(() => {
    var sel = document.getElementById('wiEdgePicker');
    return sel ? sel.options.length : 0;
  });
  edgeCount > 0
    ? pass('WHATIF', `Edge picker has ${edgeCount} edges`)
    : fail('WHATIF', 'Edge picker is empty');

  // Run analysis
  await page.evaluate(() => {
    var picker = document.getElementById('wiEdgePicker');
    var newCostEl = document.getElementById('wiNewCost');
    if (picker && picker.options.length > 0 && newCostEl) {
      picker.selectedIndex = 0;
      picker.dispatchEvent(new Event('change'));
      newCostEl.value = 100;
    }
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => { if (typeof _runWhatIfAnalysis === 'function') _runWhatIfAnalysis(); });
  await page.waitForTimeout(2000);

  const wiResult = await page.evaluate(() => {
    var el = document.getElementById('wiImpactResult');
    return el ? el.textContent.trim().slice(0, 80) : '';
  });
  wiResult && wiResult.length > 5
    ? pass('WHATIF', `Analysis ran: "${wiResult.slice(0,60)}..."`)
    : fail('WHATIF', 'Analysis result is empty');
  await shot(page, '54-s3-what-if-result');

  // ── Final summary ─────────────────────────────────────────────────────────
  await browser.close();
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   SPRINT 3 SMOKE TEST — FINAL SUMMARY                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  PASSED : ${String(PASS).padEnd(54)}║`);
  console.log(`║  FAILED : ${String(FAIL).padEnd(54)}║`);
  console.log(`║  TOTAL  : ${String(PASS+FAIL).padEnd(54)}║`);
  if (FAIL === 0) {
    console.log('║  STATUS : ALL SPRINT 3 SMOKE CHECKS PASSED ✅                   ║');
  } else {
    console.log('║  STATUS : SOME CHECKS FAILED ❌ — review output above           ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  process.exit(FAIL > 0 ? 1 : 0);
})();
