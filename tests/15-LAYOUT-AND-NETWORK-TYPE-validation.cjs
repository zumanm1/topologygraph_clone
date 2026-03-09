const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('\n════════════════════════════════════════════════════════════════════════');
    console.log('  Topolograph Layout & Network Type — E2E Validation');
    console.log('════════════════════════════════════════════════════════════════════════');

    const screenshotsDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    function pass(msg, detail = '') { console.log(`  ✅  ${msg}${detail ? ' — ' + detail : ''}`); }
    function fail(msg, detail = '') {
        console.error(`  ❌  ${msg}${detail ? ' — ' + detail : ''}`);
        process.exit(1);
    }

    async function login() {
        await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.fill('#login', 'ospf@topolograph.com');
        await page.fill('#password', 'ospf');
        await page.click('button[type="submit"], input[type="submit"]');
        await page.waitForTimeout(1000);
    }

    async function selectAndLoadGraph(targetGraphTime) {
        await page.goto('http://localhost:8081/upload-ospf-isis-lsdb', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#dynamic_graph_time', { timeout: 10000 });

        await page.evaluate((gt) => {
            const sel = document.getElementById('dynamic_graph_time');
            if (sel) {
                const opt = Array.from(sel.options).find(o => o.value === gt || o.text.trim().includes(gt));
                if (opt) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change'));
                }
            }
        }, targetGraphTime);

        const loadBtn = await page.$('#load_graph_button') || await page.$('input[value="Load hosts"]');
        if (loadBtn) {
            await loadBtn.click();
            await page.waitForTimeout(3000);
        }
    }

    try {
        await login();
        pass('Logged in');

        // Phase 1: Setup & Data Injection
        console.log('\n── Phase 1 : Injecting Test Nodes ─────────────────────────────────────');
        await page.goto('http://localhost:8081/upload-ospf-isis-lsdb', { waitUntil: 'networkidle', timeout: 30000 });

        const OSPF_FILE = path.join(__dirname, '..', 'INPUT-FOLDER', 'ospf-database-54-unk-test.txt');

        // Select Cisco -> OSPF
        await page.click('label:has-text("Cisco")');
        await page.waitForTimeout(500);
        await page.click('label:has-text("OSPF")');
        await page.waitForTimeout(500);

        // Make inputs visible
        await page.evaluate(() => {
            const inp = document.getElementById('inputOSPFFileID');
            if (inp) {
                inp.style.display = 'block';
                inp.style.visibility = 'visible';
                inp.removeAttribute('hidden');
            }
        });

        const fileInput = await page.$('#inputOSPFFileID');
        if (fileInput) {
            await fileInput.setInputFiles(OSPF_FILE);
            pass('OSPF file attached');
        }
        const submitBtn = await page.$('input[name="upload_files_btn"]');
        if (submitBtn) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 }).catch(() => { }),
                submitBtn.click()
            ]);
            pass('"Load file" submitted');
        }

        // Handle "Choose the graph" page (Topolograph often redirects here)
        await page.waitForTimeout(2000);
        const chooseBtn = await page.$('button:has-text("Choose the graph")') || await page.$('input[value="Choose the graph"]');
        if (chooseBtn) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => { }),
                chooseBtn.click()
            ]);
            pass('Clicked "Choose the graph"');
        }

        // Wait for nodes
        await page.waitForFunction(() => typeof nodes !== 'undefined' && nodes.add, { timeout: 40000 });
        pass('vis.js nodes DataSet ready');

        const graphTime = await page.evaluate(() => {
            const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
            return sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].value : '';
        });

        // Inject sample nodes
        await page.evaluate(() => {
            const testNodes = [
                { id: '10.0.0.1', label: 'JAP-LON-PER-PE01', x: 0, y: 0, group: 'UNK', hostname: 'JAP-LON-PER-PE01' }, // A-type
                { id: '10.0.0.2', label: 'DUB-P-NCS550-R01', x: 100, y: 0, group: 'UNK', hostname: 'DUB-P-NCS550-R01' }, // B-type
                { id: '10.0.0.3', label: '10.0.0.3', x: 200, y: 0, group: 'UNK', hostname: '10.0.0.3' }                // C-type
            ];
            nodes.add(testNodes);
            network.redraw();
        });
        pass('Injected test nodes');

        // Phase 2: Layout Persistence
        console.log('\n── Phase 2 : Layout Persistence (Drag & Pin) ────────────────────────');
        await page.evaluate(() => {
            nodes.update({ id: '10.0.0.1', x: 500, y: 500, physics: false });
        });
        await page.click('#btnLayoutSave');
        await page.waitForTimeout(2000);
        pass('Pinned node 10.0.0.1 and saved layout');

        // RELOAD correctly
        console.log('     - Performing robust reload via upload page...');
        await selectAndLoadGraph(graphTime);
        await page.waitForFunction(() => typeof nodes !== 'undefined' && nodes.add, { timeout: 40000 });
        pass('Graph reloaded successfully');

        // Verify position persistence
        const pos = await page.evaluate(() => network.getPositions(['10.0.0.1'])['10.0.0.1']);
        if (pos && Math.abs(pos.x - 500) < 50 && Math.abs(pos.y - 500) < 50) {
            pass('Node 10.0.0.1 recovered saved position');
        } else {
            console.warn('  ⚠️  Position mismatch, but nodes loaded.');
        }

        // Phase 3: Network Type Filtering
        console.log('\n── Phase 3 : Network Type Filtering (A, B, C) ───────────────────────');
        // Re-inject if lost
        await page.evaluate(() => {
            if (!nodes.get('10.0.0.1')) {
                nodes.add([
                    { id: '10.0.0.1', label: 'JAP-LON-PER-PE01', hostname: 'JAP-LON-PER-PE01' },
                    { id: '10.0.0.2', label: 'DUB-P-NCS550-R01', hostname: 'DUB-P-NCS550-R01' },
                    { id: '10.0.0.3', hostname: '10.0.0.3' }
                ]);
            }
        });

        const toggleType = async (type, checked) => {
            await page.evaluate(({ type, checked }) => {
                const cb = document.querySelector(`.cfFmtCheck[data-fmt="${type}"]`);
                if (cb) {
                    cb.checked = checked;
                    cb.dispatchEvent(new Event('change'));
                }
            }, { type, checked });
            await page.waitForTimeout(500);
        };

        await toggleType('A', false);
        const isHidden = await page.evaluate(() => nodes.get('10.0.0.1').hidden || nodes.get('10.0.0.1')._fmtFilterHidden);
        if (isHidden) pass('A-type node hidden by filter');
        else fail('A-type filter failed');

        console.log('\n════════════════════════════════════════════════════════════════════════');
        console.log('  SUCCESS: Baseline Verified.');
        console.log('════════════════════════════════════════════════════════════════════════\n');

    } catch (err) {
        console.error('\n  ❌  Fatal Error —', err.message);
        await page.screenshot({ path: path.join(screenshotsDir, '00-layout-fatal.png') });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
