/**
 * 08-live-walkthrough.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Full step-by-step screenshot walkthrough of the Topolograph app.
 * Captures screenshots of every significant UI state.
 * Run from: 00-STEP-BY-STEP/ directory
 *   node scripts/08-live-walkthrough.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const BASE       = 'http://localhost:8081';
const SHOTS_DIR  = path.join(__dirname, '..', 'screenshots');
const OSPF_FILE  = path.join(__dirname, '..', '..', 'INPUT-FOLDER', 'ospf-database-2.txt');
const HOST_FILE  = path.join(__dirname, '..', '..', 'INPUT-FOLDER', 'Load-hosts.txt');

// Country-to-colour map (mirroring push-to-ui.py)
const COUNTRY_COLOURS = {
  ZAF:'#2ecc71', GBR:'#3498db', FRA:'#e74c3c', POR:'#e67e22',
  TAN:'#9b59b6', KEN:'#1abc9c', MOZ:'#f39c12', DRC:'#e91e63',
  LES:'#00bcd4', DJB:'#ff5722'
};

fs.mkdirSync(SHOTS_DIR, { recursive: true });

let shotIndex = 0;
async function shot(page, name) {
  shotIndex++;
  const fname = `${String(shotIndex).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path: path.join(SHOTS_DIR, fname), fullPage: false });
  console.log(`  📸  Screenshot saved: screenshots/${fname}`);
  return fname;
}

function log(step, msg) { console.log(`\n${'═'.repeat(60)}\n[STEP ${step}] ${msg}\n${'─'.repeat(60)}`); }
function info(msg)       { console.log(`  ℹ  ${msg}`); }
function ok(msg)         { console.log(`  ✅  ${msg}`); }

(async () => {
  const br  = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1 — Home page
    // ══════════════════════════════════════════════════════════════════════════
    log('B1', 'Open Topolograph home page');
    await page.goto(`${BASE}/upload-ospf-isis-lsdb`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    info(`URL: ${page.url()}`);
    await shot(page, 'B1-home-upload-page');
    ok('Home page loaded');

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2 — Upload OSPF file via web UI
    // ══════════════════════════════════════════════════════════════════════════
    log('B2', 'Upload OSPF database file via Web UI');
    const fileInput = await page.$('#inputOSPFFileID');
    if (!fileInput) throw new Error('File input #inputOSPFFileID not found');
    await fileInput.setInputFiles(OSPF_FILE);
    info(`File set: ${path.basename(OSPF_FILE)}`);
    await page.waitForTimeout(800);
    await shot(page, 'B2-file-selected');

    // Click upload button
    const uploadBtn = await page.$('input[name="upload_files_btn"]') ||
                      await page.$('button[name="upload_files_btn"]');
    if (!uploadBtn) throw new Error('Upload button not found');
    await uploadBtn.click();
    info('Upload button clicked — waiting for page reload…');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await shot(page, 'B2-after-upload');
    ok('OSPF file uploaded');

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3 — Load host mappings
    // ══════════════════════════════════════════════════════════════════════════
    log('B3', 'Upload host-to-name mapping file (Load-hosts.txt)');
    await page.goto(`${BASE}/ospf-host-to-dns-mapping`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await shot(page, 'B3-host-mapping-page');

    const hostInput = await page.$('input[type=file]');
    if (hostInput) {
      await hostInput.setInputFiles(HOST_FILE);
      await page.waitForTimeout(500);
      const submitBtn = await page.$('input[type=submit]') || await page.$('button[type=submit]');
      if (submitBtn) { await submitBtn.click(); await page.waitForLoadState('networkidle'); }
      await page.waitForTimeout(1500);
      await shot(page, 'B3-hosts-loaded');
      ok('Host file uploaded');
    } else {
      info('No file input on host mapping page (hosts may already be loaded)');
      await shot(page, 'B3-host-mapping-existing');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4 — Load the graph in the visualiser
    // ══════════════════════════════════════════════════════════════════════════
    log('B4', 'Load the graph in the topology visualiser');
    await page.goto(`${BASE}/upload-ospf-isis-lsdb`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Select graph from dropdown
    const dropdown = await page.$('select#graphTimeValue') ||
                     await page.$('select[id*="graph"]') ||
                     await page.$('select');
    if (dropdown) {
      // Pick most recent option
      const opts = await dropdown.$$('option');
      const lastOpt = opts[opts.length - 1];
      const lastVal = await lastOpt.getAttribute('value');
      if (lastVal) {
        await dropdown.selectOption(lastVal);
        info(`Selected graph: ${lastVal}`);
        await page.waitForTimeout(500);
      }
    }
    await shot(page, 'B4-graph-selected');

    // Click Load dynamic graph
    const loadBtn = await page.$('button[onclick*="upload_ospf_lsdb"]') ||
                    await page.$('input[value*="Load"]') ||
                    await page.$('button:has-text("Load")');
    if (loadBtn) {
      await loadBtn.click();
      info('Load graph clicked — waiting for vis.js render…');
      await page.waitForTimeout(4000);
    }
    await shot(page, 'B4-graph-loaded');
    ok('Graph rendered');

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 5 — Inject country data and colours into vis.js
    // ══════════════════════════════════════════════════════════════════════════
    log('B5', 'Inject country codes and colours into the live graph');

    // Build country map from host file
    const hostLines = fs.readFileSync(HOST_FILE, 'utf8').split('\n');
    const countryMap = {};
    for (const line of hostLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const country = parts[1].slice(0, 3).toUpperCase();
        countryMap[parts[0]] = country;
      }
    }
    info(`Country map built: ${Object.keys(countryMap).length} entries`);

    // Inject into vis.js DataSet
    const injected = await page.evaluate(({ map, colours }) => {
      if (typeof nodes === 'undefined' || !nodes || typeof nodes.get !== 'function') return 0;
      const updates = [];
      nodes.get().forEach(n => {
        const rid = n.label || n.id;
        const country = map[String(rid)] || null;
        const colour  = country ? colours[country] : null;
        const update  = { id: n.id, country };
        if (colour) {
          update.color = { background: colour, border: colour,
                           highlight: { background: colour, border: '#fff' } };
          update.shape = 'dot';
          update.size  = 14;
        }
        updates.push(update);
      });
      if (updates.length) nodes.update(updates);
      return updates.length;
    }, { map: countryMap, colours: COUNTRY_COLOURS });

    info(`Injected country data into ${injected} nodes`);
    await page.waitForTimeout(1500);
    await shot(page, 'B5-country-colours-injected');
    ok(`Countries and colours applied to ${injected} nodes`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 6 — Country Filter panel — open and show all countries
    // ══════════════════════════════════════════════════════════════════════════
    log('B6', 'Open Country Filter panel and show all countries');
    const cfToggle = await page.$('#cfToggle');
    if (cfToggle) {
      await cfToggle.click();
      await page.waitForTimeout(800);
      await shot(page, 'B6-filter-panel-open');
      ok('Country Filter panel opened');

      // Count checkboxes
      const cbs = await page.$$('.cfCheckbox');
      info(`${cbs.length} country checkboxes visible`);
    } else {
      info('Country Filter panel toggle not found — may need topolograph.js update');
      await shot(page, 'B6-filter-panel-missing');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 7 — Filter: Show only ZAF
    // ══════════════════════════════════════════════════════════════════════════
    log('B7', 'Filter: Show Only — ZAF (South Africa)');
    const selectNone = await page.$('#cfSelectNone');
    if (selectNone) {
      await selectNone.click();
      await page.waitForTimeout(400);

      // Check ZAF checkbox
      const zafCb = await page.$('.cfCheckbox[data-country="ZAF"]');
      if (zafCb) { await zafCb.click(); await page.waitForTimeout(300); }

      // Set mode to Show Only
      const showOnlyBtn = await page.$('.cfModeBtn[data-mode="show-only"]');
      if (showOnlyBtn) { await showOnlyBtn.click(); await page.waitForTimeout(300); }

      // Apply
      const applyBtn = await page.$('#cfApply');
      if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(1500); }

      await shot(page, 'B7-filter-show-only-ZAF');
      ok('Show Only ZAF applied');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 8 — Filter: Reset
    // ══════════════════════════════════════════════════════════════════════════
    log('B8', 'Reset filter — show all routers again');
    const resetBtn = await page.$('#cfReset');
    if (resetBtn) {
      await resetBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, 'B8-filter-reset-all');
      ok('Filter reset — all nodes visible');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 9 — Navigate to API docs
    // ══════════════════════════════════════════════════════════════════════════
    log('B9', 'API documentation page');
    await page.goto(`${BASE}/api/ui/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, 'B9-api-docs');
    ok('API docs page captured');

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 10 — Host mapping management page
    // ══════════════════════════════════════════════════════════════════════════
    log('B10', 'Host-to-DNS mapping management page');
    await page.goto(`${BASE}/ospf-host-to-dns-mapping`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, 'B10-host-mapping-management');
    ok('Host mapping page captured');

  } catch (err) {
    console.error('\n❌  Walkthrough error:', err.message);
    await shot(page, 'ERROR-state').catch(() => {});
  } finally {
    await br.close();
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Walkthrough complete. Screenshots in: screenshots/`);
    console.log(`Total screenshots: ${shotIndex}`);
    console.log('═'.repeat(60));
  }
})();
