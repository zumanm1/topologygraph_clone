# =============================================================================
# docker/e2e-runner/Dockerfile
# OSPF Country Topology — Playwright E2E test runner container
# =============================================================================
#
# PURPOSE
# ───────
# Runs the full 114-check Playwright validation suite inside Docker:
#   tests/validate-full-e2e-v2.cjs    (12-phase, 114 checks)
#   tests/validate-country-filter.cjs (legacy country filter)
#   06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh
#
# The project root is mounted at /app so test files are available at:
#   /app/tests/validate-full-e2e-v2.cjs
#
# BASE IMAGE
# ──────────
# node:18-slim — lean Node.js 18 base
# Playwright + Chromium installed via npx playwright install
# (Avoids the 735MB mcr.microsoft.com/playwright image download)
#
# =============================================================================

FROM node:18-slim

LABEL maintainer="OSPF Country Topology E2E Runner"
LABEL description="Playwright E2E test runner: Node.js 18 + Chromium"

# System dependencies for tools + Chromium browser
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        curl \
        jq \
        python3 \
        python3-pip \
        ca-certificates \
        # Chromium system dependencies for Playwright
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install Python requests for any inline validation scripts
RUN pip3 install --no-cache-dir requests --break-system-packages 2>/dev/null || \
    pip3 install --no-cache-dir requests

# Install Playwright npm package ONLY (browser binaries downloaded at runtime)
# Chromium is installed on first `docker compose exec e2e-runner` run via
# docker-e2e.sh which runs: npx playwright install chromium
# Browsers are stored in the playwright-browsers named volume for persistence.
WORKDIR /playwright-setup
COPY package-bootstrap.json package.json
RUN npm install

# Chromium browser storage — persisted in a named volume
# docker-e2e.sh installs chromium on first run
ENV PLAYWRIGHT_BROWSERS_PATH=/playwright-browsers

# NODE_PATH so playwright can be found from /app context
ENV NODE_PATH=/playwright-setup/node_modules

# Working directory — project root will be mounted here
WORKDIR /app

# Default: keep container alive for `docker exec` triggers
CMD ["sleep", "infinity"]
