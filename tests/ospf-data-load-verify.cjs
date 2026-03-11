'use strict';
const { chromium } = require('playwright');
const BASE = 'http://localhost:8081';
const pass = [], fail = [];
function ok(name) { pass.push(name); console.log('  ✓ ' + name); }
function ko(name, msg) { fail.push(name); console.log('  ✗ ' + name + ' — ' + msg); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(BASE + '/login');
  await page.fill('#login', 'ospf@topolograph.com');
  await page.fill('#password', 'ospf');
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);

  await page.goto(BASE + '/upload-ospf-isis-lsdb');
  await page.waitForTimeout(1000);
  const gt = await page.evaluate(() => {
    const s = document.getElementById('dynamic_graph_time');
    return s ? (Array.from(s.options).find(o => o.value) || {}).value || '' : '';
  });
  console.log('graph_time:', gt);

  // ── /api/graph-times ────────────────────────────────────────────
  console.log('\n─── /api/graph-times ───');
  const gtR = await page.evaluate(async () => {
    const r = await fetch('/api/graph-times');
    return { status: r.status, body: await r.json() };
  });
  console.log('  status:', gtR.status, '| body:', JSON.stringify(gtR.body));
  if (gtR.status === 200) ok('/api/graph-times 200');
  else ko('/api/graph-times', 'status ' + gtR.status);

  // ── POST /upload-ospf-lsdb-from-js ──────────────────────────────
  console.log('\n─── POST /upload-ospf-lsdb-from-js ───');
  const topoR = await page.evaluate(async (g) => {
    const fd = new FormData(); fd.append('dynamic_graph_time', g);
    const r = await fetch('/upload-ospf-lsdb-from-js', { method: 'POST', body: fd });
    const d = await r.json();
    return { status: r.status, nodes: (d.nodes_attr_dd_in_ll || []).length, edges: (d.edges_attr_dd_in_ll || []).length };
  }, gt);
  console.log('  nodes:', topoR.nodes, '| edges:', topoR.edges);
  if (topoR.status === 200 && topoR.nodes > 0) ok('POST topology returns nodes');
  else ko('POST topology', 'nodes=' + topoR.nodes);

  // ── path-explorer, change-planner, impact-lab (auto-load) ───────
  const autoPages = [
    { name: 'path-explorer',  sel: '#peStatus',  url: `/path-explorer?graph_time=${encodeURIComponent(gt)}` },
    { name: 'change-planner', sel: '#cpStatus',  url: `/change-planner?graph_time=${encodeURIComponent(gt)}` },
    { name: 'impact-lab',     sel: '#ilStatus',  url: `/impact-lab?graph_time=${encodeURIComponent(gt)}` },
  ];

  for (const p of autoPages) {
    console.log('\n─── ' + p.name + ' ───');
    const tab = await ctx.newPage();
    const apiErrs = [];
    tab.on('console', m => { if (m.type() === 'error' && (m.text().includes('401') || m.text().includes('404') || m.text().includes('/api/diagram'))) apiErrs.push(m.text()); });
    await tab.goto(BASE + p.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await tab.waitForTimeout(7000);
    const status = await tab.$eval(p.sel, el => el.textContent).catch(() => '');
    console.log('  status:', status.trim().slice(0, 90));
    console.log('  api errors:', apiErrs.length ? apiErrs : 'NONE');
    const loaded = /Loaded[: ]+([1-9]\d*)/.test(status);
    if (loaded) ok(p.name + ' nodes > 0');
    else ko(p.name, status.trim().slice(0, 60));
    // Check ECMP expansion worked (edges should be > raw count if ECMP present)
    const edgeCount = (status.match(/(\d+)\s+edges/) || [])[1];
    if (edgeCount && Number(edgeCount) >= topoR.edges) ok(p.name + ' ECMP expansion: ' + edgeCount + ' edges (≥' + topoR.edges + ' parent)');
    await tab.close();
  }

  // ── topo-diff (requires Compare click) ──────────────────────────
  console.log('\n─── topo-diff ───');
  const tdTab = await ctx.newPage();
  const tdApiErrs = [];
  tdTab.on('console', m => { if (m.type() === 'error' && (m.text().includes('401') || m.text().includes('404') || m.text().includes('/api/diagram'))) tdApiErrs.push(m.text()); });
  await tdTab.goto(BASE + `/topo-diff?graph_time=${encodeURIComponent(gt)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await tdTab.waitForTimeout(3000);

  // Select same graph_time in both dropdowns and compare
  await tdTab.evaluate((g) => {
    const selA = document.getElementById('tdSnapA');
    const selB = document.getElementById('tdSnapB');
    if (selA) { for (let i = 0; i < selA.options.length; i++) if (selA.options[i].value === g) selA.selectedIndex = i; }
    if (selB) { for (let i = 0; i < selB.options.length; i++) if (selB.options[i].value === g) selB.selectedIndex = i; }
  }, gt);
  await tdTab.click('#tdBtnCompare').catch(() => {});
  await tdTab.waitForTimeout(8000);
  const tdStatus = await tdTab.$eval('#tdStatus', el => el.textContent).catch(() => '');
  console.log('  status:', tdStatus.trim().slice(0, 90));
  console.log('  api errors:', tdApiErrs.length ? tdApiErrs : 'NONE');
  const tdOk = /Diff complete|0 edge changes|country pair/.test(tdStatus) || /edge changes/.test(tdStatus);
  if (tdOk) ok('topo-diff Compare runs successfully');
  else ko('topo-diff', tdStatus.trim().slice(0, 60));
  const tdSelA = await tdTab.evaluate(() => { const s = document.getElementById('tdSnapA'); return s ? s.options.length : 0; });
  if (tdSelA > 1) ok('topo-diff dropdown populated (>1 option incl. blank)');
  else if (tdSelA === 1 && gt) ok('topo-diff dropdown shows 1 graph_time');
  else ko('topo-diff dropdown', 'count=' + tdSelA);
  await tdTab.close();

  await browser.close();
  console.log('\n══════════════════════════════════════════');
  console.log('PASSED: ' + pass.length + ' | FAILED: ' + fail.length);
  if (fail.length) { console.log('FAILED:', fail); process.exit(1); }
  else console.log('ALL PASSED');
})();
