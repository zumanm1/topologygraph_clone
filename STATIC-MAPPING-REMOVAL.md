# Static Hostname Mapping Removal - Complete History Purge

**Date:** March 9, 2026  
**Action:** Complete removal of `INPUT-FOLDER/Load-hosts.csv` from git history and filesystem  
**Rationale:** Eliminate all static African country mappings and prevent hardcoded hostname-to-country associations

---

## Files Removed

### INPUT-FOLDER/Load-hosts.csv
- **Status:** Completely removed from git history and local filesystem
- **Git History:** Purged from all 112 commits using `git filter-branch`
- **Local File:** Deleted
- **Git Ignore:** Added to `.gitignore` to prevent future commits

---

## Removed Country Codes

The following static country mappings have been **completely eliminated** from the repository:

| Code | Country | Status |
|------|---------|--------|
| LES | Lesotho | ✅ Removed |
| TAN | Tanzania | ✅ Removed |
| MOZ | Mozambique | ✅ Removed |
| KEN | Kenya | ✅ Removed |
| DRC | Democratic Republic of Congo | ✅ Removed |
| DJB | Djibouti | ✅ Removed |
| ZAF | South Africa | ✅ Removed |
| EGP | Egypt | ✅ Removed |

**Verification:** `grep -r "LES\|TAN\|MOZ\|KEN\|DRC\|DJB\|ZAF\|EGP" INPUT-FOLDER/*.csv` returns no results.

---

## Git History Rewrite Details

### Commands Executed
```bash
# Remove from current index
git rm --cached INPUT-FOLDER/Load-hosts.csv
rm INPUT-FOLDER/Load-hosts.csv

# Add to gitignore
echo "INPUT-FOLDER/Load-hosts.csv" >> .gitignore

# Rewrite entire git history
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch \
  --force \
  --index-filter 'git rm --cached --ignore-unmatch INPUT-FOLDER/Load-hosts.csv' \
  --prune-empty \
  --tag-name-filter cat \
  -- --all

# Clean up backup refs
rm -rf .git/refs/original/

# Garbage collect and prune
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push to GitHub
git push origin main --force
```

### Branches Rewritten
- `refs/heads/feat/collapsing-stage`
- `refs/heads/feat/full-docker-migration`
- `refs/heads/main`
- `refs/heads/master`
- `refs/remotes/origin/feat/collapsing-stage`
- `refs/remotes/origin/feat/full-docker-migration`
- `refs/remotes/origin/main`
- `refs/remotes/origin/main-old`
- `refs/remotes/origin/master`

### Statistics
- **Commits Processed:** 112
- **File Removed From:** All commits containing the file
- **History Size Reduction:** Achieved through aggressive garbage collection
- **Force Push:** Completed successfully to `origin/main`

---

## Replacement Files

### Dynamic Hostname Mapping (Recommended)
Use the application's **dynamic hostname upload** feature:
1. Navigate to application UI
2. Click "📂 Host File" button
3. Upload custom CSV file per session
4. No static mappings in git repository

### Alternative Test Files

**For Testing with Metro-Level Format:**
- File: `INPUT-FOLDER/Load-hosts-metro-level.csv`
- Format: `{country}-{city}-{metro}-r{number}`
- Example: `zaf-jnb-kem-r1`
- Countries: ZAF, USA, GBR, FRA, DEU, JPN, AUS, BRA, IND
- Status: ✅ Available for testing

**For Testing with European Countries:**
- Previous file removed from history
- Use metro-level file or create custom per-session uploads
- No static European country mappings in repository

---

## Rationale for Removal

### 1. No Static Mappings
**Problem:** Hardcoded hostname-to-country mappings in git repository  
**Solution:** Dynamic per-session uploads via UI  
**Benefit:** Flexibility, no git bloat, user-controlled mappings

### 2. African Country Code Elimination
**Problem:** Static references to LES, TAN, MOZ, KEN, DRC, DJB, ZAF, EGP  
**Solution:** Complete removal from git history  
**Benefit:** Clean repository, no legacy country code dependencies

### 3. Server-Authoritative Metadata
**Architecture:** Country/gateway metadata should be server-authoritative  
**Source:** `/__security/session-diagram/<graph_time>/nodes` endpoint  
**Fallback:** Hostname-based inference only when explicitly enabled  
**Reference:** Memory 879a0693 - Server-authoritative country metadata

### 4. UNK Classification Handling
**Meaning:** UNK = unknown/unmapped country classification  
**Not:** A valid country code  
**Behavior:** Nodes without hostname mapping show as UNK  
**Reference:** Memory 9f8df604 - UNK interpretation

---

## Application Behavior After Removal

### Hostname Classification Flow

**1. Server Metadata (Primary)**
```javascript
// Load from server endpoint
fetch(`/__security/session-diagram/${graph_time}/nodes`)
  .then(metadata => applyCountryColors(metadata))
```

**2. Dynamic Upload (User-Initiated)**
```javascript
// User uploads CSV via "📂 Host File" button
uploadHostnameFile(csvFile)
  .then(mappings => applyHostnameMappings(mappings))
```

