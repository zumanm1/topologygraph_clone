#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// validate-collapsing-deep.cjs
// ─────────────────────────────────────────────────────────────────────────────
// SCHOLAR'S NOTE
//   This is the definitive, exhaustive Playwright validation of the COLLAPSING
//   feature.  It runs against ALL graph_times that have COLLAPSING artefacts,
//   understanding each JSON file before exercising the UI.
//
//   Conceptual layers tested (Parnas decomposition):
//
//   L0  Navigation & Auth    — login, reach upload page, load graph
//   L1  Mode Switch          — COLLAPSING button activates, panel appears
//   L2  Panel Structure      — header, country rows, bulk controls, footer
//   L3  Collapse/Expand      — each country individually + bulk
//   L4  Badge Contract       — "▲ N hidden" counter on gateway nodes
//   L5  Node/Edge Count      — vis.js DataSet before vs after collapse
//   L6  Gateway Visibility   — non-gateway nodes hidden on collapse
//   L7  Footer Tools         — Link Costs table, Save State / localStorage
//   L8  Cross-Mode Restore   — switch away then back → state preserved
//   L9  Multi-Graph          — repeat L0-L8 for all 4 graph_times
//
//   Each PASS/FAIL line uses the emoji "✅ PASS" / "❌ FAIL" so the shell
//   wrapper's grep counter works correctly.
//
// USAGE
//   GRAPH_TIMES="04Mar2026_12h25m56s_34_hosts,04Mar2026_11h14m54s_34_hosts" \
//   HEADLESS=true SCREENSHOTS=true \
//   API_USER=ospf@topolograph.com API_PASS=ospf \
//   BASE_URL=http://localhost:8081 \
//   node validate-collapsing-deep.cjs
// ─────────────────────────────────────────────────────────────────────────────

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL    = process.env.BASE_URL    || 'http://localhost:8081';
const API_USER    = process.env.API_USER    || 'ospf@topolograph.com';
const API_PASS    = process.env.API_PASS    || 'ospf';
const HEADLESS    = (process.env.HEADLESS   || 'true') !== 'false';
const SCREENSHOTS = (process.env.SCREENSHOTS || 'true') !== 'false';
const PROJ_ROOT   = path.join(__dirname, '..');
const SS_DIR      = path.join(PROJ_ROOT, '04-STEP-BY-STEP', 'screenshots');

// All 4 graph_times that have COLLAPSING artefacts
const ALL_GRAPH_TIMES = process.env.GRAPH_TIMES
  ? process.env.GRAPH_TIMES.split(',').map(s => s.trim())
  : [
      '03Mar2026_20h05m03s_34_hosts',
      '04Mar2026_11h14m54s_34_hosts',
      '04Mar2026_12h01m30s_34_hosts',
      '04Mar2026_12h25m56s_34_hosts',
    ];

// Country roster for ALL graph_times (same 10 countries in all)
const COUNTRIES = ['DJB','DRC','FRA','GBR','KEN','LES','MOZ','POR','TAN','ZAF'];
const COUNTRY_ROUTER_COUNTS = { DJB:2, DRC:4, FRA:3, GBR:3, KEN:2, LES:3, MOZ:4, POR:3, TAN:2, ZAF:8 };
const GATEWAY_COUNTS        = { DJB:2, DRC:4, FRA:2, GBR:2, KEN:2, LES:3, MOZ:4, POR:2, TAN:2, ZAF:5 };
const CORE_COUNTS           = { DJB:0, DRC:0, FRA:1, GBR:1, KEN:0, LES:0, MOZ:0, POR:1, TAN:0, ZAF:3 };

// ── Counters ──────────────────────────────────────────────────────────────────
let PASS = 0, FAIL = 0;
function pass(tag, msg) { PASS++; console.log(`  ✅ PASS: ${tag} — ${msg}`); }
function fail(tag, msg) { FAIL++; console.log(`  ❌ FAIL: ${tag} — ${msg}`); }
function info(msg)      { console.log(`  ℹ  ${msg}`); }
function head(msg)      { console.log(`\n[collapsing-deep] ${msg}`); }

