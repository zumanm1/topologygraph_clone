'use strict';
/**
 * 25-what-if-graph-rendering.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that the What-If Analysis page renders the graph correctly.
 * 
 * Test Flow:
 *   1. Login with credentials
 *   2. Navigate to /what-if page
 *   3. Wait for graph time dropdown to populate
 *   4. Wait for Vis.js network to initialize
 *   5. Verify canvas element exists and has dimensions
 *   6. Verify nodes are loaded in Vis.js DataSet
 *   7. Capture screenshot showing visible graph
 *   8. Validate no JavaScript errors in console
 * 
 * Run:
 *   BASE_URL=http://localhost:8081 API_USER=ospf@topolograph.com API_PASS=ospf \
 *   node tests/25-what-if-graph-rendering.cjs
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const pass = [], fail = [], warn = [];
function ok(msg) { pass.push(msg); console.log('  ✅  ' + msg); }
function ko(msg, detail) { fail.push(msg); console.log('  ❌  ' + msg + (detail ? ' — ' + detail : '')); }
function wn(msg, detail) { warn.push(msg); console.log('  ⚠️   ' + msg + (detail ? ' — ' + detail : '')); }

async function shot(page, name) {
  const f = path.join(SCREENSHOT_DIR, name + '.png');
  await page.screenshot({ path: f, fullPage: true });
  console.log('  📸  Screenshot: ' + f);
}

(async () => {
  const browser = await chromium.launch({ 
    headless: true, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const ctx = await browser.newContext({ 
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1
  });

  console.log('\n════ What-If Analysis Graph Rendering Validation ════\n');

  const page = await ctx.newPage();
  
  // Capture console messages and errors
  const consoleMessages = [];
  const jsErrors = [];
  
  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      console.log('  🔴 Console Error:', text);
      jsErrors.push(text);
    } else if (text.includes('WI:')) {
      console.log('  📝 ' + text);
    }
  });

  page.on('pageerror', err => {
    console.log('  🔴 Page Error:', err.message);
    jsErrors.push(err.message);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 1: Login
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('Step 1: Authenticating...');
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(500);
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);
  
  const loggedIn = !page.url().includes('/login');
  loggedIn ? ok('Login successful') : ko('Login failed', 'still on login page');
  if (!loggedIn) { await browser.close(); process.exit(1); }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 2: Navigate to What-If Analysis page
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\nStep 2: Navigating to What-If Analysis page...');
  await page.goto(BASE + '/what-if', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1000);
  
  const url = page.url();
  url.includes('/what-if') ? ok('Navigated to What-If page') : ko('Navigation failed', url);

  await shot(page, '25-01-what-if-initial-load');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 3: Verify graph time dropdown populates
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\nStep 3: Checking graph time dropdown...');
  await page.waitForTimeout(3000); // Allow API call to complete
  
  const graphTimeOptions = await page.evaluate(() => {
    const sel = document.getElementById('wiGraphTime');
    if (!sel) return null;
    return Array.from(sel.options).map(o => o.value).filter(v => v);
  });

  if (graphTimeOptions && graphTimeOptions.length > 0) {
    ok('Graph time dropdown populated: ' + graphTimeOptions.length + ' options');
    console.log('    Available graph times:', graphTimeOptions.slice(0, 3).join(', ') + 
                (graphTimeOptions.length > 3 ? '...' : ''));
  } else {
    ko('Graph time dropdown empty', 'No graph times available');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 4: Wait for topology to load
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\nStep 4: Waiting for topology to load...');
  await page.waitForTimeout(8000); // Allow KSP_loadTopology to complete

  const topologyState = await page.evaluate(() => {
    return {
      wiNodesCount: typeof wiNodes !== 'undefined' ? wiNodes.length : 0,
      wiEdgesCount: typeof wiEdges !== 'undefined' ? wiEdges.length : 0,
      wiNetworkExists: typeof wiNetwork !== 'undefined' && wiNetwork !== null,
      wiVNodesCount: typeof wiVNodes !== 'undefined' && wiVNodes !== null ? wiVNodes.length : 0,
      wiVEdgesCount: typeof wiVEdges !== 'undefined' && wiVEdges !== null ? wiVEdges.length : 0,
      statusText: document.getElementById('wi-status')?.textContent || ''
    };
  });

  console.log('    Topology state:', JSON.stringify(topologyState, null, 2));

  if (topologyState.wiNodesCount > 0) {
    ok('Topology data loaded: ' + topologyState.wiNodesCount + ' nodes, ' + topologyState.wiEdgesCount + ' edges');
  } else {
    ko('Topology data not loaded', 'wiNodes.length = ' + topologyState.wiNodesCount);
  }

  if (topologyState.wiNetworkExists) {
    ok('Vis.js network instance created');
  } else {
    ko('Vis.js network not initialized', 'wiNetwork is null or undefined');
  }

  if (topologyState.wiVNodesCount > 0) {
    ok('Vis.js DataSet populated: ' + topologyState.wiVNodesCount + ' nodes');
  } else {
    ko('Vis.js DataSet empty', 'wiVNodes.length = ' + topologyState.wiVNodesCount);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 5: Verify canvas element and dimensions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\nStep 5: Verifying canvas element...');
  
  const canvasInfo = await page.evaluate(() => {
    const container = document.getElementById('wiTopoContainer');
    if (!container) return { exists: false };
    
    const canvas = container.querySelector('canvas');
    if (!canvas) return { exists: false, containerExists: true };
    
    const rect = canvas.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(container);
    
    return {
      exists: true,
      containerExists: true,
      width: rect.width,
      height: rect.height,
      containerWidth: computedStyle.width,
      containerHeight: computedStyle.height,
      display: computedStyle.display,
      visibility: computedStyle.visibility
    };
  });

  console.log('    Canvas info:', JSON.stringify(canvasInfo, null, 2));

  if (canvasInfo.exists) {
    ok('Canvas element found: ' + Math.round(canvasInfo.width) + 'x' + Math.round(canvasInfo.height) + 'px');
  } else if (canvasInfo.containerExists) {
    ko('Canvas not found', 'Container exists but no canvas element inside');
  } else {
    ko('Container #wiTopoContainer not found', 'DOM structure issue');
  }

  if (canvasInfo.width > 0 && canvasInfo.height > 0) {
    ok('Canvas has valid dimensions');
  } else {
    ko('Canvas has zero dimensions', 'width=' + canvasInfo.width + ', height=' + canvasInfo.height);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 6: Wait for network stabilization and capture final screenshot
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\nStep 6: Waiting for network stabilization...');
  await page.waitForTimeout(5000); // Allow physics to stabilize

  await shot(page, '25-02-what-if-graph-rendered');

  // Check if nodes are visible on canvas
  const nodesVisible = await page.evaluate(() => {
    if (typeof wiNetwork === 'undefined' || !wiNetwork) return false;
    try {
      const positions = wiNetwork.getPositions();
      return Object.keys(positions).length > 0;
    } catch (e) {
      return false;
    }
  });

  if (nodesVisible) {
    ok('Nodes positioned on canvas (network.getPositions() returned data)');
  } else {
    wn('Could not verify node positions', 'network.getPositions() failed or returned empty');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 7: Check for JavaScript errors
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\nStep 7: Checking for JavaScript errors...');
  
  if (jsErrors.length === 0) {
    ok('No JavaScript errors detected');
  } else {
    ko('JavaScript errors found: ' + jsErrors.length, jsErrors.join('; '));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Step 8: Test scenario creation (bonus validation)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\nStep 8: Testing scenario creation UI...');
  
  const scenarioButtonExists = await page.evaluate(() => {
    const btn = document.querySelector('button[onclick*="wiAddScenario"]');
    return btn !== null;
  });

  if (scenarioButtonExists) {
    ok('Scenario creation button found');
    
    // Click to add a scenario
    await page.click('button[onclick*="wiAddScenario"]').catch(() => {});
    await page.waitForTimeout(500);
    
    const scenarioCardExists = await page.evaluate(() => {
      return document.querySelector('.scenario-card') !== null;
    });
    
    if (scenarioCardExists) {
      ok('Scenario card created successfully');
      await shot(page, '25-03-what-if-scenario-added');
    } else {
      wn('Scenario card not created', 'UI interaction may have failed');
    }
  } else {
    wn('Scenario creation button not found', 'UI element missing');
  }

  await browser.close();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Summary
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  PASSED: ' + pass.length + ' | FAILED: ' + fail.length + ' | WARNED: ' + warn.length);
  console.log('  Screenshots saved to: ' + SCREENSHOT_DIR);
  
  if (warn.length) {
    console.log('\n  ⚠️  WARNINGS:');
    warn.forEach(w => console.log('    - ' + w));
  }
  
  if (fail.length) {
    console.log('\n  ❌  FAILURES:');
    fail.forEach(f => console.log('    - ' + f));
    process.exit(1);
  } else {
    console.log('\n  ✅  ALL TESTS PASSED');
  }
})();
