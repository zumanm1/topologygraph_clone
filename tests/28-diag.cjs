'use strict';
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const errs = [], logs = [];
  page.on('console', m => {
    if (m.type() === 'error') errs.push(m.text());
    else logs.push(m.text());
  });
  page.on('response', r => {
    const u = r.url();
    if (u.includes('graph-times') || u.includes('upload-ospf') || u.includes('diagram')) {
      console.log('RESP:', r.status(), u);
    }
  });

  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(500);
  await page.fill('#login', 'ospf@topolograph.com');
  await page.fill('#password', 'ospf');
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);
  console.log('After login URL:', page.url());

  // Check localStorage after login
  const ls = await page.evaluate(() => {
    return {
      graph_time: localStorage.getItem('ospf_graph_time'),
      graph_id: localStorage.getItem('ospf_graph_id')
    };
  });
  console.log('localStorage after login:', JSON.stringify(ls));

  // Direct fetch of /api/graph-times from within page context (uses session cookie)
  const apiResult = await page.evaluate(async () => {
    const r = await fetch('/api/graph-times');
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 300) };
  });
  console.log('api/graph-times status:', apiResult.status, 'body:', apiResult.body);

  await page.goto('http://localhost:8081/cost-matrix', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);

  // Check which JS functions are available
  const fns = await page.evaluate(() => ({
    rmInit: typeof rmInit,
    KSP_loadTopology: typeof KSP_loadTopology,
    KSP_buildDirAdjList: typeof KSP_buildDirAdjList,
    jQuery: typeof $
  }));
  console.log('Functions available:', JSON.stringify(fns));

  // Fetch graph-times directly
  const apiOnCM = await page.evaluate(async () => {
    const r = await fetch('/api/graph-times');
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 150) };
  });
  console.log('api/graph-times on cost-matrix:', JSON.stringify(apiOnCM));

  // Test upload endpoint
  const uploadTest = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('dynamic_graph_time', '07Mar2026_11h56m55s_54_hosts');
    const r = await fetch('/upload-ospf-lsdb-from-js', { method: 'POST', body: fd });
    return { status: r.status, ok: r.ok };
  });
  console.log('upload-ospf-lsdb-from-js:', JSON.stringify(uploadTest));

  // Wait for rmInit to auto-run via $(document).ready
  await page.waitForTimeout(3000);

  // Check dropdown state
  const dropdown = await page.$eval('#matrix-topo-select', el => el.options.length).catch(() => -1);
  console.log('Dropdown options:', dropdown);

  // Select the 84-node snapshot and load it
  const TARGET = '11Mar2026_21h17m14s_84_hosts';
  const hasTarget = await page.evaluate((t) => {
    var sel = document.getElementById('matrix-topo-select');
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === t) return true;
    }
    return false;
  }, TARGET);
  console.log('84-node snapshot in dropdown:', hasTarget);

  if (hasTarget) {
    await page.selectOption('#matrix-topo-select', TARGET);
    console.log('Selected', TARGET);
    await page.waitForTimeout(20000); // Dijkstra on 84 nodes takes a few seconds
  } else {
    // Manually load it
    await page.evaluate((t) => { if (typeof rmLoadTopology === 'function') rmLoadTopology(t); }, TARGET);
    console.log('Manually called rmLoadTopology for', TARGET);
    await page.waitForTimeout(20000);
  }

  console.log('JS ERRORS:', JSON.stringify(errs));
  console.log('ALL LOGS:', JSON.stringify(logs.slice(0, 40)));
  const hasTable = await page.$('table.rm-table').then(el => !!el).catch(() => false);
  console.log('Has table:', hasTable);
  const bodyText = await page.$eval('#matrix-display', el => el.innerText).catch(() => '');
  console.log('Display text:', bodyText.slice(0, 300));

  await b.close();
})();