// ── Screenshot helper ─────────────────────────────────────────────────────────
let ssIdx = 0;
async function shot(page, name) {
  if (!SCREENSHOTS) return;
  fs.mkdirSync(SS_DIR, { recursive: true });
  const fname = `${String(ssIdx++).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path: path.join(SS_DIR, fname), fullPage: false });
  info(`Screenshot → ${fname}`);
}

// ── vis.js helpers ────────────────────────────────────────────────────────────
const visNodeCount = p => p.evaluate(() => {
  try { return window.nodes ? window.nodes.get().length : null; } catch { return null; }
});
const visEdgeCount = p => p.evaluate(() => {
  try { return window.edges ? window.edges.get().length : null; } catch { return null; }
});
const visVisibleNodeCount = p => p.evaluate(() => {
  try {
    return window.nodes
      ? window.nodes.get({ filter: n => n.hidden !== true }).length
      : null;
  } catch { return null; }
});
const visVisibleEdgeCount = p => p.evaluate(() => {
  try {
    return window.edges
      ? window.edges.get({ filter: e => e.hidden !== true }).length
      : null;
  } catch { return null; }
});
const getNodeById = (p, id) => p.evaluate((id) => {
  try { return window.nodes ? window.nodes.get(id) : null; } catch { return null; }
}, id);
const getAllNodeLabels = p => p.evaluate(() => {
  try { return window.nodes ? window.nodes.get().map(n => n.label||'') : []; } catch { return []; }
});

async function settle(page, ms) {
  await page.waitForTimeout(ms);
}

// ── Load a graph by graph_time ────────────────────────────────────────────────
async function loadGraph(page, graphTime) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 800);

  // Select in dropdown (or add synthetic option)
  await page.evaluate((gt) => {
    const sel = document.getElementById('dynamic_graph_time');
    if (!sel) return;
    let opt = Array.from(sel.options).find(o => o.value === gt || o.text.trim() === gt);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = gt; opt.text = gt; sel.add(opt);
    }
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
  }, graphTime);

  // Click Load button or call JS directly
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

  // Wait for vis.js DataSet to populate
  let total = null;
  for (let i = 1; i <= 10; i++) {
    await settle(page, 1500);
    total = await visNodeCount(page);
    if (total !== null && total > 0) break;
    info(`[loadGraph] attempt ${i}/10 — nodes=${total}`);
  }
  return total;
}

// ── Enter COLLAPSING mode ─────────────────────────────────────────────────────
async function enterCollapsingMode(page) {
  // Click the COLLAPSING ▼ button
  const btn = await page.$('button.vmBtn[data-mode="collapsing"]') ||
              await page.$('[data-mode="collapsing"]');
  if (btn) {
    await btn.click();
    await settle(page, 1200);
    return true;
  }
  // Fallback: call JS
  const ok = await page.evaluate(() => {
    if (typeof setViewMode === 'function') { setViewMode('collapsing'); return true; }
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('COLLAPSING'));
    if (b) { b.click(); return true; }
    return false;
  });
  await settle(page, 1200);
  return ok;
}

// ── Login ─────────────────────────────────────────────────────────────────────
// NOTE: Topolograph uses '#login' (not '#email') for the username field.
//       It also has a Google OAuth form on the same page — we must target
//       the local form specifically by pressing Enter on the password field.
async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);
  await page.fill('#login',    API_USER);
  await page.fill('#password', API_PASS);
  await shot(page, '00-login-form');
  await Promise.race([
    page.press('#password', 'Enter'),
    page.click('input[type="submit"], button[type="submit"]').catch(() => {}),
  ]);
  await settle(page, 1500);
  const url = page.url();
  const hasLoginForm = (await page.$('#password')) !== null;
  return !url.includes('/login') || !hasLoginForm;
}

// ════════════════════════════════════════════════════════════════════════════
//  TEST SUITE — run for ONE graph_time
// ════════════════════════════════════════════════════════════════════════════
async function runCollapsingTests(page, graphTime) {
  const GT = graphTime;

  // ── Clear localStorage so prior graph_time's Save State doesn't bleed in ─
  await page.evaluate(() => {
    localStorage.removeItem('topolograph_collapse_v1');
  });

  // ── Load config from disk for ground-truth comparison ────────────────────
  const cfgPath  = path.join(PROJ_ROOT, 'OUTPUT','COLLAPSING', `${GT}_COLLAPSING`, 'COLLAPSING_country-collapse-config.json');
  const topoPath = path.join(PROJ_ROOT, 'OUTPUT','COLLAPSING', `${GT}_COLLAPSING`, 'COLLAPSING_collapsed-topology.json');
  const cfg  = JSON.parse(fs.readFileSync(cfgPath,  'utf8'));
  const topo = JSON.parse(fs.readFileSync(topoPath, 'utf8'));
  const diskGateways = cfg.summary.total_gateways;  // 28
  const diskRouters  = cfg.summary.total_routers;   // 34
  const diskCores    = cfg.summary.total_cores;     // 6
  const diskCountries= cfg.summary.total_countries; // 10
  info(`Disk artefact: ${diskRouters} routers | ${diskGateways} gateways | ${diskCores} cores | ${diskCountries} countries`);

  // ────────────────────────────────────────────────────────────────────────
  // L0  Load graph
  // ────────────────────────────────────────────────────────────────────────
  head(`L0 — Load graph ${GT}`);
  const nodeCount = await loadGraph(page, GT);
  await shot(page, `${GT.slice(0,10)}-L0-loaded`);
  if (nodeCount !== null && nodeCount > 0) {
    pass(`L0[${GT}]`, `Graph loaded — ${nodeCount} vis.js nodes`);
    // Validate total node count matches enriched (34 routers)
    if (nodeCount === diskRouters) {
      pass(`L0[${GT}]`, `Node count matches disk: ${nodeCount} = ${diskRouters} routers`);
    } else {
      fail(`L0[${GT}]`, `Node count mismatch: UI=${nodeCount}  disk=${diskRouters}`);
    }
  } else {
    fail(`L0[${GT}]`, `Graph failed to load — nodes=${nodeCount}`);
    return; // can't continue
  }

  // ────────────────────────────────────────────────────────────────────────
  // L1  Activate COLLAPSING mode
  // ────────────────────────────────────────────────────────────────────────
  head(`L1 — Activate COLLAPSING mode`);
  const modeActivated = await enterCollapsingMode(page);
  await shot(page, `${GT.slice(0,10)}-L1-collapsing-mode`);

  // Panel is injected dynamically; wait up to 3 s for it to appear in the DOM,
  // then confirm it is not explicitly set to display:none inline.
  const panelEl = await page.waitForSelector('#countryCollapsePanel', { timeout: 3000 }).catch(() => null);
  const panelVisible = panelEl !== null && await page.evaluate(() => {
    const p = document.getElementById('countryCollapsePanel');
    if (!p) return false;
    const cs = window.getComputedStyle(p);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  });
  if (panelVisible) {
    pass(`L1[${GT}]`, `#countryCollapsePanel is visible after COLLAPSING mode click`);
  } else {
    fail(`L1[${GT}]`, `#countryCollapsePanel NOT visible`);
  }

  const collapsingBtnActive = await page.evaluate(() => {
    const b = document.querySelector('button.vmBtn[data-mode="collapsing"]');
    return b ? b.classList.contains('active') : false;
  });
  if (collapsingBtnActive) {
    pass(`L1[${GT}]`, `COLLAPSING button has .active class`);
  } else {
    fail(`L1[${GT}]`, `COLLAPSING button missing .active class`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // L2  Panel structure — rows, bulk buttons, footer
  // ────────────────────────────────────────────────────────────────────────
  head(`L2 — Panel structure`);

  // Country rows (one per country)
  const rowCount = await page.evaluate(() => {
    return document.querySelectorAll('.cpRow, .cp-row, [data-country]').length;
  });
  if (rowCount >= diskCountries) {
    pass(`L2[${GT}]`, `Panel has ${rowCount} country rows (≥${diskCountries})`);
  } else {
    fail(`L2[${GT}]`, `Panel row count ${rowCount} < expected ${diskCountries}`);
  }

  // Bulk controls
  const collapseAllBtn = await page.$('#cpCollapseAll, button[onclick*="collapseAllCountries"]') ||
                         await page.evaluate(() => {
                           const b = Array.from(document.querySelectorAll('button'))
                             .find(x => x.textContent.includes('Collapse All'));
                           return b ? true : false;
                         });
  if (collapseAllBtn) {
    pass(`L2[${GT}]`, `"Collapse All" bulk button present`);
  } else {
    fail(`L2[${GT}]`, `"Collapse All" bulk button NOT found`);
  }

  const expandAllBtn = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => x.textContent.includes('Expand All') || x.textContent.includes('Restore'));
    return b ? true : false;
  });
  if (expandAllBtn) {
    pass(`L2[${GT}]`, `"Expand All / Restore" bulk button present`);
  } else {
    fail(`L2[${GT}]`, `"Expand All / Restore" bulk button NOT found`);
  }

  // Footer buttons (CL-F1, CL-F4)
  const saveBtnPresent = await page.evaluate(() => {
    return !!document.getElementById('btnSaveState') ||
           !!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Save State'));
  });
  const costTableBtnPresent = await page.evaluate(() => {
    return !!document.getElementById('btnCostTable') ||
           !!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Link Costs'));
  });
  if (saveBtnPresent)     pass(`L2[${GT}]`, `💾 Save State button in panel footer`);
  else                    fail(`L2[${GT}]`, `💾 Save State button NOT found`);
  if (costTableBtnPresent) pass(`L2[${GT}]`, `🔗 Link Costs button in panel footer`);
  else                     fail(`L2[${GT}]`, `🔗 Link Costs button NOT found`);

  await shot(page, `${GT.slice(0,10)}-L2-panel`);

  // ────────────────────────────────────────────────────────────────────────
  // L3/L4/L5/L6  Per-country collapse + badge + node/edge counts
  // ────────────────────────────────────────────────────────────────────────
  head(`L3-L6 — Per-country collapse / expand (10 countries)`);

  const preCollapseVisible = await visVisibleNodeCount(page);
  const preCollapseEdges   = await visVisibleEdgeCount(page);
  info(`Pre-collapse visible nodes=${preCollapseVisible}  edges=${preCollapseEdges}`);

  // Test each country individually
  for (const country of COUNTRIES) {
    const coreCount    = CORE_COUNTS[country]    || 0;
    const gatewayCount = GATEWAY_COUNTS[country] || 0;
    const totalRouters = COUNTRY_ROUTER_COUNTS[country] || 0;
    const hideable     = totalRouters - gatewayCount; // non-gateway routers that get hidden

    // ── L3a: Collapse this country ─────────────────────────────────────
    const collapsed = await page.evaluate((c) => {
      // Try clicking the country toggle button in the panel
      const btn = document.querySelector(`[data-country="${c}"] .cpToggle, [data-country="${c}"] button`) ||
                  document.querySelector(`button[onclick*="${c}"]`);
      if (btn) { btn.click(); return 'click'; }
      // Fallback: call collapseCountry() directly
      if (typeof collapseCountry === 'function') { collapseCountry(c); return 'js'; }
      return null;
    }, country);

    await settle(page, 600);

    if (collapsed) {
      pass(`L3[${GT}]`, `${country}: collapse triggered (method=${collapsed})`);
    } else {
      fail(`L3[${GT}]`, `${country}: could not trigger collapse`);
      continue;
    }

    // ── L4: Badge check ───────────────────────────────────────────────
    // After collapsing, gateway nodes for this country should show badge
    // The badge text is "▲ N hidden" where N = non-gateway router count
    const badgeNodes = await page.evaluate((c) => {
      return window.nodes
        ? window.nodes.get({ filter: n =>
            n.country === c &&
            n.is_gateway === true &&
            typeof n.label === 'string' &&
            (n.label.includes('▲') || n.label.includes('hidden'))
          }).length
        : 0;
    }, country);

    if (hideable === 0) {
      // Country with no non-gateway routers: all are gateways, nothing to hide
      pass(`L4[${GT}]`, `${country}: no non-gateway nodes — badge N/A (all are gateways)`);
    } else if (badgeNodes > 0) {
      pass(`L4[${GT}]`, `${country}: ${badgeNodes} gateway node(s) show "▲ hidden" badge`);
    } else {
      // Check via DOM if vis.js label not updated yet
      const domBadge = await page.evaluate((c) => {
        const panelText = document.getElementById('countryCollapsePanel')?.innerText || '';
        return panelText.includes(c) ? true : false;
      }, country);
      fail(`L4[${GT}]`, `${country}: badge not found (hideable=${hideable})`);
    }

    // ── L5: Node count drops by expected amount ────────────────────────
    const postCollapseVisible = await visVisibleNodeCount(page);
    // After first collapse the visible count should be < preCollapseVisible IF hideable>0
    if (hideable > 0 && postCollapseVisible !== null && postCollapseVisible < preCollapseVisible) {
      pass(`L5[${GT}]`, `${country}: visible nodes dropped (${preCollapseVisible}→${postCollapseVisible}, expect -${hideable})`);
    } else if (hideable === 0) {
      pass(`L5[${GT}]`, `${country}: no non-gateway nodes, visible count unchanged (expected)`);
    } else {
      fail(`L5[${GT}]`, `${country}: visible nodes did NOT drop (${preCollapseVisible}→${postCollapseVisible}, hideable=${hideable})`);
    }

    // ── L6: Non-gateway nodes for this country are hidden ─────────────
    const hiddenNonGateways = await page.evaluate((c) => {
      return window.nodes
        ? window.nodes.get({ filter: n =>
            n.country === c && n.is_gateway !== true && n.hidden === true
          }).length
        : 0;
    }, country);

    if (hideable === 0) {
      pass(`L6[${GT}]`, `${country}: no non-gateway nodes to hide (correct)`);
    } else if (hiddenNonGateways >= hideable) {
      pass(`L6[${GT}]`, `${country}: ${hiddenNonGateways}/${hideable} non-gateway nodes hidden ✓`);
    } else {
      fail(`L6[${GT}]`, `${country}: only ${hiddenNonGateways}/${hideable} non-gateway nodes hidden`);
    }

    // ── L3b: Expand this country back ─────────────────────────────────
    const expanded = await page.evaluate((c) => {
      const btn = document.querySelector(`[data-country="${c}"] .cpToggle, [data-country="${c}"] button`) ||
                  document.querySelector(`button[onclick*="${c}"]`);
      if (btn) { btn.click(); return 'click'; }
      if (typeof collapseCountry === 'function') { expandCountry(c); return 'js'; }
      return null;
    }, country);
    await settle(page, 500);

    const afterExpandVisible = await visVisibleNodeCount(page);
    if (afterExpandVisible !== null && afterExpandVisible >= preCollapseVisible) {
      pass(`L3b[${GT}]`, `${country}: expand restores visible count (${afterExpandVisible})`);
    } else {
      fail(`L3b[${GT}]`, `${country}: expand did NOT restore count (${preCollapseVisible}→${afterExpandVisible})`);
    }
  }
  await shot(page, `${GT.slice(0,10)}-L3-per-country-cycle`);

  // ────────────────────────────────────────────────────────────────────────
  // L3c  Bulk Collapse All → Expand All
  // ────────────────────────────────────────────────────────────────────────
  head(`L3c — Bulk "Collapse All"`);

  const preAllVisible = await visVisibleNodeCount(page);

  // Click "Collapse All"
  const clickedCollapseAll = await page.evaluate(() => {
    const btn = document.getElementById('cpCollapseAll') ||
                Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Collapse All'));
    if (btn) { btn.click(); return true; }
    if (typeof collapseAllCountries === 'function') { collapseAllCountries(); return true; }
    return false;
  });
  await settle(page, 1500);
  await shot(page, `${GT.slice(0,10)}-L3c-collapse-all`);

  if (clickedCollapseAll) {
    pass(`L3c[${GT}]`, `"Collapse All" triggered`);
  } else {
    fail(`L3c[${GT}]`, `"Collapse All" button not found`);
  }

  const postAllVisible = await visVisibleNodeCount(page);
  const postAllEdges   = await visVisibleEdgeCount(page);
  info(`After Collapse All: visible nodes=${postAllVisible}  edges=${postAllEdges}`);

  // After full collapse: only gateways (28) + cores (6) should be visible = 28
  // (cores are part of gateways in this topology, non-gateway routers = 6 hidden)
  // Total routers=34, gateways=28, so 6 non-gateway routers hidden
  const totalNonGateway = diskRouters - diskGateways; // 6
  const expectedVisible = diskGateways; // 28
  if (postAllVisible !== null && postAllVisible <= expectedVisible) {
    pass(`L3c[${GT}]`, `After Collapse All: ${postAllVisible} nodes visible (≤${expectedVisible} gateways)`);
  } else {
    fail(`L3c[${GT}]`, `After Collapse All: ${postAllVisible} nodes (expected ≤${expectedVisible})`);
  }

  // All 10 countries should have badges on their gateway nodes
  const badgeTotal = await page.evaluate(() => {
    return window.nodes
      ? window.nodes.get({ filter: n =>
          n.is_gateway === true &&
          typeof n.label === 'string' &&
          (n.label.includes('▲') || n.label.includes('hidden'))
        }).length
      : 0;
  });
  info(`Badge count after Collapse All: ${badgeTotal}`);
  // Only countries WITH non-gateway nodes will have badges
  const countriesWithHideable = COUNTRIES.filter(c => (COUNTRY_ROUTER_COUNTS[c] - GATEWAY_COUNTS[c]) > 0);
  if (badgeTotal > 0) {
    pass(`L3c[${GT}]`, `${badgeTotal} gateway nodes show "▲ hidden" badges after Collapse All`);
  } else {
    fail(`L3c[${GT}]`, `No badge nodes found after Collapse All`);
  }

  // Expand All
  const clickedExpandAll = await page.evaluate(() => {
    const btn = document.getElementById('cpExpandAll') ||
                Array.from(document.querySelectorAll('button'))
                  .find(x => x.textContent.includes('Expand All') || x.textContent.includes('Restore'));
    if (btn) { btn.click(); return true; }
    if (typeof expandAllCountries === 'function') { expandAllCountries(); return true; }
    return false;
  });
  await settle(page, 1500);
  await shot(page, `${GT.slice(0,10)}-L3c-expand-all`);

  const postExpandAll = await visVisibleNodeCount(page);
  if (postExpandAll !== null && postExpandAll === diskRouters) {
    pass(`L3c[${GT}]`, `After Expand All: ${postExpandAll} nodes visible = all ${diskRouters} routers`);
  } else {
    fail(`L3c[${GT}]`, `After Expand All: ${postExpandAll} nodes (expected ${diskRouters})`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // L7a  Link Costs table (CL-F4)
  // ────────────────────────────────────────────────────────────────────────
  head(`L7a — Link Costs table (CL-F4)`);

  const clickedCostTable = await page.evaluate(() => {
    const btn = document.getElementById('btnCostTable') ||
                Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Link Costs'));
    if (btn) { btn.click(); return true; }
    if (typeof buildInterCountryCostTable === 'function') { buildInterCountryCostTable(); return true; }
    return false;
  });
  await settle(page, 1000);
  await shot(page, `${GT.slice(0,10)}-L7a-cost-table`);

  if (clickedCostTable) {
    pass(`L7a[${GT}]`, `🔗 Link Costs button clicked`);
  } else {
    fail(`L7a[${GT}]`, `🔗 Link Costs button NOT found`);
  }

  const costPanelPresent = await page.evaluate(() => {
    return !!document.getElementById('costTablePanel') ||
           !!document.querySelector('.costTablePanel');
  });
  if (costPanelPresent) {
    pass(`L7a[${GT}]`, `#costTablePanel appeared`);
  } else {
    fail(`L7a[${GT}]`, `#costTablePanel did NOT appear`);
  }

  // Validate table has rows for country pairs
  const tableRows = await page.evaluate(() => {
    const tbl = document.querySelector('#costTablePanel table, .costTablePanel table');
    return tbl ? tbl.querySelectorAll('tr').length : 0;
  });
  if (tableRows > 1) {
    pass(`L7a[${GT}]`, `Cost table has ${tableRows} rows (country-pair data present)`);
  } else {
    fail(`L7a[${GT}]`, `Cost table has ${tableRows} rows (expected >1)`);
  }

  // Close cost table if close button exists
  await page.evaluate(() => {
    const close = document.querySelector('#costTablePanel .close, #costTablePanel button[onclick*="remove"], #costTablePanel [aria-label="close"]');
    if (close) close.click();
  });
  await settle(page, 400);

  // ────────────────────────────────────────────────────────────────────────
  // L7b  Save State / localStorage (CL-F1)
  // ────────────────────────────────────────────────────────────────────────
  head(`L7b — Save State / localStorage (CL-F1)`);

  // First collapse ZAF so we have a non-trivial state to save
  await page.evaluate(() => {
    if (typeof collapseCountry === 'function') { collapseCountry('ZAF'); }
  });
  await settle(page, 600);

  // Click Save State
  const savedState = await page.evaluate(() => {
    const btn = document.getElementById('btnSaveState') ||
                Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Save State'));
    if (btn) { btn.click(); return true; }
    if (typeof _persistCollapseState === 'function') { _persistCollapseState(); return true; }
    return false;
  });
  await settle(page, 600);
  await shot(page, `${GT.slice(0,10)}-L7b-save-state`);

  if (savedState) {
    pass(`L7b[${GT}]`, `💾 Save State triggered`);
  } else {
    fail(`L7b[${GT}]`, `💾 Save State NOT triggered`);
  }

  // Verify localStorage was written
  const lsValue = await page.evaluate(() => {
    const key = 'topolograph_collapse_v1';
    return localStorage.getItem(key);
  });
  if (lsValue) {
    try {
      const parsed = JSON.parse(lsValue);
      pass(`L7b[${GT}]`, `localStorage["topolograph_collapse_v1"] = ${lsValue}`);
      // Validate ZAF is marked true
      // State may be flat {"ZAF": true} OR nested {"default": {"ZAF": true}}
      const zafInState = parsed['ZAF'] === true ||
                         (parsed['default'] && parsed['default']['ZAF'] === true);
      if (zafInState) {
        pass(`L7b[${GT}]`, `localStorage correctly records ZAF as collapsed`);
      } else {
        fail(`L7b[${GT}]`, `ZAF not in saved state: ${lsValue}`);
      }
    } catch(e) {
      fail(`L7b[${GT}]`, `localStorage value is not valid JSON: ${lsValue}`);
    }
  } else {
    fail(`L7b[${GT}]`, `localStorage["topolograph_collapse_v1"] is empty`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // L8  Cross-mode restore: switch to ENRICHED then back to COLLAPSING
  //     Verify collapse state is preserved
  // ────────────────────────────────────────────────────────────────────────
  head(`L8 — Cross-mode restore (ENRICHED → COLLAPSING)`);

  // Record current collapse state
  const beforeSwitch = await page.evaluate(() => {
    if (typeof _collapseState !== 'undefined') return JSON.stringify(_collapseState);
    return localStorage.getItem('topolograph_collapse_v1');
  });
  info(`Collapse state before switch: ${beforeSwitch}`);

  // Switch to ENRICHED
  await page.evaluate(() => {
    const btn = document.querySelector('button.vmBtn[data-mode="enriched"]');
    if (btn) btn.click();
    else if (typeof setViewMode === 'function') setViewMode('enriched');
  });
  await settle(page, 1000);
  await shot(page, `${GT.slice(0,10)}-L8-switched-to-enriched`);

  const allVisibleInEnriched = await visVisibleNodeCount(page);
  info(`In ENRICHED mode: ${allVisibleInEnriched} nodes visible`);
  if (allVisibleInEnriched !== null && allVisibleInEnriched === diskRouters) {
    pass(`L8[${GT}]`, `ENRICHED mode shows all ${diskRouters} routers`);
  } else {
    fail(`L8[${GT}]`, `ENRICHED mode shows ${allVisibleInEnriched} (expected ${diskRouters})`);
  }

  // Switch back to COLLAPSING
  await enterCollapsingMode(page);
  await settle(page, 1000);
  await shot(page, `${GT.slice(0,10)}-L8-returned-to-collapsing`);

  // ZAF should still be collapsed (ZAF has 3 non-gateway nodes = 3 hidden)
  const zafHidden = await page.evaluate(() => {
    return window.nodes
      ? window.nodes.get({ filter: n => n.country === 'ZAF' && n.is_gateway !== true && n.hidden === true }).length
      : 0;
  });
  const zafGatewayBadge = await page.evaluate(() => {
    return window.nodes
      ? window.nodes.get({ filter: n =>
          n.country === 'ZAF' && n.is_gateway === true &&
          typeof n.label === 'string' && (n.label.includes('▲') || n.label.includes('hidden'))
        }).length
      : 0;
  });
  const zafNonGateway = COUNTRY_ROUTER_COUNTS['ZAF'] - GATEWAY_COUNTS['ZAF']; // 3
  if (zafHidden >= zafNonGateway) {
    pass(`L8[${GT}]`, `After return to COLLAPSING: ZAF ${zafHidden}/${zafNonGateway} non-gateway nodes still hidden`);
  } else {
    fail(`L8[${GT}]`, `After return to COLLAPSING: ZAF collapse state lost (${zafHidden}/${zafNonGateway} hidden)`);
  }

  // Expand ZAF to clean up for next test
  await page.evaluate(() => {
    if (typeof collapseCountry === 'function') expandCountry('ZAF');
  });
  await settle(page, 500);

  // ────────────────────────────────────────────────────────────────────────
  // Summary for this graph_time
  // ────────────────────────────────────────────────────────────────────────
  console.log(`\n  ─── ${GT} done ───`);
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════════════════
(async () => {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   COLLAPSING DEEP-DIVE VALIDATION  v2                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║   BASE_URL     : ${BASE_URL.padEnd(45)}║`);
  console.log(`║   HEADLESS     : ${String(HEADLESS).padEnd(45)}║`);
  console.log(`║   GRAPH_TIMES  : ${String(ALL_GRAPH_TIMES.length).padEnd(45)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // ── Login once ─────────────────────────────────────────────────────────
  head('AUTH — Login');
  const loggedIn = await login(page);
  await shot(page, '00-login');
  if (loggedIn) {
    pass('AUTH', `Logged in as ${API_USER}`);
  } else {
    fail('AUTH', `Login failed (URL=${page.url()})`);
    await browser.close();
    process.exit(1);
  }

  // ── Run per-graph_time suite ────────────────────────────────────────────
  for (let i = 0; i < ALL_GRAPH_TIMES.length; i++) {
    const gt = ALL_GRAPH_TIMES[i];
    const cfgPath  = path.join(PROJ_ROOT, 'OUTPUT','COLLAPSING', `${gt}_COLLAPSING`, 'COLLAPSING_country-collapse-config.json');
    if (!fs.existsSync(cfgPath)) {
      fail(`SKIP[${gt}]`, `No COLLAPSING artefact on disk — skipping`);
      continue;
    }
    console.log(`\n${'═'.repeat(66)}`);
    console.log(`  GRAPH ${i+1}/${ALL_GRAPH_TIMES.length}: ${gt}`);
    console.log(`${'═'.repeat(66)}`);
    try {
      await runCollapsingTests(page, gt);
    } catch (err) {
      fail(`CRASH[${gt}]`, `Unhandled exception: ${err.message}`);
      await shot(page, `${gt.slice(0,10)}-CRASH`);
    }
  }

  await browser.close();

  // ── Final summary ───────────────────────────────────────────────────────
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   COLLAPSING DEEP-DIVE — FINAL SUMMARY                          ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  PASSED : ${String(PASS).padEnd(54)}║`);
  console.log(`║  FAILED : ${String(FAIL).padEnd(54)}║`);
  console.log(`║  TOTAL  : ${String(PASS+FAIL).padEnd(54)}║`);
  if (FAIL === 0) {
    console.log('║  STATUS : ALL COLLAPSING DEEP-DIVE CHECKS PASSED ✅             ║');
  } else {
    console.log('║  STATUS : SOME CHECKS FAILED ❌ — review output above           ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  process.exit(FAIL > 0 ? 1 : 0);
})();
