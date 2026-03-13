'use strict';
/**
 * 26-what-if-visual-validation.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Visual validation test with hard refresh and scroll testing.
 * Captures screenshots at different scroll positions to locate the graph.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  console.log('\n════ What-If Visual Validation with Hard Refresh ════\n');

  // Login
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);
  console.log('✅ Logged in');

  // Navigate with hard refresh (bypass cache)
  await page.goto(BASE + '/what-if', { waitUntil: 'networkidle', timeout: 30000 });
  await page.reload({ waitUntil: 'networkidle' });
  console.log('✅ Hard refresh completed');

  await page.waitForTimeout(10000); // Allow full initialization

  // Capture initial viewport
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '26-01-viewport-top.png') });
  console.log('📸 Screenshot: viewport-top');

  // Check canvas dimensions and container layout
  const layout = await page.evaluate(() => {
    const container = document.getElementById('wiTopoContainer');
    const viewport = document.querySelector('.wi-viewport');
    const main = document.querySelector('.wi-main');
    const canvas = container?.querySelector('canvas');
    
    return {
      container: container ? {
        offsetWidth: container.offsetWidth,
        offsetHeight: container.offsetHeight,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        computedHeight: getComputedStyle(container).height,
        computedMinHeight: getComputedStyle(container).minHeight,
        computedFlex: getComputedStyle(container).flex
      } : null,
      viewport: viewport ? {
        offsetHeight: viewport.offsetHeight,
        scrollHeight: viewport.scrollHeight,
        computedHeight: getComputedStyle(viewport).height
      } : null,
      main: main ? {
        offsetHeight: main.offsetHeight,
        scrollHeight: main.scrollHeight
      } : null,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        offsetTop: canvas.offsetTop,
        offsetLeft: canvas.offsetLeft
      } : null,
      pageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight
    };
  });

  console.log('\n📊 Layout Analysis:');
  console.log(JSON.stringify(layout, null, 2));

  // Scroll down to see if graph is below fold
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '26-02-scrolled-1000px.png') });
  console.log('📸 Screenshot: scrolled-1000px');

  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '26-03-scrolled-3000px.png') });
  console.log('📸 Screenshot: scrolled-3000px');

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '26-04-scrolled-bottom.png') });
  console.log('📸 Screenshot: scrolled-bottom');

  // Check if nodes are actually visible on canvas
  const canvasAnalysis = await page.evaluate(() => {
    const canvas = document.querySelector('#wiTopoContainer canvas');
    if (!canvas) return { error: 'No canvas found' };
    
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 1000));
    const data = imageData.data;
    
    // Count non-black pixels (graph elements should be colored)
    let nonBlackPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      if (r > 10 || g > 10 || b > 10) nonBlackPixels++;
    }
    
    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      sampledHeight: Math.min(canvas.height, 1000),
      totalPixels: imageData.data.length / 4,
      nonBlackPixels,
      percentageRendered: ((nonBlackPixels / (imageData.data.length / 4)) * 100).toFixed(2)
    };
  });

  console.log('\n🎨 Canvas Pixel Analysis:');
  console.log(JSON.stringify(canvasAnalysis, null, 2));

  if (canvasAnalysis.nonBlackPixels > 1000) {
    console.log('✅ Graph appears to be rendered (detected colored pixels)');
  } else {
    console.log('❌ Graph may not be rendered (mostly black canvas)');
  }

  await browser.close();
  console.log('\n✅ Visual validation complete. Check screenshots in:', SCREENSHOT_DIR);
})();
