#!/usr/bin/env node
// Build-time script to fetch settlements from OSM Overpass API using area membership
// For each admin_level=6 relation, fetch its place nodes directly
// Output: public/data/settlements-74.json (or configurable region)
// Run: node scripts/build-settlements.mjs

import https from 'https';
import fs from 'fs';
import path from 'path';

const OVERPASS_URL = 'https://overpass.openstreetmap.fr/api/interpreter';
const OUT_FILE = path.resolve('public/data/settlements-74.json');
const BBOX = [51.9, 57.0, 56.4, 63.4]; // [minLat, minLon, maxLat, maxLon] Chelyabinsk oblast approx

// Query 1: Get region and its admin_level=6 boundaries
const BOUNDARY_QUERY = `
[out:json][timeout:180];
(
  // Get Chelyabinsk oblast area
  relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="RU-CHE"];
  map_to_area -> .chelyabinsk;
  // Get admin_level=6 boundaries in that area
  relation["boundary"="administrative"]["admin_level"="6"](area.chelyabinsk);
);
out body;
>;
out skel qt;
`;

// Fetch from Overpass using POST with retry and backoff
async function fetchOverpass(query, retries = 3, baseDelay = 2000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fetchOverpassOnce(query);
      return result;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`  Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function fetchOverpassOnce(query) {
  return new Promise((resolve, reject) => {
    const postData = `data=${encodeURIComponent(query)}`;
    const req = https.request(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'grafik-to/1.0 (build script)',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/^г\.\s*/i, '')
    .replace(/^п\.\s*/i, '')
    .replace(/^с\.\s*/i, '')
    .replace(/^д\.\s*/i, '')
    .replace(/^рп\s*/i, '')
    .replace(/^поселок\s+/i, '')
    .replace(/^деревня\s+/i, '')
    .replace(/^село\s+/i, '')
    .replace(/^ станица\s+/i, '')
    .replace(/^ хутор\s+/i, '')
    .trim();
}

function cleanMunicipalityName(name) {
  // Remove common suffixes for cleaner display
  let cleaned = name
    .replace(/\s+муниципальный\s+район$/i, '')
    .replace(/\s+городской\s+округ$/i, '')
    .replace(/\s+муниципальный$/i, '')
    .replace(/\s+район$/i, '')
    .replace(/\s+округ$/i, '')
    .trim();

  // Map adjective forms to noun forms for urban okrugs (города областного подчинения)
  const urbanOkrugMap = {
    'Челябинский': 'Челябинск',
    'Магнитогорский': 'Магнитогорск',
    'Златоустовский': 'Златоуст',
    'Миасский': 'Миасс',
    'Копейский': 'Копейск',
    'Коркинский': 'Коркино',
    'Южноуральский': 'Южноуральск',
    'Снежинский': 'Снежинск',
    'Озёрский': 'Озёрск',
    'Трёхгорный': 'Трехгорный',
    'Карабашский': 'Карабаш',
    'Кыштымский': 'Кыштым',
    'Усть-Катавский': 'Усть-Катав',
    'Ашинский': 'Аша',
    'Троицкий': 'Троицк',
    'Верхнеуральский': 'Верхнеуральск',
    'Верхнеуфалейский': 'Верхнеуфалейск',
    'Локомотивный': 'Локомотивный',
    'Чебаркульский': 'Чебаркуль',
    'Еманжелинский': 'Еманжелинск',
    'Трехгорный': 'Трехгорный',
  };

  // For municipal districts, the adjective form IS the name (e.g., Саткинский, Кусинский)
  // But strip trailing " муниципальный" if present
  cleaned = cleaned.replace(/\s+муниципальный$/i, '');

  return urbanOkrugMap[cleaned] || cleaned;
}

function isJunkName(name) {
  if (!name) return true;
  // Drop names starting with digit
  if (/^\d/.test(name)) return true;
  // Drop "урочище", "ур." prefixes
  if (/^ур\.|урочище/i.test(name)) return true;
  // Drop "нежил" (нежилое)
  if (/нежил/i.test(name)) return true;
  // Drop obvious non-settlement terms
  if (/загон|террикон|га\b/.test(name)) return true;
  return false;
}

async function fetchMunicipalities() {
  console.log('Fetching municipal boundaries (admin_level=6)...');
  const boundaryData = await fetchOverpass(BOUNDARY_QUERY);
  const boundaryElements = boundaryData.elements || [];

  const relations = boundaryElements.filter(e => e.type === 'relation');
  const municipalities = [];

  for (const rel of relations) {
    if (rel.tags?.boundary === 'administrative' && rel.tags?.admin_level === '6') {
      const rawName = rel.tags.name || rel.tags['name:ru'] || `municipality_${rel.id}`;
      const name = cleanMunicipalityName(rawName);
      municipalities.push({ id: rel.id, name, rawName });
    }
  }

  console.log(`Found ${municipalities.length} municipalities (admin_level=6)`);
  return municipalities;
}

async function fetchSettlementsForMunicipality(municipality, pauseMs = 2500) {
  // Overpass area ID for relation: 3600000000 + relation_id
  const areaId = 3600000000 + municipality.id;
  const query = `
[out:json][timeout:120];
node["place"~"city|town|village|hamlet|locality"](area:${areaId});
out body;
`;

  const data = await fetchOverpass(query);
  const nodes = data.elements || [];

  // Filter by bbox and valid names
  const settlements = [];
  for (const node of nodes) {
    if (!node.tags?.place) continue;
    const name = node.tags.name || node.tags['name:ru'] || node.tags['official_name'] || '';
    if (!name) continue;

    const lat = node.lat;
    const lon = node.lon;

    // BBox check
    if (lat < BBOX[0] || lat > BBOX[2] || lon < BBOX[1] || lon > BBOX[3]) continue;

    settlements.push({
      osmId: node.id,
      name,
      type: node.tags.place,
      municipality: municipality.name,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5))
    });
  }

  // Pause between requests to be nice to Overpass
  if (pauseMs > 0) {
    await new Promise(r => setTimeout(r, pauseMs));
  }

  return settlements;
}

function deduplicateSettlements(settlements) {
  let droppedById = 0;
  let droppedByCoords = 0;
  let droppedLocalities = 0;
  let droppedJunk = 0;
  const droppedJunkNames = [];

  // 1. Drop by OSM node ID (keep first occurrence)
  const seenIds = new Set();
  const afterIdDedupe = [];
  for (const s of settlements) {
    if (seenIds.has(s.osmId)) {
      droppedById++;
    } else {
      seenIds.add(s.osmId);
      afterIdDedupe.push(s);
    }
  }

  // 2. Drop place=locality entirely
  const afterLocalityFilter = [];
  for (const s of afterIdDedupe) {
    if (s.type === 'locality') {
      droppedLocalities++;
    } else {
      afterLocalityFilter.push(s);
    }
  }

  // 3. Drop junk names
  const afterJunkFilter = [];
  for (const s of afterLocalityFilter) {
    if (isJunkName(s.name)) {
      droppedJunk++;
      droppedJunkNames.push(s.name + ' (' + s.municipality + ')');
    } else {
      afterJunkFilter.push(s);
    }
  }

  // 4. Drop records with identical (name, municipality) and coordinates equal to 3 decimals
  const seenCoords = new Map();
  const finalSettlements = [];
  for (const s of afterJunkFilter) {
    const key = s.name + '|' + s.municipality + '|' + s.lat.toFixed(3) + '|' + s.lon.toFixed(3);
    if (seenCoords.has(key)) {
      droppedByCoords++;
    } else {
      seenCoords.set(key, true);
      // Remove osmId from output
      finalSettlements.push({
        name: s.name,
        type: s.type,
        municipality: s.municipality,
        lat: s.lat,
        lon: s.lon
      });
    }
  }

  return {
    settlements: finalSettlements,
    stats: {
      droppedById,
      droppedByCoords,
      droppedLocalities,
      droppedJunk,
      droppedJunkNames
    }
  };
}

async function main() {
  const municipalities = await fetchMunicipalities();

  console.log('\nFetching settlements for each municipality via area membership...');
  const allSettlements = [];
  const unassigned = [];

  for (let i = 0; i < municipalities.length; i++) {
    const mun = municipalities[i];
    console.log(`  [${i + 1}/${municipalities.length}] ${mun.name} (rel ${mun.id})...`);
    try {
      const settlements = await fetchSettlementsForMunicipality(mun);
      allSettlements.push(...settlements);
      console.log(`    -> ${settlements.length} settlements`);
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
      unassigned.push({ municipality: mun.name, error: err.message });
    }
  }

  console.log(`\nTotal settlements fetched (raw): ${allSettlements.length}`);
  console.log(`Municipalities with errors: ${unassigned.length}`);

  // Deduplicate and clean
  console.log('\nDeduplicating and cleaning...');
  const { settlements, stats } = deduplicateSettlements(allSettlements);

  console.log(`  Dropped by duplicate OSM ID: ${stats.droppedById}`);
  console.log(`  Dropped by duplicate (name,muni,3dec coords): ${stats.droppedByCoords}`);
  console.log(`  Dropped place=locality: ${stats.droppedLocalities}`);
  console.log(`  Dropped junk names: ${stats.droppedJunk}`);
  if (stats.droppedJunkNames.length > 0) {
    console.log(`  Sample dropped junk names (first 10):`);
    for (const n of stats.droppedJunkNames.slice(0, 10)) {
      console.log(`    - ${n}`);
    }
  }

  // Check for duplicates: same name in multiple municipalities
  const nameMap = new Map();
  for (const s of settlements) {
    const key = normalizeName(s.name).toLowerCase();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push({ municipality: s.municipality, type: s.type, name: s.name });
  }

  const duplicates = [...nameMap.entries()].filter(([, entries]) => {
    const muns = new Set(entries.map(e => e.municipality));
    return muns.size > 1;
  });

  console.log(`\nDuplicate names across municipalities: ${duplicates.length}`);
  for (const [name, entries] of duplicates.slice(0, 10)) {
    const muns = [...new Set(entries.map(e => e.municipality))];
    console.log(`  ${name}: ${muns.join(', ')}`);
  }

  // Spot checks
  const spotChecks = [
    { name: 'Сатка', expectedMun: 'Саткинский' },
    { name: 'Бердяуш', expectedMun: 'Саткинский' },
    { name: 'Тайнак', expectedMun: 'Златоуст' },
    { name: 'Тундуш', expectedMun: 'Златоуст' },
    { name: 'Тюбук', expectedMun: 'Каслинский' },
    { name: 'Магнитка', expectedMun: 'Кусинский' },
    { name: 'Челябинск', expectedMun: 'Челябинск' },
    { name: 'Магнитогорск', expectedMun: 'Магнитогорск' },
    { name: 'Златоуст', expectedMun: 'Златоуст' },
    { name: 'Миасс', expectedMun: 'Миасс' },
  ];

  console.log('\nSpot checks:');
  for (const check of spotChecks) {
    const found = settlements.find(s => normalizeName(s.name).toLowerCase() === normalizeName(check.name).toLowerCase());
    if (found) {
      const status = found.municipality === check.expectedMun ? '✓' : '✗';
      console.log(`  ${status} ${check.name} -> ${found.municipality} (expected: ${check.expectedMun}) [${found.type}]`);
    } else {
      console.log(`  ✗ ${check.name} NOT FOUND`);
    }
  }

  // Count by type
  const counts = {};
  for (const s of settlements) {
    counts[s.type] = (counts[s.type] || 0) + 1;
  }
  console.log('\nCounts by type:', counts);

  // Check for any records without municipality (should be 0)
  const noMun = settlements.filter(s => !s.municipality).length;
  console.log(`Records without municipality: ${noMun}`);

  // Sort by municipality, then name
  settlements.sort((a, b) => {
    const m = a.municipality.localeCompare(b.municipality);
    if (m !== 0) return m;
    return a.name.localeCompare(b.name);
  });

  // Write output
  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(settlements));
  const size = fs.statSync(OUT_FILE).size;
  console.log(`\nWritten ${OUT_FILE} (${(size / 1024).toFixed(1)} KB raw)`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Records before cleaning: ${allSettlements.length}`);
  console.log(`Records after cleaning: ${settlements.length}`);
  console.log(`  Dropped by duplicate OSM ID: ${stats.droppedById}`);
  console.log(`  Dropped by duplicate (name,muni,3dec coords): ${stats.droppedByCoords}`);
  console.log(`  Dropped place=locality: ${stats.droppedLocalities}`);
  console.log(`  Dropped junk names: ${stats.droppedJunk}`);
  console.log(`File size: ${(size / 1024).toFixed(1)} KB raw`);
  console.log(`Duplicates across municipalities: ${duplicates.length}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});