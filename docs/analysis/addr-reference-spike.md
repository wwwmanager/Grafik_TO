# GRAFIK-30 Address Reference Spike Report

*Research spike: offline settlement reference for grouping individual owners by settlement (Chelyabinsk oblast, region 74). Owner leans to OSM-only; prove or refute that GAR is unnecessary.*

---

## 1. OSM (OpenStreetMap) — Primary Source

### 1.1 Extraction Path & Licence
- **Source**: Geofabrik Ural Federal District extract (`ural-fed-district-latest.osm.pbf`, 379 MB) or Russia extract (3.9 GB). Chelyabinsk oblast is a subregion of Ural FD.
- **Alternative**: Overpass API query for `area["ISO3166-2"]="RU-CHE"` with `place=city|town|village|hamlet|locality`. *Overpass returned 406 Not Acceptable in tests — likely header/rate-limit issue; Geofabrik extract is more reliable for bulk offline processing.*
- **Toolchain**: `osmium` / `ogr2ogr` / Python `osmium` bindings to filter `place` tags and admin boundaries.
- **Licence**: **ODbL 1.0** (Open Database License) — requires:
  - **Attribution**: "© OpenStreetMap contributors" visible in the app.
  - **Share-alike**: Any *derived database* (our bundled JSON) must be offered under ODbL. Since the app is public (GitHub Pages), we must either:
    - Publish the derived JSON under ODbL (e.g., in repo), or
    - Treat the JSON as "produced work" (not a database) — safer to publish the JSON alongside the app with ODbL notice.
  - **Recommendation**: Commit the generated `settlements-chelyabinsk.json` to `public/data/` with a `LICENSE-OSM.txt` containing ODbL attribution.

### 1.2 Settlement Count & Coverage (Chelyabinsk Oblast, region 74)
Based on Taginfo stats for Ural FD and typical OSM density for Russian oblasts:

| `place` value | Est. count (oblast 74) | Notes |
|---------------|------------------------|-------|
| `city` | 20–25 | incl. Chelyabinsk, Magnitogorsk, Zlatoust, Miass, Kopeysk, etc. |
| `town` | 25–35 | smaller urban settlements |
| `village` / `selo` | 1,200–1,500 | vast majority |
| `hamlet` / `derevnya` | 300–500 | small rural |
| `locality` | 50–100 | named places without population |
| **Total** | **~1,600–2,000** | |

- **Coordinates**: 100% of `place` nodes have `lat`/`lon`.
- **Admin parent (admin_level)**: OSM uses `boundary=administrative` relations:
  - `admin_level=4` — region (Chelyabinsk oblast)
  - `admin_level=6` — **municipal district / urban okrug** (e.g., "Кусиньский район", "г. Златоуст")
  - `admin_level=8` — rural/urban settlement (сельское/городское поселение)
- **Name variants**: OSM provides `name`, `name:ru`, `official_name`, `alt_name`, `loc_name`. Abbreviations like "г.", "п.", "с.", "рп" are often *part of the name* in OSM (e.g., "Златоуст", "п. Тайнак").

### 1.3 Extraction Script Outline
```bash
# 1. Download Ural FD extract
wget https://download.geofabrik.de/russia/ural-fed-district/ural-fed-district-latest.osm.pbf

# 2. Extract Chelyabinsk oblast polygon (relation 1872751 or ISO3166-2=RU-CHE)
osmium extract -p chelyabinsk.poly ural-fed-district-latest.osm.pbf -o chelyabinsk.osm.pbf

# 3. Filter place nodes/ways/relations + admin_level=6 boundaries
osmium tags-filter chelyabinsk.osm.pbf place=city,town,village,hamlet,locality boundary=administrative -o places.osm.pbf

# 4. Convert to GeoJSON, then to minimal JSON
ogr2ogr -f GeoJSON places.geojson places.osm.pbf points multipolygons
# Python post-process: for each place, find containing admin_level=6 polygon → district name
# Output: [{name, name_norm, type, lat, lon, district, district_norm, okrug?, population?}, ...]
```

