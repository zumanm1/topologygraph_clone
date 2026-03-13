'use strict';
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const USER     = process.env.API_USER  || 'ospf@topolograph.com';
const PASS     = process.env.API_PASS  || 'ospf';
const TARGET   = '11Mar2026_21h17m14s_84_hosts';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(500);
  await page.fill('#login', USER);
  await page.fill('#password', PASS);
  await page.press('#password', 'Enter');
  await page.waitForTimeout(2000);

  await page.goto(`${BASE_URL}/change-planner`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  // Wait for dropdown
  await page.waitForFunction(
    () => document.querySelector('#cpGraphTime') && document.querySelector('#cpGraphTime').options.length > 1,
    { timeout: 15000 }
  );
  await page.selectOption('#cpGraphTime', TARGET);

  // Wait for topology
  await page.waitForFunction(
    () => { const el = document.getElementById('cpStatus'); return el && el.textContent.includes('nodes'); },
    { timeout: 30000 }
  );
  await page.waitForTimeout(1000);

  // Find edges that cross country boundaries
  const result = await page.evaluate(() => {
    if (typeof _cpNodes === 'undefined' || typeof _cpEdges === 'undefined') return null;
    var nodeMap = {};
    _cpNodes.forEach(function(n) { nodeMap[String(n.id)] = n; });

    var crossEdges = [];
    _cpEdges.forEach(function(e) {
      var nFrom = nodeMap[String(e.from)];
      var nTo   = nodeMap[String(e.to)];
      if (!nFrom || !nTo) return;
      var pFrom = KSP_parseAtype(nFrom.label || '');
      var pTo   = KSP_parseAtype(nTo.label   || '');
      if (pFrom && pTo && pFrom.country !== pTo.country) {
        crossEdges.push({
          id: e.id,
          from: nFrom.label || String(e.from),
          to:   nTo.label   || String(e.to),
          fromCountry: pFrom.country,
          toCountry:   pTo.country,
          weight: e.weight || e.cost || 1
        });
      }
    });
    // Also return all node labels to understand the topology
    var atypeLabels = _cpNodes
      .map(function(n) { return n.label || ''; })
      .filter(function(l) { return KSP_parseAtype(l) !== null; })
      .slice(0, 10);

    return { crossEdges: crossEdges.slice(0, 10), atypeLabels: atypeLabels };
  });

  console.log('A-type node labels (sample):', JSON.stringify(result.atypeLabels));
  console.log('Cross-country edges:', JSON.stringify(result.crossEdges, null, 2));

  await browser.close();
})();
