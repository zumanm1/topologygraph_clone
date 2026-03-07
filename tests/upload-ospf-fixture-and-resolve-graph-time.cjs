#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const OSPF_FILE = process.env.OSPF_FILE
  ? path.resolve(process.env.OSPF_FILE)
  : path.join(__dirname, '..', 'INPUT-FOLDER', 'ospf-database-54-unk-test.txt');

async function settle(page, ms) {
  await page.waitForTimeout(ms || 800);
}

(async () => {
  if (!fs.existsSync(OSPF_FILE)) {
    console.error(`Missing OSPF fixture: ${OSPF_FILE}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await settle(page, 500);
    await page.fill('#login', API_USER);
    await page.fill('#password', API_PASS);
    await Promise.race([
      page.press('#password', 'Enter'),
      page.click('input[type="submit"], button[type="submit"]').catch(() => {})
    ]);
    await settle(page, 1200);

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
    const graphTime = created[0] || after[after.length - 1] || '';
    if (!graphTime) {
      console.error('No graph_time resolved after OSPF upload');
      process.exit(1);
    }
    console.log(graphTime);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
