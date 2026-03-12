'use strict';
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8081';

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('[PAGE ERR]', m.text().substring(0,100)); });

  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForTimeout(500);
  await p.fill('#login', 'ospf@topolograph.com');
  await p.fill('#password', 'ospf');
  await p.press('#password', 'Enter');
  await p.waitForTimeout(2000);
  if (p.url().includes('/login')) { console.error('Login FAILED'); await browser.close(); process.exit(1); }
  console.log('✅ Login');

  // Get the most recent 84_hosts snapshot (sort lexicographically — timestamps are YYYYMMDD_HHh...)
  await p.goto(BASE + '/upload-ospf-isis-lsdb', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForTimeout(1000);
  const opts = await p.$$eval('#dynamic_graph_time option', os => os.map(o => o.value));
  const hosts84 = opts.filter(v => v.includes('84_hosts')).sort();
  const gt = hosts84[hosts84.length - 1]; // newest lexicographically
  if (!gt) { console.error('No 84_hosts graph_time found'); await browser.close(); process.exit(1); }
  console.log('✅ graph_time:', gt, '(most recent 84_hosts)');

  await p.goto(BASE + '/impact-lab?graph_time=' + gt, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForFunction(() => {
    var s = document.getElementById('ilStatus');
    return s && (s.textContent.includes('nodes') || s.textContent.includes('⚠'));
  }, { timeout: 30000 });
  const status1 = await p.locator('#ilStatus').textContent();
  console.log('   Status:', status1.substring(0, 80));

  await p.click('#ilTabMatrix');
  await p.waitForTimeout(600);
  await p.click('#ilBtnBuildMatrix');
  await p.waitForFunction(() => {
    var w = document.getElementById('ilMatrixWrap');
    return w && w.querySelector('table');
  }, { timeout: 30000 }).catch(() => null);

  const cells = await p.locator('.rm-clickable').count();
  const sum = await p.locator('#ilMatrixSummary').textContent();
  console.log('   Summary:', sum.substring(0, 100));
  console.log('   Clickable cells:', cells);

  if (cells === 0) {
    const nodeCount = await p.evaluate(() => typeof _ilNodes !== 'undefined' ? _ilNodes.length : 'undefined');
    console.error('No cells. _ilNodes:', nodeCount, 'Summary:', sum);
    await browser.close(); process.exit(1);
  }
  console.log('✅ Matrix rendered with', cells, 'clickable cells');

  // Click first finite cell
  const finite = await p.locator('.rm-clickable:not(.rm-none)').count();
  const target = finite > 0 ? p.locator('.rm-clickable:not(.rm-none)').first() : p.locator('.rm-clickable').first();
  const tv = (await target.textContent()).trim();
  console.log('   Clicking cell value:', tv);
  await target.click();
  await p.waitForTimeout(1200);

  const panelVisible = await p.locator('#ilDetailPanel').isVisible();
  const title   = await p.locator('#ilDetailTitle').textContent();
  const badge   = await p.locator('#ilDetailCostBadge').textContent();
  const hopRows = await p.locator('.il-hop-tbl tbody tr').count();
  const altRows = await p.locator('.il-alt-path-row').count();
  const gw      = (await p.locator('#ilDetailGw').textContent()).substring(0, 70);

  console.log(panelVisible ? '✅ detail panel visible' : '❌ panel NOT visible');
  console.log('   title:', title, '| badge:', badge);
  console.log(hopRows >= 2 ? '✅ hops: ' + hopRows : '❌ hops: ' + hopRows + ' (expected ≥ 2)');
  console.log('   alt paths:', altRows, '| gw:', gw);

  if (!panelVisible || hopRows < 2) {
    await browser.close(); process.exit(1);
  }

  // Alt path click
  if (altRows >= 2) {
    await p.locator('.il-alt-path-row').nth(1).click();
    await p.waitForTimeout(400);
    console.log('✅ alt path #2 click OK');
  }

  // No-route cell
  const noRoute = await p.locator('td.rm-none.rm-clickable').count();
  if (noRoute > 0) {
    await p.locator('td.rm-none.rm-clickable').first().click();
    await p.waitForTimeout(500);
    const txt = await p.locator('#ilDetailContent').textContent();
    const ok  = txt.includes('∞') || txt.toLowerCase().includes('route') || txt.toLowerCase().includes('unreachable');
    console.log(ok ? '✅ ∞ no-route panel renders' : '⚠ no-route text unexpected: ' + txt.substring(0,60));
  }

  // Close
  await p.locator('.il-detail-close').click();
  await p.waitForTimeout(300);
  const closed = !(await p.locator('#ilDetailPanel').isVisible());
  console.log(closed ? '✅ panel closes' : '❌ panel did not close');

  await browser.close();
  const pass = panelVisible && hopRows >= 2 && closed;
  console.log(pass ? '\n✅  SMOKE TEST PASSED' : '\n❌  SMOKE TEST FAILED');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
