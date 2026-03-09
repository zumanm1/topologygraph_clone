# European Countries Test Validation Report

**Date:** March 9, 2026  
**Test Scope:** Validate application functionality with updated Load-hosts.csv (European countries)  
**Previous Data:** African countries (LES, TAN, MOZ, KEN, DRC, DJB, ZAF)  
**New Data:** European countries (DEU, ITA, ESP, NLD, BEL, CHE, GBR, FRA, POR, AUT)

---

## Test Configuration

### Updated Load-hosts.csv Content

**Total Routers:** 36  
**Total Countries:** 10 European countries

| Country Code | Country Name    | Cities                          | Router Count |
|--------------|-----------------|----------------------------------|--------------|
| DEU          | Germany         | Berlin (ber), Munich (mun)       | 3            |
| ITA          | Italy           | Rome (rom), Milan (mil)          | 2            |
| ESP          | Spain           | Madrid (mad), Barcelona (bcn)    | 4            |
| NLD          | Netherlands     | Amsterdam (ams)                  | 2            |
| BEL          | Belgium         | Brussels (bru), Antwerp (ant)    | 4            |
| CHE          | Switzerland     | Zurich (zur)                     | 2            |
| GBR          | United Kingdom  | London (lon)                     | 3            |
| FRA          | France          | Paris (par)                      | 3            |
| POR          | Portugal        | Lisbon (lis)                     | 3            |
| AUT          | Austria         | Vienna (vie), Salzburg (slz), Graz (grz), Innsbruck (inn) | 8 |

**Hostname Format:** `{country_code}-{city_code}-r{number}`  
**Example:** `deu-ber-r1` (Germany, Berlin, Router 1)

---

## Test Scenarios

### 1. Hostname File Upload Test

**Objective:** Verify the application correctly parses and applies the updated Load-hosts.csv file.

**Expected Behavior:**
- ✅ File upload succeeds
- ✅ All 36 routers classified with correct country codes
- ✅ No UNK (unclassified) nodes after upload
- ✅ Country colors applied correctly
- ✅ Hostname tooltips display correctly

**Test Steps:**
1. Navigate to http://localhost:8081/upload-ospf-isis-lsdb
2. Load existing OSPF database (54 hosts test file)
3. Click "📂 Host File" button
4. Upload `INPUT-FOLDER/Load-hosts.csv`
5. Verify country classification in graph

**Validation Criteria:**
- [ ] All nodes show country badges (DEU, ITA, ESP, NLD, BEL, CHE, GBR, FRA, POR, AUT)
- [ ] No nodes marked as UNK
- [ ] Tooltips show full hostname (e.g., "deu-ber-r1")
- [ ] Country colors distinct and visible

---

### 2. Country Classification Test

**Objective:** Verify country-based node grouping and classification.

**Expected Behavior:**
- ✅ Nodes grouped by country code
- ✅ Country metadata stored correctly
- ✅ Gateway vs. core router classification preserved
- ✅ Cross-country links identified correctly

**Test Steps:**
1. Switch to ENRICHED view mode
2. Verify country-based coloring
3. Check node metadata (right-click → inspect)
4. Verify gateway nodes identified

**Validation Criteria:**
- [ ] DEU nodes: 3 routers (9.9.9.1-3)
- [ ] ITA nodes: 2 routers (10.10.10.1-2)
- [ ] ESP nodes: 4 routers (11.11.11.1-4)
- [ ] NLD nodes: 2 routers (12.12.12.1-2)
- [ ] BEL nodes: 4 routers (13.13.13.1-4)
- [ ] CHE nodes: 2 routers (14.14.14.1-2)
- [ ] GBR nodes: 3 routers (15.15.15.1-3)
- [ ] FRA nodes: 3 routers (16.16.16.1-3)
- [ ] POR nodes: 3 routers (17.17.17.1-3)
- [ ] AUT nodes: 8 routers (18.18.18.1-8)

---

### 3. COLLAPSING View Test

**Objective:** Verify COLLAPSING view correctly handles European country topology.

**Expected Behavior:**
- ✅ Intra-country edges collapsed
- ✅ Inter-country (gateway) edges preserved
- ✅ Gateway link aggregation shows **minimum cost** (not sum)
- ✅ Collapse badges show hidden router count
- ✅ SPF shortest path semantics maintained

**Test Steps:**
1. Switch to COLLAPSING view mode
2. Collapse individual countries (DEU, ITA, ESP, etc.)
3. Verify gateway links remain visible
4. Check meta-edge labels show "min=" not "Σ"
5. Verify tooltip shows primary route marked with ★

**Validation Criteria:**
- [ ] Intra-DEU edges hidden when DEU collapsed
- [ ] DEU↔GBR gateway links remain visible
- [ ] Meta-edge label format: "N links | min=X" (NOT "ΣX")
- [ ] Tooltip shows: "★ PRIMARY: Link1: cost 10" format
- [ ] Collapse badge shows correct hidden router count
- [ ] No cross-country edges collapsed

---

### 4. Cost Matrix Test (SPF Verification)

**Objective:** Verify Cost Matrix uses SPF (Dijkstra) shortest path calculations.

**Expected Behavior:**
- ✅ Matrix shows country-to-country shortest paths
- ✅ Uses Dijkstra's algorithm (not sum of paths)
- ✅ Minimum cost displayed for each country pair
- ✅ Heatmap colors reflect cost gradients
- ✅ Excel export works correctly

**Test Steps:**
1. Click "🗺 Cost Matrix" button
2. Verify matrix displays all 10 countries
3. Check diagonal values = 0 (same country)
4. Verify costs are shortest paths (not sums)
5. Test heatmap visualization
6. Export to Excel and verify data