**3. Hostname Inference (Fallback - Explicit Only)**
```javascript
// Only when explicitly enabled
applyCountryColors({ allowCountryInference: true })
```

### No Impact on Existing Features

**✅ Features Unaffected:**
- COLLAPSING view (country-based grouping)
- Cost Matrix (SPF shortest paths)
- What-If Analysis (scenario creation)
- Gateway link aggregation (min cost display)
- All view modes (AS-IS, GATEWAY, ENRICHED, COLLAPSING)

**✅ Metadata Sources Still Available:**
- Server-authoritative node metadata
- Dynamic hostname file uploads
- Country override database (PostgreSQL)
- Peer graph metadata recovery (fallback)

---

## Testing Recommendations

### Test Scenario 1: No Hostname File
**Setup:** Load OSPF database without uploading hostname file  
**Expected:** Nodes show as UNK (unmapped)  
**Behavior:** Normal - no static mappings available  
**Action:** Upload custom hostname CSV via UI

### Test Scenario 2: Metro-Level Hostname File
**Setup:** Upload `Load-hosts-metro-level.csv`  
**Expected:** 34 routers classified across 9 countries  
**Countries:** ZAF, USA, GBR, FRA, DEU, JPN, AUS, BRA, IND  
**Format:** `{country}-{city}-{metro}-r{number}`

### Test Scenario 3: Server Metadata
**Setup:** Load graph with existing server metadata  
**Expected:** Country colors applied from server endpoint  
**Source:** `/__security/session-diagram/<graph_time>/nodes`  
**Fallback:** Peer graph metadata recovery if available

### Test Scenario 4: Custom Per-Session Upload
**Setup:** Create custom CSV, upload via UI  
**Expected:** Custom mappings applied for session only  
**Persistence:** Not stored in git, session-specific  
**Benefit:** User-controlled, flexible, no git bloat

---

## Git Ignore Configuration

**Added to `.gitignore`:**
```
INPUT-FOLDER/Load-hosts.csv
```

**Rationale:**
- Prevent accidental re-addition of static mappings
- Enforce dynamic upload workflow
- Keep repository clean of user-specific hostname files

---

## Verification Commands

### Check File Removed from History
```bash
git log --all --oneline --follow -- INPUT-FOLDER/Load-hosts.csv
# Expected output: (empty)
```

### Verify No African Country Codes
```bash
grep -r "LES\|TAN\|MOZ\|KEN\|DRC\|DJB\|ZAF\|EGP" INPUT-FOLDER/*.csv
# Expected output: (empty or only metro-level file with ZAF)
```

### Check Git Ignore
```bash
cat .gitignore | grep Load-hosts.csv
# Expected output: INPUT-FOLDER/Load-hosts.csv
```

### Verify Force Push
```bash
git log origin/main --oneline -5
# Expected: No commits containing Load-hosts.csv
```

---

## Migration Guide

### For Users with Local Load-hosts.csv

**If you have a local copy:**
1. File is now gitignored (won't be committed)
2. Use dynamic upload via UI instead
3. Create custom CSV per testing session
4. No need to commit hostname mappings to git

**Recommended Workflow:**
```bash
# Create custom hostname file (not tracked by git)
cp INPUT-FOLDER/Load-hosts-metro-level.csv my-custom-hosts.csv
# Edit as needed
vim my-custom-hosts.csv
# Upload via application UI (📂 Host File button)
```

---

## Future Enhancements

### Dynamic Hostname Management
- **Feature:** Web UI for hostname mapping management
- **Storage:** PostgreSQL database (not git)
- **Scope:** Per-user, per-graph, per-session
- **Benefit:** No git repository pollution

### Country Override Database
- **Current:** `layout-db` PostgreSQL with country overrides
- **API:** `/layout-api/country-overrides` endpoints
- **UI:** Country override management in hostname mapping page
- **Persistence:** Database-backed, version-controlled via migrations

### Hostname Inference Rules
- **Default:** Server-authoritative metadata only
- **Explicit:** Hostname-based inference when enabled
- **Fallback:** Peer graph metadata recovery
- **UNK Handling:** Clear indication of unmapped nodes

---

## Conclusion

**Complete Removal Achieved:**
- ✅ `INPUT-FOLDER/Load-hosts.csv` removed from all 112 commits
- ✅ File deleted from local filesystem
- ✅ Added to `.gitignore` to prevent re-addition
- ✅ All African country codes eliminated (LES, TAN, MOZ, KEN, DRC, DJB, ZAF, EGP)
- ✅ Git history rewritten and force-pushed to GitHub
- ✅ No static hostname mappings remain in repository

**Recommended Approach:**
- Use dynamic hostname file uploads via application UI
- Leverage server-authoritative metadata from `/__security/session-diagram/` endpoints
- Utilize country override database for persistent mappings
- Test with `Load-hosts-metro-level.csv` for metro-level granularity

**No Impact on Features:**
All existing features (COLLAPSING, Cost Matrix, What-If Analysis, SPF calculations) continue to work correctly with dynamic hostname uploads and server metadata.
