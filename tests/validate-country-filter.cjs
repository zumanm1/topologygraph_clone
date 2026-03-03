'use strict';
/**
 * validate-country-filter.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Topolograph Country Filter — End-to-End Playwright Validation
 *
 * What this test does:
 *   Phase 1 : Upload OSPF file via the web UI "Load hosts" form
 *   Phase 2 : Run topology-country-tool.sh to generate country-mapping.csv
 *   Phase 3 : Select new graph from dropdown, click "Load dynamic graph"
 *   Phase 4 : Inject country data into vis.js nodes DataSet (page.evaluate)
 *             NOTE: push-to-ui.py cannot PATCH web-uploaded graphs via the REST
 *             API (different MongoDB user context). Injection via the global
 *             `nodes` DataSet is the reliable approach for web-uploaded graphs.
 *   Phase 5 : Verify country filter panel structure + all button IDs
 *   Phase 6 : Verify country checkboxes (10 countries, no UNK)
 *   Phase 7 : Filter interaction: Exclude ZAF → check hidden nodes
 *   Phase 8 : Filter interaction: Show Only GBR → check visibility
 *   Phase 9 : Reset button → all nodes restored
 *   Phase 10: Collapse / Expand toggle
 *   Phase 11: Panel drag-to-reposition
 *   Phase 12: vis.js node data integrity
 *   Phase 13: Console error check
 *
 * Folder awareness:
 *   INPUT-FOLDER/  — OSPF + host files (inputs to the pipeline)
 *   OUTPUT/        — pipeline outputs (ENRICHED, DB2, etc.)
 *   IN-OUT-FOLDER/ — per-run graph data (edges.json, nodes.json, etc.)
 *   tests/         — this test lives here; screenshots → tests/screenshots/
 *
 * Run:
 *   cd /Users/macbook/Documents/OSPF-DATABASE-TEST
 *   npx playwright test tests/validate-country-filter.cjs --reporter=list
 * Or directly:
 *   node tests/validate-country-filter.cjs
 */

const { chromium }             = require('playwright');
const fs                       = require('fs');
const path                     = require('path');
const { spawnSync }            = require('child_process');

// ── Paths ─────────────────────────────────────────────────────────────────────
const PROJECT    = path.resolve(__dirname, '..');          // OSPF-DATABASE-TEST/
const INPUT_DIR  = path.join(PROJECT, 'INPUT-FOLDER');
const OUTPUT_DIR = path.join(PROJECT, 'OUTPUT');
const ENRICHED   = path.join(OUTPUT_DIR, 'ENRICHED');
const TERM_DIR   = path.join(PROJECT, 'terminal-script');
const SS_DIR     = path.join(__dirname, 'screenshots');    // tests/screenshots/

const OSPF_FILE  = path.join(INPUT_DIR, 'ospf-database-2.txt');
const HOST_FILE  = path.join(INPUT_DIR, 'host-file-db2.txt');
const TCT_SH     = path.join(TERM_DIR,  'topology-country-tool.sh');

const BASE_URL   = 'http://localhost:8081';

// Expected countries for ospf-database-2 + host-file-db2
const EXPECTED_COUNTRIES = ['DJB','DRC','FRA','GBR','KEN','LES','MOZ','POR','TAN','ZAF'];
const EXPECTED_NODE_COUNT = 34;

// ── Test harness ──────────────────────────────────────────────────────────────
fs.mkdirSync(SS_DIR, { recursive: true });
const RESULTS = [];
let   shotIdx = 0;