**Validation Criteria:**
- [ ] Matrix size: 10×10 (all European countries)
- [ ] DEU→DEU = 0 (diagonal)
- [ ] All costs represent shortest paths via SPF
- [ ] No cost summation artifacts
- [ ] Heatmap colors scale correctly
- [ ] Excel export includes all country pairs

---

### 5. What-If Analysis Test

**Objective:** Verify What-If analysis works with European topology.

**Expected Behavior:**
- ✅ Scenario creation works with new country codes
- ✅ Node failure scenarios (e.g., deu-ber-r1)
- ✅ Link failure scenarios (e.g., DEU↔GBR link)
- ✅ Cost change scenarios with SPF recalculation
- ✅ Before/after matrix comparison accurate

**Test Steps:**
1. Click "🔬 What-If" button
2. Create node failure scenario (select DEU router)
3. Create link failure scenario (select inter-country link)
4. Create cost change scenario
5. Verify matrix comparison shows correct diffs
6. Check statistics (paths lost/improved/degraded)

**Validation Criteria:**
- [ ] Scenario creator lists European countries
- [ ] Node failure removes DEU router correctly
- [ ] Link failure preserves SPF semantics
- [ ] Cost matrix diff shows green/red/black colors
- [ ] Statistics accurate (paths lost, improved, degraded)
- [ ] Scenario list displays saved scenarios

---

### 6. Gateway Link Aggregation Test (SPF Fix)

**Objective:** Verify gateway link aggregation uses **minimum cost** (SPF) not sum.

**Expected Behavior:**
- ✅ Multiple parallel gateway links bundled
- ✅ Meta-edge shows **minimum** cost path
- ✅ Label format: "N links | min=X"
- ✅ Tooltip shows primary route with ★ marker
- ✅ Primary route sorted first in tooltip

**Test Steps:**
1. Switch to COLLAPSING view
2. Collapse countries with multiple gateway links
3. Inspect meta-edge labels
4. Hover over meta-edges to see tooltips
5. Verify primary route selection logic

**Validation Criteria:**
- [ ] Meta-edge label: "3 links | min=10" (NOT "Σ30")
- [ ] Tooltip format: "★ PRIMARY: Link1: cost 10\n  • Link2: cost 15"
- [ ] Primary route = minimum cost path
- [ ] Visual width scales with link count
- [ ] SPF shortest path principle maintained

---

### 7. View Mode Consistency Test

**Objective:** Verify all view modes work correctly with European countries.

**Test Steps:**
1. Test AS-IS view: Raw topology
2. Test GATEWAY view: Gateway nodes only
3. Test ENRICHED view: Country-colored nodes
4. Test COLLAPSING view: Selective country collapse

**Validation Criteria:**
- [ ] AS-IS: All 36 routers visible
- [ ] GATEWAY: Only gateway routers visible
- [ ] ENRICHED: Country colors applied
- [ ] COLLAPSING: Collapse/expand works per country
- [ ] All views preserve SPF cost calculations

---

## Expected Test Results

### Success Criteria

**All tests must pass:**
1. ✅ Hostname file upload succeeds with European countries
2. ✅ All 36 routers classified correctly (no UNK nodes)
3. ✅ COLLAPSING view preserves inter-country links
4. ✅ Gateway link aggregation shows **min cost** (SPF fix verified)
5. ✅ Cost Matrix uses Dijkstra's SPF algorithm
6. ✅ What-If analysis works with new topology
7. ✅ All view modes function correctly

### Regression Prevention

**Verify no African country artifacts remain:**
- [ ] No LES, TAN, MOZ, KEN, DRC, DJB, ZAF references
- [ ] All country codes are European (DEU, ITA, ESP, NLD, BEL, CHE, GBR, FRA, POR, AUT)
- [ ] No hardcoded African country mappings
- [ ] Country override database uses new data

---

## Test Execution Instructions

### Prerequisites
```bash
# Verify application is running
docker compose ps

# Verify Load-hosts.csv has European countries
cat INPUT-FOLDER/Load-hosts.csv | grep -E "deu|ita|esp|nld|bel|che|gbr|fra|por|aut"
```

### Manual Test Execution
1. Open browser: http://localhost:8081
2. Upload OSPF database (54 hosts test file)
3. Upload hostname file: `INPUT-FOLDER/Load-hosts.csv`
4. Execute test scenarios 1-7 above
5. Document results in this file

### Automated Validation (Future)
- Playwright E2E tests for hostname upload
- API tests for country classification
- SPF algorithm unit tests
- What-If scenario integration tests

---

## Test Results

**Test Date:** _To be filled after execution_  
**Tester:** _To be filled_  
**Status:** ⏳ Pending Execution

### Results Summary
- [ ] Test 1: Hostname File Upload - PENDING
- [ ] Test 2: Country Classification - PENDING
- [ ] Test 3: COLLAPSING View - PENDING
- [ ] Test 4: Cost Matrix (SPF) - PENDING
- [ ] Test 5: What-If Analysis - PENDING
- [ ] Test 6: Gateway Link Aggregation - PENDING
- [ ] Test 7: View Mode Consistency - PENDING

### Issues Found
_To be documented during testing_

### Recommendations
_To be documented after testing_

---

## Conclusion

This test plan validates that the application correctly handles the transition from African to European country data, ensuring:
1. No static country mappings remain
2. SPF (Shortest Path First) algorithm used consistently
3. Gateway link aggregation shows minimum cost (not sum)
4. All features work with new European topology

**Next Steps:**
1. Execute manual tests
2. Document results
3. Fix any issues found
4. Commit test results to GitHub
5. Update documentation with European country examples
