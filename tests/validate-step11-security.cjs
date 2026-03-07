#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';
const GRAPH_TIME = (process.env.GRAPH_TIME || process.env.GRAPH_TIMES || '').split(',')[0].trim();
const SS_DIR = process.env.SCREENSHOT_DIR ? path.resolve(process.env.SCREENSHOT_DIR) : path.join(__dirname, '..', '11-STEP-BY-STEP-SECURITY', 'screenshots');

let PASS = 0, FAIL = 0, WARN = 0;
const log = (s) => process.stdout.write(s + '\n');
const pass = (t, m) => { PASS++; log(`  PASS [${t}]: ${m}`); };
const fail = (t, m) => { FAIL++; log(`  FAIL [${t}]: ${m}`); };
const warn = (t, m) => { WARN++; log(`  WARN [${t}]: ${m}`); };
const settle = (p, ms=800) => p.waitForTimeout(ms);
async function shot(page, name) { fs.mkdirSync(SS_DIR, { recursive: true }); await page.screenshot({ path: path.join(SS_DIR, name + '.png'), fullPage: false }); }

async function fetchStatus(page, payload) {
  return page.evaluate(async ({ url, auth, credentials }) => {
    const headers = {};
    if (auth) headers.Authorization = auth;
    const response = await fetch(url, { headers, credentials: credentials || 'same-origin' });
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (e) {}
    return { status: response.status, bodyText: bodyText.slice(0, 200) };
  }, payload);
}

