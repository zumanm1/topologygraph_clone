# 3-Level Hostname Format - Metro-Level Granularity

**Date:** March 9, 2026  
**Format:** `{country}-{city}-{metro}-r{number}`  
**Purpose:** Enhanced geographic granularity for network topology visualization

---

## Format Specification

### Naming Convention

```
{country}-{city}-{metro}-r{number}

Where:
  country = 3-letter ISO country code (lowercase)
  city    = 3-letter airport/city code (lowercase)
  metro   = 3-letter metro/district code (lowercase)
  r       = literal "r" (router indicator)
  number  = router sequence number (1, 2, 3, ...)
```

### Example Breakdown

**Hostname:** `zaf-jnb-kem-r1`

| Component | Value | Description |
|-----------|-------|-------------|
| Country   | `zaf` | South Africa (ZAF) |
| City      | `jnb` | Johannesburg (JNB airport code) |
| Metro     | `kem` | Kempton Park metro area |
| Router    | `r1`  | Router number 1 |

**Full Meaning:** Router 1 in Kempton Park metro, Johannesburg, South Africa

---

## Geographic Hierarchy

### Level 1: Country (ISO 3166-1 alpha-3)
- Provides country-level aggregation
- Used for COLLAPSING view grouping
- Examples: ZAF, USA, GBR, FRA, DEU, JPN, AUS, BRA, IND

### Level 2: City (IATA Airport Codes)
- Major city identification
- Typically uses 3-letter airport codes
- Examples: JNB (Johannesburg), NYC (New York), LON (London)

### Level 3: Metro/District (Custom 3-letter codes)
- Specific metro area, district, or suburb
- Provides fine-grained location data
- Examples: KEM (Kempton Park), MAN (Manhattan), CBD (Central Business District)

---

## Sample Hostname Mappings

### South Africa (ZAF)

**Johannesburg (JNB):**
- `zaf-jnb-kem-r1` - Kempton Park metro, Router 1
- `zaf-jnb-kem-r2` - Kempton Park metro, Router 2
- `zaf-jnb-san-r1` - Sandton metro, Router 1

**Cape Town (CPT):**
- `zaf-cpt-cbd-r1` - Central Business District, Router 1
- `zaf-cpt-tbl-r1` - Table Bay area, Router 1

### United States (USA)

**New York City (NYC):**
- `usa-nyc-man-r1` - Manhattan, Router 1
- `usa-nyc-man-r2` - Manhattan, Router 2
- `usa-nyc-bro-r1` - Brooklyn, Router 1
- `usa-nyc-que-r1` - Queens, Router 1

### United Kingdom (GBR)

**London (LON):**
- `gbr-lon-wst-r1` - Westminster, Router 1
- `gbr-lon-cty-r1` - City of London, Router 1

### France (FRA)

**Paris (PAR):**
- `fra-par-mar-r1` - Marais district, Router 1
- `fra-par-mar-r2` - Marais district, Router 2
- `fra-par-mon-r1` - Montmartre, Router 1
- `fra-par-mon-r2` - Montmartre, Router 2

### Germany (DEU)

**Berlin (BER):**
- `deu-ber-mit-r1` - Mitte district, Router 1
- `deu-ber-kre-r1` - Kreuzberg, Router 1

### Japan (JPN)

**Tokyo (TOK):**
- `jpn-tok-shi-r1` - Shibuya, Router 1
- `jpn-tok-shi-r2` - Shibuya, Router 2
- `jpn-tok-rop-r1` - Roppongi, Router 1

### Australia (AUS)

**Sydney (SYD):**
- `aus-syd-cbd-r1` - Central Business District, Router 1
- `aus-syd-cbd-r2` - Central Business District, Router 2
- `aus-syd-par-r1` - Parramatta, Router 1

### Brazil (BRA)

**São Paulo (SAO):**
- `bra-sao-cen-r1` - Centro (downtown), Router 1
- `bra-sao-cen-r2` - Centro (downtown), Router 2
- `bra-sao-pin-r1` - Pinheiros, Router 1

### India (IND)

**Mumbai (MUM):**
- `ind-mum-bkc-r1` - Bandra-Kurla Complex, Router 1
- `ind-mum-bkc-r2` - Bandra-Kurla Complex, Router 2
- `ind-mum-and-r1` - Andheri, Router 1
- `ind-mum-and-r2` - Andheri, Router 2

**Delhi (DEL):**
- `ind-del-con-r1` - Connaught Place, Router 1
- `ind-del-con-r2` - Connaught Place, Router 2
- `ind-del-gur-r1` - Gurgaon, Router 1
- `ind-del-noi-r1` - Noida, Router 1

---

## Benefits of 3-Level Format

### Enhanced Granularity
- **Country-level:** Macro topology view (COLLAPSING mode)
- **City-level:** Regional network hubs
- **Metro-level:** Precise location tracking

### Improved Visualization
- Color-coding by country (existing feature)
- Potential city-level grouping (future enhancement)
- Metro-level detail in tooltips and labels

### Operational Advantages
- **Troubleshooting:** Quickly identify router location
- **Capacity Planning:** Metro-level traffic analysis
- **Disaster Recovery:** Geographic redundancy planning
- **Network Design:** Identify metro-level single points of failure

### Example Use Cases

