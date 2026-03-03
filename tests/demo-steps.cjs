'use strict';
/**
 * demo-steps.cjs
 * Full walkthrough: upload → pipeline → inject country data → filter demo
 * Uses a single browser session throughout (same page, same cookies).
 */
const { chromium } = require('playwright');
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

const PROJECT   = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(PROJECT, 'INPUT-FOLDER');
const ENRICHED  = path.join(PROJECT, 'OUTPUT', 'ENRICHED');
const TERM_DIR  = path.join(PROJECT, 'terminal-script');
const SS_DIR    = path.join(__dirname, 'screenshots');
const OSPF_FILE = path.join(INPUT_DIR, 'ospf-database-2.txt');
const HOST_FILE = path.join(INPUT_DIR, 'host-file-db2.txt');
const BASE_URL  = 'http://localhost:8081';

function loadCsvMapping(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols[0] && cols[2]) map[cols[0].trim()] = cols[2].trim().toUpperCase();
  }
  return map;
}

function runPipeline(newGraph) {
  const outDir  = path.join(ENRICHED, newGraph + '_ENRICHED');
  const csvPath = path.join(outDir, 'ENRICHED_country-mapping.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  Running topology-country-tool.sh...');
    const r = spawnSync('bash', [
      path.join(TERM_DIR, 'topology-country-tool.sh'),
      'from-file',
      '--host-file',  HOST_FILE,
      '--ospf-file',  OSPF_FILE,
      '--output-dir', outDir,
    ], { cwd: PROJECT, timeout: 60000, encoding: 'utf8' });
    if (r.status !== 0) { console.error('  Pipeline error:', r.stderr.substring(0, 200)); }
    else                { console.log('  topology-country-tool.sh ✅'); }
  } else {
    console.log('  Enriched data already present ✅');
  }
  return loadCsvMapping(csvPath);
}

