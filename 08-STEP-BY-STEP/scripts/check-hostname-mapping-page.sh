#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_CMD=(docker compose --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml")

cd "$PROJECT_ROOT"

"${COMPOSE_CMD[@]}" exec -T e2e-runner node -e "const { chromium } = require('playwright'); (async()=>{ const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto('http://webserver:8081/ospf-host-to-dns-mapping', { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForTimeout(2500); await page.locator('body').waitFor({ state: 'visible', timeout: 5000 }); const emptyVisible = await page.locator('#hostToDnsEmptyState').isVisible().catch(() => false); const fallbackVisible = await page.locator('#hostToDnsFallback').isVisible().catch(() => false); const mainSelectOptions = await page.locator('#select_graph_time_id option').count().catch(() => 0); const srcSelectOptions = await page.locator('#hostToDnsSrcGraph option').count().catch(() => 0); const dstSelectOptions = await page.locator('#hostToDnsDstGraph option').count().catch(() => 0); const result = { emptyVisible, fallbackVisible, mainSelectOptions, srcSelectOptions, dstSelectOptions }; console.log('[08-step] Hostname mapping page check: ' + JSON.stringify(result)); if (emptyVisible || mainSelectOptions < 1 || srcSelectOptions < 1 || dstSelectOptions < 1) { await browser.close(); process.exit(1); } await browser.close(); })().catch(async err => { console.error('[08-step] Hostname mapping page check failed:', err.message); process.exit(1); });"
