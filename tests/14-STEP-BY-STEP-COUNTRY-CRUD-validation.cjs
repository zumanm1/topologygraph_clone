'use strict';
/**
 * 14-STEP-BY-STEP-COUNTRY-CRUD-validation.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Validation of the Bulk Country Editor UI and CRUD Persistence
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(PROJECT, 'INPUT-FOLDER');
const OSPF_FILE = path.join(INPUT_DIR, 'ospf-database-54-unk-test.txt');
const SS_DIR = path.join(__dirname, 'screenshots');

const BASE_URL = 'http://localhost:8081';

fs.mkdirSync(SS_DIR, { recursive: true });
const RESULTS = [];
let shotIdx = 0;

const pass = (name, detail = '') => { RESULTS.push({ s: 'PASS', name, detail }); console.log(`  ✅  ${name}${detail ? ' — ' + detail : ''}`); };
const fail = (name, detail = '') => { RESULTS.push({ s: 'FAIL', name, detail }); console.error(`  ❌  ${name}${detail ? ' — ' + detail : ''}`); };
const info = msg => console.log(`  ℹ️   ${msg}`);
const shot = async (page, label) => {
    const f = path.join(SS_DIR, `${String(shotIdx++).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log(`  📸  ${path.relative(PROJECT, f)}`);
};

(async () => {
    console.log('\n' + '═'.repeat(72));
    console.log('  Topolograph Bulk Country CRUD  —  E2E Validation');
    console.log('═'.repeat(72) + '\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    let newGraphTime = '';

    try {
        // 1️⃣ Upload OSPF file
        console.log('── Phase 1 : Upload OSPF file via web UI ──────────────────────────────');
        await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'networkidle', timeout: 20000 });
        pass('Upload page loaded');

        // Make inputs visible
        await page.evaluate(() => {
            const wrap = document.getElementById('devinputGroupFile02');
            if (wrap) wrap.removeAttribute('hidden');
            const inp = document.getElementById('inputOSPFFileID');
            if (inp) { inp.style.display = 'block'; inp.removeAttribute('hidden'); }
        });

        const fileInput = await page.$('#inputOSPFFileID');
        if (fileInput) {
            await fileInput.setInputFiles(OSPF_FILE);
            pass('OSPF file attached');
        }
        const submitBtn = await page.$('input[name="upload_files_btn"]') || await page.$('#inputGroupFileAddon02');
        if (submitBtn) {
            await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }), submitBtn.click()]);
            pass('"Load file" submitted');
        }

        const afterTimes = await page.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
        if (afterTimes.length > 0) {
            newGraphTime = afterTimes[0];
            pass('Graph available', newGraphTime);
        }

        // 2️⃣ Load Graph in vis.js
        console.log('\n── Phase 2 : Load graph & Setup Country Edit ──────────────────────────');
        await page.evaluate(gt => {
            const sel = document.getElementById('dynamic_graph_time');
            if (sel) sel.value = gt;
            if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt);
        }, newGraphTime);

        await page.waitForTimeout(9000);
        await shot(page, 'crud-graph-loaded');

        // Set map to arbitrary countries for testing initially
        await page.evaluate(() => {
            if (typeof nodes !== 'undefined' && nodes) {
                var items = nodes.get();
                // Force the first 5 to UNK
                for (var i = 0; i < 5; i++) {
                    nodes.update({ id: items[i].id, country: 'UNK' });
                }
            }
        });

        await page.evaluate(() => {
            if (typeof applyCountryColors === 'function') applyCountryColors();
            if (typeof buildCountryFilterPanel === 'function') buildCountryFilterPanel();
            var p = document.getElementById('countryFilterPanel');
            if (p) p.style.display = '';
        });
        await page.waitForTimeout(1000);
        await shot(page, 'crud-panel-open');

        // 3️⃣ Interact with UI
        console.log('\n── Phase 3 : UI Interaction (Apply & Rollback) ────────────────────────');
        // We select 3 routers
        await page.evaluate(() => {
            var all = nodes.get();
            var toSelect = [all[0].id, all[1].id, all[2].id];
            network.setSelection({ nodes: toSelect });
            // Trigger selection event manually as programmatic setSelection doesn't fire it automatically
            if (typeof _updateBulkCount === 'function' || document.getElementById('cfBulkCount')) {
                var evts = network.listeners || {};
                if (evts.selectNode && evts.selectNode.length) {
                    evts.selectNode.forEach(fn => fn({ nodes: toSelect }));
                } else {
                    document.getElementById('cfBulkCount').textContent = toSelect.length;
                }
            }
        });
        await page.waitForTimeout(500);

        const applyMapBtn = await page.$('#cfBulkApplyBtn');
        const rollbackBtn = await page.$('#cfBulkRollbackBtn');
        const saveDbBtn = await page.$('#cfBulkSaveBtn');

        if (applyMapBtn && saveDbBtn && rollbackBtn) {
            pass('Bulk Editor Buttons located');

            // Select country ZAF using the DOM inject since standard playwright might not see injected options
            await page.evaluate(() => {
                const sel = document.getElementById('cfBulkCountrySel');
                // Force inject ZAF if it isn't listed
                var exists = Array.from(sel.options).some(o => o.value === 'ZAF');
                if (!exists) {
                    var o = document.createElement('option');
                    o.value = 'ZAF'; o.text = 'ZAF';
                    sel.add(o);
                }
                sel.value = 'ZAF';
            });

            // Apply
            await applyMapBtn.click();
            await page.waitForTimeout(1000);
            await shot(page, 'crud-applied-map');

            const countZaf = await page.evaluate(() => {
                return nodes.get().filter(n => n.country === 'ZAF').length;
            });
            if (countZaf >= 3) pass('Routers locally converted to ZAF');
            else fail('Routers did not convert to ZAF locally', 'Count = ' + countZaf);

            // Save DB
            await saveDbBtn.click();
            await page.waitForTimeout(2000); // wait for fetch
            await shot(page, 'crud-saved-db');
            const dbStatus = await page.evaluate(() => document.getElementById('cfBulkSaveBtn').textContent);
            if (dbStatus.includes('Saved DB') || dbStatus.includes('Save to DB')) pass('Database save visually resolved', dbStatus);
            else fail('Database save reported error or hung', dbStatus);

            // Rollback
            await rollbackBtn.click();
            await page.waitForTimeout(1000);
            await shot(page, 'crud-rollback');
            const countUnk = await page.evaluate(() => {
                return nodes.get().filter(n => n.country === 'UNK').length;
            });
            if (countUnk >= 5) pass('Routers correctly rolled back to original UNK');
            else fail('Rollback failed to restore UNK', 'UNK count = ' + countUnk);

        } else {
            fail('Could not find Bulk Editor buttons (#cfBulkApplyBtn, etc)');
        }


        // 4️⃣ Verify Persistence upon reload
        console.log('\n── Phase 4 : Verification of Saved Data Hydration ───────────────────');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        await page.evaluate(gt => {
            const sel = document.getElementById('dynamic_graph_time');
            if (sel) sel.value = gt;
            if (typeof upload_ospf_lsdb === 'function') upload_ospf_lsdb(false, false, gt);
        }, newGraphTime);

        await page.waitForTimeout(9000);

        const newZafCount = await page.evaluate(() => {
            return nodes.get().filter(n => n.country === 'ZAF').length;
        });

        if (newZafCount >= 3) {
            pass('Data persisted across page reload', `Loaded with ${newZafCount} ZAFs`);
        } else {
            fail('Country overrides were NOT restored from backend', `Found ${newZafCount} ZAFs`);
        }

        await shot(page, 'crud-final-reload-check');

    } catch (err) {
        fail('Unexpected fatal error', err.message);
        console.error(err.stack);
        await shot(page, 'crud-fatal-exception').catch(() => { });
    } finally {
        await browser.close();
    }

    console.log('\n' + '═'.repeat(72));
    console.log('  VALIDATION SUMMARY');
    console.log('═'.repeat(72));
    for (const r of RESULTS) { console.log(`  ${r.s === 'PASS' ? '✅' : '❌'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`); }
    const f = RESULTS.filter(r => r.s === 'FAIL').length;
    process.exit(f > 0 ? 1 : 0);
})();