async function resolveGraphTimeFromUi(page) {
  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 800);
  return page.evaluate(() => {
    const sel = document.getElementById('dynamic_graph_time') || document.getElementById('graph_time');
    if (!sel || !sel.options || !sel.options.length) return '';
    const values = Array.from(sel.options).map(o => String(o.value || '').trim()).filter(Boolean);
    const d54 = values.filter(v => v.includes('_54_hosts'));
    return d54[0] || values[0] || '';
  });
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await settle(page, 500);
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await Promise.race([page.press('#password', 'Enter'), page.click('input[type="submit"], button[type="submit"]').catch(() => {})]);
  await settle(page, 1500);
  return !page.url().includes('/login');
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const anonContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anonPage = await anonContext.newPage();
  try {
    log('╔══════════════════════════════════════════════════════════════════╗');
    log('║   11-STEP-BY-STEP-SECURITY — Focused Security Validation       ║');
    log('╚══════════════════════════════════════════════════════════════════╝');

    await anonPage.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await settle(anonPage, 500);

    const okLogin = await login(page);
    okLogin ? pass('AUTH', `Logged in as ${API_USER}`) : fail('AUTH', 'Login failed');
    if (!okLogin) throw new Error('login failed');

    const effectiveGraphTime = GRAPH_TIME || await resolveGraphTimeFromUi(page);
    effectiveGraphTime ? pass('GRAPH', `Resolved graph_time ${effectiveGraphTime}`) : warn('GRAPH', 'No graph_time resolved from env or UI');

    const tokenCreateResp = await page.goto(`${BASE_URL}/token_management/create_token`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const cc = (tokenCreateResp && tokenCreateResp.headers()['cache-control']) || '';
    cc.includes('no-store') ? pass('HDR', 'Token create page is no-store') : fail('HDR', `Token create page cache-control unexpected: ${cc || 'missing'}`);

    const tokenName = `step11-token-${Date.now()}`;
    await page.fill('input[name="token_name"]', tokenName);
    await page.fill('textarea[name="description"]', 'step11 security validation token');
    await page.click('button[type="submit"]');
    await settle(page, 1000);
    const tokenValue = (await page.locator('#generated-token-value').textContent().catch(() => '') || '').trim();
    if (tokenValue.startsWith('sk-')) pass('TOKEN', 'One-time token value rendered'); else throw new Error('generated token missing');
    await shot(page, 'step11-token-created');

    await page.goto(`${BASE_URL}/token_management/my_tokens`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await settle(page, 800);
    const tokenPageText = await page.locator('body').innerText();
    !tokenPageText.includes(tokenValue) ? pass('TOKEN', 'Raw token not shown on token list page') : fail('TOKEN', 'Raw token leaked on token list page');
    tokenPageText.includes(tokenValue.slice(-4)) ? pass('TOKEN', 'Masked token listing shows last4 only') : warn('TOKEN', 'Could not confirm masked token last4 in list page');

    const apiAnon = await fetchStatus(anonPage, { url: '/api/graph/', credentials: 'omit' });
    apiAnon.status === 401 ? pass('API', 'Anonymous /api/graph/ rejected') : fail('API', `Anonymous /api/graph/ returned HTTP ${apiAnon.status}`);

    const apiSession = await fetchStatus(page, { url: '/api/graph/', credentials: 'same-origin' });
    apiSession.status === 200 ? pass('API', 'Session-authenticated /api/graph/ works without Authorization header') : fail('API', `Session /api/graph/ returned HTTP ${apiSession.status}`);

    const bearerOk = await fetchStatus(anonPage, { url: '/api/graph/', auth: `Bearer ${tokenValue}`, credentials: 'omit' });
    bearerOk.status === 200 ? pass('BEARER', 'Bearer-only /api/graph/ access works without session cookies') : fail('BEARER', `Bearer-only /api/graph/ returned HTTP ${bearerOk.status}`);

    const bearerBad = await fetchStatus(page, { url: '/api/graph/', auth: 'Bearer sk-invalid-step11', credentials: 'same-origin' });
    bearerBad.status === 401 ? pass('BEARER', 'Invalid bearer rejected even with active session (no fallback)') : fail('BEARER', `Invalid bearer with session returned HTTP ${bearerBad.status}`);

    const layoutBearerOnly = await fetchStatus(anonPage, { url: '/layout-api/layouts?graph_id=x&graph_time=y&view_mode=z', auth: `Bearer ${tokenValue}`, credentials: 'omit' });
    layoutBearerOnly.status === 401 ? pass('LAYOUT', 'Bearer-only access to layout-api is rejected (session boundary preserved)') : fail('LAYOUT', `Bearer-only layout-api access returned HTTP ${layoutBearerOnly.status}`);

    const mcpAnon = await fetchStatus(anonPage, { url: '/mcp', credentials: 'omit' });
    mcpAnon.status === 401 ? pass('MCP', 'Anonymous /mcp access rejected') : fail('MCP', `Anonymous /mcp returned HTTP ${mcpAnon.status}`);

    const mcpSession = await fetchStatus(page, { url: '/mcp', credentials: 'same-origin' });
    mcpSession.status === 401 ? pass('MCP', 'Session-only /mcp access rejected (bearer required)') : fail('MCP', `Session-only /mcp returned HTTP ${mcpSession.status}`);

    const tokenRow = page.locator('table tbody tr').filter({ hasText: tokenName }).first();
    if (await tokenRow.count()) {
      await Promise.allSettled([
        page.waitForLoadState('domcontentloaded').catch(() => null),
        tokenRow.locator('form[action*="/revoke_token/"] button').click()
      ]);
      await settle(page, 1200);
      pass('TOKEN', 'Token revoke submitted');
      const revokedStatus = await fetchStatus(anonPage, { url: '/api/graph/', auth: `Bearer ${tokenValue}`, credentials: 'omit' });
      revokedStatus.status === 401 ? pass('BEARER', 'Revoked bearer token rejected') : fail('BEARER', `Revoked bearer returned HTTP ${revokedStatus.status}`);
    } else {
      fail('TOKEN', 'Created token row not found for revoke check');
    }

    const layoutSessionStatus = await page.evaluate(async () => {
      const r = await fetch('/layout-api/layouts?graph_id=x&graph_time=y&view_mode=z', { credentials: 'same-origin' });
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    layoutSessionStatus.status === 200 ? pass('LAYOUT', 'Session-authenticated layout-api access works') : fail('LAYOUT', `layout-api session access returned HTTP ${layoutSessionStatus.status}`);

    if (effectiveGraphTime) {
      const sessionDiagram = await page.evaluate(async (gt) => {
        const r = await fetch('/__security/session-diagram/' + encodeURIComponent(gt) + '/nodes', { credentials: 'same-origin' });
        const body = await r.json().catch(() => null);
        return { status: r.status, count: Array.isArray(body) ? body.length : -1 };
      }, effectiveGraphTime);
      sessionDiagram.status === 200 && sessionDiagram.count > 0
        ? pass('PROXY', `Session diagram proxy returned ${sessionDiagram.count} nodes`)
        : fail('PROXY', `Session diagram proxy returned HTTP ${sessionDiagram.status} count=${sessionDiagram.count}`);
    } else {
      warn('PROXY', 'GRAPH_TIME not provided; skipped session diagram proxy validation');
    }
  } catch (err) {
    fail('FATAL', err.message || String(err));
  } finally {
    await browser.close();
    log('');
    log(`TOTAL PASSED: ${PASS}`);
    log(`TOTAL FAILED: ${FAIL}`);
    log(`TOTAL WARNED: ${WARN}`);
    process.exit(FAIL > 0 ? 1 : 0);
  }
})().catch(err => { console.error(err && err.stack ? err.stack : String(err)); process.exit(1); });
