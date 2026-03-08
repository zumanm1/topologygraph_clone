#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const GRAPH_TIME = (process.env.GRAPH_TIME || process.env.GRAPH_TIMES || '').split(',')[0].trim();
const SS_DIR = process.env.SCREENSHOT_DIR
  ? path.resolve(process.env.SCREENSHOT_DIR)
  : path.join(__dirname, '..', '11-STEP-BY-STEP-SECURITY', 'screenshots', 'layout-isolation');

let PASS = 0;
let FAIL = 0;
function pass(tag, msg) { PASS++; console.log(`  ✅ PASS [${tag}]: ${msg}`); }
function fail(tag, msg) { FAIL++; console.log(`  ❌ FAIL [${tag}]: ${msg}`); }
async function settle(page, ms) { await page.waitForTimeout(ms || 800); }
async function shot(page, name) {
  fs.mkdirSync(SS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SS_DIR, name + '.png'), fullPage: false });
}
function near(value, expected, tolerance) {
  return typeof value === 'number' && Math.abs(value - expected) <= tolerance;
}

async function login(page, loginValue, passwordValue) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);
  await page.fill('#login', loginValue);
  await page.fill('#password', passwordValue);
  await Promise.race([
    page.press('#password', 'Enter'),
    page.click('input[type="submit"], button[type="submit"]').catch(() => {})
  ]);
  await settle(page, 1500);
  return !page.url().includes('/login');
}

async function registerOrLogin(page, loginValue, passwordValue) {
  await page.goto(`${BASE_URL}/register`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 700);
  const emailInput = await page.$('#validationEmail');
  const passwordInput = await page.$('#validationPassword');
  if (emailInput && passwordInput) {
    await page.fill('#validationEmail', loginValue);
    await page.fill('#validationPassword', passwordValue);
    await Promise.race([
      page.click('button[type="submit"]').catch(() => {}),
      page.press('#validationPassword', 'Enter').catch(() => {})
    ]);
    await settle(page, 1800);
  }
  if (page.url().includes('/login') || page.url().includes('/register')) {
    return login(page, loginValue, passwordValue);
  }
  return true;
}

async function loadGraph(page, graphTime) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1000);
  await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
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
    await Promise.allSettled([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      loadBtn.click()
    ]);
  } else {
    await page.evaluate((gt) => { if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt); }, graphTime);
  }
  for (let i = 0; i < 15; i++) {
    await settle(page, 1200);
    const total = await page.evaluate(() => {
      try { return typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0; } catch (e) { return 0; }
    });
    if (total > 0) return total;
  }
  return 0;
}

async function getLayoutContext(page) {
  return page.evaluate(() => {
    const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
    const graphTime = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].value : '';
    const graphId = typeof graph_id !== 'undefined' && graph_id !== null ? String(graph_id) : '';
    const viewMode = typeof _viewMode !== 'undefined' && _viewMode ? _viewMode : 'enriched';
    return { graph_id: graphId, graph_time: graphTime, view_mode: viewMode };
  });
}

async function fetchSavedLayout(page, layoutContext) {
  return page.evaluate(async (ctx) => {
    const query = new URLSearchParams({ graph_id: ctx.graph_id, graph_time: ctx.graph_time, view_mode: ctx.view_mode });
    const response = await fetch('/layout-api/layouts?' + query.toString(), { credentials: 'same-origin' });
    return response.json();
  }, layoutContext);
}

async function resetSavedLayout(page, layoutContext) {
  return page.evaluate(async (ctx) => {
    const query = new URLSearchParams({ graph_id: ctx.graph_id, graph_time: ctx.graph_time, view_mode: ctx.view_mode });
    const response = await fetch('/layout-api/layouts?' + query.toString(), { method: 'DELETE', credentials: 'same-origin' });
    return { status: response.status };
  }, layoutContext);
}