**Scenario 1: Metro-Level Failure Analysis**
```
Problem: All routers in zaf-jnb-kem-* are down
Analysis: Kempton Park metro area outage
Action: Route traffic through zaf-jnb-san-* (Sandton)
```

**Scenario 2: City-Level Redundancy Check**
```
Query: How many metros in Johannesburg (jnb)?
Answer: 2 metros (kem, san)
Redundancy: ✓ Multi-metro coverage
```

**Scenario 3: Country-Level Aggregation**
```
COLLAPSING view: Collapse ZAF
Result: All zaf-* routers hidden, gateway links preserved
Visible: Inter-country links (ZAF ↔ USA, ZAF ↔ GBR, etc.)
```

---

## Application Integration

### Hostname Parsing

The application will parse hostnames as follows:

```javascript
// Example parsing logic
const hostname = "zaf-jnb-kem-r1";
const parts = hostname.split('-');

const router = {
  country: parts[0],  // "zaf"
  city: parts[1],     // "jnb"
  metro: parts[2],    // "kem"
  number: parts[3]    // "r1"
};
```

### Country Classification

**Existing behavior preserved:**
- Country code extracted from first 3 letters
- Country override database lookup
- Color assignment by country
- COLLAPSING view grouping by country

**New metadata available:**
- City code (parts[1])
- Metro code (parts[2])
- Future enhancements: city-level grouping, metro-level filtering

### Tooltip Display

**Enhanced tooltip format:**
```
Router: zaf-jnb-kem-r1
Country: South Africa (ZAF)
City: Johannesburg (JNB)
Metro: Kempton Park (KEM)
IP: 9.9.9.1
```

---

## Migration from 2-Level Format

### Old Format (2-level)
```
{country}-{city}-r{number}
Example: zaf-jnb-r1
```

### New Format (3-level)
```
{country}-{city}-{metro}-r{number}
Example: zaf-jnb-kem-r1
```

### Backward Compatibility

The application will handle both formats:
- **2-level:** Country and city extracted
- **3-level:** Country, city, and metro extracted
- **Parsing:** Split by '-', count parts to determine format

---

## File: Load-hosts-metro-level.csv

**Total Routers:** 34  
**Countries:** 9 (ZAF, USA, GBR, FRA, DEU, JPN, AUS, BRA, IND)  
**Cities:** 10 (JNB, CPT, NYC, LON, PAR, BER, TOK, SYD, SAO, MUM/DEL)  
**Metros:** 20+ distinct metro areas

### Country Distribution

| Country | Cities | Metros | Routers |
|---------|--------|--------|---------|
| ZAF (South Africa) | 2 | 4 | 5 |
| USA (United States) | 1 | 3 | 4 |
| GBR (United Kingdom) | 1 | 2 | 2 |
| FRA (France) | 1 | 2 | 4 |
| DEU (Germany) | 1 | 2 | 2 |
| JPN (Japan) | 1 | 2 | 3 |
| AUS (Australia) | 1 | 2 | 3 |
| BRA (Brazil) | 1 | 2 | 3 |
| IND (India) | 2 | 4 | 8 |

---

## Testing Checklist

### Hostname Upload Test
- [ ] Upload Load-hosts-metro-level.csv
- [ ] Verify all 34 routers classified
- [ ] Check country extraction (9 countries)
- [ ] Verify no UNK nodes

### Tooltip Verification
- [ ] Hover over zaf-jnb-kem-r1
- [ ] Verify full hostname displayed
- [ ] Check country metadata (ZAF)

### COLLAPSING View Test
- [ ] Collapse ZAF (South Africa)
- [ ] Verify 5 routers hidden
- [ ] Check inter-country links preserved
- [ ] Verify gateway link aggregation (min cost)

### Cost Matrix Test
- [ ] Open Cost Matrix
- [ ] Verify 9×9 matrix (9 countries)
- [ ] Check SPF shortest paths
- [ ] Verify ZAF ↔ USA, ZAF ↔ GBR paths

### What-If Analysis Test
- [ ] Create scenario: zaf-jnb-kem-r1 failure
- [ ] Verify metro-level impact analysis
- [ ] Check before/after comparison
- [ ] Validate statistics

---

## Future Enhancements

### City-Level Grouping
- Add city-level COLLAPSING option
- Example: Collapse all "jnb" (Johannesburg) routers
- Preserve inter-city links

### Metro-Level Filtering
- Filter view by metro area
- Example: Show only "kem" (Kempton Park) routers
- Useful for metro-specific troubleshooting

### Geographic Heatmap
- Color-code by metro density
- Identify high-traffic metro areas
- Capacity planning visualization

### Metro-Level Statistics
- Routers per metro
- Traffic per metro
- Redundancy analysis per metro

---

## Conclusion

The 3-level hostname format provides enhanced geographic granularity while maintaining backward compatibility with existing features. This format enables:

1. **Precise Location Tracking:** Country → City → Metro hierarchy
2. **Flexible Aggregation:** Collapse at country, city, or metro level
3. **Operational Clarity:** Quick identification of router locations
4. **Future Extensibility:** City-level and metro-level features

**Next Steps:**
1. Test Load-hosts-metro-level.csv with application
2. Verify country classification works correctly
3. Validate COLLAPSING view preserves inter-country links
4. Document any parsing issues or enhancements needed
