#!/bin/bash
# Test Script: European Countries Hostname Mapping
# Tests the application with updated Load-hosts.csv (European countries)

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  European Countries Test - Automated Validation             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Configuration
OSPF_DB_FILE="INPUT-FOLDER/ospf-database-54-unk-test.txt"
HOSTNAME_FILE="INPUT-FOLDER/Load-hosts.csv"
APP_URL="http://localhost:8081"

echo "📋 Test Configuration:"
echo "   OSPF Database: $OSPF_DB_FILE"
echo "   Hostname File: $HOSTNAME_FILE"
echo "   Application:   $APP_URL"
echo ""

# Step 1: Verify files exist
echo "✓ Step 1: Verifying test files..."
if [ ! -f "$OSPF_DB_FILE" ]; then
    echo "❌ ERROR: OSPF database file not found: $OSPF_DB_FILE"
    exit 1
fi

if [ ! -f "$HOSTNAME_FILE" ]; then
    echo "❌ ERROR: Hostname file not found: $HOSTNAME_FILE"
    exit 1
fi

echo "   ✓ OSPF database file exists"
echo "   ✓ Hostname file exists"
echo ""

# Step 2: Verify hostname file has European countries
echo "✓ Step 2: Verifying European country codes in hostname file..."
EUROPEAN_COUNTRIES=$(grep -E "deu|ita|esp|nld|bel|che|gbr|fra|por|aut" "$HOSTNAME_FILE" | wc -l | tr -d ' ')
TOTAL_ROUTERS=$(tail -n +2 "$HOSTNAME_FILE" | wc -l | tr -d ' ')

echo "   ✓ European country entries: $EUROPEAN_COUNTRIES"
echo "   ✓ Total routers: $TOTAL_ROUTERS"

if [ "$EUROPEAN_COUNTRIES" -eq 0 ]; then
    echo "❌ ERROR: No European country codes found in hostname file"
    exit 1
fi

# Verify no African countries remain
AFRICAN_COUNTRIES=$(grep -iE "les-|tan-|moz-|ken-|drc-|djb-|zaf-" "$HOSTNAME_FILE" | wc -l | tr -d ' ')
if [ "$AFRICAN_COUNTRIES" -gt 0 ]; then
    echo "❌ ERROR: African country codes still present in hostname file"
    grep -iE "les-|tan-|moz-|ken-|drc-|djb-|zaf-" "$HOSTNAME_FILE"
    exit 1
fi
echo "   ✓ No African country codes found (as expected)"
echo ""

# Step 3: Verify application is running
echo "✓ Step 3: Verifying application is running..."
if ! curl -s -o /dev/null -w "%{http_code}" "$APP_URL" | grep -q "200\|302"; then
    echo "❌ ERROR: Application not responding at $APP_URL"
    echo "   Please ensure: docker compose up -d"
    exit 1
fi
echo "   ✓ Application is running at $APP_URL"
echo ""

# Step 4: Verify Docker services
echo "✓ Step 4: Verifying Docker services..."
SERVICES_UP=$(docker compose ps --services --filter "status=running" | wc -l | tr -d ' ')
echo "   ✓ Running services: $SERVICES_UP"

if [ "$SERVICES_UP" -lt 5 ]; then
    echo "⚠️  WARNING: Expected at least 5 services running"
    docker compose ps
fi
echo ""

# Step 5: Display country breakdown
echo "✓ Step 5: Country breakdown in hostname file:"
echo ""
echo "   Country | Routers | Cities"
echo "   --------|---------|------------------"
for country in DEU ITA ESP NLD BEL CHE GBR FRA POR AUT; do
    count=$(grep -i "^[0-9.]*,$country" "$HOSTNAME_FILE" | wc -l | tr -d ' ')
    cities=$(grep -i "^[0-9.]*,$country" "$HOSTNAME_FILE" | cut -d'-' -f2 | sort -u | tr '\n' ',' | sed 's/,$//')
    printf "   %-7s | %-7s | %s\n" "$country" "$count" "$cities"
done
echo ""

# Step 6: OSPF Database analysis
echo "✓ Step 6: OSPF database analysis..."
ROUTER_COUNT=$(grep -E "^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" "$OSPF_DB_FILE" | wc -l | tr -d ' ')
echo "   ✓ Router entries in OSPF database: $ROUTER_COUNT"
echo ""

# Step 7: Manual test instructions
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  MANUAL TEST INSTRUCTIONS                                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "1. Open browser: $APP_URL"
echo ""
echo "2. Upload OSPF Database:"
echo "   - Click 'Choose File' or drag-and-drop"
echo "   - Select: $OSPF_DB_FILE"
echo "   - Click 'Show Graph'"
echo ""
echo "3. Upload Hostname File:"
echo "   - Click '📂 Host File' button"
echo "   - Select: $HOSTNAME_FILE"
echo "   - Click 'Upload'"
echo ""
echo "4. Verify Results:"
echo "   ✓ All nodes should be classified (no UNK nodes)"
echo "   ✓ Countries: DEU, ITA, ESP, NLD, BEL, CHE, GBR, FRA, POR, AUT"
echo "   ✓ Total: 36 routers across 10 European countries"
echo ""
echo "5. Test COLLAPSING View:"
echo "   - Switch to COLLAPSING view mode"
echo "   - Collapse individual countries"
echo "   - Verify inter-country links remain visible"
echo "   - Check meta-edge labels show 'min=' not 'Σ'"
echo ""
echo "6. Test Cost Matrix:"
echo "   - Click '🗺 Cost Matrix' button"
echo "   - Verify 10×10 matrix (European countries)"
echo "   - Check SPF shortest path calculations"
echo ""
echo "7. Test What-If Analysis:"
echo "   - Click '🔬 What-If' button"
echo "   - Create scenario with European router"
echo "   - Verify before/after comparison"
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  VALIDATION CHECKLIST                                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "[ ] No UNK (unclassified) nodes after hostname upload"
echo "[ ] All 10 European countries recognized"
echo "[ ] COLLAPSING view preserves inter-country links"
echo "[ ] Gateway link aggregation shows 'min=' (not 'Σ')"
echo "[ ] Cost Matrix uses SPF (Dijkstra) algorithm"
echo "[ ] What-If analysis works with European topology"
echo "[ ] No African country codes visible anywhere"
echo ""
echo "✅ Pre-test validation complete!"
echo "   Ready for manual testing in browser."
echo ""
