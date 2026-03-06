#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const HEADLESS = process.env.HEADLESS !== 'false';
const SS_DIR = path.join(__dirname, '..', '09-STEP-BY-STEP', 'screenshots');

function resolveGraphTime() {
  const fromEnv = (process.env.GRAPH_TIME || process.env.GRAPH_TIMES || '').split(',')[0].trim();
  if (fromEnv) return fromEnv;
  const inout = path.join(__dirname, '..', 'IN-OUT-FOLDER');
  if (!fs.existsSync(inout)) return null;
  const dirs = fs.readdirSync(inout)
    .filter(d => fs.existsSync(path.join(inout, d, 'nodes.json')))
    .sort();
  const d54 = dirs.filter(d => d.includes('_54_hosts'));
  return d54.length ? d54[d54.length - 1] : (dirs.length ? dirs[dirs.length - 1] : null);
}

const GRAPH_TIME = resolveGraphTime();
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
    page.click('input[type="submit"], button[type="submit"]').catch(() => {}),
  ]);
  await settle(page, 1500);
  return !page.url().includes('/login');
}

async function loadGraph(page, graphTime) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1000);
  await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    let opt = Array.from(sel.options).find(o => o.value === gt || o.text.trim() === gt);
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
  for (let i = 0; i < 12; i++) {
    await settle(page, 1200);
    const total = await page.evaluate(() => {
      try { return typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0; } catch (e) { return 0; }
    });
    if (total > 0) return total;
  }
  return 0;
}

