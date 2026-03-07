#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const GRAPH_TIME = process.env.GRAPH_TIME || '07Mar2026_19h26m35s_54_hosts';

let PASS = 0;
let FAIL = 0;

function pass(tag, msg) {
  PASS++;
  console.log(`  ✅ PASS [${tag}]: ${msg}`);
}

function fail(tag, msg) {
  FAIL++;
  console.log(`  ❌ FAIL [${tag}]: ${msg}`);
}

function info(msg) {
  console.log(`  ℹ  ${msg}`);
}

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
    let opt = Array.from(sel.options).find((o) => o.value === gt || o.text.trim() === gt);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = gt;
      opt.text = gt;
      sel.add(opt);
    }
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
  }, graphTime);
  const loadBtn = await page.$('input#load_graph_button') ||
                  await page.$('input[onclick*="upload_ospf_lsdb"]') ||
                  await page.$('button[onclick*="upload_ospf_lsdb"]');
  if (loadBtn) {
    await loadBtn.click();
  } else {
    await page.evaluate((gt) => {
      if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt);
    }, graphTime);
  }
  for (let i = 0; i < 14; i++) {
    await settle(page, 1000);
    const total = await page.evaluate(() => {
      try {
        return typeof nodes !== 'undefined' && nodes ? nodes.get().length : 0;
      } catch (error) {
        return 0;
      }
    });
    if (total > 0) return total;
  }
  return 0;
}

async function summarizeLiveState(page) {
  return page.evaluate(() => {
    const allNodes = typeof nodes !== 'undefined' && nodes ? nodes.get() : [];
    const classified = allNodes.filter((node) => {
      const country = String(node.country || node.group || '').toUpperCase().trim();
      return country && country !== 'UNK';
    }).length;
    const hostnameNonEmpty = allNodes.filter((node) => String(node.hostname || '').trim()).length;
    const gateways = allNodes.filter((node) => node.is_gateway === true).length;
    const countries = Array.from(new Set(allNodes.map((node) => String(node.country || node.group || '').toUpperCase().trim()).filter(Boolean)));
    const hydration = typeof window.__topolographCountryHydration === 'object' && window.__topolographCountryHydration
      ? window.__topolographCountryHydration
      : null;
    return {
      node_count: allNodes.length,
      classified_count: classified,
      hostname_non_empty: hostnameNonEmpty,
      gateway_true: gateways,
      countries,
      hydration
    };
  });
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   Country Metadata Recovery Regression                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  info(`Graph under test: ${GRAPH_TIME}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const ok = await login(page);
    if (!ok) {
      fail('AUTH', `Login failed for ${API_USER}`);
      process.exit(1);
    }
    pass('AUTH', `Logged in as ${API_USER}`);
    const total = await loadGraph(page, GRAPH_TIME);
    if (!total) {
      fail('LOAD', `Graph ${GRAPH_TIME} did not load`);
      process.exit(1);
    }
    pass('LOAD', `Graph loaded with ${total} nodes`);
    await settle(page, 4500);
    const beforeMode = await summarizeLiveState(page);
    info(`Recovered state: classified=${beforeMode.classified_count}, hostnames=${beforeMode.hostname_non_empty}, gateways=${beforeMode.gateway_true}, countries=${beforeMode.countries.length}`);

    if (beforeMode.node_count === 54) {
      pass('META', 'Recovered graph kept the full 54-node topology');
    } else {
      fail('META', `Expected 54 nodes after recovery, saw ${beforeMode.node_count}`);
    }

    if (beforeMode.classified_count >= 30) {
      pass('META', `Recovered classified country metadata for ${beforeMode.classified_count} nodes`);
    } else {
      fail('META', `Expected at least 30 classified nodes after recovery, saw ${beforeMode.classified_count}`);
    }

    if (beforeMode.hostname_non_empty === beforeMode.node_count) {
      pass('META', `Recovered hostnames for all ${beforeMode.hostname_non_empty} nodes`);
    } else {
      fail('META', `Expected hostname coverage for all nodes, saw ${beforeMode.hostname_non_empty}/${beforeMode.node_count}`);
    }

    if (beforeMode.gateway_true >= 30) {
      pass('META', `Recovered gateway roles for ${beforeMode.gateway_true} nodes`);
    } else {
      fail('META', `Expected at least 30 gateways after recovery, saw ${beforeMode.gateway_true}`);
    }

    if (beforeMode.countries.length >= 10) {
      pass('META', `Recovered a multi-country topology (${beforeMode.countries.length} countries)`);
    } else {
      fail('META', `Expected at least 10 countries after recovery, saw ${beforeMode.countries.length}`);
    }

    if (beforeMode.hydration && beforeMode.hydration.status === 'ready') {
      pass('HYDRATE', `Hydration reached ready for ${GRAPH_TIME}`);
    } else {
      fail('HYDRATE', `Expected hydration ready state, saw ${JSON.stringify(beforeMode.hydration || null)}`);
    }

    if (beforeMode.hydration && beforeMode.hydration.graphTime === GRAPH_TIME) {
      pass('HYDRATE', `Hydration state is keyed to ${GRAPH_TIME}`);
    } else {
      fail('HYDRATE', `Hydration graphTime mismatch: ${JSON.stringify(beforeMode.hydration || null)}`);
    }

    await page.evaluate(() => {
      if (typeof setViewMode === 'function') setViewMode('collapsing');
    });
    await settle(page, 1800);
    const collapsingState = await page.evaluate(() => {
      const panel = document.getElementById('countryCollapsePanel');
      const rows = panel ? panel.querySelectorAll('.cpRow').length : 0;
      const style = panel ? window.getComputedStyle(panel) : null;
      return {
        panel_exists: !!panel,
        panel_visible: !!(panel && style && style.display !== 'none' && style.visibility !== 'hidden'),
        row_count: rows,
        view_mode: typeof _viewMode !== 'undefined' ? _viewMode : ''
      };
    });

    if (collapsingState.view_mode === 'collapsing') {
      pass('MODE', 'View mode switched to collapsing');
    } else {
      fail('MODE', `Expected view_mode=collapsing, saw ${collapsingState.view_mode}`);
    }

    if (collapsingState.panel_exists && collapsingState.panel_visible) {
      pass('MODE', 'Country collapse panel is present and visible');
    } else {
      fail('MODE', `Expected visible collapse panel, saw ${JSON.stringify(collapsingState)}`);
    }

    if (collapsingState.row_count >= 10) {
      pass('MODE', `Collapse panel rendered ${collapsingState.row_count} country rows`);
    } else {
      fail('MODE', `Expected at least 10 collapse panel rows, saw ${collapsingState.row_count}`);
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║   Country Metadata Recovery — FINAL SUMMARY                    ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log(`║  PASSED : ${String(PASS).padEnd(52)}║`);
    console.log(`║  FAILED : ${String(FAIL).padEnd(52)}║`);
    console.log(`║  STATUS : ${FAIL === 0 ? 'RECOVERY REGRESSION PASSED ✅' : 'RECOVERY REGRESSION FAILED ❌'.padEnd(52)}║`);
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    if (FAIL > 0) {
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