async function putSavedLayout(page, layoutContext, positions, selectedNodeId) {
  return page.evaluate(async ({ ctx, positions, selectedNodeId }) => {
    const payload = {
      graph_id: ctx.graph_id,
      graph_time: ctx.graph_time,
      view_mode: ctx.view_mode,
      positions,
      viewport: {},
      physics_enabled: false,
      selected_node_id: selectedNodeId || null,
    };
    const response = await fetch('/layout-api/layouts', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { ctx: layoutContext, positions, selectedNodeId });
}

async function moveNodeAndSave(page, layoutContext, x, y) {
  await page.evaluate(() => {
    if (typeof do_stop_start_physics === 'function' && network.physics && network.physics.physicsEnabled) {
      do_stop_start_physics();
    }
  });
  await settle(page, 400);
  const moved = await page.evaluate(({ x, y }) => {
    const all = nodes.get().filter(n => n.hidden !== true);
    const target = all[0];
    if (!target) return null;
    const nodeId = target.id;
    network.selectNodes([nodeId]);
    network.moveNode(nodeId, x, y);
    const after = network.getPositions([nodeId])[nodeId];
    return { nodeId: String(nodeId), after };
  }, { x, y });
  if (!moved || !moved.after) return null;
  await page.click('#btnLayoutSave');
  await settle(page, 1200);
  const layout = await fetchSavedLayout(page, layoutContext);
  return { nodeId: moved.nodeId, layout };
}

(async () => {
  if (!GRAPH_TIME) {
    console.error('GRAPH_TIME is required');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Layout Isolation — Cross-User Playwright Validation          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const secondUser = `li${String(Date.now()).slice(-8)}@p.io`;
  const secondPass = 'LayoutIsolation2026!';
  let cleanupA = false;
  let cleanupB = false;

  try {
    const okA = await login(pageA, API_USER, API_PASS);
    okA ? pass('AUTH-A', `Primary user logged in as ${API_USER}`) : fail('AUTH-A', 'Primary login failed');
    if (!okA) throw new Error('primary login failed');

    const okB = await registerOrLogin(pageB, secondUser, secondPass);
    okB ? pass('AUTH-B', `Secondary user session ready as ${secondUser}`) : fail('AUTH-B', 'Secondary register/login failed');
    if (!okB) throw new Error('secondary auth failed');

    const countA = await loadGraph(pageA, GRAPH_TIME);
    countA > 0 ? pass('LOAD-A', `Primary graph loaded with ${countA} nodes`) : fail('LOAD-A', 'Primary graph failed to load');
    if (countA <= 0) throw new Error('graph load failed');

    // Wait for any in-flight navigation triggered by upload_ospf_lsdb to settle
    // before evaluating JS context, otherwise execution context is destroyed
    await pageA.waitForLoadState('domcontentloaded').catch(() => null);
    await settle(pageA, 1500);

    const layoutContext = await getLayoutContext(pageA);
    if (!layoutContext.graph_id || !layoutContext.graph_time || !layoutContext.view_mode) {
      throw new Error('could not resolve layout context from primary graph');
    }
    pass('CTX', `Shared layout context resolved for ${layoutContext.graph_time}`);

    await shot(pageA, 'layout-isolation-user-a-loaded');
    await shot(pageB, 'layout-isolation-user-b-loaded');

    const resetA0 = await resetSavedLayout(pageA, layoutContext);
    const resetB0 = await resetSavedLayout(pageB, layoutContext);
    [200, 404].includes(resetA0.status) ? pass('CLEAN-A', `Primary pre-clean status ${resetA0.status}`) : fail('CLEAN-A', `Unexpected primary pre-clean status ${resetA0.status}`);
    [200, 404].includes(resetB0.status) ? pass('CLEAN-B', `Secondary pre-clean status ${resetB0.status}`) : fail('CLEAN-B', `Unexpected secondary pre-clean status ${resetB0.status}`);

    const movedA = await moveNodeAndSave(pageA, layoutContext, 4321, -2345);
    if (!movedA || !movedA.layout || !movedA.layout.found || !movedA.layout.positions || !movedA.layout.positions[movedA.nodeId]) {
      throw new Error('primary layout save failed');
    }
    cleanupA = true;
    const posA = movedA.layout.positions[movedA.nodeId];
    near(posA.x, 4321, 25) && near(posA.y, -2345, 25)
      ? pass('SAVE-A', `Primary layout stored for node ${movedA.nodeId}`)
      : fail('SAVE-A', `Primary layout position unexpected: ${JSON.stringify(posA)}`);

    const beforeB = await fetchSavedLayout(pageB, layoutContext);
    !beforeB.found
      ? pass('ISO-READ', 'Secondary user cannot read primary saved layout')
      : fail('ISO-READ', 'Secondary user unexpectedly saw an existing layout');

    const putB = await putSavedLayout(pageB, layoutContext, { [movedA.nodeId]: { x: -3456, y: 2100 } }, movedA.nodeId);
    if (putB.status !== 200) {
      throw new Error('secondary layout save failed');
    }
    cleanupB = true;
    const savedB = await fetchSavedLayout(pageB, layoutContext);
    const posB = savedB.positions && savedB.positions[movedA.nodeId];
    near(posB.x, -3456, 25) && near(posB.y, 2100, 25)
      ? pass('SAVE-B', `Secondary layout stored for node ${movedA.nodeId}`)
      : fail('SAVE-B', `Secondary layout position unexpected: ${JSON.stringify(posB)}`);

    const afterBSaveA = await fetchSavedLayout(pageA, layoutContext);
    const afterBSaveAPos = afterBSaveA.positions && afterBSaveA.positions[movedA.nodeId];
    afterBSaveA.found && afterBSaveAPos && near(afterBSaveAPos.x, 4321, 25) && near(afterBSaveAPos.y, -2345, 25)
      ? pass('ISO-WRITE', 'Secondary save did not overwrite primary layout')
      : fail('ISO-WRITE', `Primary layout changed after secondary save: ${JSON.stringify(afterBSaveAPos || afterBSaveA)}`);

    const resetB = await resetSavedLayout(pageB, layoutContext);
    resetB.status === 200 ? pass('RESET-B', 'Secondary layout reset succeeded') : fail('RESET-B', `Secondary reset returned HTTP ${resetB.status}`);
    cleanupB = false;

    const afterBReset = await fetchSavedLayout(pageB, layoutContext);
    !afterBReset.found
      ? pass('ISO-RESET-B', 'Secondary reset removed only the secondary layout')
      : fail('ISO-RESET-B', 'Secondary layout still present after reset');

    const afterBResetA = await fetchSavedLayout(pageA, layoutContext);
    const afterBResetAPos = afterBResetA.positions && afterBResetA.positions[movedA.nodeId];
    afterBResetA.found && afterBResetAPos && near(afterBResetAPos.x, 4321, 25) && near(afterBResetAPos.y, -2345, 25)
      ? pass('ISO-RESET-A', 'Secondary reset did not remove the primary layout')
      : fail('ISO-RESET-A', `Primary layout changed after secondary reset: ${JSON.stringify(afterBResetAPos || afterBResetA)}`);

    const resetA = await resetSavedLayout(pageA, layoutContext);
    resetA.status === 200 ? pass('RESET-A', 'Primary cleanup reset succeeded') : fail('RESET-A', `Primary cleanup reset returned HTTP ${resetA.status}`);
    cleanupA = false;

    await shot(pageA, 'layout-isolation-user-a-final');
    await shot(pageB, 'layout-isolation-user-b-final');
  } catch (error) {
    fail('FATAL', error.message || String(error));
  } finally {
    if (cleanupA) {
      try {
        const layoutContext = await getLayoutContext(pageA);
        if (layoutContext.graph_id && layoutContext.graph_time && layoutContext.view_mode) {
          await resetSavedLayout(pageA, layoutContext);
        }
      } catch (e) {}
    }
    if (cleanupB) {
      try {
        const layoutContext = await getLayoutContext(pageA);
        if (layoutContext.graph_id && layoutContext.graph_time && layoutContext.view_mode) {
          await resetSavedLayout(pageB, layoutContext);
        }
      } catch (e) {}
    }
    await browser.close();
    console.log('');
    console.log(`TOTAL PASSED: ${PASS}`);
    console.log(`TOTAL FAILED: ${FAIL}`);
    process.exit(FAIL > 0 ? 1 : 0);
  }
})().catch(err => { console.error(err && err.stack ? err.stack : String(err)); process.exit(1); });
