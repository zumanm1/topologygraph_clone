#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const GRAPH_TIME = (process.env.GRAPH_TIME || process.env.GRAPH_TIMES || '').split(',')[0].trim();
const SS_DIR = path.join(__dirname, 'screenshots');

let PASS = 0;
let FAIL = 0;
function pass(tag, msg) { PASS++; console.log(`  ✅ PASS [${tag}]: ${msg}`); }
function fail(tag, msg) { FAIL++; console.log(`  ❌ FAIL [${tag}]: ${msg}`); }
async function settle(page, ms) { await page.waitForTimeout(ms || 800); }
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
    let opt = Array.from(sel.options).find(o => o.value === gt || o.text.trim() === gt);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = gt;
      opt.text = gt;
      sel.add(opt);
    }
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
  }, graphTime);
  const loadBtn = await page.$('input#load_graph_button') ||
                  await page.$('input[onclick*="upload_ospf_lsdb"]') ||
                  await page.$('button[onclick*="upload_ospf_lsdb"]');
  if (loadBtn) {
    await loadBtn.click();
  } else {
    await page.evaluate((gt) => { if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt); }, graphTime);
  }
  for (let i = 0; i < 12; i++) {
    await settle(page, 1200);
    const total = await page.evaluate(() => {
      try { return typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0; } catch (e) { return 0; }
    });
    if (total > 0) return total;
  }
  return 0;
}

async function fetchSavedLayout(page) {
  return page.evaluate(async () => {
    const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
    const graphTime = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].value : '';
    const graphId = typeof graph_id !== 'undefined' && graph_id !== null ? String(graph_id) : '';
    const mode = typeof _viewMode !== 'undefined' && _viewMode ? _viewMode : 'enriched';
    const query = new URLSearchParams({ graph_id: graphId, graph_time: graphTime, view_mode: mode });
    const response = await fetch('/layout-api/layouts?' + query.toString(), { credentials: 'same-origin' });
    return response.json();
  });
}

(async () => {
  if (!GRAPH_TIME) {
    console.error('GRAPH_TIME is required');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Layout Persistence — Playwright Smoke Test                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  try {
    const okLogin = await login(page);
    okLogin ? pass('AUTH', `Logged in as ${API_USER}`) : fail('AUTH', 'Login failed');
    if (!okLogin) throw new Error('login failed');

    const nodeCount = await loadGraph(page, GRAPH_TIME);
    nodeCount > 0 ? pass('LOAD', `Graph loaded with ${nodeCount} nodes`) : fail('LOAD', 'Graph failed to load');
    if (nodeCount <= 0) throw new Error('graph load failed');
    await shot(page, 'layout-01-graph-loaded');

    const controls = [
      'btnLayoutSave',
      'btnLayoutLoad',
      'btnLayoutReset',
      'btnLayoutResetNode',
      'btnExportYaml',
      'btnExportCsv',
      'btnExportExcel'
    ];
    for (const id of controls) {
      const el = await page.$('#' + id);
      el ? pass('CTRL', `${id} present`) : fail('CTRL', `${id} missing`);
    }

    await page.evaluate(() => { if (typeof do_stop_start_physics === 'function' && network.physics && network.physics.physicsEnabled) do_stop_start_physics(); });
    await settle(page, 400);

    const moved = await page.evaluate(() => {
      const all = nodes.get().filter(n => n.hidden !== true);
      const target = all[0];
      if (!target) return null;
      const nodeId = target.id;
      const before = network.getPositions([nodeId])[nodeId];
      network.selectNodes([nodeId]);
      network.moveNode(nodeId, 4321, -2345);
      const after = network.getPositions([nodeId])[nodeId];
      return { nodeId: String(nodeId), before, after };
    });
    if (moved && moved.after && Math.abs(moved.after.x - 4321) < 5 && Math.abs(moved.after.y + 2345) < 5) {
      pass('MOVE', `Node ${moved.nodeId} moved to saved test position`);
    } else {
      fail('MOVE', 'Node move did not apply');
      throw new Error('move failed');
    }

    await page.click('#btnLayoutSave');
    await settle(page, 1200);
    const savedLayout = await fetchSavedLayout(page);
    if (savedLayout.found && savedLayout.positions && savedLayout.positions[moved.nodeId]) {
      pass('SAVE', `Layout stored in API revision ${savedLayout.revision}`);
    } else {
      fail('SAVE', 'Layout not stored in API');
      throw new Error('save failed');
    }

    await page.evaluate((gt) => { if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt); }, GRAPH_TIME);
    await settle(page, 2600);
    const reloadedPosition = await page.evaluate((nodeId) => {
      const pos = network.getPositions([Number(nodeId)])[Number(nodeId)] || network.getPositions([nodeId])[nodeId];
      return pos || null;
    }, moved.nodeId);
    if (reloadedPosition && Math.abs(reloadedPosition.x - 4321) < 25 && Math.abs(reloadedPosition.y + 2345) < 25) {
      pass('LOAD', `Saved layout re-applied to node ${moved.nodeId}`);
    } else {
      fail('LOAD', 'Saved layout not re-applied after graph reload');
      throw new Error('load failed');
    }
    await shot(page, 'layout-02-layout-reloaded');

    await page.click('#btnLayoutResetNode');
    await settle(page, 1200);
    const nodeResetLayout = await fetchSavedLayout(page);
    if (nodeResetLayout.found && (!nodeResetLayout.positions || !nodeResetLayout.positions[moved.nodeId])) {
      pass('RESET-NODE', `Selected node ${moved.nodeId} removed from saved layout`);
    } else {
      fail('RESET-NODE', 'Selected node layout reset did not remove node');
      throw new Error('node reset failed');
    }

    await page.click('#btnLayoutSave');
    await settle(page, 1000);
    await page.click('#btnLayoutReset');
    await settle(page, 1500);
    const resetLayout = await fetchSavedLayout(page);
    if (!resetLayout.found) {
      pass('RESET', 'Full layout reset removed saved snapshot');
    } else {
      fail('RESET', 'Saved layout still present after reset');
      throw new Error('full reset failed');
    }

    for (const buttonId of ['btnExportYaml', 'btnExportCsv', 'btnExportExcel']) {
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
      await page.click('#' + buttonId);
      const download = await downloadPromise;
      const name = await download.suggestedFilename();
      pass('EXPORT', `${buttonId} download started (${name})`);
    }
    await shot(page, 'layout-03-layout-controls');
  } catch (error) {
    fail('FATAL', error.message || String(error));
  } finally {
    await browser.close();
    console.log('');
    console.log(`TOTAL PASSED: ${PASS}`);
    console.log(`TOTAL FAILED: ${FAIL}`);
    process.exit(FAIL > 0 ? 1 : 0);
  }
})();
