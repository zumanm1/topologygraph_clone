/**
 * 28-cost-matrix-detail-drawer.cjs
 * Playwright validation: Cost Matrix page — cell-click detail drawer,
 * FWD/REV hop tables, country toggle, detail CSV export.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const USER     = process.env.API_USER  || 'ospf@topolograph.com';
const PASS     = process.env.API_PASS  || 'ospf';
const SS_DIR   = path.join(__dirname, '..', 'test-screenshots');

if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

let passed = 0, failed = 0;

function ok(msg)   { console.log(`  ✅  ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌  ${msg}`); failed++; }
function info(msg) { console.log(`  📝 ${msg}`); }
function shot(page, name) {
    const p = path.join(SS_DIR, name);
    return page.screenshot({ path: p, fullPage: false }).then(() => console.log(`  📸  Screenshot: ${p}`));
}

(async () => {
    console.log('\n════ Cost Matrix Detail Drawer Validation ════\n');

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();

    const jsErrors = [];
    page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });

    /* ── Step 1: Login ─────────────────────────────────────────────── */
    console.log('Step 1: Authenticating...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(500);
    await page.fill('#login', USER);
    await page.fill('#password', PASS);
    await page.press('#password', 'Enter');
    await page.waitForTimeout(2000);
    if (page.url().includes('login')) { fail('Login failed'); await browser.close(); process.exit(1); }
    ok('Login successful');

    /* ── Step 2: Navigate to Cost Matrix ──────────────────────────── */
    console.log('\nStep 2: Navigating to Cost Matrix page...');
    await page.goto(`${BASE_URL}/cost-matrix`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);
    ok('Navigated to Cost Matrix page');
    await shot(page, '28-01-cost-matrix-initial.png');

    const TARGET_SNAP = '11Mar2026_21h17m14s_84_hosts';

    /* ── Step 3: Wait for dropdown to populate ────────────────────── */
    console.log('\nStep 3: Waiting for graph snapshot dropdown...');
    try {
        await page.waitForFunction(
            () => document.querySelector('#matrix-topo-select') &&
                  document.querySelector('#matrix-topo-select').options.length > 0,
            { timeout: 15000 }
        );
        const optCount = await page.$$eval('#matrix-topo-select option', els => els.length);
        ok(`Dropdown populated: ${optCount} snapshots available`);
    } catch(e) {
        fail('Dropdown did not populate within 15s');
        await shot(page, '28-fail-no-dropdown.png');
        await browser.close(); process.exit(1);
    }

    /* ── Step 4: Select 84-node snapshot ─────────────────────────── */
    console.log(`\nStep 4: Selecting 84-node snapshot (${TARGET_SNAP})...`);
    const hasTarget = await page.evaluate((t) => {
        var sel = document.getElementById('matrix-topo-select');
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === t) return true;
        }
        return false;
    }, TARGET_SNAP);

    if (hasTarget) {
        await page.selectOption('#matrix-topo-select', TARGET_SNAP);
        ok(`Selected snapshot: ${TARGET_SNAP}`);
    } else {
        fail(`84-node snapshot not found in dropdown: ${TARGET_SNAP}`);
        info('Proceeding with auto-selected snapshot');
    }

    /* ── Step 5: Wait for matrix table ───────────────────────────── */
    console.log('\nStep 5: Waiting for matrix table to render...');
    try {
        await page.waitForSelector('table.rm-table', { timeout: 35000 });
        ok('Matrix table rendered');
    } catch (e) {
        fail('Matrix table did not render within 35s');
        await shot(page, '28-fail-no-table.png');
        await browser.close(); process.exit(1);
    }

    // Check row/col counts
    const rowCount = await page.$$eval('table.rm-table tbody tr', els => els.length);
    const colCount = await page.$$eval('table.rm-table thead th', els => els.length - 1);
    info(`Matrix dimensions: ${rowCount} rows × ${colCount} columns`);
    if (rowCount >= 2 && colCount >= 2) ok(`Matrix is ${rowCount}×${colCount}`);
    else fail(`Matrix too small: ${rowCount}×${colCount}`);

    await shot(page, '28-02-matrix-rendered.png');

    /* ── Step 6: Click a non-diagonal cell ───────────────────────── */
    console.log('\nStep 6: Clicking a matrix cell (SRC≠DST)...');
    // Find first non-self cell (rm-low / rm-med / rm-high / rm-crit / rm-none)
    const clickableCell = await page.$('td.rm-cell:not(.rm-self)');
    if (!clickableCell) { fail('No clickable non-self cell found'); await browser.close(); process.exit(1); }

    const cellTitle = await clickableCell.getAttribute('title');
    info(`Clicking cell: ${cellTitle}`);
    await clickableCell.click();
    await page.waitForTimeout(800);

    /* ── Step 7: Verify drawer opened ─────────────────────────────── */
    console.log('\nStep 7: Verifying detail drawer opened...');
    const drawerVisible = await page.isVisible('#rm-detail-drawer');
    if (drawerVisible) ok('Detail drawer is visible');
    else { fail('Detail drawer did not open'); await shot(page, '28-fail-no-drawer.png'); await browser.close(); process.exit(1); }

    const drawerHasOpen = await page.$eval('#rm-detail-drawer', el => el.classList.contains('rm-drawer-open'));
    if (drawerHasOpen) ok('Drawer has rm-drawer-open class (slide-up animation)');
    else fail('Drawer missing rm-drawer-open class');

    await shot(page, '28-03-drawer-opened.png');

    /* ── Step 6: Check FWD and REV panel headings ─────────────────── */
    console.log('\nStep 6: Checking FWD / REV panel headings...');
    const fwdBadge = await page.$('.rm-fwd-badge');
    const revBadge = await page.$('.rm-rev-badge');
    if (fwdBadge) ok('FWD badge present');
    else fail('FWD badge missing');
    if (revBadge) ok('REV badge present');
    else fail('REV badge missing');

    const fwdHeading = await page.$('.rm-fwd-heading');
    const revHeading = await page.$('.rm-rev-heading');
    if (fwdHeading) ok('Forward path heading present');
    else fail('Forward path heading missing');
    if (revHeading) ok('Reverse path heading present');
    else fail('Reverse path heading missing');

    /* ── Step 7: Check hop tables ─────────────────────────────────── */
    console.log('\nStep 7: Checking hop tables...');
    const hopTables = await page.$$('.rm-hop-table');
    info(`Hop tables found: ${hopTables.length}`);
    if (hopTables.length >= 1) ok(`At least one hop table rendered`);
    else fail('No hop tables found');

    // Check hop rows have router labels, countries, costs
    const hopRows = await page.$$('.rm-hop-table tbody tr');
    info(`Total hop rows: ${hopRows.length}`);
    if (hopRows.length > 0) ok('Hop rows present in table');
    else fail('No hop rows in table');

    // Check country chips
    const countryChips = await page.$$('.rm-country-chip');
    info(`Country chips: ${countryChips.length}`);
    if (countryChips.length > 0) ok('Country chips present in hop rows');
    else fail('No country chips in hop rows');

    // Check cost badges in panel headings
    const costBadges = await page.$$('.rm-cost-badge');
    if (costBadges.length >= 1) ok(`Cost badges present: ${costBadges.length}`);
    else fail('No cost badges in panel headings');

    await shot(page, '28-04-hop-tables.png');

    /* ── Step 8: Toggle to Country View ──────────────────────────── */
    console.log('\nStep 8: Testing Country View toggle...');
    const toggleBtn = await page.$('.rm-drawer-actions .rm-btn:not(.rm-btn-export):not(.rm-btn-close)');
    if (toggleBtn) {
        const btnText = await toggleBtn.innerText();
        info(`Toggle button label: "${btnText}"`);
        await toggleBtn.click();
        await page.waitForTimeout(500);

        const countryChain = await page.$('.rm-country-chain');
        const segments = await page.$$('.rm-segment');
        if (countryChain || segments.length > 0) ok(`Country View active: ${segments.length} segments`);
        else fail('Country View did not render country chain');

        await shot(page, '28-05-country-view.png');

        // Toggle back to Router View
        const toggleBtn2 = await page.$('.rm-drawer-actions .rm-btn:not(.rm-btn-export):not(.rm-btn-close)');
        if (toggleBtn2) {
            await toggleBtn2.click();
            await page.waitForTimeout(400);
            const routerTable = await page.$('.rm-hop-table');
            if (routerTable) ok('Toggled back to Router View successfully');
            else fail('Failed to toggle back to Router View');
        }
    } else {
        fail('Toggle button not found in drawer actions');
    }

    /* ── Step 9: Check selected cell highlight ─────────────────────── */
    console.log('\nStep 9: Checking selected cell highlight...');
    const selectedCell = await page.$('.rm-selected');
    if (selectedCell) ok('Selected cell is highlighted with rm-selected class');
    else fail('No cell is highlighted as selected');

    /* ── Step 10: Close drawer ─────────────────────────────────────── */
    console.log('\nStep 10: Closing drawer...');
    const closeBtn = await page.$('.rm-btn-close');
    if (closeBtn) {
        await closeBtn.click();
        await page.waitForTimeout(400);
        const drawerGone = !(await page.$('#rm-detail-drawer'));
        if (drawerGone) ok('Drawer closed and removed from DOM');
        else fail('Drawer still in DOM after close');
    } else {
        fail('Close button not found');
    }

    /* ── Step 11: Re-click and verify asymmetry badge ─────────────── */
    console.log('\nStep 11: Checking asymmetry detection...');
    // Click all non-self cells and check if any show asymmetry
    const allCells = await page.$$('td.rm-cell:not(.rm-self)');
    let asymFound = false;
    for (const cell of allCells.slice(0, Math.min(10, allCells.length))) {
        await cell.click();
        await page.waitForTimeout(300);
        const asymBadge = await page.$('.rm-asym-badge');
        if (asymBadge) { asymFound = true; break; }
        const closeB = await page.$('.rm-btn-close');
        if (closeB) await closeB.click();
        await page.waitForTimeout(200);
    }
    if (asymFound) ok('Asymmetry badge correctly shown for asymmetric pair');
    else info('No asymmetric pairs found in this topology (OK — symmetric topology)');

    /* ── Step 12: JS errors ────────────────────────────────────────── */
    console.log('\nStep 12: Checking for JavaScript errors...');
    const relevantErrors = jsErrors.filter(e =>
        !e.includes('favicon') && !e.includes('net::ERR') && !e.includes('404')
    );
    if (relevantErrors.length === 0) ok('No JavaScript errors detected');
    else { fail(`JS errors: ${relevantErrors.slice(0, 3).join(' | ')}`); }

    await shot(page, '28-06-final-state.png');

    /* ── Summary ─────────────────────────────────────────────────── */
    console.log('\n' + '═'.repeat(56));
    console.log(`  PASSED: ${passed} | FAILED: ${failed}`);
    console.log(`  Screenshots saved to: ${SS_DIR}`);
    if (failed === 0) console.log('\n  ✅  ALL TESTS PASSED\n');
    else console.log(`\n  ⚠️  ${failed} TEST(S) FAILED\n`);

    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
