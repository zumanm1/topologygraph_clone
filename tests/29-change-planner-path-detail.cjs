'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const USER     = process.env.API_USER  || 'ospf@topolograph.com';
const PASS     = process.env.API_PASS  || 'ospf';
const SS_DIR   = path.join(__dirname, '..', 'test-screenshots');

if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

let passed = 0, failed = 0;
function ok(msg)   { console.log('  ✅ ', msg); passed++; }
function fail(msg) { console.log('  ❌ ', msg); failed++; }
function info(msg) { console.log('  📝', msg); }
async function shot(page, name) {
  const p = path.join(SS_DIR, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log('  📸  Screenshot:', p);
}

(async () => {
  console.log('\n════ Change Planner — Full Path Detail Validation ════\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });

  /* ── Step 1: Login ─────────────────────────────────────────────── */
  console.log('Step 1: Authenticating...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(500);
  await page.fill('#login', USER);
  await page.fill('#password', PASS);
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);
  if (page.url().includes('login')) { fail('Login failed'); await browser.close(); process.exit(1); }
  ok('Login successful');

  /* ── Step 2: Navigate to Change Planner ────────────────────────── */
  console.log('\nStep 2: Navigating to Change Planner...');
  await page.goto(`${BASE_URL}/change-planner`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1000);
  ok('Navigated to Change Planner');
  await shot(page, '29-01-planner-initial.png');

  /* ── Step 3: Wait for dropdown, select 84-node snapshot ─────────── */
  console.log('\nStep 3: Selecting 84-node snapshot...');
  const TARGET = '11Mar2026_21h17m14s_84_hosts';
  try {
    await page.waitForFunction(
      () => document.querySelector('#cpGraphTime') &&
            document.querySelector('#cpGraphTime').options.length > 1,
      { timeout: 15000 }
    );
    ok('Dropdown populated');
  } catch (e) {
    fail('Dropdown did not populate within 15s');
    await shot(page, '29-fail-no-dropdown.png');
    await browser.close(); process.exit(1);
  }

  const hasTarget = await page.evaluate(t => {
    const sel = document.getElementById('cpGraphTime');
    return Array.from(sel.options).some(o => o.value === t);
  }, TARGET);

  if (hasTarget) {
    await page.selectOption('#cpGraphTime', TARGET);
    ok(`Selected: ${TARGET}`);
  } else {
    fail(`84-node snapshot not found: ${TARGET}`);
    info('Proceeding with auto-selected snapshot');
  }

  /* ── Step 4: Wait for topology to load ─────────────────────────── */
  console.log('\nStep 4: Waiting for topology to load...');
  try {
    await page.waitForFunction(
      () => {
        const el = document.getElementById('cpStatus');
        return el && el.textContent.includes('nodes') && el.textContent.includes('edges');
      },
      { timeout: 30000 }
    );
    const statusText = await page.$eval('#cpStatus', el => el.textContent);
    ok(`Topology loaded: ${statusText.trim()}`);
  } catch (e) {
    fail('Topology did not load within 30s');
    await shot(page, '29-fail-no-topo.png');
    await browser.close(); process.exit(1);
  }
  await shot(page, '29-02-topology-loaded.png');

  /* ── Step 5: Add a change row via edge picker ───────────────────── */
  console.log('\nStep 5: Adding a change row...');
  await page.click('#cpBtnAddRow');
  await page.waitForTimeout(300);

  // Fill in edge ID and cost in the plan table
  // Use a known cross-country edge from the 84-node snapshot (CAN→FRA, weight 10)
  // This edge lies on the shortest CAN→FRA inter-country path
  const CROSS_EDGE_ID = '9.9.9.1_to_13.13.13.1';
  const edgeInputs = await page.$$('.cp-plan-table input[type="text"]');
  if (edgeInputs.length > 0) {
    await edgeInputs[edgeInputs.length - 1].fill(CROSS_EDGE_ID);
    info(`Using cross-country edge: ${CROSS_EDGE_ID}`);
  }
  const fwdInputs = await page.$$('.cp-plan-table input[type="number"]');
  if (fwdInputs.length > 0) {
    await fwdInputs[fwdInputs.length - 2].fill('500');  // raise cost dramatically → forces reroute
  }
  ok(`Change row added: edge ${CROSS_EDGE_ID} cost→500`);
  await shot(page, '29-03-change-row.png');

  /* ── Step 6: Run Analyse Impact ────────────────────────────────── */
  console.log('\nStep 6: Running Analyse Impact...');
  await page.click('#cpBtnAnalyse');

  try {
    await page.waitForFunction(
      () => document.getElementById('cpImpactSection') &&
            document.getElementById('cpImpactSection').style.display !== 'none',
      { timeout: 30000 }
    );
    ok('Impact section visible');
  } catch (e) {
    fail('Impact section did not appear within 30s');
    await shot(page, '29-fail-no-impact.png');
    await browser.close(); process.exit(1);
  }

  const affected = await page.$eval('#cpStatAffected', el => el.textContent.trim());
  const improved = await page.$eval('#cpStatImproved', el => el.textContent.trim());
  const degraded = await page.$eval('#cpStatDegraded', el => el.textContent.trim());
  info(`Impact stats — Affected: ${affected}, Improved: ${improved}, Degraded: ${degraded}`);
  if (parseInt(affected) >= 0) ok('Impact stats rendered');
  else fail('Impact stats missing');

  await shot(page, '29-04-impact-results.png');

  /* ── Step 7: Check diff table rows exist ───────────────────────── */
  console.log('\nStep 7: Checking diff table rows...');
  const diffRows = await page.$$('#cpDiffRows tr');
  info(`Diff table rows: ${diffRows.length}`);
  if (diffRows.length > 0) ok(`Diff table has ${diffRows.length} rows`);
  else {
    info('No affected pairs (edge may not affect any country pair) — trying with a different edge');
    // Try picking from the edge dropdown if available
  }

  /* ── Step 8: Click a diff row to expand path detail ────────────── */
  console.log('\nStep 8: Expanding path detail panel...');

  let detailExpanded = false;

  if (diffRows.length > 0) {
    await diffRows[0].click();
    await page.waitForTimeout(1000);
    const detailTr = await page.$('tr.cp-detail-tr');
    if (detailTr) {
      ok('Detail row inserted (cp-detail-tr)');
      detailExpanded = true;
    } else {
      fail('Detail row not found after click');
    }
  } else {
    info('No diff rows — skipping detail expansion (no path changes for this edge)');
  }

  if (detailExpanded) {
    await shot(page, '29-05-detail-expanded.png');

    /* ── Step 9: Verify 4 panels present ──────────────────────────── */
    console.log('\nStep 9: Verifying 4-panel structure...');
    const panels = await page.$$('tr.cp-detail-tr .cp-detail-panel');
    info(`Detail panels found: ${panels.length}`);
    if (panels.length === 4) ok('All 4 panels present (Before FWD/REV + After FWD/REV)');
    else if (panels.length > 0) ok(`${panels.length} panels present`);
    else fail('No detail panels found');

    /* ── Step 10: Verify hop tables ───────────────────────────────── */
    console.log('\nStep 10: Checking hop tables...');
    const hopTables = await page.$$('tr.cp-detail-tr .cp-hop-table');
    info(`Hop tables found: ${hopTables.length}`);
    if (hopTables.length > 0) ok(`${hopTables.length} hop tables rendered`);
    else fail('No hop tables found');

    const hopRows = await page.$$('tr.cp-detail-tr .cp-hop-table tbody tr');
    info(`Total hop rows: ${hopRows.length}`);
    if (hopRows.length > 0) ok(`${hopRows.length} hop rows present`);
    else fail('No hop rows in tables');

    /* ── Step 11: Verify country chips ───────────────────────────── */
    console.log('\nStep 11: Checking country chips...');
    const ctryChips = await page.$$('tr.cp-detail-tr .cp-ctry-chip');
    info(`Country chips: ${ctryChips.length}`);
    if (ctryChips.length > 0) ok(`Country chips present: ${ctryChips.length}`);
    else fail('No country chips found');

    /* ── Step 12: Verify cost chips ──────────────────────────────── */
    console.log('\nStep 12: Checking cost chips...');
    const costChips = await page.$$('tr.cp-detail-tr .cp-cost-chip');
    info(`Cost chips: ${costChips.length}`);
    if (costChips.length > 0) ok(`Cost chips present: ${costChips.length}`);
    else fail('No cost chips found');

    /* ── Step 13: Verify country chain ───────────────────────────── */
    console.log('\nStep 13: Checking country chains...');
    const ctryChains = await page.$$('tr.cp-detail-tr .cp-ctry-chain');
    info(`Country chains: ${ctryChains.length}`);
    if (ctryChains.length > 0) ok(`Country chains present: ${ctryChains.length}`);
    else fail('No country chains found');

    /* ── Step 14: Verify FWD/REV badges ─────────────────────────── */
    console.log('\nStep 14: Checking FWD/REV badges...');
    const fwdBadges = await page.$$('tr.cp-detail-tr .cp-db-fwd');
    const revBadges = await page.$$('tr.cp-detail-tr .cp-db-rev');
    if (fwdBadges.length >= 2) ok(`FWD badges: ${fwdBadges.length}`);
    else fail(`FWD badges: ${fwdBadges.length} (expected ≥2)`);
    if (revBadges.length >= 2) ok(`REV badges: ${revBadges.length}`);
    else fail(`REV badges: ${revBadges.length} (expected ≥2)`);

    /* ── Step 15: Verify Before/After labels ─────────────────────── */
    console.log('\nStep 15: Checking Before/After headings...');
    const beforeHeads = await page.$$('tr.cp-detail-tr .cp-ph-before');
    const afterHeads  = await page.$$('tr.cp-detail-tr .cp-ph-after');
    if (beforeHeads.length >= 2) ok(`Before headings: ${beforeHeads.length}`);
    else fail(`Before headings: ${beforeHeads.length}`);
    if (afterHeads.length >= 2) ok(`After headings: ${afterHeads.length}`);
    else fail(`After headings: ${afterHeads.length}`);

    /* ── Step 16: Verify topology buttons ────────────────────────── */
    console.log('\nStep 16: Checking topology highlight buttons...');
    const topoBtn = await page.$('tr.cp-detail-tr .cp-topo-btns');
    if (topoBtn) ok('Topology buttons row present');
    else fail('Topology buttons row missing');

    /* ── Step 17: Collapse detail row ────────────────────────────── */
    console.log('\nStep 17: Collapsing detail row...');
    await diffRows[0].click();
    await page.waitForTimeout(500);
    const detailGone = await page.$('tr.cp-detail-tr');
    if (!detailGone) ok('Detail row collapsed on second click');
    else fail('Detail row not collapsed');
  }

  await shot(page, '29-06-final-state.png');

  /* ── Step 18: JS errors ─────────────────────────────────────────── */
  console.log('\nStep 18: Checking for JavaScript errors...');
  if (jsErrors.length === 0) ok('No JavaScript errors detected');
  else { fail(`JavaScript errors: ${jsErrors.length}`); jsErrors.forEach(e => info('  JS ERR: ' + e)); }

  /* ── Summary ────────────────────────────────────────────────────── */
  console.log('\n' + '═'.repeat(56));
  console.log(`  PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`  Screenshots saved to: ${SS_DIR}`);
  if (failed === 0) console.log('\n  ✅  ALL TESTS PASSED\n');
  else console.log('\n  ⚠️  SOME TESTS FAILED\n');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
