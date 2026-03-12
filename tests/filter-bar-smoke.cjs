'use strict';
/**
 * filter-bar-smoke.cjs
 * Validates TopoFilterBar on all 4 analysis pages using 84-node snapshot.
 * Graph: 11Mar2026_21h17m14s_84_hosts (34 A-type + 50 C-type nodes)
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const GT84  = '11Mar2026_21h17m14s_84_hosts';

let passed = 0, failed = 0;
function ok(msg)  { console.log('  ✅ ', msg); passed++; }
function ko(msg, detail) { console.error('  ❌ ', msg, detail || ''); failed++; }

async function login(page) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(400);
  await page.fill('#login', 'ospf@topolograph.com');
  await page.fill('#password', 'ospf');
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);
  if (page.url().includes('/login')) throw new Error('Login failed');
}

async function waitForFilterBar(page, containerId) {
  await page.waitForSelector('#' + containerId + ' .tfb-toolbar', { timeout: 30000 });
}

async function testPage(page, name, path, filterId, waitFn) {
  console.log('\n── ' + name + ' ────────────────────────────────────────');
  await page.goto(BASE + path + '?graph_time=' + GT84, { waitUntil: 'domcontentloaded', timeout: 20000 });

  // Wait for topology to load
  await waitFn(page);

  // 1. Filter bar rendered
  const barExists = await page.locator('#' + filterId + ' .tfb-toolbar').count();
  barExists > 0 ? ok('filter bar renders') : ko('filter bar not found', '#' + filterId);

  // 2. Stats badge shows 84 nodes
  const stats = await page.locator('#' + filterId + ' .tfb-stats').textContent();
  stats.includes('84') ? ok('stats badge: ' + stats) : ko('stats wrong: ' + stats);

  // 3. GATEWAY mode — click and verify fewer nodes shown
  await page.locator('#' + filterId + ' .tfb-mode-btn[data-mode="gateway"]').click();
  await page.waitForTimeout(600);
  const statsGW = await page.locator('#' + filterId + ' .tfb-stats').textContent();
  const gwMatch = statsGW.match(/^(\d+)\//);
  const gwCount = gwMatch ? parseInt(gwMatch[1]) : 0;
  (gwCount > 0 && gwCount <= 34) ? ok('GATEWAY hides non-A nodes: ' + statsGW) : ko('GATEWAY count wrong: ' + statsGW);

  // 4. AS-IS mode — restores all nodes
  await page.locator('#' + filterId + ' .tfb-mode-btn[data-mode="asis"]').click();
  await page.waitForTimeout(400);
  const statsAS = await page.locator('#' + filterId + ' .tfb-stats').textContent();
  statsAS.includes('84/84') ? ok('AS-IS restores all nodes') : ko('AS-IS count wrong: ' + statsAS);

  // 5. Countries panel opens
  await page.locator('#' + filterId + ' .tfb-tool-btn:has-text("Countries")').click();
  await page.waitForTimeout(300);
  const panelOpen = await page.locator('#' + filterId + ' .tfb-panel:visible').count();
  panelOpen > 0 ? ok('Countries panel opens') : ko('Countries panel did not open');

  // Count country checkboxes (should be 9 for AUS/BRA/CAN/DEU/FRA/GBR/IND/JPN/USA)
  const cbCount = await page.locator('#' + filterId + ' .tfb-panel input[data-country]').count();
  cbCount === 9 ? ok('9 country checkboxes') : ko('expected 9 country checkboxes, got ' + cbCount);

  // 6. Deselect CAN, Apply — 5 CAN nodes should hide
  const canCb = page.locator('#' + filterId + ' input[data-country="CAN"]');
  if (await canCb.count()) {
    await canCb.uncheck();
    await page.locator('#' + filterId + ' .tfb-pbtn.apply').click();
    await page.waitForTimeout(400);
    const statsAfterFilter = await page.locator('#' + filterId + ' .tfb-stats').textContent();
    const afterMatch = statsAfterFilter.match(/^(\d+)\//);
    const afterCount = afterMatch ? parseInt(afterMatch[1]) : 84;
    afterCount < 84 ? ok('CAN filter hides nodes: ' + statsAfterFilter) : ko('CAN filter had no effect: ' + statsAfterFilter);
  }

  // 7. Reset with AS-IS
  await page.locator('#' + filterId + ' .tfb-mode-btn[data-mode="asis"]').click();
  await page.waitForTimeout(400);

  // 8. A-Groups panel
  await page.locator('#' + filterId + ' .tfb-tool-btn:has-text("A-Groups")').click();
  await page.waitForTimeout(300);
  const groupCount = await page.locator('#' + filterId + ' .tfb-group-hdr').count();
  groupCount === 9 ? ok('A-Groups has 9 country groups') : ko('expected 9 groups, got ' + groupCount);

  // Close panel with Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 9. COLLAPSING mode
  await page.locator('#' + filterId + ' .tfb-mode-btn[data-mode="collapsing"]').click();
  await page.waitForTimeout(600);
  const statsCollapse = await page.locator('#' + filterId + ' .tfb-stats').textContent();
  const colMatch = statsCollapse.match(/^(\d+)\//);
  const colCount = colMatch ? parseInt(colMatch[1]) : 84;
  colCount <= 34 ? ok('COLLAPSING shows only A-type: ' + statsCollapse) : ko('COLLAPSING count wrong: ' + statsCollapse);

  // Restore
  await page.locator('#' + filterId + ' .tfb-mode-btn[data-mode="asis"]').click();
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch();
  const page    = await browser.newPage();
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('404')) {
      console.log('  [PAGE ERR]', m.text().substring(0, 100));
    }
  });

  await login(page);

  // ── K-Path Explorer ──────────────────────────────────────────────
  await testPage(page, 'K-Path Explorer', '/path-explorer', 'peFilterBar', async (p) => {
    await p.waitForFunction(() => {
      var s = document.getElementById('peStatus');
      return s && (s.textContent.includes('nodes') || s.textContent.includes('⚠'));
    }, { timeout: 30000 }).catch(() => null);
    await p.waitForSelector('#peFilterBar .tfb-toolbar', { timeout: 20000 });
  });

  // ── Change Planner ───────────────────────────────────────────────
  await testPage(page, 'Change Planner', '/change-planner', 'cpFilterBar', async (p) => {
    await p.waitForFunction(() => {
      var s = document.getElementById('cpStatus');
      return s && (s.textContent.includes('nodes') || s.textContent.includes('⚠'));
    }, { timeout: 30000 }).catch(() => null);
    await p.waitForSelector('#cpFilterBar .tfb-toolbar', { timeout: 20000 });
  });

  // ── Impact Lab ───────────────────────────────────────────────────
  await testPage(page, 'Impact Lab', '/impact-lab', 'ilFilterBar', async (p) => {
    await p.waitForFunction(() => {
      var s = document.getElementById('ilStatus');
      return s && (s.textContent.includes('nodes') || s.textContent.includes('⚠'));
    }, { timeout: 30000 }).catch(() => null);
    await p.waitForSelector('#ilFilterBar .tfb-toolbar', { timeout: 20000 });
  });

  // ── Topo Diff (compare same snapshot to itself) ──────────────────
  console.log('\n── Topology Diff ────────────────────────────────────────────');
  await page.goto(BASE + '/topo-diff', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1000);

  // Select same 84-node snapshot for both A and B
  const snapA = page.locator('#tdSnapA');
  const snapB = page.locator('#tdSnapB');
  const optVal = GT84;
  if (await snapA.count()) {
    await page.selectOption('#tdSnapA', { value: optVal }).catch(() => null);
    await page.selectOption('#tdSnapB', { value: optVal }).catch(() => null);
    await page.click('#tdBtnCompare');
    await page.waitForSelector('#tdFilterBar .tfb-toolbar', { timeout: 30000 });
    ok('Topo Diff filter bar renders after compare');

    const statsA = await page.locator('#tdFilterBar .tfb-stats').textContent();
    statsA.includes('84') ? ok('Topo Diff stats: ' + statsA) : ko('Topo Diff stats wrong: ' + statsA);

    // GATEWAY on diff page
    await page.locator('#tdFilterBar .tfb-mode-btn[data-mode="gateway"]').click();
    await page.waitForTimeout(600);
    const statsGW = await page.locator('#tdFilterBar .tfb-stats').textContent();
    const m = statsGW.match(/^(\d+)\//);
    (m && parseInt(m[1]) <= 34) ? ok('Topo Diff GATEWAY: ' + statsGW) : ko('Topo Diff GATEWAY wrong: ' + statsGW);
  } else {
    ko('Topo Diff snapA selector not found');
  }

  await browser.close();

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  PASSED:', passed, '| FAILED:', failed);
  console.log(failed === 0 ? '  ALL PASSED ✅' : '  SOME FAILED ❌');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
