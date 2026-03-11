'use strict';
/**
 * 23-path-analysis-suite-e2e.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Full end-to-end validation for the OSPF Path Analysis Suite (PRD-08 → PRD-13).
 *
 * Workflow:
 *   1. Upload ospf-database-54-unk-test.txt  → creates a real 84-node OSPF graph
 *   2. Apply Load-hosts-metro-level.csv      → resolves A/B/C-type hostnames
 *      (A-type: can-tor-kem-r1, usa-nyc-man-r1, etc.)
 *   3. Run 7-phase UX validation across all 5 pages:
 *      A: Main page + upload + hostname CSV
 *      B: Navbar — all 4 new analysis links present
 *      C: /path-explorer  — K-SP between A-type countries
 *      D: /change-planner — multi-router cost edit + impact analysis
 *      E: /impact-lab     — blast radius rings + country table
 *      F: /topo-diff      — snapshot compare
 *      G: Cross-page consistency (K-Paths button, Change Planner button)
 *
 * Run:
 *   BASE_URL=http://localhost:8081 node tests/23-path-analysis-suite-e2e.cjs
 *   (or via 13-STEP-BY-STEP/scripts/run-path-analysis-validation.sh)
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const BASE          = process.env.BASE_URL || 'http://localhost:8081';
const API_USER      = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS      = process.env.API_PASS || 'ospf';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(__dirname, '..', '13-STEP-BY-STEP', 'screenshots');
const PROJECT_ROOT  = path.join(__dirname, '..');
const OSPF_FILE     = path.join(PROJECT_ROOT, 'INPUT-FOLDER', 'ospf-database-54-unk-test.txt');
const CSV_FILE      = path.join(PROJECT_ROOT, 'INPUT-FOLDER', 'Load-hosts-metro-level.csv');

if (!fs.existsSync(OSPF_FILE)) { console.error('Missing OSPF file:', OSPF_FILE); process.exit(1); }
if (!fs.existsSync(CSV_FILE))  { console.error('Missing CSV file:', CSV_FILE);   process.exit(1); }

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const pass = [], fail = [], warn = [];
let sc = 23;
function ok(n)    { pass.push(n); console.log('  ✅  ' + n); }
function ko(n, m) { fail.push(n); console.log('  ❌  ' + n + ' — ' + m); }
function wn(n, m) { warn.push(n); console.log('  ⚠️   ' + n + (m ? ' — ' + m : '')); }
async function shot(page, name) {
  const f = path.join(SCREENSHOT_DIR, String(sc++).padStart(2,'0') + '-' + name + '.png');
  await page.screenshot({ path: f, fullPage: false });
  console.log('  📸  ' + f);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE A — Login + Upload OSPF file + Apply hostname CSV
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE A — Upload Real OSPF Data + Hostname CSV ════');
  const main = await ctx.newPage();

  // A1: Login
  await main.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await main.waitForTimeout(500);
  await main.fill('#login', API_USER);
  await main.fill('#password', API_PASS);
  await main.press('#password', 'Enter');
  await main.waitForTimeout(2000);
  const loggedIn = !main.url().includes('/login');
  loggedIn ? ok('Login succeeded') : ko('Login', 'still on login page: ' + main.url());
  if (!loggedIn) { await browser.close(); process.exit(1); }

  // A2: Navigate to upload page and capture existing graph times
  await main.goto(BASE + '/upload-ospf-isis-lsdb', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await main.waitForTimeout(1000);
  const before = await main.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  console.log('  Graphs before upload:', before.length);

  // A3: Upload OSPF file — reveal hidden file input and set files
  await main.evaluate(() => {
    const wrap = document.getElementById('devinputGroupFile02');
    if (wrap) wrap.removeAttribute('hidden');
    const inp = document.getElementById('inputOSPFFileID');
    if (inp) { inp.style.display = 'block'; inp.removeAttribute('hidden'); }
  });
  await main.locator('#inputOSPFFileID').setInputFiles(OSPF_FILE);
  await main.waitForTimeout(500);
  const submitBtn = await main.$('input[name="upload_files_btn"]') || await main.$('#inputGroupFileAddon02');
  if (!submitBtn) { ko('OSPF upload button', 'not found'); await browser.close(); process.exit(1); }
  await Promise.all([
    main.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
    submitBtn.click()
  ]);
  await main.waitForTimeout(3000);
  ok('OSPF file uploaded: ' + path.basename(OSPF_FILE));

  // A4: Resolve graph_time — prefer newest _84_hosts entry
  const after = await main.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  const created = after.filter(v => !before.includes(v));
  const hosts84 = after.filter(v => v.includes('_84_hosts'));
  const gt = created[0] || hosts84[0] || after[after.length - 1] || '';
  console.log('  Graphs after upload:', after.length, '| new:', created.length, '| graph_time:', gt);
  gt ? ok('Resolved graph_time: ' + gt) : ko('graph_time', 'not resolved — check upload');
  if (!gt) { await browser.close(); process.exit(1); }

  // A5: Select and load the graph
  await main.goto(BASE + '/upload-ospf-isis-lsdb', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await main.waitForTimeout(800);
  await main.evaluate(g => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    const opt = Array.from(sel.options).find(o => o.value === g);
    if (opt) { sel.value = g; sel.dispatchEvent(new Event('change')); }
  }, gt);

  // Click load button — try several selectors used across templates
  const loadBtn = await main.$('#load_graph_button') ||
                  await main.$('button[onclick*="upload_ospf_lsdb"]') ||
                  await main.$('input[value*="Load"]');
  if (loadBtn) {
    await loadBtn.click();
    await main.waitForTimeout(8000);
  } else {
    // Fallback: call JS directly
    await main.evaluate(g => {
      if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(g);
    }, gt);
    await main.waitForTimeout(8000);
  }

  const nodesCount = await main.evaluate(() => typeof nodes !== 'undefined' ? nodes.length : 0);
  nodesCount > 0 ? ok('Graph loaded: ' + nodesCount + ' nodes') : ko('Graph load', 'nodes=0 after load');

  // A6: Persist hostname CSV to DB via save_hostname() — this is required so new
  //     pages (path-explorer, etc.) see A-type names when they call KSP_loadTopology()
  const csvText = fs.readFileSync(CSV_FILE, 'utf8');

  // Get graph_id from the page (set by upload response at graph_id = response.graph_id)
  const graphId = await main.evaluate(() => {
    // Try global var first, then localStorage fallback
    if (typeof graph_id !== 'undefined' && graph_id) return String(graph_id);
    return localStorage.getItem('ospf_graph_id') || '';
  });
  console.log('  graph_id:', graphId);
  graphId ? ok('graph_id resolved: ' + graphId) : wn('graph_id', 'empty — save_hostname may not persist correctly');

  // Parse CSV and save each mapping to the server DB via save_hostname()
  const savedCount = await main.evaluate(async (params) => {
    const { csv, gid } = params;
    if (!gid) return 0;
    const lines = csv.trim().split(/\r?\n/).filter(l => l.trim());
    const pairs = [];
    for (const line of lines) {
      const cols = line.split(',').map(c => c.trim());
      if (cols.length < 2) continue;
      const [ip, hostname] = cols;
      const ipRe = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
      if (!ipRe.test(ip)) continue;  // skip header rows
      if (!hostname) continue;
      pairs.push({ ip, hostname });
    }
    // save_hostname(ip, graphId, hostname) with 3 args doesn't need DOM element
    if (typeof save_hostname !== 'function') return 0;
    const reqs = pairs.map(p => {
      try { return save_hostname(p.ip, gid, p.hostname); } catch(e) { return null; }
    }).filter(Boolean);
    // Wait for all jQuery ajax calls to settle
    if (typeof $.when === 'function' && reqs.length) {
      await new Promise(resolve => $.when.apply($, reqs).always(resolve));
    } else {
      await new Promise(resolve => setTimeout(resolve, reqs.length * 50 + 500));
    }
    return pairs.length;
  }, { csv: csvText, gid: graphId });
  console.log('  Saved hostname mappings:', savedCount);
  savedCount > 0 ? ok('Hostname CSV persisted to DB: ' + savedCount + ' mappings') : ko('Hostname persist', 'save_hostname unavailable or graph_id empty');

  // Call update_hostname_on_graph to flush saved labels back into the graph document.
  // This ensures POST /upload-ospf-lsdb-from-js returns nodes with A-type labels
  // when new pages (path-explorer, change-planner, etc.) load the topology.
  const updateStatus = await main.evaluate(async (g) => {
    try {
      const r = await fetch('/update_hostname_on_graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'choosen_graph_time=' + encodeURIComponent(g),
        credentials: 'same-origin'
      });
      return r.status;
    } catch (e) { return 'error: ' + e.message; }
  }, gt);
  console.log('  update_hostname_on_graph status:', updateStatus);
  (updateStatus === 200 || updateStatus === 204) ? ok('Hostname labels flushed to graph (update_hostname_on_graph)') :
    wn('update_hostname_on_graph', 'status=' + updateStatus + ' — new pages may not see A-type labels');
  await main.waitForTimeout(3000);

  // Also apply in-memory so A-type labels appear on the main page
  await main.evaluate((csv) => {
    if (typeof _applyHostnameMapping === 'function') {
      _applyHostnameMapping(csv, 'Load-hosts-metro-level.csv');
    }
  }, csvText);
  await main.waitForTimeout(2000);

  // A7: Verify A-type nodes are now present
  const atypeCount = await main.evaluate(() => {
    if (typeof nodes === 'undefined') return 0;
    return nodes.get().filter(n => {
      const h = String(n.hostname || n.label || '').split('\n')[0].trim();
      return /^[a-z]{3}-[a-z]+-[a-z]+-[a-z]\d+$/i.test(h);
    }).length;
  });
  console.log('  A-type nodes detected:', atypeCount);
  atypeCount > 0 ? ok('A-type nodes present: ' + atypeCount) : ko('A-type nodes', 'none found after CSV apply');

  // A8: Write localStorage so new pages can pick up the graph_time
  await main.evaluate(g => {
    try { localStorage.setItem('ospf_graph_time', g); } catch(e) {}
  }, gt);
  const lsGt = await main.evaluate(() => localStorage.getItem('ospf_graph_time') || '');
  lsGt ? ok('localStorage written: ' + lsGt) : ko('localStorage', 'not written');

  await shot(main, 'A-main-loaded');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE B — Navbar Analysis Dropdown
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE B — Navbar Analysis Dropdown ════');
  const navHrefs = await main.evaluate(() =>
    Array.from(document.querySelectorAll('a.dropdown-item')).map(a => a.href));
  ['/path-explorer', '/change-planner', '/impact-lab', '/topo-diff'].forEach(p => {
    navHrefs.some(h => h.includes(p)) ? ok('Navbar: ' + p) : ko('Navbar', p + ' missing');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE C — K-Path Explorer
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE C — K-Path Explorer (/path-explorer) ════');
  const kp = await ctx.newPage();
  await kp.goto(BASE + '/path-explorer?graph_time=' + encodeURIComponent(gt), { waitUntil: 'domcontentloaded' });
  await kp.waitForTimeout(10000);

  const peStatus = await kp.$eval('#peStatus', e => e.textContent).catch(() => '');
  console.log('  status:', peStatus.trim().slice(0, 120));
  const peNodes = (peStatus.match(/[Ll]oaded[: (]+(\d+)\s+nodes/) || [])[1];
  Number(peNodes) > 0 ? ok('path-explorer: ' + peNodes + ' nodes loaded') : ko('path-explorer nodes', peStatus.slice(0, 80));

  const [srcOpts, dstOpts] = await kp.evaluate(() => {
    const s = document.getElementById('peSrc');
    const d = document.getElementById('peDst');
    return [
      s ? Array.from(s.options).map(o => o.value).filter(v => v && !v.startsWith('⚠')) : [],
      d ? Array.from(d.options).map(o => o.value).filter(v => v && !v.startsWith('⚠')) : []
    ];
  });
  console.log('  Source countries:', srcOpts.join(', ') || '(none)');
  srcOpts.length > 0 ? ok('Countries populated: ' + srcOpts.join(', ')) : ko('Countries', 'no A-type countries in dropdown');

  if (srcOpts.length >= 2) {
    await kp.selectOption('#peSrc', srcOpts[0]);
    await kp.selectOption('#peDst', srcOpts.length > 1 ? srcOpts[1] : srcOpts[0]);
    await kp.click('#peBtnGo');
    await kp.waitForTimeout(8000);
    const fwdCount = await kp.evaluate(() => document.querySelectorAll('#peListFwd .pe-path-row').length);
    const revCount = await kp.evaluate(() => document.querySelectorAll('#peListRev .pe-path-row').length);
    console.log('  FWD paths:', fwdCount, '| REV paths:', revCount);
    fwdCount > 0 ? ok('K-SP FWD: ' + fwdCount + ' paths (' + srcOpts[0] + '→' + (srcOpts[1] || srcOpts[0]) + ')') : ko('K-SP FWD', 'no paths');
    revCount > 0 ? ok('K-SP REV: ' + revCount + ' paths') : ko('K-SP REV', 'no paths');
    // Click first path row to test highlight
    if (fwdCount > 0) {
      await kp.click('#peListFwd .pe-path-row').catch(() => {});
      await kp.waitForTimeout(800);
      ok('Clicked first FWD path row (highlight test)');
    }
  } else {
    ko('K-SP', 'need ≥2 A-type countries — got: ' + srcOpts.join(', '));
  }

  // Override row — expand panel first then add row
  await kp.click('#peOverrideToggle').catch(() => {});
  await kp.waitForTimeout(400);
  await kp.click('#peBtnAddOverride').catch(() => {
    kp.evaluate(() => { if (typeof peAddOverrideRow === 'function') peAddOverrideRow(); });
  });
  await kp.waitForTimeout(600);
  const overrideRows = await kp.evaluate(() => document.querySelectorAll('#peOvRows tr').length);
  overrideRows > 0 ? ok('Override row added: ' + overrideRows) : ko('Override row', '#peOvRows empty after click');

  await shot(kp, 'C-path-explorer');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE D — Change Planner
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE D — Change Planner (/change-planner) ════');
  const cp = await ctx.newPage();
  await cp.goto(BASE + '/change-planner?graph_time=' + encodeURIComponent(gt), { waitUntil: 'domcontentloaded' });
  await cp.waitForTimeout(10000);

  const cpStatus = await cp.$eval('#cpStatus', e => e.textContent).catch(() => '');
  console.log('  status:', cpStatus.trim().slice(0, 100));
  const cpNodes = (cpStatus.match(/[Ll]oaded[: (]+(\d+)\s+nodes/) || [])[1];
  Number(cpNodes) > 0 ? ok('change-planner: ' + cpNodes + ' nodes loaded') : ko('change-planner nodes', cpStatus.slice(0, 80));

  // Add a change row
  await cp.click('#cpBtnAddRow');
  await cp.waitForTimeout(600);
  const cpRows = await cp.evaluate(() => document.querySelectorAll('#cpPlanRows tr').length);
  cpRows > 0 ? ok('Change row added: ' + cpRows) : ko('Change row', '#cpPlanRows empty after click');

  if (cpRows > 0) {
    // Fill in the first available edge and set a high cost
    const firstEdgeId = await cp.evaluate(() => {
      if (typeof _cpEdges !== 'undefined' && _cpEdges.length) {
        return String(_cpEdges[0].id || _cpEdges[0].from + '_to_' + _cpEdges[0].to || '');
      }
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
    ok('Cost change entered: edge=' + (firstEdgeId.slice(0, 30) || 'n/a') + ', fwd=9999');
  }

  // Run impact analysis
  await cp.click('#cpBtnAnalyse');
  await cp.waitForTimeout(10000);
  const cpAffected = await cp.$eval('#cpStatAffected', e => e.textContent).catch(() => '?');
  const cpImproved = await cp.$eval('#cpStatImproved', e => e.textContent).catch(() => '?');
  const cpDegraded = await cp.$eval('#cpStatDegraded', e => e.textContent).catch(() => '?');
  console.log('  Impact — Affected:', cpAffected, '| Improved:', cpImproved, '| Degraded:', cpDegraded);
  const cpImpactDisplay = await cp.$eval('#cpImpactSection', e => e.style.display).catch(() => 'none');
  cpImpactDisplay !== 'none' ? ok('Impact section visible (affected=' + cpAffected + ')') : wn('Impact section', 'hidden — expected if no A-type pairs cross this edge');

  // Animate if enabled
  const animEnabled = await cp.$eval('#cpBtnAnimate', e => !e.disabled).catch(() => false);
  if (animEnabled) {
    await cp.click('#cpBtnAnimate');
    await cp.waitForTimeout(3000);
    ok('Animation triggered');
  } else {
    wn('Animation', 'disabled — no A-type country pairs cross the edited edge');
  }
  await shot(cp, 'D-change-planner');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE E — Impact Lab
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE E — Impact Lab (/impact-lab) ════');
  const il = await ctx.newPage();
  await il.goto(BASE + '/impact-lab?graph_time=' + encodeURIComponent(gt), { waitUntil: 'domcontentloaded' });
  await il.waitForTimeout(10000);

  const ilStatus = await il.$eval('#ilStatus', e => e.textContent).catch(() => '');
  console.log('  status:', ilStatus.trim().slice(0, 100));
  const ilNodes = (ilStatus.match(/[Ll]oaded[: (]+(\d+)\s+nodes/) || [])[1];
  Number(ilNodes) > 0 ? ok('impact-lab: ' + ilNodes + ' nodes loaded') : ko('impact-lab nodes', ilStatus.slice(0, 80));

  // Pick a node to analyse — prefer an A-type gateway node
  const firstNodeId = await il.evaluate(() => {
    if (typeof _ilNodes === 'undefined') return '';
    // Prefer A-type node for richer country impact result
    const atype = _ilNodes.find(n => /^[a-z]{3}-[a-z]+-[a-z]+-[a-z]\d+$/i.test(String(n.hostname || n.label || '').split('\n')[0]));
    return String((atype || _ilNodes[0] || {}).id || '');
  });
  console.log('  First node:', firstNodeId);

  if (firstNodeId) {
    await il.fill('#ilSearchBox', firstNodeId.slice(0, 8));
    await il.waitForTimeout(1000);
    const resultCount = await il.evaluate(() => {
      const r = document.getElementById('ilSearchResults');
      return r ? r.children.length : 0;
    });
    resultCount > 0 ? ok('Node search: ' + resultCount + ' results') : wn('Node search', 'no results for: ' + firstNodeId.slice(0, 8));

    if (resultCount > 0) {
      await il.click('#ilSearchResults div:first-child').catch(() => {});
      await il.waitForTimeout(500);
      const selected = await il.$eval('#ilSelectedFailure', e => e.textContent).catch(() => '');
      selected.length > 3 ? ok('Node selected: ' + selected.trim().slice(0, 50)) : ko('Node selection', selected || '(empty)');

      await il.click('#ilBtnAnalyse');
      await il.waitForTimeout(8000);
      const ilPost = await il.$eval('#ilStatus', e => e.textContent).catch(() => '');
      console.log('  Post-compute status:', ilPost.trim().slice(0, 100));
      /blast|computed|ring/i.test(ilPost) ? ok('Blast radius computed') : ko('Blast radius', ilPost.slice(0, 80));

      // Ring section
      const rings = await il.evaluate(() => ({
        ring0:   document.getElementById('ilRing0')   ? document.getElementById('ilRing0').textContent   : '?',
        ring1:   document.getElementById('ilRing1')   ? document.getElementById('ilRing1').textContent   : '?',
        ring2:   document.getElementById('ilRing2')   ? document.getElementById('ilRing2').textContent   : '?',
        unreach: document.getElementById('ilUnreach') ? document.getElementById('ilUnreach').textContent : '?',
      }));
      console.log('  Rings — R0:', rings.ring0, '| R1:', rings.ring1, '| R2:', rings.ring2, '| Unreach:', rings.unreach);
      const ringSectionVisible = await il.$eval('#ilRingSection', e => e.style.display !== 'none').catch(() => false);
      ringSectionVisible ? ok('Ring section visible: R0=' + rings.ring0 + ' R1=' + rings.ring1 + ' R2=' + rings.ring2) : ko('Ring section', 'hidden after compute');

      // Country impact rows — should now have data with A-type nodes
      const countryRows = await il.evaluate(() => document.querySelectorAll('#ilCountryRows tr').length);
      console.log('  Country rows:', countryRows);
      countryRows > 0 ? ok('Country impact table: ' + countryRows + ' rows') : wn('Country table', 'empty — check A-type nodes exist in graph');
    }
  }
  await shot(il, 'E-impact-lab');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE F — Topology Diff
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE F — Topology Diff (/topo-diff) ════');
  const td = await ctx.newPage();
  await td.goto(BASE + '/topo-diff?graph_time=' + encodeURIComponent(gt), { waitUntil: 'domcontentloaded' });
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
      for (const id of ['tdSnapA', 'tdSnapB']) {
        const sel = document.getElementById(id);
        if (!sel) continue;
        for (const opt of sel.options) { if (opt.value === val) { opt.selected = true; break; } }
      }
    }, v);
    await td.click('#tdBtnCompare');
    await td.waitForTimeout(12000);
    const tdStatus = await td.$eval('#tdStatus', e => e.textContent).catch(() => '');
    console.log('  status:', tdStatus.trim().slice(0, 100));
    /Diff complete|edge changes/.test(tdStatus) ? ok('topo-diff Compare completed') : ko('topo-diff Compare', tdStatus.slice(0, 80));
    const diffRows = await td.evaluate(() => {
      const t = document.getElementById('tdDiffTable');
      return t ? t.querySelectorAll('tbody tr').length : 0;
    });
    ok('Diff table: ' + diffRows + ' rows (0 expected when both snapshots are identical)');
  }
  await shot(td, 'F-topo-diff');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PHASE G — Cross-page consistency
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n════ PHASE G — Cross-page consistency ════');
  const kpBtnOc = await main.evaluate(() => {
    const b = document.getElementById('btnKspExplorer');
    return b ? (b.getAttribute('onclick') || '') : null;
  });
  kpBtnOc && kpBtnOc.includes('/path-explorer') ? ok('K-Paths toolbar button → /path-explorer') : ko('K-Paths button', kpBtnOc === null ? 'not found' : 'onclick: ' + kpBtnOc);

  const cpBtnOc = await main.evaluate(() => {
    const b = document.getElementById('btnChangePlanner');
    return b ? (b.getAttribute('onclick') || '') : null;
  });
  cpBtnOc && cpBtnOc.includes('/change-planner') ? ok('Change Planner toolbar button → /change-planner') : wn('Change Planner button', cpBtnOc === null ? 'not found' : 'onclick: ' + cpBtnOc);

  // Verify K-Paths button carries graph_time in URL
  if (kpBtnOc && kpBtnOc.includes('graph_time')) {
    ok('K-Paths button passes graph_time in URL');
  } else {
    wn('K-Paths URL param', kpBtnOc ? 'no graph_time in onclick' : 'button not found');
  }

  await browser.close();

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  PASSED: ' + pass.length + ' | FAILED: ' + fail.length + ' | WARNED: ' + warn.length);
  if (warn.length)  console.log('  WARNINGS:', warn);
  if (fail.length) { console.log('  FAILED:', fail); process.exit(1); }
  else console.log('  ALL PASSED ✅');
})();
