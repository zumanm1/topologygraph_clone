#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const HEADLESS = process.env.HEADLESS !== 'false';
const OSPF_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'ospf-database-54-unk-test.txt');
const HOST_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.csv');

async function settle(page, ms) {
  await page.waitForTimeout(ms || 800);
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
    if (total > 0) break;
  }
  await settle(page, 2500);
}

async function inspect(page) {
  return page.evaluate(() => {
    const all = nodes.get();
    const allEdges = edges.get();
    const byId = new Map(all.map(n => [n.id, n]));
    const inferred = new Set();
    allEdges.forEach(e => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return;
      const ca = String(a.country || 'UNK').toUpperCase();
      const cb = String(b.country || 'UNK').toUpperCase();
      if (ca !== cb) {
        inferred.add(a.id);
        inferred.add(b.id);
      }
    });
    const byCountry = {};
    all.forEach(n => {
      const c = String(n.country || 'UNK').toUpperCase();
      if (!byCountry[c]) byCountry[c] = { total: 0, actual: 0, inferred: 0 };
      byCountry[c].total += 1;
      if (n.is_gateway === true) byCountry[c].actual += 1;
      if (inferred.has(n.id)) byCountry[c].inferred += 1;
    });
    return {
      total: all.length,
      actualGatewayTotal: all.filter(n => n.is_gateway === true).length,
      inferredGatewayTotal: inferred.size,
      byCountry
    };
  });
}

async function visibleSnapshot(page) {
  return page.evaluate(() => {
    const visible = nodes.get().filter(n => !n.hidden);
    const counts = {};
    visible.forEach(n => {
      const c = String(n.country || 'UNK').toUpperCase();
      counts[c] = (counts[c] || 0) + 1;
    });
    return { visible: visible.length, counts };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);
  const graphTime = await uploadOspf(page);
  await loadHostsPage(page, graphTime);
  await importHosts(page);
  await loadGraph(page, graphTime);
  const beforeGateway = await inspect(page);
  await page.evaluate(() => { if (typeof setViewMode === 'function') setViewMode('gateway'); });
  await settle(page, 1000);
  const gatewayVisible = await visibleSnapshot(page);
  await page.evaluate(() => { if (typeof filterNodesByCountry === 'function') filterNodesByCountry('show_only', new Set(['ZAF'])); });
  await settle(page, 800);
  const gatewayZafVisible = await visibleSnapshot(page);
  console.log(JSON.stringify({ graphTime, beforeGateway, gatewayVisible, gatewayZafVisible }, null, 2));
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
