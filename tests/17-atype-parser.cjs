/**
 * Test 17 — _parseAtypeHostname() Unit Tests
 * PRD-01: Validate the A-type hostname parser via browser page.evaluate
 *
 * Usage:  node tests/17-atype-parser.cjs
 */
'use strict';
const { chromium } = require('playwright');

const BASE    = 'http://localhost:8081';
const API_USER = 'ospf@topolograph.com';
const API_PASS = 'ospf';

let passed = 0, failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    console.log('  ✅ ', label);
    passed++;
  } else {
    console.log('  ❌ ', label, detail ? `— ${detail}` : '');
    failed++;
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.fill('#login',    API_USER);
  await page.fill('#password', API_PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  return !page.url().includes('/login');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log('  Test 17 — _parseAtypeHostname() Parser Unit Tests');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  // Login to load the app
  const loggedIn = await login(page);
  ok('Login succeeded', loggedIn);

  // Navigate to main page so topolograph.js is loaded
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1000);

  // Check function exists
  const fnExists = await page.evaluate(() => typeof _parseAtypeHostname === 'function');
  ok('_parseAtypeHostname function exists', fnExists);

  if (!fnExists) {
    console.log('\n  ⚠️  Function not found — ensure docker container rebuilt with updated topolograph.js');
    await browser.close();
    printSummary();
    return;
  }

  // ── Test cases ──────────────────────────────────────────────────────────────

  // 1. Standard 3-letter country
  const t1 = await page.evaluate(() => _parseAtypeHostname('fra-par-mar-r2'));
  ok('fra-par-mar-r2: returns object', t1 !== null);
  ok('fra-par-mar-r2: country=FRA', t1 && t1.country === 'FRA', JSON.stringify(t1));
  ok('fra-par-mar-r2: city=PAR',    t1 && t1.city    === 'PAR', JSON.stringify(t1));
  ok('fra-par-mar-r2: airport=MAR', t1 && t1.airport === 'MAR', JSON.stringify(t1));
  ok('fra-par-mar-r2: role=R',      t1 && t1.role    === 'R',   JSON.stringify(t1));
  ok('fra-par-mar-r2: num=2',       t1 && t1.num     === '2',   JSON.stringify(t1));

  // 2. 2-letter country code (key edge case: ir-)
  const t2 = await page.evaluate(() => _parseAtypeHostname('ir-dub-dcr-p01'));
  ok('ir-dub-dcr-p01: returns object', t2 !== null);
  ok('ir-dub-dcr-p01: country=IR',  t2 && t2.country === 'IR',  JSON.stringify(t2));
  ok('ir-dub-dcr-p01: city=DUB',    t2 && t2.city    === 'DUB', JSON.stringify(t2));
  ok('ir-dub-dcr-p01: airport=DCR', t2 && t2.airport === 'DCR', JSON.stringify(t2));
  ok('ir-dub-dcr-p01: role=P',      t2 && t2.role    === 'P',   JSON.stringify(t2));
  ok('ir-dub-dcr-p01: num=01',      t2 && t2.num     === '01',  JSON.stringify(t2));

  // 3. Uppercase hostname (JAP-LON-PER-PE01)
  const t3 = await page.evaluate(() => _parseAtypeHostname('JAP-LON-PER-PE01'));
  ok('JAP-LON-PER-PE01: returns object', t3 !== null);
  ok('JAP-LON-PER-PE01: country=JAP', t3 && t3.country === 'JAP', JSON.stringify(t3));
  ok('JAP-LON-PER-PE01: city=LON',    t3 && t3.city    === 'LON', JSON.stringify(t3));
  ok('JAP-LON-PER-PE01: airport=PER', t3 && t3.airport === 'PER', JSON.stringify(t3));
  ok('JAP-LON-PER-PE01: role=PE',     t3 && t3.role    === 'PE',  JSON.stringify(t3));
  ok('JAP-LON-PER-PE01: num=01',      t3 && t3.num     === '01',  JSON.stringify(t3));

  // 4. can-tor-kem-r1
  const t4 = await page.evaluate(() => _parseAtypeHostname('can-tor-kem-r1'));
  ok('can-tor-kem-r1: returns object', t4 !== null);
  ok('can-tor-kem-r1: country=CAN', t4 && t4.country === 'CAN', JSON.stringify(t4));
  ok('can-tor-kem-r1: city=TOR',    t4 && t4.city    === 'TOR', JSON.stringify(t4));
  ok('can-tor-kem-r1: airport=KEM', t4 && t4.airport === 'KEM', JSON.stringify(t4));

  // 5. IP address — must return null
  const t5 = await page.evaluate(() => _parseAtypeHostname('9.9.9.1'));
  ok('9.9.9.1: returns null (not A-type)', t5 === null, JSON.stringify(t5));

  // 6. B-type hostname — must return null
  const t6 = await page.evaluate(() => _parseAtypeHostname('GBR-PE-ASR9k-01'));
  ok('GBR-PE-ASR9k-01: returns null (not A-type pattern)', t6 === null, JSON.stringify(t6));

  // 7. Empty string — must return null
  const t7 = await page.evaluate(() => _parseAtypeHostname(''));
  ok('empty string: returns null', t7 === null, JSON.stringify(t7));

  // 8. Missing role+num (only 3 segments) — must return null
  const t8 = await page.evaluate(() => _parseAtypeHostname('fra-par-mar'));
  ok('fra-par-mar (missing role+num): returns null', t8 === null, JSON.stringify(t8));

  // 9. null input — must return null
  const t9 = await page.evaluate(() => _parseAtypeHostname(null));
  ok('null input: returns null', t9 === null, JSON.stringify(t9));

  // 10. DUB-P-NCS550-R01 (B-type) — must return null (4th segment starts with digits)
  const t10 = await page.evaluate(() => _parseAtypeHostname('DUB-P-NCS550-R01'));
  ok('DUB-P-NCS550-R01: returns null (B-type has digits in segment 3)', t10 === null, JSON.stringify(t10));

  await browser.close();
  printSummary();
})().catch(e => { console.error(e); process.exit(1); });

function printSummary() {
  console.log('\n════════════════════════════════════════════════════════════════════════');
  if (failed === 0) {
    console.log(`  Results: ${passed} passed, ${failed} failed`);
  } else {
    console.log(`  Results: ${passed} passed, ${failed} FAILED`);
  }
  console.log('════════════════════════════════════════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}
