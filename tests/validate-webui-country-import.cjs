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
  : path.join(__dirname, '..', '09-STEP-BY-STEP', 'screenshots');
const OSPF_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'ospf-database-54-unk-test.txt');
const HOST_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.csv');

let PASS = 0;
let FAIL = 0;

function pass(tag, msg) { PASS++; console.log(`  ✅ PASS [${tag}]: ${msg}`); }
function fail(tag, msg) { FAIL++; console.log(`  ❌ FAIL [${tag}]: ${msg}`); }
async function settle(page, ms) { await page.waitForTimeout(ms || 800); }
async function shot(page, name) {
  fs.mkdirSync(SS_DIR, { recursive: true });
  const file = path.join(SS_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ℹ  Screenshot → ${path.basename(file)}`);
}

async function clickAndSettle(page, selector, waitMs) {
  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
  await page.locator(selector).first().click();
  await nav;
  await settle(page, waitMs || 1200);
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await Promise.race([
    page.press('#password', 'Enter'),
    page.click('input[type="submit"], button[type="submit"]').catch(() => {})
  ]);
  await settle(page, 1500);
  return !page.url().includes('/login');
}

async function uploadOspfAndResolveGraphTime(page) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1200);
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
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
    page.locator('input[name="upload_files_btn"], button[name="upload_files_btn"], input[type="submit"], button[type="submit"]').first().click()
  ]);
  await settle(page, 2000);
  const after = await page.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  const created = after.filter(v => !before.includes(v));
  return created[0] || after[after.length - 1] || '';
}

async function loadHostsForGraph(page, graphTime) {
  await page.goto(`${BASE_URL}/ospf-host-to-dns-mapping`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1200);
  const select = page.locator('#select_graph_time_id');
  if (await select.count()) {
    await select.selectOption({ value: graphTime }).catch(async () => {
      await select.selectOption({ label: graphTime }).catch(() => {});
    });
    const loadBtn = page.locator('input[value="Load hosts"], button:has-text("Load hosts")');
    if (await loadBtn.count()) {
      await clickAndSettle(page, 'input[value="Load hosts"], button:has-text("Load hosts")', 1500);
    }
  }
}

async function importHostsCsv(page) {
  const fileInput = page.locator('#hostCsvImportPicker');
  if (!(await fileInput.count())) return false;
  await fileInput.setInputFiles(HOST_FILE);
  for (let i = 0; i < 20; i++) {
    await settle(page, 500);
    const status = await page.locator('#hostCsvImportStatus').textContent().catch(() => '');
    if (status && status.includes('Imported')) {
      return true;
    }
  }
  return false;
}

async function updateHostnamesOnGraph(page, graphTime) {
  await loadHostsForGraph(page, graphTime);
  const updateBtn = page.locator('#update_hostname_on_graph');
  if (!(await updateBtn.count())) return false;
  await updateBtn.first().click();
  await settle(page, 1800);
  return true;
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
  for (let i = 0; i < 15; i++) {
    await settle(page, 1200);
    const total = await page.evaluate(() => {
      try { return typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0; } catch (e) { return 0; }
    });
    if (total > 0) return total;
  }
  return 0;
}

async function waitForDerivedSamples(page) {
  for (let i = 0; i < 15; i++) {
    await settle(page, 1000);
    const rows = await page.evaluate(() => {
      const wanted = ['12.12.12.2', '13.13.13.1', '18.18.18.4', '19.19.19.1'];
      if (typeof nodes === 'undefined' || !nodes) return [];
      return nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => ({
        id: String(n.name || n.id),
        hostname: n.hostname || '',
        country: (n.country || 'UNK').toUpperCase(),
        label: n.label || ''
      }));
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    const ken = byId.get('12.12.12.2');
    const drc = byId.get('13.13.13.1');
    const zaf = byId.get('18.18.18.4');
    if (ken && drc && zaf && ken.country === 'KEN' && drc.country === 'DRC' && zaf.country === 'ZAF') {
      return rows;
    }
  }
  return page.evaluate(() => {
    const wanted = ['12.12.12.2', '13.13.13.1', '18.18.18.4', '19.19.19.1'];
    if (typeof nodes === 'undefined' || !nodes) return [];
    return nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => ({
      id: String(n.name || n.id),
      hostname: n.hostname || '',
      country: (n.country || 'UNK').toUpperCase(),
      label: n.label || ''
    }));
  });
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   WebUI Host CSV Import → Automatic Country Derivation         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (!fs.existsSync(OSPF_FILE)) {
    fail('PRE', `Missing OSPF fixture: ${OSPF_FILE}`);
    process.exit(1);
  }
  if (!fs.existsSync(HOST_FILE)) {
    fail('PRE', `Missing host fixture: ${HOST_FILE}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  if (await login(page)) pass('AUTH', `Logged in as ${API_USER}`);
  else {
    fail('AUTH', 'Login failed');
    await browser.close();
    process.exit(1);
  }

  const graphTime = await uploadOspfAndResolveGraphTime(page);
  graphTime ? pass('UPLOAD', `Uploaded OSPF file and resolved graph_time=${graphTime}`) : fail('UPLOAD', 'Could not resolve graph_time after OSPF upload');
  await shot(page, '03-webui-ospf-uploaded');

  if (!graphTime) {
    await browser.close();
    process.exit(1);
  }

  await loadHostsForGraph(page, graphTime);
  pass('HOSTS', `Loaded hostname page for graph ${graphTime}`);

  const imported = await importHostsCsv(page);
  imported ? pass('HOSTS', `Imported ${path.basename(HOST_FILE)} via normal WebUI flow`) : fail('HOSTS', 'Could not import host CSV through WebUI');

  const updated = await updateHostnamesOnGraph(page, graphTime);
  updated ? pass('HOSTS', 'Updated hostnames on the graph from saved hostname mappings') : fail('HOSTS', 'Update hostnames on the graph button not available');

  const total = await loadGraph(page, graphTime);
  total > 0 ? pass('GRAPH', `Loaded graph ${graphTime} with ${total} nodes`) : fail('GRAPH', `Failed to load graph ${graphTime}`);
  await shot(page, '04-webui-graph-loaded-after-host-import');

  const derivedRows = await waitForDerivedSamples(page);
  const byId = new Map(derivedRows.map(row => [row.id, row]));
  [
    ['12.12.12.2', 'ken-mob-r2', 'KEN'],
    ['13.13.13.1', 'drc-moa-r1', 'DRC'],
    ['18.18.18.4', 'zaf-mtz-r1', 'ZAF']
  ].forEach(([rid, hostname, country]) => {
    const row = byId.get(rid);
    row && row.hostname === hostname && row.country === country && row.label.includes('[' + country + ']')
      ? pass('DERIVE', `${rid} => ${hostname} => ${country} through normal WebUI flow`)
      : fail('DERIVE', `${rid} mismatch after WebUI import flow: ${JSON.stringify(row || null)}`);
  });
  const unkRow = byId.get('19.19.19.1');
  unkRow && unkRow.country === 'UNK'
    ? pass('DERIVE', 'IP-like hostname remains UNK through normal WebUI flow')
    : fail('DERIVE', `Expected 19.19.19.1 to remain UNK, saw ${JSON.stringify(unkRow || null)}`);

  await page.evaluate(() => {
    const wanted = ['12.12.12.2', '13.13.13.1', '18.18.18.4', '19.19.19.1'];
    const ids = (typeof nodes !== 'undefined' && nodes ? nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => n.id) : []);
    if (typeof network !== 'undefined' && network && ids.length) network.fit({ nodes: ids, animation: false });
  });
  await settle(page, 1000);
  await shot(page, '05-webui-derived-country-samples');

  await browser.close();
  console.log('');
  console.log(`TOTAL PASSED: ${PASS}`);
  console.log(`TOTAL FAILED: ${FAIL}`);
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
