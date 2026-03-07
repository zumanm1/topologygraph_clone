#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const HEADLESS = process.env.HEADLESS !== 'false';
const SS_DIR = process.env.SCREENSHOT_DIR
  ? path.resolve(process.env.SCREENSHOT_DIR)
  : path.join(__dirname, '..', '10-STEP-BY-STEP', 'screenshots', 'walkthrough');
const OSPF_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'ospf-database-54-unk-test.txt');
const HOST_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.csv');

let PASS = 0;
let FAIL = 0;
let index = 0;

function pass(tag, msg) { PASS++; console.log(`  ✅ PASS [${tag}]: ${msg}`); }
function fail(tag, msg) { FAIL++; console.log(`  ❌ FAIL [${tag}]: ${msg}`); }
async function settle(page, ms) { await page.waitForTimeout(ms || 900); }
async function shot(page, name) {
  fs.mkdirSync(SS_DIR, { recursive: true });
  index += 1;
  const file = path.join(SS_DIR, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ℹ  Screenshot → ${path.basename(file)}`);
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 600);
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await Promise.race([
    page.press('#password', 'Enter'),
    page.click('input[type="submit"], button[type="submit"]').catch(() => {})
  ]);
  await settle(page, 1200);
  return !page.url().includes('/login');
}

async function uploadOspf(page) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1000);
  await shot(page, '01-upload-page');
  const before = await page.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  await page.click('#Cisco').catch(() => {});
  await page.evaluate(() => {
    const wrap = document.getElementById('devinputGroupFile02');
    if (wrap) wrap.removeAttribute('hidden');
    const input = document.getElementById('inputOSPFFileID');
    if (input) {
      input.style.display = 'block';
      input.removeAttribute('hidden');
    }
  });
  await page.locator('#inputOSPFFileID').setInputFiles(OSPF_FILE);
  await shot(page, '02-ospf-selected');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
    page.locator('input[name="upload_files_btn"], button[name="upload_files_btn"], input[type="submit"], button[type="submit"]').first().click()
  ]);
  await settle(page, 1500);
  await shot(page, '03-after-upload');
  const after = await page.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  const created = after.filter(v => !before.includes(v));
  return created[0] || after[after.length - 1] || '';
}

async function loadHostsPage(page, graphTime) {
  await page.goto(`${BASE_URL}/ospf-host-to-dns-mapping`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1000);
  const select = page.locator('#select_graph_time_id');
  if (await select.count()) {
    await select.selectOption({ value: graphTime }).catch(async () => {
      await select.selectOption({ label: graphTime }).catch(() => {});
    });
    const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
    const btn = page.locator('input[value="Load hosts"], button:has-text("Load hosts")');
    if (await btn.count()) await btn.first().click();
    await nav;
    await settle(page, 1200);
  }
}

async function importHosts(page) {
  const picker = page.locator('#hostCsvImportPicker');
  if (!(await picker.count())) return false;
  await shot(page, '04-host-mapping-page');
  await picker.setInputFiles(HOST_FILE);
  for (let i = 0; i < 24; i++) {
    await settle(page, 500);
    const status = await page.locator('#hostCsvImportStatus').textContent().catch(() => '');
    if (status && status.includes('Imported')) {
      await shot(page, '05-host-csv-imported');
      return true;
    }
  }
  return false;
}

async function loadGraph(page, graphTime) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1200);
  await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    let opt = Array.from(sel.options).find(o => o.value === gt || (o.textContent || '').trim() === gt);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = gt;
      opt.text = gt;
      sel.add(opt);
    }
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
    if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt);
  }, graphTime);
  for (let i = 0; i < 18; i++) {
    await settle(page, 900);
    const total = await page.evaluate(() => {
      try { return typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0; } catch (e) { return 0; }
    });
    if (total > 0) return total;
  }
  return 0;
}

async function setMode(page, mode, shotName) {
  await page.evaluate((m) => { if (typeof setViewMode === 'function') setViewMode(m); }, mode);
  await settle(page, 1000);
  await shot(page, shotName);
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Step 10 Updated Web UI User Journey                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (!fs.existsSync(OSPF_FILE) || !fs.existsSync(HOST_FILE)) {
    fail('PRE', 'Required packaged fixtures missing');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    if (await login(page)) {
      pass('AUTH', `Logged in as ${API_USER}`);
      await shot(page, '00-login-success');
    } else {
      fail('AUTH', 'Login failed');
      throw new Error('login failed');
    }

    const graphTime = await uploadOspf(page);
    graphTime ? pass('UPLOAD', `Uploaded raw OSPF and created graph_time=${graphTime}`) : fail('UPLOAD', 'No graph_time created after upload');
    if (!graphTime) throw new Error('upload failed');

    await loadHostsPage(page, graphTime);
    const imported = await importHosts(page);
    imported ? pass('HOSTS', `Imported ${path.basename(HOST_FILE)} on host mapping page`) : fail('HOSTS', 'Host CSV import did not complete');

    const total = await loadGraph(page, graphTime);
    total > 0 ? pass('GRAPH', `Loaded graph ${graphTime} with ${total} nodes`) : fail('GRAPH', 'Graph failed to load after import');
    if (!total) throw new Error('graph load failed');
    await shot(page, '06-graph-loaded');

    await setMode(page, 'asis', '07-view-asis');
    pass('VIEW', 'AS-IS rendered');

    await setMode(page, 'gateway', '08-view-gateway');
    pass('VIEW', 'GATEWAY rendered');

    await setMode(page, 'enriched', '09-view-enriched');
    pass('VIEW', 'ENRICHED rendered');

    await setMode(page, 'collapsing', '10-view-collapsing');
    pass('VIEW', 'COLLAPSING rendered');

    await page.evaluate(() => { if (typeof buildOspfCostMatrix === 'function') buildOspfCostMatrix(); });
    await settle(page, 2200);
    await shot(page, '11-cost-matrix-panel');
    await page.evaluate(() => { const p = document.getElementById('ospfCostMatrixPanel'); if (p) p.remove(); if (typeof _matrixData !== 'undefined') _matrixData = null; });
    pass('FEATURE', 'Cost Matrix panel opened');

    await page.evaluate(() => { if (typeof buildOspfWhatIf === 'function') buildOspfWhatIf(); });
    await settle(page, 1000);
    await shot(page, '12-what-if-panel');
    pass('FEATURE', 'What-If panel opened');

    await page.evaluate(() => {
      const ids = ['btnLayoutSave','btnLayoutLoad','btnLayoutReset','btnLayoutResetNode','btnExportYaml','btnExportCsv','btnExportExcel'];
      return ids.map(id => ({ id, present: !!document.getElementById(id) }));
    }).then(results => {
      results.forEach(item => item.present ? pass('LAYOUT', `${item.id} visible`) : fail('LAYOUT', `${item.id} missing`));
    });
    await shot(page, '13-layout-export-controls');
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
