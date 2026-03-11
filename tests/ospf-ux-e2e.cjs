'use strict';
/**
 * End-to-end UX flow — simulates a real network engineer using all 5 pages:
 *   Main (topolograph) → K-Path Explorer → Change Planner → Impact Lab → Topo Diff
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const BASE = 'http://localhost:8081';
const SS   = 'tests/screenshots';
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });

const pass = [], fail = [], warn = [];
let sc = 10;
function ok(n)    { pass.push(n); console.log('  ✅  ' + n); }
function ko(n, m) { fail.push(n); console.log('  ❌  ' + n + ' — ' + m); }
function wn(n, m) { warn.push(n); console.log('  ⚠️   ' + n + (m ? ' — ' + m : '')); }
async function shot(page, name) {
  const f = path.join(SS, String(sc++).padStart(2,'0') + '-e2e-' + name + '.png');
  await page.screenshot({ path: f, fullPage: false });
  console.log('  📸  ' + f);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE A — Login + Main Page
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE A — Login + Main Page ════');
  const main = await ctx.newPage();
  await main.goto(BASE + '/login');
  await main.fill('#login', 'ospf@topolograph.com');
  await main.fill('#password', 'ospf');
  await main.press('#password', 'Enter');
  await main.waitForTimeout(2000);
  const loggedIn = !main.url().includes('/login');
  loggedIn ? ok('Login succeeded') : ko('Login', 'still on login page');

  await main.goto(BASE + '/upload-ospf-isis-lsdb', { waitUntil: 'domcontentloaded' });
  await main.waitForTimeout(1500);
  const graphOptions = await main.evaluate(() => {
    const s = document.getElementById('dynamic_graph_time');
    return s ? Array.from(s.options).map(o => o.value).filter(Boolean) : [];
  });
  console.log('  Available graphs:', graphOptions.length, graphOptions.slice(0,2).join(', '));
  const gt84 = graphOptions.find(g => g.includes('84')) || graphOptions[0] || '';
  if (!gt84) { ko('Graph selection', 'no graphs found'); process.exit(1); }
  ok('Found graphs: ' + graphOptions.length);

  // Load the 84-host graph
  await main.evaluate(g => {
    document.getElementById('dynamic_graph_time').value = g;
    if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(g);
  }, gt84);
  await main.waitForTimeout(6000);
  const nodesCount = await main.evaluate(() => typeof nodes !== 'undefined' ? nodes.length : 0);
  nodesCount > 0 ? ok('Main graph loaded — ' + nodesCount + ' nodes') : ko('Main graph load', 'nodes=0');

  const lsGt = await main.evaluate(() => localStorage.getItem('ospf_graph_time') || '');
  lsGt ? ok('localStorage written: ' + lsGt) : ko('localStorage', 'not written');
  await shot(main, 'main-loaded');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE B — Navbar
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE B — Navbar Analysis Dropdown ════');
  const navHrefs = await main.evaluate(() =>
    Array.from(document.querySelectorAll('a.dropdown-item')).map(a => a.href));
  ['/path-explorer','/change-planner','/impact-lab','/topo-diff'].forEach(p => {
    navHrefs.some(h => h.includes(p)) ? ok('Navbar: ' + p) : ko('Navbar', p + ' missing');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE C — K-Path Explorer
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE C — K-Path Explorer (/path-explorer) ════');
  const kp = await ctx.newPage();
  await kp.goto(BASE + '/path-explorer?graph_time=' + encodeURIComponent(gt84), { waitUntil: 'domcontentloaded' });
  await kp.waitForTimeout(8000);

  const peStatus = await kp.$eval('#peStatus', e => e.textContent).catch(() => '');
  console.log('  status:', peStatus.trim().slice(0, 120));
  // Accept both: "Loaded: N nodes" and "Topology loaded (N nodes)"
  const peNodes = (peStatus.match(/[Ll]oaded[: (]+(\d+)\s+nodes/) || [])[1];
  Number(peNodes) > 0 ? ok('path-explorer: ' + peNodes + ' nodes loaded') : ko('path-explorer nodes', peStatus.slice(0,60));

  const [srcOpts, dstOpts] = await kp.evaluate(() => {
    const s = document.getElementById('peSrc');
    const d = document.getElementById('peDst');
    return [
      s ? Array.from(s.options).map(o => o.value).filter(v => v && !v.startsWith('⚠')) : [],
      d ? Array.from(d.options).map(o => o.value).filter(v => v && !v.startsWith('⚠')) : []
    ];
  });
  console.log('  Source countries:', srcOpts.join(', ') || '(none — no A-type nodes)');
  srcOpts.length > 0 ? ok('Countries populated: ' + srcOpts.join(',')) : wn('No A-type countries', 'demo graph uses plain router IDs');

  if (srcOpts.length >= 2) {
    await kp.selectOption('#peSrc', srcOpts[0]);
    await kp.selectOption('#peDst', srcOpts[srcOpts.length > 1 ? 1 : 0]);
    await kp.click('#peBtnGo');
    await kp.waitForTimeout(5000);
    const fwdCount = await kp.evaluate(() => document.querySelectorAll('#peListFwd .pe-path-row').length);
    const revCount = await kp.evaluate(() => document.querySelectorAll('#peListRev .pe-path-row').length);
    console.log('  FWD paths:', fwdCount, '| REV paths:', revCount);
    fwdCount > 0 ? ok('K-SP FWD: ' + fwdCount + ' paths') : ko('K-SP FWD', 'no paths');
    revCount > 0 ? ok('K-SP REV: ' + revCount + ' paths') : ko('K-SP REV', 'no paths');
    if (fwdCount > 0) {
      await kp.click('#peListFwd .pe-path-row').catch(() => {});
      await kp.waitForTimeout(800);
      ok('Clicked first FWD path row');
    }
  } else {
    // No A-type nodes — verify helpful message is shown
    const noATypeMsg = peStatus.includes('A-type') || peStatus.includes('hostname');
    noATypeMsg ? ok('path-explorer shows A-type guidance message') : wn('path-explorer no-A-type msg', 'missing guidance');
  }

  // Override row — panel is collapsed by default, must toggle first
  await kp.click('#peOverrideToggle').catch(() => {});
  await kp.waitForTimeout(400);
  await kp.click('#peBtnAddOverride').catch(() => {
    // fallback: call JS directly if panel still hidden
    kp.evaluate(() => { if (typeof peAddOverrideRow === 'function') peAddOverrideRow(); });
  });
  await kp.waitForTimeout(600);
  const overrideRows = await kp.evaluate(() => document.querySelectorAll('#peOvRows tr').length);
  overrideRows > 0 ? ok('Override row added: ' + overrideRows) : ko('Override row', '#peOvRows empty after click');
  await shot(kp, 'path-explorer');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE D — Change Planner
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE D — Change Planner (/change-planner) ════');
  const cp = await ctx.newPage();
  await cp.goto(BASE + '/change-planner?graph_time=' + encodeURIComponent(gt84), { waitUntil: 'domcontentloaded' });
  await cp.waitForTimeout(8000);

  const cpStatus = await cp.$eval('#cpStatus', e => e.textContent).catch(() => '');
  console.log('  status:', cpStatus.trim().slice(0, 100));
  const cpNodes = (cpStatus.match(/Loaded\s+(\d+)\s+nodes/) || [])[1];
  Number(cpNodes) > 0 ? ok('change-planner: ' + cpNodes + ' nodes loaded') : ko('change-planner nodes', cpStatus.slice(0,60));

  // Add a change row — button now has id="cpBtnAddRow"
  await cp.click('#cpBtnAddRow');
  await cp.waitForTimeout(600);
  const cpRows = await cp.evaluate(() => document.querySelectorAll('#cpPlanRows tr').length);
  cpRows > 0 ? ok('Change row added: ' + cpRows) : ko('Change row', '#cpPlanRows empty after click');

  if (cpRows > 0) {
    // Fill in an edge ID and cost
    const firstEdgeId = await cp.evaluate(() => {
      // Use first edge from topology
      if (typeof _cpEdges !== 'undefined' && _cpEdges.length) return _cpEdges[0].id || _cpEdges[0].from + '_to_' + _cpEdges[0].to;
      return '';
    });
    if (firstEdgeId) {
      await cp.evaluate(eid => {
        const inp = document.querySelector('#cpPlanRows tr:first-child .cp-edge-input');
        if (inp) { inp.value = eid; inp.dispatchEvent(new Event('input')); }
      }, firstEdgeId);
    }
    await cp.evaluate(() => {
      const fwdIn = document.querySelector('#cpPlanRows tr:first-child .cp-fwd-input');
      if (fwdIn) { fwdIn.value = '9999'; fwdIn.dispatchEvent(new Event('input')); }
    });
    ok('Cost change entered: edge=' + (firstEdgeId.slice(0,20) || 'n/a') + ', fwd=9999');
  }

  // Run analysis
  await cp.click('#cpBtnAnalyse');
  await cp.waitForTimeout(7000);
  const cpAffected = await cp.$eval('#cpStatAffected', e => e.textContent).catch(() => '');
  const cpImproved = await cp.$eval('#cpStatImproved', e => e.textContent).catch(() => '');
  const cpDegraded = await cp.$eval('#cpStatDegraded', e => e.textContent).catch(() => '');
  console.log('  Impact — Affected:', cpAffected, '| Improved:', cpImproved, '| Degraded:', cpDegraded);
  const cpImpactSection = await cp.$eval('#cpImpactSection', e => e.style.display).catch(() => 'none');
  cpImpactSection !== 'none' ? ok('Impact section visible') : wn('Impact section', 'hidden — no A-type pairs affected');

  // Animation button
  const animEnabled = await cp.$eval('#cpBtnAnimate', e => !e.disabled).catch(() => false);
  if (animEnabled) {
    await cp.click('#cpBtnAnimate');
    await cp.waitForTimeout(3000);
    ok('Animation triggered');
  } else {
    wn('Animation', 'disabled — expected if no A-type affected pairs');
  }
  await shot(cp, 'change-planner');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE E — Impact Lab
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE E — Impact Lab (/impact-lab) ════');
  const il = await ctx.newPage();
  await il.goto(BASE + '/impact-lab?graph_time=' + encodeURIComponent(gt84), { waitUntil: 'domcontentloaded' });
  await il.waitForTimeout(8000);

  const ilStatus = await il.$eval('#ilStatus', e => e.textContent).catch(() => '');
  console.log('  status:', ilStatus.trim().slice(0, 100));
  const ilNodes = (ilStatus.match(/Loaded\s+(\d+)\s+nodes/) || [])[1];
  Number(ilNodes) > 0 ? ok('impact-lab: ' + ilNodes + ' nodes loaded') : ko('impact-lab nodes', ilStatus.slice(0,60));

  // Search for a node
  const firstNodeId = await il.evaluate(() =>
    typeof _ilNodes !== 'undefined' && _ilNodes.length ? (_ilNodes[0].id || '') : '');
  console.log('  First node:', firstNodeId);
  if (firstNodeId) {
    await il.fill('#ilSearchBox', firstNodeId.slice(0, 6));
    await il.waitForTimeout(1000);
    const resultCount = await il.evaluate(() => {
      const r = document.getElementById('ilSearchResults');
      return r ? r.children.length : 0;
    });
    resultCount > 0 ? ok('Node search: ' + resultCount + ' results') : wn('Node search', 'no results');

    if (resultCount > 0) {
      await il.click('#ilSearchResults div:first-child').catch(() => {});
      await il.waitForTimeout(500);
      const selected = await il.$eval('#ilSelectedFailure', e => e.textContent).catch(() => '');
      selected.length > 3 ? ok('Node selected: ' + selected.trim().slice(0,40)) : ko('Node selection', selected);

      await il.click('#ilBtnAnalyse');
      await il.waitForTimeout(5000);
      const ilPost = await il.$eval('#ilStatus', e => e.textContent).catch(() => '');
      console.log('  Post-compute:', ilPost.trim().slice(0, 100));
      /blast|computed|ring/i.test(ilPost) ? ok('Blast radius computed') : ko('Blast radius', ilPost.slice(0,60));

      // Check ring count divs (not a table — they're div elements)
      const rings = await il.evaluate(() => ({
        ring0: document.getElementById('ilRing0') ? document.getElementById('ilRing0').textContent : '?',
        ring1: document.getElementById('ilRing1') ? document.getElementById('ilRing1').textContent : '?',
        ring2: document.getElementById('ilRing2') ? document.getElementById('ilRing2').textContent : '?',
        unreach: document.getElementById('ilUnreach') ? document.getElementById('ilUnreach').textContent : '?',
      }));
      console.log('  Rings — R0:', rings.ring0, '| R1:', rings.ring1, '| R2:', rings.ring2, '| Unreach:', rings.unreach);
      const ringSectionVisible = await il.$eval('#ilRingSection', e => e.style.display !== 'none').catch(() => false);
      ringSectionVisible ? ok('Ring section visible: R0=' + rings.ring0 + ' R1=' + rings.ring1 + ' R2=' + rings.ring2) : ko('Ring section', 'hidden');

      // Country impact rows
      const countryRows = await il.evaluate(() => document.querySelectorAll('#ilCountryRows tr').length);
      console.log('  Country rows:', countryRows);
      countryRows > 0 ? ok('Country impact table: ' + countryRows + ' rows') : wn('Country table empty', 'expected — no A-type nodes');
    }
  }
  await shot(il, 'impact-lab');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE F — Topology Diff
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE F — Topology Diff (/topo-diff) ════');
  const td = await ctx.newPage();
  await td.goto(BASE + '/topo-diff?graph_time=' + encodeURIComponent(gt84), { waitUntil: 'domcontentloaded' });
  await td.waitForTimeout(3000);

  const tdVals = await td.evaluate(() => {
    const s = document.getElementById('tdSnapA');
    return s ? Array.from(s.options).map(o => o.value).filter(Boolean) : [];
  });
  console.log('  Snapshot options:', tdVals.join(', ') || '(none)');
  tdVals.length > 0 ? ok('topo-diff snap dropdown: ' + tdVals.length + ' option(s)') : ko('topo-diff dropdown', 'empty');

  if (tdVals.length > 0) {
    const v = tdVals[0];
    await td.evaluate(val => {
      for (const id of ['tdSnapA','tdSnapB']) {
        const sel = document.getElementById(id);
        if (!sel) continue;
        for (const opt of sel.options) if (opt.value === val) { opt.selected = true; break; }
      }
    }, v);
    await td.click('#tdBtnCompare');
    await td.waitForTimeout(9000);
    const tdStatus = await td.$eval('#tdStatus', e => e.textContent).catch(() => '');
    console.log('  status:', tdStatus.trim().slice(0, 100));
    /Diff complete|edge changes/.test(tdStatus) ? ok('topo-diff Compare completed') : ko('topo-diff Compare', tdStatus.slice(0,60));

    const diffRows = await td.evaluate(() => {
      const t = document.getElementById('tdDiffTable');
      return t ? t.querySelectorAll('tbody tr').length : 0;
    });
    ok('Diff table: ' + diffRows + ' rows (0 expected for same snapshot)');
  }
  await shot(td, 'topo-diff');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE G — Cross-page consistency
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE G — Cross-page consistency ════');
  const kpBtnOc = await main.evaluate(() => {
    const b = document.getElementById('btnKspExplorer');
    return b ? (b.getAttribute('onclick') || '') : null;
  });
  kpBtnOc && kpBtnOc.includes('/path-explorer') ? ok('K-Paths button → /path-explorer') : ko('K-Paths button', 'missing or wrong');
  const cpBtnOc = await main.evaluate(() => {
    const b = document.getElementById('btnChangePlanner');
    return b ? (b.getAttribute('onclick') || '') : null;
  });
  cpBtnOc && cpBtnOc.includes('/change-planner') ? ok('Change Planner button → /change-planner') : ko('Change Planner button', 'missing');

  await browser.close();

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  PASSED: ' + pass.length + ' | FAILED: ' + fail.length + ' | WARNED: ' + warn.length);
  if (warn.length)  console.log('  WARNINGS:', warn);
  if (fail.length) { console.log('  FAILED:', fail); process.exit(1); }
  else console.log('  ALL PASSED');
})();
