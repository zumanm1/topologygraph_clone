'use strict';
const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const USER     = process.env.API_USER  || 'ospf@topolograph.com';
const PASS     = process.env.API_PASS  || 'ospf';
const SS_DIR   = path.join(__dirname, '..', 'test-screenshots');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(500);
  await page.fill('#login', USER);
  await page.fill('#password', PASS);
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);

  await page.goto(`${BASE_URL}/change-planner`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelector('#cpGraphTime') && document.querySelector('#cpGraphTime').options.length > 1,
    { timeout: 15000 }
  );
  await page.selectOption('#cpGraphTime', '11Mar2026_21h17m14s_84_hosts');
  await page.waitForFunction(
    () => { const el = document.getElementById('cpStatus'); return el && el.textContent.includes('nodes'); },
    { timeout: 30000 }
  );
  await page.waitForTimeout(1000);

  // Add change row with cross-country edge
  await page.click('#cpBtnAddRow');
  await page.waitForTimeout(300);
  const edgeInputs = await page.$$('.cp-plan-table input[type="text"]');
  await edgeInputs[edgeInputs.length - 1].fill('9.9.9.1_to_13.13.13.1');
  const fwdInputs = await page.$$('.cp-plan-table input[type="number"]');
  await fwdInputs[fwdInputs.length - 2].fill('500');

  // Analyse
  await page.click('#cpBtnAnalyse');
  await page.waitForFunction(
    () => document.getElementById('cpImpactSection') && document.getElementById('cpImpactSection').style.display !== 'none',
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);

  // Click first diff row
  const diffRows = await page.$$('#cpDiffRows tr');
  await diffRows[0].click();
  await page.waitForTimeout(800);

  // Scroll detail row into view
  await page.evaluate(() => {
    const tr = document.querySelector('tr.cp-detail-tr');
    if (tr) tr.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(300);

  // Full page screenshot to capture all hop tables
  await page.screenshot({ path: path.join(SS_DIR, '29-07-detail-fullpage.png'), fullPage: true });
  console.log('Full-page screenshot saved: 29-07-detail-fullpage.png');

  await browser.close();
})();
