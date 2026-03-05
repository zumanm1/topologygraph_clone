#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const SS   = '/Users/macbook/Documents/OSPF-DATABASE-TEST/04-STEP-BY-STEP/screenshots';

const GT = '04Mar2026_12h25m56s_34_hosts';

(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });

  // Login
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.fill('#login', 'ospf@topolograph.com');
  await page.fill('#password', 'ospf');
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);

  // Load graph
  await page.goto('http://localhost:8081/upload-ospf-isis-lsdb', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(function(gt) {
    var sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    var opt = Array.from(sel.options).find(function(o) { return o.value===gt || o.text.trim()===gt; });
    if (!opt) { opt=document.createElement('option'); opt.value=gt; opt.text=gt; sel.add(opt); }
    sel.value = opt.value; sel.dispatchEvent(new Event('change'));
  }, GT);
  var lb = await page.$('input#load_graph_button');
  if (lb) await lb.click();
  for (var i=0; i<12; i++) {
    await page.waitForTimeout(1500);
    var n = await page.evaluate(function() { try { return nodes ? nodes.get().length : 0; } catch(e) { return 0; } });
    if (n > 0) { console.log('Graph loaded: ' + n + ' nodes'); break; }
  }

  // ── Review 1: Cost Matrix zoomed ──────────────────────────────────────────
  await page.evaluate(function() { buildOspfCostMatrix(); });
  await page.waitForTimeout(1500);
  var panel = await page.$('#ospfCostMatrixPanel');
  if (panel) {
    var box = await panel.boundingBox();
    await page.screenshot({
      path: path.join(SS, '55-s3-cost-matrix-zoom.png'),
      clip: { x: Math.max(0, box.x-5), y: Math.max(0, box.y-5),
              width: Math.min(box.width+10, 1200), height: Math.min(box.height+10, 700) }
    });
    console.log('Cost Matrix zoom screenshot saved');
  }

  // ── Review 2: What-If with analysis result ────────────────────────────────
  await page.evaluate(function() { buildOspfWhatIf(); });
  await page.waitForTimeout(600);
  // Set first edge, new cost, run analysis
  await page.evaluate(function() {
    var picker = document.getElementById('wiEdgePicker');
    var newCostEl = document.getElementById('wiNewCost');
    if (picker && picker.options.length > 5 && newCostEl) {
      picker.selectedIndex = 5;  // pick a middle edge
      picker.dispatchEvent(new Event('change'));
      newCostEl.value = 1;  // dramatic cost drop to force route changes
    }
  });
  await page.waitForTimeout(200);
  await page.evaluate(function() { _runWhatIfAnalysis(); });
  await page.waitForTimeout(2000);
  var wi = await page.$('#ospfWhatIfPanel');
  if (wi) {
    var box2 = await wi.boundingBox();
    await page.screenshot({
      path: path.join(SS, '56-s3-what-if-zoom.png'),
      clip: { x: Math.max(0, box2.x-5), y: Math.max(0, box2.y-5),
              width: Math.min(box2.width+10, 500), height: Math.min(box2.height+10, 750) }
    });
    console.log('What-If zoom screenshot saved');
  }

  // ── Review 3: Hostname Upload panel zoomed ────────────────────────────────
  await page.evaluate(function() { buildHostnameUploadPanel(); });
  await page.waitForTimeout(500);
  var hp = await page.$('#hostnameUploadPanel');
  if (hp) {
    var box3 = await hp.boundingBox();
    await page.screenshot({
      path: path.join(SS, '57-s3-hostname-zoom.png'),
      clip: { x: Math.max(0, box3.x-5), y: Math.max(0, box3.y-5),
              width: Math.min(box3.width+10, 700), height: Math.min(box3.height+10, 600) }
    });
    console.log('Hostname Upload zoom screenshot saved');
  }

  await b.close();
  console.log('All review screenshots done.');
})();
