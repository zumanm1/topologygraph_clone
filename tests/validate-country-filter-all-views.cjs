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

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);
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
  await settle(page, 1500);
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
  await picker.setInputFiles(HOST_FILE);
  for (let i = 0; i < 24; i++) {
    await settle(page, 500);
    const status = await page.locator('#hostCsvImportStatus').textContent().catch(() => '');
    if (status && status.includes('Imported')) return true;
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

async function graphSnapshot(page) {
  return page.evaluate(() => {
    if (typeof nodes === 'undefined' || !nodes) return null;
    const all = nodes.get();
    const visible = all.filter(n => !n.hidden);
    const counts = {};
    visible.forEach(n => {
      const c = String(n.country || 'UNK').toUpperCase();
      counts[c] = (counts[c] || 0) + 1;
    });
    return {
      total: all.length,
      visible: visible.length,
      counts,
      cfVisible: (() => {
        const el = document.getElementById('countryFilterPanel');
        return !!(el && el.style.display !== 'none');
      })(),
      cpVisible: (() => {
        const el = document.getElementById('countryCollapsePanel');
        return !!(el && el.style.display !== 'none');
      })(),
      unkVisible: !!document.getElementById('unkPanel')
    };
  });
}

async function setMode(page, mode) {
  await page.evaluate((m) => { if (typeof setViewMode === 'function') setViewMode(m); }, mode);
  await settle(page, 1000);
}

async function applyShowOnly(page, country) {
  return page.evaluate((countryCode) => {
    if (typeof filterNodesByCountry !== 'function') return false;
    filterNodesByCountry('show_only', new Set([countryCode]));
    return true;
  }, country);
}

async function resetFilter(page) {
  await page.evaluate(() => { if (typeof resetCountryFilter === 'function') resetCountryFilter(); });
  await settle(page, 700);
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Country Filter Across AS-IS / GATEWAY / ENRICHED / COLLAPSING║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (!fs.existsSync(OSPF_FILE) || !fs.existsSync(HOST_FILE)) {
    fail('PRE', 'Required fixtures are missing');
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

  const graphTime = await uploadOspf(page);
  graphTime ? pass('SETUP', `Uploaded OSPF graph ${graphTime}`) : fail('SETUP', 'No graph_time after upload');
  if (!graphTime) {
    await browser.close();
    process.exit(1);
  }

  await loadHostsPage(page, graphTime);
  const imported = await importHosts(page);
  imported ? pass('SETUP', `Imported ${path.basename(HOST_FILE)}`) : fail('SETUP', 'Host CSV import failed');

  const total = await loadGraph(page, graphTime);
  total > 0 ? pass('SETUP', `Graph loaded with ${total} nodes`) : fail('SETUP', 'Graph failed to load');
  if (!total) {
    await browser.close();
    process.exit(1);
  }

  const modes = [
    { mode: 'asis', label: 'AS-IS', expectCp: false },
    { mode: 'gateway', label: 'GATEWAY', expectCp: false },
    { mode: 'enriched', label: 'ENRICHED', expectCp: false },
    { mode: 'collapsing', label: 'COLLAPSING', expectCp: true }
  ];

  for (const item of modes) {
    await setMode(page, item.mode);
    const base = await graphSnapshot(page);
    base && base.cfVisible
      ? pass(item.label, 'Country Filter panel visible')
      : fail(item.label, `Country Filter panel missing: ${JSON.stringify(base)}`);
    (!!base && !!base.cpVisible === item.expectCp)
      ? pass(item.label, `Country Groups panel visibility correct (${item.expectCp})`)
      : fail(item.label, `Country Groups panel visibility mismatch: ${JSON.stringify(base)}`);
    base && base.unkVisible
      ? pass(item.label, 'UNK panel visible')
      : fail(item.label, 'UNK panel missing');

    const applied = await applyShowOnly(page, 'ZAF');
    applied ? pass(item.label, 'Applied show-only ZAF filter') : fail(item.label, 'Could not apply filter function');
    await settle(page, 800);
    const filtered = await graphSnapshot(page);
    const visibleCountries = Object.keys((filtered && filtered.counts) || {});
    filtered && filtered.visible > 0 && visibleCountries.length === 1 && visibleCountries[0] === 'ZAF'
      ? pass(item.label, `Filter isolated ZAF (${filtered.visible} visible nodes)`)
      : fail(item.label, `Unexpected filtered visibility: ${JSON.stringify(filtered)}`);

    await resetFilter(page);
    const restored = await graphSnapshot(page);
    restored && base && restored.visible === base.visible
      ? pass(item.label, `Reset restored baseline visibility (${restored.visible})`)
      : fail(item.label, `Reset mismatch: base=${JSON.stringify(base)} restored=${JSON.stringify(restored)}`);

    await shot(page, `filter-${item.mode.toLowerCase()}-view`);
  }

  await browser.close();
  console.log('');
  console.log(`TOTAL PASSED: ${PASS}`);
  console.log(`TOTAL FAILED: ${FAIL}`);
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