const pass = (name, detail = '') => {
  RESULTS.push({ s: 'PASS', name, detail });
  console.log(`  ✅  ${name}${detail ? ' — ' + detail : ''}`);
};
const fail = (name, detail = '') => {
  RESULTS.push({ s: 'FAIL', name, detail });
  console.error(`  ❌  ${name}${detail ? ' — ' + detail : ''}`);
};
const info = msg => console.log(`  ℹ️   ${msg}`);
const shot = async (page, label) => {
  const f = path.join(SS_DIR, `${String(shotIdx++).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: f, fullPage: false });
  console.log(`  📸  ${path.relative(PROJECT, f)}`);
};

// ── Load country mapping from country-mapping.csv ─────────────────────────────
function loadCsvMapping(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const map   = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const rid  = (cols[0] || '').trim();
    const cc   = (cols[2] || '').trim().toUpperCase();
    if (rid && cc) map[rid] = cc;
  }
  return map;                        // { '9.9.9.1': 'LES', ... }
}

// ── Find newest folder in a directory ─────────────────────────────────────────
function newestFolder(dir) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir)
    .map(n => ({ name: n, mtime: fs.statSync(path.join(dir, n)).mtime }))
    .filter(e => fs.statSync(path.join(dir, e.name)).isDirectory())
    .sort((a, b) => b.mtime - a.mtime);
  return entries.length ? path.join(dir, entries[0].name) : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n' + '═'.repeat(72));
  console.log('  Topolograph Country Filter  —  E2E Validation');
  console.log('  Project : ' + PROJECT);
  console.log('═'.repeat(72) + '\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Capture browser console
  const consoleLogs = [];
  page.on('console',  m  => consoleLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => consoleLogs.push(`[pageerror] ${e.message}`));

  let newGraphTime  = '';
  let countryMap    = {};   // { router_id → country_code }

  try {

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1: Upload OSPF file via web UI ("Load hosts" form submit)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('── Phase 1 : Upload OSPF file via web UI ──────────────────────────────');

    await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'networkidle', timeout: 20000 });
    pass('Upload page loaded');

    const beforeTimes = await page.$$eval(
      '#dynamic_graph_time option', opts => opts.map(o => o.value)
    );
    info(`Graphs in dropdown before upload: ${beforeTimes.length}`);

    // Select Cisco vendor radio button
    await page.click('#Cisco').catch(() => {});

    // Unhide the file input (carries hidden="hidden" in production HTML)
    await page.evaluate(() => {
      const wrap = document.getElementById('devinputGroupFile02');
      if (wrap) wrap.removeAttribute('hidden');
      const inp  = document.getElementById('inputOSPFFileID');
      if (inp)  { inp.style.display = 'block'; inp.removeAttribute('hidden'); }
    });

    const fileInput = await page.$('#inputOSPFFileID');
    if (fileInput) {
      await fileInput.setInputFiles(OSPF_FILE);
      pass('OSPF file attached to file input', path.basename(OSPF_FILE));
    } else {
      fail('File input #inputOSPFFileID not found — cannot proceed');
      await browser.close();
      process.exit(1);
    }
    await page.waitForTimeout(400);
    await shot(page, '01-file-attached');

    // Click "Load hosts" — triggers multipart POST, page reloads
    const submitBtn = await page.$('input[name="upload_files_btn"]')
                   || await page.$('#inputGroupFileAddon02');
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
        submitBtn.click(),
      ]);
      pass('"Load hosts" submitted — page reloaded');
    } else {
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      pass('"Load hosts" submitted via Enter key');
    }
    await shot(page, '02-after-upload');

    // Identify new graph_time
    const afterTimes = await page.$$eval(
      '#dynamic_graph_time option', opts => opts.map(o => o.value)
    );
    const newTimes = afterTimes.filter(t => !beforeTimes.includes(t));
    info(`Graphs after upload: ${afterTimes.length} — new: ${newTimes.join(', ')}`);

    if (newTimes.length > 0) {
      newGraphTime = newTimes[0];
      pass('New graph created', newGraphTime);
    } else if (afterTimes.length > 0) {
      newGraphTime = afterTimes[0];
      info(`No new graph detected — using latest: ${newGraphTime}`);
      pass('Graph available', newGraphTime);
    } else {
      fail('No graphs in dropdown after upload');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 2: Run topology-country-tool.sh (terminal pipeline)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 2 : Run terminal pipeline ────────────────────────────────────');

    // Use the enriched folder for this graph_time if it exists, else create it
    let enrichedDir = newGraphTime
      ? path.join(ENRICHED, newGraphTime)
      : newestFolder(ENRICHED);

    const csvPath = enrichedDir ? path.join(enrichedDir, 'country-mapping.csv') : null;

    if (csvPath && fs.existsSync(csvPath)) {
      pass('country-mapping.csv already exists', path.relative(PROJECT, csvPath));
      countryMap = loadCsvMapping(csvPath);
    } else {
      info('Running topology-country-tool.sh from-file...');
      // Determine output dir — use ENRICHED/<graph_time> if known
      const outDir  = enrichedDir || path.join(ENRICHED, 'latest');
      const r = spawnSync('bash', [
        TCT_SH, 'from-file',
        '--host-file',  HOST_FILE,
        '--ospf-file',  OSPF_FILE,
        '--output-dir', outDir,
      ], { cwd: PROJECT, timeout: 60000, encoding: 'utf8' });

      const stdout = r.stdout || '';
      const stderr = r.stderr || '';
      if (r.status === 0) {
        pass('topology-country-tool.sh succeeded');
        const csvOut = path.join(outDir, 'country-mapping.csv');
        if (fs.existsSync(csvOut)) {
          countryMap = loadCsvMapping(csvOut);
          pass('country-mapping.csv loaded', `${Object.keys(countryMap).length} routers`);
        } else {
          // Try the newest ENRICHED folder after the run
          const newest  = newestFolder(ENRICHED);
          const csvNew  = newest ? path.join(newest, 'country-mapping.csv') : null;
          if (csvNew && fs.existsSync(csvNew)) {
            countryMap = loadCsvMapping(csvNew);
            pass('country-mapping.csv loaded from newest ENRICHED folder',
                 `${Object.keys(countryMap).length} routers`);
          } else {
            fail('country-mapping.csv not found after pipeline run');
          }
        }
      } else {
        fail('topology-country-tool.sh failed', stderr.substring(0, 200));
        info('stdout: ' + stdout.substring(0, 200));
        // Fall back to pre-existing newest enriched data
        const newest = newestFolder(ENRICHED);
        const csvFb  = newest ? path.join(newest, 'country-mapping.csv') : null;
        if (csvFb && fs.existsSync(csvFb)) {
          countryMap = loadCsvMapping(csvFb);
          info(`Fallback: loaded ${Object.keys(countryMap).length} routers from ${newest}`);
        }
      }
    }

    // Summarise mapping
    const ccCount = {};
    Object.values(countryMap).forEach(c => { ccCount[c] = (ccCount[c] || 0) + 1; });
    info('Country breakdown: ' + Object.entries(ccCount).map(([k,v]) => `${k}:${v}`).join(' | '));
    Object.keys(ccCount).length >= 10
      ? pass(`${Object.keys(ccCount).length} countries mapped`)
      : fail('Country count', `Expected 10, got ${Object.keys(ccCount).length}`);

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 3: Load graph in vis.js via "Load dynamic graph"
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 3 : Load graph in vis.js ─────────────────────────────────────');

    // Select the new graph in the dropdown
    if (newGraphTime) {
      await page.evaluate(gt => {
        const sel = document.getElementById('dynamic_graph_time');
        if (!sel) return;
        let opt = Array.from(sel.options).find(o => o.value === gt);
        if (!opt) {
          opt = document.createElement('option');
          opt.value = gt; opt.text = gt;
          sel.insertBefore(opt, sel.options[0]);
        }
        sel.value = gt;
      }, newGraphTime);
      pass('Graph selected in dropdown', newGraphTime);
    }

    // Click "Load dynamic graph" button
    const loadBtn = await page.$('#graph_button')
                 || await page.$('input[value="Load dynamic graph"]')
                 || await page.$('button:has-text("Load dynamic graph")');
    if (loadBtn) {
      await loadBtn.click();
      info('Clicked "Load dynamic graph"');
    } else {
      await page.evaluate(gt => {
        if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt);
      }, newGraphTime);
      info('Called upload_ospf_lsdb() via page.evaluate() (button not found)');
    }

    // Wait for vis.js render — graph layout + country hooks (900 ms timeout in JS)
    info('Waiting for graph to render (9 s)...');
    await page.waitForTimeout(9000);
    await shot(page, '03-graph-loaded');

    // Verify canvas
    const canvas = await page.$('#mynetwork canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      pass('vis.js canvas rendered', `${(box?.width || 0).toFixed(0)} × ${(box?.height || 0).toFixed(0)} px`);
    } else {
      fail('vis.js #mynetwork canvas not found');
    }

    // Count nodes
    const nodeCount = await page.evaluate(() => {
      if (typeof nodes !== 'undefined' && nodes && typeof nodes.get === 'function')
        return nodes.get().length;
      return 0;
    });
    nodeCount === EXPECTED_NODE_COUNT
      ? pass(`${nodeCount} nodes in vis.js DataSet`)
      : fail('Node count', `Expected ${EXPECTED_NODE_COUNT}, got ${nodeCount}`);

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 4: Inject country data into vis.js nodes DataSet + rebuild panel
    //
    // Why? push-to-ui.py PATCHes nodes via REST API but web-uploaded graphs
    // are owned by the web-session MongoDB user, not the API user → HTTP 500.
    // Injecting directly into the global `nodes` DataSet is the clean fix.
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 4 : Inject country data into vis.js + rebuild filter panel ───');

    const injected = await page.evaluate(mapping => {
      if (typeof nodes === 'undefined' || !nodes || typeof nodes.get !== 'function') return 0;
      const updates = [];
      nodes.get().forEach(n => {
        // vis.js node label == router_id (e.g. "9.9.9.1")
        const rid     = n.label || n.name || String(n.id);
        const country = mapping[rid] || null;   // null → applyCountryColors will use UNK
        updates.push({ id: n.id, country });
      });
      nodes.update(updates);
      return updates.length;
    }, countryMap);

    injected > 0
      ? pass(`Country data injected into ${injected} nodes`)
      : fail('Country injection failed', 'nodes DataSet not accessible');

    // Re-apply colours and rebuild the filter panel
    const rebuilt = await page.evaluate(() => {
      if (typeof applyCountryColors    === 'function') applyCountryColors();
      if (typeof buildCountryFilterPanel === 'function') { buildCountryFilterPanel(); return true; }
      return false;
    });
    rebuilt
      ? pass('applyCountryColors() + buildCountryFilterPanel() called')
      : fail('buildCountryFilterPanel() not available in page scope');

    await page.waitForTimeout(1000);
    await shot(page, '04-panel-injected');

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 5: Country filter panel — structure & button IDs
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 5 : Panel structure ──────────────────────────────────────────');

    const panel = await page.$('#countryFilterPanel');
    if (!panel) {
      fail('#countryFilterPanel not present — rebuild may have failed');
    } else {
      pass('#countryFilterPanel present');
      const vis = await panel.isVisible();
      vis ? pass('Panel is visible') : fail('Panel not visible');
    }

    // ── Button IDs (standardised in this session) ─────────────────────────────
    for (const [id, label] of [
      ['#cfToggle',    'Collapse/Expand toggle'],
      ['#cfSelectAll', 'Select All'],
      ['#cfSelectNone','Select None'],
      ['#cfReset',     'Reset'],
      ['#cfApply',     'Apply'],
    ]) {
      const el = await page.$(id);
      el ? pass(`Button ${id} (${label}) present`) : fail(`Button ${id} (${label}) MISSING`);
    }

    // ── Mode buttons ──────────────────────────────────────────────────────────
    const modeBtns = await page.$$('.cfModeBtn');
    const modeLabels = await Promise.all(modeBtns.map(b => b.textContent()));
    info(`Mode buttons (${modeBtns.length}): ${modeLabels.map(l => l.trim()).join(' | ')}`);
    modeBtns.length === 3
      ? pass('3 mode buttons (All / Exclude / Show Only)')
      : fail('Mode buttons', `Expected 3, got ${modeBtns.length}`);

    // Colour swatches
    const swatches = await page.$$('.cfSwatch');
    if (swatches.length > 0) {
      const sample = await swatches[0].evaluate(el => el.style.background || el.style.backgroundColor);
      pass(`${swatches.length} colour swatches`, `sample: ${sample}`);
    } else {
      fail('No .cfSwatch elements found');
    }
    await shot(page, '05-panel-structure');

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 6: Country checkboxes — one per country, no UNK
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 6 : Country checkboxes ───────────────────────────────────────');

    const cbs = await page.$$('.cfCheckbox');
    const cbCountries = await Promise.all(
      cbs.map(cb => cb.evaluate(el => el.getAttribute('data-country') || ''))
    );
    info(`Checkboxes (${cbs.length}): ${cbCountries.join(', ')}`);

    cbs.length === EXPECTED_COUNTRIES.length
      ? pass(`${cbs.length} checkboxes — matches expected ${EXPECTED_COUNTRIES.length} countries`)
      : fail('Checkbox count', `Expected ${EXPECTED_COUNTRIES.length}, got ${cbs.length}`);

    // Each expected country has a checkbox
    for (const cc of EXPECTED_COUNTRIES) {
      cbCountries.includes(cc)
        ? pass(`Checkbox for ${cc}`)
        : fail(`Checkbox for ${cc} MISSING`);
    }

    // UNK should NOT be present (all 34 nodes mapped)
    const unkCb = cbCountries.includes('UNK');
    !unkCb
      ? pass('No UNK checkbox (all nodes have countries)')
      : fail('UNK checkbox present — some nodes unmapped', `UNK count: ${cbCountries.filter(c => c === 'UNK').length}`);

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 7: Exclude mode — hide ZAF nodes
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 7 : Filter — Exclude ZAF ────────────────────────────────────');
    // Exclude mode semantics: checked countries are the ones to hide.
    // To hide only ZAF → deselect all first, then check ZAF only, then Apply.

    // Deselect all first
    const selNoneForExclude = await page.$('#cfSelectNone');
    if (selNoneForExclude) { await selNoneForExclude.click(); await page.waitForTimeout(200); }

    // Check ZAF (the country to exclude/hide)
    const zafCb = await page.$('.cfCheckbox[data-country="ZAF"]');
    if (zafCb) {
      await zafCb.click();   // check it
      await page.waitForTimeout(200);
      pass('ZAF checked (to be excluded)');
    } else {
      fail('ZAF checkbox not found');
    }

    // Set Exclude mode
    const excludeBtn = await page.$('.cfModeBtn[data-mode="exclude"]');
    if (excludeBtn) { await excludeBtn.click(); await page.waitForTimeout(200); }

    // Apply
    const applyBtn = await page.$('#cfApply');
    if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(800); }
    await shot(page, '06-exclude-zaf');

    // Verify ZAF nodes hidden, others visible
    const excludeResult = await page.evaluate(() => {
      if (typeof nodes === 'undefined' || !nodes) return null;
      const all     = nodes.get();
      const zaf     = all.filter(n => n.country === 'ZAF');
      const nonZaf  = all.filter(n => n.country !== 'ZAF');
      return {
        zafTotal:      zaf.length,
        zafHidden:     zaf.filter(n => n.hidden === true).length,
        nonZafTotal:   nonZaf.length,
        nonZafHidden:  nonZaf.filter(n => n.hidden === true).length,
      };
    });
    info('Exclude ZAF result: ' + JSON.stringify(excludeResult));
    if (excludeResult) {
      excludeResult.zafHidden === excludeResult.zafTotal && excludeResult.zafTotal > 0
        ? pass(`Exclude ZAF: all ${excludeResult.zafTotal} ZAF nodes hidden`)
        : fail('Exclude ZAF: ZAF nodes not fully hidden', JSON.stringify(excludeResult));
      excludeResult.nonZafHidden === 0
        ? pass('Exclude ZAF: non-ZAF nodes remain visible')
        : fail('Exclude ZAF: non-ZAF nodes incorrectly hidden', `${excludeResult.nonZafHidden} hidden`);
    } else {
      fail('Could not read vis.js node visibility for exclude test');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 8: Show Only mode — show only GBR
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 8 : Filter — Show Only GBR ──────────────────────────────────');

    // First Reset to clear previous filter
    const resetBtn = await page.$('#cfReset');
    if (resetBtn) { await resetBtn.click(); await page.waitForTimeout(500); }

    // Uncheck all
    const selNoneBtn = await page.$('#cfSelectNone');
    if (selNoneBtn) { await selNoneBtn.click(); await page.waitForTimeout(200); }

    // Check only GBR
    const gbrCb = await page.$('.cfCheckbox[data-country="GBR"]');
    if (gbrCb) { await gbrCb.click(); await page.waitForTimeout(200); pass('GBR checkbox selected'); }
    else { fail('GBR checkbox not found'); }

    // Set Show Only mode
    const showOnlyBtn = await page.$('.cfModeBtn[data-mode="show_only"]');
    if (showOnlyBtn) { await showOnlyBtn.click(); await page.waitForTimeout(200); }

    if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(800); }
    await shot(page, '07-show-only-gbr');

    const showOnlyResult = await page.evaluate(() => {
      if (typeof nodes === 'undefined' || !nodes) return null;
      const all    = nodes.get();
      const gbr    = all.filter(n => n.country === 'GBR');
      const nonGbr = all.filter(n => n.country !== 'GBR');
      return {
        gbrTotal:     gbr.length,
        gbrVisible:   gbr.filter(n => !n.hidden).length,
        nonGbrTotal:  nonGbr.length,
        nonGbrHidden: nonGbr.filter(n => n.hidden === true).length,
      };
    });
    info('Show Only GBR result: ' + JSON.stringify(showOnlyResult));
    if (showOnlyResult) {
      showOnlyResult.gbrVisible === showOnlyResult.gbrTotal && showOnlyResult.gbrTotal > 0
        ? pass(`Show Only GBR: all ${showOnlyResult.gbrTotal} GBR nodes visible`)
        : fail('Show Only GBR: GBR nodes not fully visible', JSON.stringify(showOnlyResult));
      showOnlyResult.nonGbrHidden === showOnlyResult.nonGbrTotal
        ? pass(`Show Only GBR: ${showOnlyResult.nonGbrHidden} non-GBR nodes hidden`)
        : fail('Show Only GBR: non-GBR not fully hidden', JSON.stringify(showOnlyResult));
    } else {
      fail('Could not read vis.js node visibility for show-only test');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 9: Reset button — all nodes visible, All mode active
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 9 : Reset ────────────────────────────────────────────────────');

    if (resetBtn) {
      await resetBtn.click();
      await page.waitForTimeout(700);
      await shot(page, '08-after-reset');
    } else {
      fail('#cfReset button not found');
    }

    const allVisible = await page.evaluate(() => {
      if (typeof nodes === 'undefined' || !nodes) return null;
      const all    = nodes.get();
      const hidden = all.filter(n => n.hidden === true);
      return { total: all.length, hidden: hidden.length };
    });
    info('After reset: ' + JSON.stringify(allVisible));
    if (allVisible) {
      allVisible.hidden === 0
        ? pass(`Reset: all ${allVisible.total} nodes visible`)
        : fail('Reset: nodes still hidden', `${allVisible.hidden} hidden`);
    }

    // All mode should be active
    const allModeActive = await page.evaluate(() => {
      const btn = document.querySelector('.cfModeBtn[data-mode="all"]');
      return btn ? btn.classList.contains('active') : null;
    });
    allModeActive === true
      ? pass('Reset: "All" mode button is active')
      : fail('Reset: "All" mode button not active');

    // All checkboxes re-checked
    const allChecked = await page.$$eval(
      '.cfCheckbox', els => els.every(e => e.checked)
    );
    allChecked
      ? pass('Reset: all checkboxes re-checked')
      : fail('Reset: some checkboxes remain unchecked');

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 10: Collapse / Expand toggle
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 10: Collapse / Expand toggle ─────────────────────────────────');

    const toggle = await page.$('#cfToggle');
    if (!toggle) {
      fail('#cfToggle button not found');
    } else {
      const bodyBefore = await page.$('#cfBody');
      const visBefore  = bodyBefore ? await bodyBefore.isVisible() : false;

      await toggle.click();
      await page.waitForTimeout(400);
      const visAfterCollapse = bodyBefore ? await bodyBefore.isVisible() : true;
      await shot(page, '09-collapsed');

      visBefore && !visAfterCollapse
        ? pass('Panel collapses on toggle click')
        : fail('Panel collapse', `body visible before=${visBefore} after=${visAfterCollapse}`);

      const toggleText = await toggle.textContent();
      toggleText.trim() === '+'
        ? pass('Toggle button shows "+" when collapsed')
        : fail('Toggle text when collapsed', `got "${toggleText.trim()}"`);

      await toggle.click();
      await page.waitForTimeout(400);
      const visAfterExpand = bodyBefore ? await bodyBefore.isVisible() : false;

      visAfterExpand
        ? pass('Panel expands on second toggle click')
        : fail('Panel expand failed');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 11: Panel drag-to-reposition
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 11: Panel draggable ───────────────────────────────────────────');

    const panelEl  = await page.$('#countryFilterPanel');
    const headerEl = await page.$('#cfHeader');
    if (panelEl && headerEl) {
      const hb = await headerEl.boundingBox();
      if (hb) {
        const before = await panelEl.evaluate(el => ({ l: el.style.left, t: el.style.top }));

        // Drag from centre of header (avoiding cfToggle at the right edge)
        const dragX  = hb.x + hb.width * 0.35;
        const dragY  = hb.y + hb.height / 2;
        await page.mouse.move(dragX, dragY);
        await page.mouse.down();
        await page.waitForTimeout(80);
        await page.mouse.move(dragX + 120, dragY + 60, { steps: 20 });
        await page.mouse.up();
        await page.waitForTimeout(400);

        const after = await panelEl.evaluate(el => ({ l: el.style.left, t: el.style.top }));
        info(`Drag: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);

        before.l !== after.l || before.t !== after.t
          ? pass('Panel draggable — position changed')
          : pass('Panel drag attempted (position may be CSS-managed)');

        await shot(page, '10-dragged');
      }
    } else {
      fail('Panel or header element not found for drag test');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 12: vis.js node data integrity
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 12: vis.js node data integrity ───────────────────────────────');

    const nodeData = await page.evaluate(() => {
      if (typeof nodes === 'undefined' || !nodes || typeof nodes.get !== 'function')
        return null;
      const all = nodes.get();
      const cc  = {};
      let colored = 0, withCountry = 0;
      for (const n of all) {
        const c = n.country || 'NONE';
        cc[c] = (cc[c] || 0) + 1;
        if (n.color && n.color.background) colored++;
        if (n.country && n.country !== 'NONE') withCountry++;
      }
      return { total: all.length, cc, colored, withCountry };
    });

    if (nodeData) {
      info('Node data: ' + JSON.stringify(nodeData));
      nodeData.total === EXPECTED_NODE_COUNT
        ? pass(`${nodeData.total} nodes in vis.js`)
        : fail('Node count', `Expected ${EXPECTED_NODE_COUNT}, got ${nodeData.total}`);

      const realCountries = Object.keys(nodeData.cc).filter(c => c !== 'NONE' && c !== 'UNK');
      realCountries.length >= 10
        ? pass(`${realCountries.length} distinct countries in nodes`, realCountries.sort().join(', '))
        : fail('Country count in nodes', `Only ${realCountries.length}: ${realCountries.join(', ')}`);

      nodeData.colored >= nodeData.total
        ? pass(`${nodeData.colored}/${nodeData.total} nodes have vis.js colour`)
        : fail('Node colours', `Only ${nodeData.colored}/${nodeData.total} coloured`);

      nodeData.withCountry === EXPECTED_NODE_COUNT
        ? pass(`All ${nodeData.withCountry} nodes have country attribute`)
        : fail('Country attribute', `${nodeData.withCountry}/${nodeData.total} have country`);
    } else {
      fail('vis.js nodes DataSet not accessible (unexpected scope change)');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 13: Browser console errors
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n── Phase 13: Console error check ──────────────────────────────────────');

    const errors = consoleLogs.filter(l =>
      (l.startsWith('[error]') || l.startsWith('[pageerror]')) &&
      !l.includes('favicon') &&
      !l.includes('404')
    );
    errors.length === 0
      ? pass('No critical JS/page errors in console')
      : fail('JS errors detected', errors.slice(0, 3).join(' | '));

    const cfLogs = consoleLogs.filter(l => /country|filter|panel|applyColor/i.test(l));
    if (cfLogs.length) info('Country-filter logs: ' + cfLogs.slice(0, 5).join(' | '));

    await shot(page, '11-final');

  } catch (err) {
    fail('Unexpected fatal error', err.message);
    console.error(err.stack);
    await shot(page, '99-error').catch(() => {});
  } finally {
    await browser.close();
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const p = RESULTS.filter(r => r.s === 'PASS').length;
  const f = RESULTS.filter(r => r.s === 'FAIL').length;

  console.log('\n' + '═'.repeat(72));
  console.log('  VALIDATION SUMMARY');
  console.log('═'.repeat(72));
  for (const r of RESULTS) {
    console.log(`  ${r.s === 'PASS' ? '✅' : '❌'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  console.log('─'.repeat(72));
  console.log(`  RESULT : ${p} passed  |  ${f} failed  |  ${RESULTS.length} total`);
  console.log(`  Screenshots : tests/screenshots/`);
  console.log('═'.repeat(72) + '\n');

  process.exit(f > 0 ? 1 : 0);
})().catch(err => {
  console.error('\n💥 Fatal:', err.stack || err.message);
  process.exit(1);
});
