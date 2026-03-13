'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  console.log('\n════ Simple What-If Check ════\n');

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);
  console.log('✅ Logged in');

  await page.goto(BASE + '/what-if', { waitUntil: 'domcontentloaded' });
  console.log('✅ Navigated to What-If');

  await page.waitForTimeout(12000);

  const state = await page.evaluate(() => {
    const container = document.getElementById('wiTopoContainer');
    const canvas = container?.querySelector('canvas');
    const rect = container?.getBoundingClientRect();
    
    return {
      containerExists: !!container,
      canvasExists: !!canvas,
      containerRect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
      canvasRect: canvas ? canvas.getBoundingClientRect() : null,
      wiNodesCount: typeof wiNodes !== 'undefined' ? wiNodes.length : 0,
      networkExists: typeof wiNetwork !== 'undefined' && wiNetwork !== null,
      containerComputedStyle: container ? {
        display: getComputedStyle(container).display,
        position: getComputedStyle(container).position,
        flex: getComputedStyle(container).flex,
        height: getComputedStyle(container).height,
        minHeight: getComputedStyle(container).minHeight
      } : null
    };
  });

  console.log('State:', JSON.stringify(state, null, 2));

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '27-what-if-headful.png'), fullPage: false });
  console.log('📸 Screenshot saved');

  console.log('\n⏸️  Browser will stay open for 30 seconds for manual inspection...');
  await page.waitForTimeout(30000);

  await browser.close();
})();