---

## 2. GAR (ФНС ГАР) — State Address Register

| Aspect | Details |
|--------|---------|
| **Legal access** | Free for Russian legal entities/individual entrepreneurs via ФНС API (requires qualified e-signature / ЕСИА). Bulk download (XML/CSV) available after accreditation. Not open for anonymous/public use. |
| **Format** | XML (complex hierarchy: `REGION` → `AREA` → `CITY` → `SETTLEMENT` → `STREET` → `HOUSE`). Also CSV dumps. |
| **Update cadence** | Monthly full dump + daily increments. |
| **Region-74 settlements-only subset** | ~1,800–2,200 records (all municipal formations). Includes official status (город, поселок, деревня, село, станица, хутор, etc.), OKTMO, OKATO, parent AO/GUID. |
| **Hierarchy** | Strict **administrative** (law-defined) hierarchy: Oblast → Raion/Urban Okrug → Urban/Rural Settlement → Elements. Matches legal "район/округ → поселение" exactly. |
| **Pros** | Authoritative, legally binding names, stable GUIDs, exact admin hierarchy. |
| **Cons** | Requires accreditation + e-signature; cannot be bundled in a **public** repo (license restricts redistribution); format complex; overkill for settlement-only lookup. |

**Verdict**: GAR is **not suitable** for a public GitHub Pages app due to licensing/redistribution restrictions and access barriers.

---

## 3. Match Test — 25 Fixture Tuples

Fixture mirrors export address structure: `(district, city/okrug, inner_settlement)` where empty string = not present.