function listOutputFiles(newGraph) {
  const dir = path.join(ENRICHED, newGraph + '_ENRICHED');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => /\.(yaml|json|csv)$/.test(f)).sort();
  console.log('\n  Output files in OUTPUT/ENRICHED/' + newGraph + '_ENRICHED:');
  files.forEach(f => {
    const kb = (fs.statSync(path.join(dir, f)).size / 1024).toFixed(1);
    console.log(`    ${f.padEnd(50)} ${kb} KB`);
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await ctx.newPage();                // ONE page, ONE session throughout

  try {

    // ── STEP A: Navigate to upload page ────────────────────────────────────────
    console.log('\n── Step A: Upload OSPF file ─────────────────────────────────────────');
    await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'networkidle' });
    const before = await page.$$eval('#dynamic_graph_time option', o => o.map(x => x.value));
    console.log(`  Existing graphs: ${before.length}`);

    await page.click('#Cisco');
    await page.evaluate(() => {
      const w = document.getElementById('devinputGroupFile02');
      if (w) w.removeAttribute('hidden');
      const i = document.getElementById('inputOSPFFileID');
      if (i) { i.style.display = 'block'; i.removeAttribute('hidden'); }
    });
    await page.locator('#inputOSPFFileID').setInputFiles(OSPF_FILE);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({ path: `${SS_DIR}/demo-04-file-attached.png` });
    console.log('  📸 demo-04-file-attached.png');

    // Submit "Load hosts" — page reloads (same session)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.locator('input[name="upload_files_btn"]').click(),
    ]);

    const after = await page.$$eval('#dynamic_graph_time option', o => o.map(x => x.value));
    const newArr  = after.filter(t => !before.includes(t));
    const newGraph = newArr.length ? newArr[0] : after[0];
    console.log(`  ✅ New graph: ${newGraph}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({ path: `${SS_DIR}/demo-05-after-upload.png` });
    console.log('  📸 demo-05-after-upload.png');

    // ── STEP B: Terminal pipeline ───────────────────────────────────────────────
    console.log('\n── Step B: Run terminal pipeline ────────────────────────────────────');
    const countryMap = runPipeline(newGraph);
    const cc = {};
    Object.values(countryMap).forEach(c => { cc[c] = (cc[c]||0)+1; });
    console.log('  Countries: ' + Object.entries(cc).map(([k,v])=>`${k}:${v}`).join(' | '));
    listOutputFiles(newGraph);

    // ── STEP C: Load graph in vis.js (same session page) ─────────────────────
    console.log('\n── Step C: Load graph in vis.js ─────────────────────────────────────');

    // Select the new graph in the dropdown
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
    }, newGraph);

    // Click "Load dynamic graph"
    const loadBtn = await page.$('#graph_button') || await page.$('input[value="Load dynamic graph"]');
    if (loadBtn) { await loadBtn.click(); console.log('  Clicked "Load dynamic graph"'); }
    else {
      await page.evaluate(gt => { if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt); }, newGraph);
      console.log('  Called upload_ospf_lsdb() via JS');
    }

    console.log('  Waiting 9 s for graph to render...');
    await page.waitForTimeout(9000);

    const nodeCount = await page.evaluate(() => {
      if (typeof nodes !== 'undefined' && nodes && typeof nodes.get === 'function') return nodes.get().length;
      return 0;
    });
    console.log(`  ✅ Nodes rendered: ${nodeCount}`);
    await page.screenshot({ path: `${SS_DIR}/demo-06-graph-rendered.png` });
    console.log('  📸 demo-06-graph-rendered.png');

    // ── STEP D: Inject country data → rebuild filter panel ──────────────────
    console.log('\n── Step D: Inject country data + build filter panel ─────────────────');
    const injected = await page.evaluate(mapping => {
      if (typeof nodes === 'undefined' || !nodes || typeof nodes.get !== 'function') return 0;
      const updates = [];
      nodes.get().forEach(n => {
        const rid = n.label || n.name || String(n.id);
        updates.push({ id: n.id, country: mapping[rid] || null });
      });
      nodes.update(updates);
      return updates.length;
    }, countryMap);
    console.log(`  Injected country into ${injected} nodes`);

    await page.evaluate(() => {
      if (typeof applyCountryColors    === 'function') applyCountryColors();
      if (typeof buildCountryFilterPanel === 'function') buildCountryFilterPanel();
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SS_DIR}/demo-07-panel-visible.png` });
    console.log('  📸 demo-07-panel-visible.png');

    // ── STEP E: Filter — Show Only ZAF ─────────────────────────────────────
    console.log('\n── Step E: Demo filter — Show Only ZAF ─────────────────────────────');
    const selNone  = await page.$('#cfSelectNone');
    const zafCb    = await page.$('.cfCheckbox[data-country="ZAF"]');
    const showOnly = await page.$('.cfModeBtn[data-mode="show_only"]');
    const apply    = await page.$('#cfApply');
    const reset    = await page.$('#cfReset');

    if (selNone && zafCb && showOnly && apply) {
      await selNone.click();  await page.waitForTimeout(200);
      await zafCb.click();    await page.waitForTimeout(200);
      await showOnly.click(); await page.waitForTimeout(200);
      await apply.click();    await page.waitForTimeout(800);
      const res = await page.evaluate(() => {
        if (typeof nodes === 'undefined') return null;
        const all = nodes.get();
        return { zaf: all.filter(n=>n.country==='ZAF'&&!n.hidden).length,
                 hidden: all.filter(n=>n.hidden).length, total: all.length };
      });
      console.log(`  Show Only ZAF: ${JSON.stringify(res)}`);
      await page.screenshot({ path: `${SS_DIR}/demo-08-show-only-zaf.png` });
      console.log('  📸 demo-08-show-only-zaf.png');
    }

    // ── STEP F: Exclude ZAF ────────────────────────────────────────────────
    if (reset) { await reset.click(); await page.waitForTimeout(500); }
    const selNone2  = await page.$('#cfSelectNone');
    const zafCb2    = await page.$('.cfCheckbox[data-country="ZAF"]');
    const excludeBtn = await page.$('.cfModeBtn[data-mode="exclude"]');
    const apply2    = await page.$('#cfApply');

    if (selNone2 && zafCb2 && excludeBtn && apply2) {
      await selNone2.click();   await page.waitForTimeout(200);
      await zafCb2.click();     await page.waitForTimeout(200);
      await excludeBtn.click(); await page.waitForTimeout(200);
      await apply2.click();     await page.waitForTimeout(800);
      const res2 = await page.evaluate(() => {
        if (typeof nodes === 'undefined') return null;
        const all = nodes.get();
        return { zafHidden: all.filter(n=>n.country==='ZAF'&&n.hidden).length,
                 visible: all.filter(n=>!n.hidden).length, total: all.length };
      });
      console.log(`  Exclude ZAF: ${JSON.stringify(res2)}`);
      await page.screenshot({ path: `${SS_DIR}/demo-09-exclude-zaf.png` });
      console.log('  📸 demo-09-exclude-zaf.png');
    }

    // ── STEP G: Reset ──────────────────────────────────────────────────────
    const reset2 = await page.$('#cfReset');
    if (reset2) { await reset2.click(); await page.waitForTimeout(600); }
    await page.screenshot({ path: `${SS_DIR}/demo-10-reset.png` });
    console.log('  📸 demo-10-reset.png — all nodes restored');

    // ── STEP H: Collapse panel ─────────────────────────────────────────────
    const toggle = await page.$('#cfToggle');
    if (toggle) {
      await toggle.click(); await page.waitForTimeout(400);
      await page.screenshot({ path: `${SS_DIR}/demo-11-collapsed.png` });
      console.log('  📸 demo-11-collapsed.png — panel collapsed');
      await toggle.click(); await page.waitForTimeout(300);
    }

    console.log('\n✅ All demo steps complete. Screenshots in tests/screenshots/');

  } finally {
    await browser.close();
  }
})().catch(e => { console.error('Fatal:', e.message, e.stack); process.exit(1); });