function readStandardHostFile() {
  const standardCsvPath = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.csv');
  const standardTxtPath = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts-3b.txt');
  const canonicalTxtPath = path.join(__dirname, '..', 'INPUT-FOLDER', 'Load-hosts.txt');
  if (fs.existsSync(standardCsvPath)) return { name: 'Load-hosts.csv', text: fs.readFileSync(standardCsvPath, 'utf8') };
  if (fs.existsSync(standardTxtPath)) return { name: 'Load-hosts-3b.txt', text: fs.readFileSync(standardTxtPath, 'utf8') };
  if (fs.existsSync(canonicalTxtPath)) return { name: 'Load-hosts.txt', text: fs.readFileSync(canonicalTxtPath, 'utf8') };
  return {
    name: 'inline-host-fallback.csv',
    text: 'device_ip_address,device_name\n12.12.12.2,ken-mob-r2\n13.13.13.1,drc-moa-r1\n18.18.18.4,zaf-mtz-r1\n19.19.19.1,19.19.19.1'
  };
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Country Derivation — Hostname-Derived Regression             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  ℹ  Graph time: ${GRAPH_TIME || '<none>'}`);
  if (!GRAPH_TIME) {
    fail('PRE', 'No graph_time found in IN-OUT-FOLDER');
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

  const total = await loadGraph(page, GRAPH_TIME);
  total > 0 ? pass('LOAD', `Graph loaded with ${total} nodes`) : fail('LOAD', 'Graph failed to load');

  const hostFile = readStandardHostFile();
  console.log(`  ℹ  Using standard host file: ${hostFile.name}`);

  const applyStandard = await page.evaluate((payload) => {
    if (typeof buildHostnameUploadPanel === 'function') buildHostnameUploadPanel();
    if (typeof _applyHostnameMapping !== 'function') return 'no_function';
    _applyHostnameMapping(payload.text, payload.name);
    return 'ok';
  }, hostFile);
  applyStandard === 'ok' ? pass('STD', `Applied ${hostFile.name}`) : fail('STD', `Standard host-file apply failed: ${applyStandard}`);
  await settle(page, 1200);

  const derived = await page.evaluate(() => {
    const wanted = ['12.12.12.2', '13.13.13.1', '18.18.18.4', '19.19.19.1'];
    return (typeof nodes !== 'undefined' && nodes ? nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => ({
      id: String(n.name || n.id),
      hostname: n.hostname || '',
      country: (n.country || 'UNK').toUpperCase(),
      label: n.label || ''
    })) : []);
  });
  const byId = new Map(derived.map(row => [row.id, row]));
  [
    ['12.12.12.2', 'ken-mob-r2', 'KEN'],
    ['13.13.13.1', 'drc-moa-r1', 'DRC'],
    ['18.18.18.4', 'zaf-mtz-r1', 'ZAF']
  ].forEach(([rid, hostname, country]) => {
    const row = byId.get(rid);
    row && row.hostname === hostname && row.country === country && row.label.includes('[' + country + ']')
      ? pass('STD', `${rid} => ${hostname} => ${country}`)
      : fail('STD', `${rid} mismatch: ${JSON.stringify(row || null)}`);
  });
  const unkRow = byId.get('19.19.19.1');
  unkRow && unkRow.country === 'UNK'
    ? pass('STD', 'IP-like hostname remains UNK')
    : fail('STD', `Expected 19.19.19.1 to be UNK, saw ${JSON.stringify(unkRow || null)}`);

  await page.evaluate(() => {
    const wanted = ['12.12.12.2', '13.13.13.1', '18.18.18.4'];
    const ids = (typeof nodes !== 'undefined' && nodes ? nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => n.id) : []);
    const panel = document.getElementById('hostnameUploadPanel');
    if (panel) panel.remove();
    if (typeof network !== 'undefined' && network && ids.length) network.fit({ nodes: ids, animation: false });
  });
  await settle(page, 1200);
  await shot(page, '01-standard-host-file-derived-countries');

  const conflictCsv = [
    'router_id,hostname,country',
    '12.12.12.2,ken-mob-r2,ZZZ',
    '18.18.18.4,zaf-mtz-r1,AAA',
    '19.19.19.1,19.19.19.1,BBB'
  ].join('\n');
  const applyConflict = await page.evaluate((csv) => {
    if (typeof _applyHostnameMapping !== 'function') return 'no_function';
    _applyHostnameMapping(csv, 'conflict-country-column.csv');
    return 'ok';
  }, conflictCsv);
  applyConflict === 'ok' ? pass('CONFLICT', 'Applied conflicting 3-column host file') : fail('CONFLICT', `Conflict apply failed: ${applyConflict}`);
  await settle(page, 1200);

  const conflict = await page.evaluate(() => {
    const wanted = ['12.12.12.2', '18.18.18.4', '19.19.19.1'];
    return (typeof nodes !== 'undefined' && nodes ? nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => ({
      id: String(n.name || n.id),
      hostname: n.hostname || '',
      country: (n.country || 'UNK').toUpperCase(),
      label: n.label || ''
    })) : []);
  });
  const conflictById = new Map(conflict.map(row => [row.id, row]));
  [
    ['12.12.12.2', 'KEN'],
    ['18.18.18.4', 'ZAF'],
    ['19.19.19.1', 'UNK']
  ].forEach(([rid, country]) => {
    const row = conflictById.get(rid);
    row && row.country === country
      ? pass('CONFLICT', `${rid} kept hostname-derived country ${country}`)
      : fail('CONFLICT', `${rid} conflict mismatch: ${JSON.stringify(row || null)}`);
  });

  await page.evaluate(() => {
    const wanted = ['12.12.12.2', '18.18.18.4', '19.19.19.1'];
    const ids = (typeof nodes !== 'undefined' && nodes ? nodes.get().filter(n => wanted.includes(String(n.name || n.id))).map(n => n.id) : []);
    if (typeof network !== 'undefined' && network && ids.length) network.fit({ nodes: ids, animation: false });
  });
  await settle(page, 1200);
  await shot(page, '02-conflicting-country-column-ignored');

  await browser.close();
  console.log('');
  console.log(`TOTAL PASSED: ${PASS}`);
  console.log(`TOTAL FAILED: ${FAIL}`);
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