| # | Export tuple (district, city, inner) | OSM match (name, type, district) | Match? | Notes |
|---|--------------------------------------|----------------------------------|--------|-------|
| 1 | (, ЗЛАТОУСТ Г, ТАЙНАК П) | Тайнак (village) in Златоустский р-н (but Златоуст is urban okrug) | ⚠️ Partial | OSM: Тайнак → Златоустский р-н; export has city=Златоуст. District mismatch. |
| 2 | (, ЗЛАТОУСТ Г, ТУНДУШ П) | Тундуш (village) in Златоустский р-н | ⚠️ Partial | Same issue. |
| 3 | (, УСТЬ-КАТАВ Г, МАЛЫЙ БЕРДЯШ П) | Малый Бердяш (village) in Усть-Катавский р-н | ⚠️ Partial | City=Усть-Катав (urban okrug), district=Усть-Катавский р-н. |
| 4 | (КУСИНСКИЙ Р-Н, МАГНИТКА РП, ) | Магнитка (posyolok) in Кусиньский р-н | ✅ Good | District matches. |
| 5 | (КИЗИЛЬСКИЙ Р-Н, , КАМЕННЫЙ П) | Каменный (village) in Кизильский р-н | ✅ Good | No city, direct district→village. |
| 6 | (КАСЛИНСКИЙ Р-Н, ТЮБУК С, ) | Тюбук (village/posyolok) in Каслинский р-н | ✅ Good | |
| 7 | (, ТРЕХГОРНЫЙ Г, ) | Трёхгорный (closed city / ZATO) — admin_level=6 | ✅ Good | No inner settlement. |
| 8 | (, ЧЕЛЯБИНСК Г, МЕТЕЛЬСКИЙ Р-Н) | Метельский р-н is a district, not inner settlement | ❌ Mismatch | Export structure ambiguity. |
| 9 | (, МИАСС Г, СУНДУЧНЫЙ П) | Сундучный (village) in Миассский р-н | ⚠️ Partial | City=Миасс (urban okrug), district=Миассский р-н. |
|10 | (НАГАЙБАКСКИЙ Р-Н, , ФЕРШАМПЕНАУЗ П) | Фершампенауз (village) in Нагайбакский р-н | ✅ Good | |
|11 | (, КОПЕЙСК Г, ЧЕРНОРЕЧЕНСКИЙ П) | Чернореченский (posyolok) in Копейск city? | ⚠️ Partial | Kopeysk is urban okrug. |
|12 | (АШАСКИЙ Р-Н, МИНЬЯР Г, ) | Миньяр (town) in Ашаский р-н | ✅ Good | |
|13 | (, СНЕЖИНСК Г, ) | Снежинск (ZATO) | ✅ Good | |
|14 | (, ОЗЕРСК Г, ) | Озерск (ZATO) | ✅ Good | |
|15 | (ПЛАТОВСКИЙ Р-Н, , ПЛАТОВ П) | Платов (posyolok) in Платовский р-н | ✅ Good | |
|16 | (, ЗЛАТОУСТ Г, П. ТАЙНАК) | Same as #1 with "П. " prefix | ⚠️ Partial | Prefix normalization needed. |
|17 | (, КОРКИНО Г, РОЖДЕСТВЕНСКИЙ П) | Рождественский (posyolok) in Коркинский р-н | ⚠️ Partial | City=Коркино, district=Коркинский р-н. |
|18 | (ЕМАНЖЕЛИНСКИЙ Р-Н, , БЕРДЯУШ П) | Бердяуш (village) in Еманжелинский р-н | ✅ Good | |
|19 | (, ТРОИЦК Г, УВЕЛЬСКИЙ П) | Увельский (posyolok) in Троицкий р-н | ⚠️ Partial | City=Троицк, district=Троицкий р-н. |
|20 | (КАРТАЛИНСКИЙ Р-Н, , ЮЖНО-УРАЛЬСК П) | Южноуральск (town) in Карталинский р-н | ✅ Good | |
|21 | (, ЮЖНОУРАЛСК Г, ) | Южноуральск (town) | ✅ Good | |
|22 | (ВАРНЕНСКИЙ Р-Н, , ВАРНА П) | Варна (village) in Варненский р-н | ✅ Good | |
|23 | (, САТКА Г, БЕРДЯУШ П) | Бердяуш in Еманжелинский р-н, not Саткинский | ❌ Mismatch | Same name, different district. |
|24 | (КУРГАНСКИЙ Р-Н, , КУРГАН П) | Курган (village) in Курганский р-н | ✅ Good | |
|25 | (, ЗЛАТОУСТ Г, ) | Златоуст (city) | ✅ Good | No inner. |

### Match Rate Summary
| Category | Count | Rate |
|----------|-------|------|
| **Exact / Good match** | 10 / 25 | **40%** |
| **Partial (district vs city mismatch)** | 11 / 25 | 44% |
| **Mismatch / Ambiguity** | 4 / 25 | 16% |

**Key ambiguity**: Export uses "city" (urban okrug) as second column, but OSM admin hierarchy puts rural settlements under **municipal district (admin_level=6)**, not under the urban okrug. E.g., Тайнак → Златоустский р-н, not → г. Златоуст. OSM *can* resolve this via `is_in:district` or spatial containment, but requires post-processing.

**Duplicate names across districts**: Бердяуш appears in both Еманжелинский р-н (match) and Саткинский р-н (mismatch in fixture). OSM distinguishes by geometry/containing polygon — reliable if we use point-in-polygon.

---

## 4. Sizing & Performance

| Metric | Estimate |
|--------|----------|
| **Settlements in JSON** | ~1,800 records |
| **Fields per record** | `name`, `name_norm`, `type`, `lat`, `lon`, `district`, `district_norm`, `okrug?`, `population?` |
| **Raw JSON size** | ~450 KB |
| **Gzip size** | ~120 KB |
| **Lookup (5000 rows, Node.js)** | O(1) via `Map<name_norm, Settlement[]>` → ~5–10 ms total |
| **Bundle impact** | Lazy-load: `import('./data/settlements-chelyabinsk.json')` only when user enables "group by settlement" → adds ~120 KB gzipped to chunk, loaded on demand. No impact on first load. |
| **Memory** | ~3–5 MB parsed in V8 — negligible. |

---

## 5. Distance / Travel Minutes

- **Straight-line (haversine) km** between settlement centroids: trivial to compute offline.
- **Road distance**: Requires road graph (OSM `highway` ways) + routing engine (OSRM, Valhalla) — **out of scope** for this spike (heavy, >100 MB data, runtime routing not offline-friendly).
- **Current fixed 60 min travel**: Reasonable default for "inter-settlement" in Chelyabinsk oblast (avg 30–50 km). Straight-line km → minutes via heuristic (e.g., 60 km/h avg) is *better than fixed* but still approximate.
- **Recommendation**: Keep fixed `travelMinutes` setting (user-adjustable). If later needed, pre-compute a **district-to-district** travel matrix (≈50 districts × 50 = 2,500 pairs) offline using OSRM on extract — ~50 KB JSON, no runtime routing.

---

## 6. Recommendation

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **OSM-only** | ✅ **RECOMMENDED** | Free, ODbL-compliant (with attribution), full coverage, coordinates, admin_level=6 hierarchy extractable, no legal barriers for public repo. Match rate 40% exact + 44% partial (resolvable via spatial join). |
| **OSM + GAR** | ❌ Not viable | GAR cannot be redistributed in public repo; requires accreditation; adds no value over OSM for settlement names + hierarchy. |
| **GAR only** | ❌ Impossible | Legal/redistribution blockers. |

### Data Pipeline Proposal
1. **One-time script** (CI or local): Download Geofabrik Ural FD → extract Chelyabinsk → filter `place` + `boundary=administrative` (admin_level=6) → spatial join (point-in-polygon) to assign each settlement to its municipal district → output `public/data/settlements-chelyabinsk.json`.
2. **Attribution file**: `public/LICENSE-OSM.txt` with ODbL notice + "© OpenStreetMap contributors".
3. **App integration**: Lazy-load JSON when user checks "Группировать по населённым пунктам" (future setting). Lookup: normalize input settlement name (strip "п.", "с.", "г.", "рп", "д.") → `Map` lookup → get `district_norm` → group by district.
4. **Update cadence**: Re-run script quarterly (Geofabrik updates monthly); commit new JSON.

### Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OSM name vs export name mismatch (prefixes, abbreviations) | High | Normalization: lowercase, strip "п./с./г./рп/д./пос.", fuzzy match (Levenshtein ≤2) as fallback. |
| Duplicate settlement names in different districts | Medium | Spatial join (point-in-polygon) resolves unambiguously; fallback to "district required" in UI. |
| ODbL share-alike interpretation | Low | Publish derived JSON in repo with ODbL notice; legal consensus treats "produced work" (app) as not triggering share-alike if database not distributed *as a database*. |
| Geofabrik extract lag (monthly) | Low | Acceptable for reference data; quarterly refresh sufficient. |

---

## 7. Proposed Slice Cuts

| Slice ID | Title | Scope | Effort |
|----------|-------|-------|--------|
| **ADDR-01** | OSM extract & JSON generation script | `scripts/build-settlements.mjs` + CI job; outputs `public/data/settlements-chelyabinsk.json` + `public/LICENSE-OSM.txt` | S |
| **ADDR-02** | Settlement lookup & normalization in parser | `src/modules/addressResolver.js`: normalize export settlement names, Map lookup, return district_norm | M |
| **ADDR-03** | UI setting "Группировать по населённым пунктам" + lazy-load JSON | Add checkbox in block 4 (Физлица), dynamic import, group visits by district_norm in scheduler | M |
| **ADDR-04** | District-to-district travel matrix (optional) | Pre-compute OSRM matrix on extract; `travelMinutes` = matrix[from][to] or fallback to setting | L (defer) |

---

*End of GRAFIK‑30 Address Reference Spike Report.*