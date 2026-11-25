#!/usr/bin/env node
// Build-time script to fetch Chelyabinsk oblast settlements from OSM Overpass API
// Output: public/data/settlements-74.json
// Run: node scripts/build-settlements.mjs

import https from 'https';
import fs from 'fs';
import path from 'path';
import pointInPolygon from 'point-in-polygon';

const OVERPASS_URL = 'https://overpass.openstreetmap.fr/api/interpreter';
const OUT_FILE = path.resolve('public/data/settlements-74.json');
const BBOX = [51.9, 57.0, 56.4, 63.4]; // [minLat, minLon, maxLat, maxLon] Chelyabinsk oblast approx

// Query 1: Get Chelyabinsk oblast and its admin_level=6 boundaries using area pivot
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

// Query 2: Settlements
const SETTLEMENT_QUERY = `
[out:json][timeout:180];
node["place"~"city|town|village|hamlet|locality"](51.9,57.0,56.4,63.4);
out body;
`;

// Fetch from Overpass using POST
function fetchOverpass(query) {
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

// Fetch geometry for ways using POST
function fetchGeometry(wayIds) {
  if (!wayIds.length) return Promise.resolve({ elements: [] });
  const query = `[out:json][timeout:120]; way(id:${wayIds.join(',')}); out geom;`;
  return fetchOverpass(query);
}

// point-in-polygon library handles [lon, lat] points and [lon, lat] polygon vertices
// pointInPolygon(point, polygon) returns true if point is inside polygon
// For multipolygon: check each polygon (outer ring), subtract holes

function pointInMultiPolygon(lon, lat, geometry) {
  const point = [lon, lat];
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      if (pointInPolygon(point, poly[0])) {
        // Check holes
        let inHole = false;
        for (let h = 1; h < poly.length; h++) {
          if (pointInPolygon(point, poly[h])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
  }
  return false;
}

// Build geometry from OSM ways/relations
function buildGeometry(elements, relationId) {
  const relation = elements.find(e => e.type === 'relation' && e.id === relationId);
  if (!relation || !relation.members) return null;

  const outerRings = [];
  const innerRings = [];

  for (const member of relation.members) {
    if (member.type === 'way' && (member.role === 'outer' || member.role === 'inner' || !member.role)) {
      const way = elements.find(e => e.type === 'way' && e.id === member.ref);
      if (way && way.geometry) {
        const coords = way.geometry.map(g => [g.lon, g.lat]);
        if (coords.length > 2) {
          // Close ring if not closed
          if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
            coords.push([...coords[0]]);
          }
          if (member.role === 'inner') {
            innerRings.push(coords);
          } else {
            outerRings.push(coords);
          }
        }
      }
    }
  }

  if (outerRings.length === 0) return null;

  // Build multipolygon: each outer ring with its inner rings
  const polygons = [];
  for (const outer of outerRings) {
    const holes = innerRings.filter(inner => pointInPolygon(inner[0], outer[0]));
    polygons.push([outer, ...holes]);
  }
  return { type: 'MultiPolygon', coordinates: polygons };
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

async function main() {
  console.log('Fetching municipal boundaries...');
  const boundaryData = await fetchOverpass(BOUNDARY_QUERY);
  const boundaryElements = boundaryData.elements || [];

  const ways = boundaryElements.filter(e => e.type === 'way');
  const relations = boundaryElements.filter(e => e.type === 'relation');
  console.log(`Received ${boundaryElements.length} boundary elements (${ways.length} ways, ${relations.length} relations)`);

  // Fetch geometry for boundary ways
  const wayIds = ways.map(w => w.id);
  console.log('Fetching geometry for boundary ways...');
  const geomData = await fetchGeometry(wayIds);
  const geomElements = geomData.elements || [];
  const geomMap = new Map(geomElements.map(e => [e.id, e]));
  for (const way of ways) {
    if (geomMap.has(way.id)) {
      way.geometry = geomMap.get(way.id).geometry;
    }
  }

  // Build municipalities (admin_level=6)
  console.log('Building municipalities...');
  const municipalities = [];
  for (const rel of relations) {
    if (rel.tags?.boundary === 'administrative' && rel.tags?.admin_level === '6') {
      const name = rel.tags.name || rel.tags['name:ru'] || `municipality_${rel.id}`;
      const geometry = buildGeometry(boundaryElements, rel.id);
      if (geometry) {
        const numPolys = geometry.coordinates.length;
        const totalRings = geometry.coordinates.reduce((s, p) => s + p.length, 0);
        console.log(`  ${name}: ${numPolys} polygons, ${totalRings} rings`);
        municipalities.push({ id: rel.id, name, geometry });
      } else {
        console.log(`  ${name}: NO GEOMETRY`);
      }
    }
  }
  console.log(`Built ${municipalities.length} municipalities`);

  // Pre-compute municipality centroids for nearest fallback
  const munCentroids = municipalities.map(mun => {
    const outer = mun.geometry.coordinates[0][0];
    const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
    const cy = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    return { name: mun.name, lon: cx, lat: cy };
  });

  // Fetch settlements
  console.log('\nFetching settlements...');
  const settlementData = await fetchOverpass(SETTLEMENT_QUERY);
  const nodes = settlementData.elements || [];
  console.log(`Received ${nodes.length} settlement nodes`);

  // Process settlements
  console.log('Processing settlements...');
  const settlements = [];
  let unassigned = 0;
  let pointInPolyCount = 0;
  let nearestCount = 0;

  for (const node of nodes) {
    if (!node.tags?.place) continue;
    const placeType = node.tags.place;
    const name = node.tags.name || node.tags['name:ru'] || node.tags['official_name'] || '';
    if (!name) continue;

    const lat = node.lat;
    const lon = node.lon;

    // BBox check
    if (lat < BBOX[0] || lat > BBOX[2] || lon < BBOX[1] || lon > BBOX[3]) continue;

    // Find containing municipality using point-in-polygon
    let municipality = null;
    for (const mun of municipalities) {
      if (pointInMultiPolygon(lon, lat, mun.geometry)) {
        municipality = mun.name;
        pointInPolyCount++;
        break;
      }
    }

    if (!municipality) {
      unassigned++;
      // Nearest centroid fallback
      let minDist = Infinity;
      for (const mun of munCentroids) {
        const d = Math.hypot(lon - mun.lon, lat - mun.lat);
        if (d < minDist) {
          minDist = d;
          municipality = mun.name + ' (nearest)';
        }
      }
      nearestCount++;
    }

    settlements.push({
      name,
      type: placeType,
      municipality,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5))
    });
  }

  console.log(`Processed ${settlements.length} settlements`);
  console.log(`  Point-in-polygon matches: ${pointInPolyCount}`);
  console.log(`  Nearest-centroid fallback: ${nearestCount}`);
  console.log(`  Unassigned (no municipalities): ${unassigned}`);

  // Count by type
  const counts = {};
  for (const s of settlements) {
    counts[s.type] = (counts[s.type] || 0) + 1;
  }
  console.log('Counts by type:', counts);

  // Sort by municipality, then name
  settlements.sort((a, b) => {
    const ma = a.municipality || '';
    const mb = b.municipality || '';
    const m = ma.localeCompare(mb);
    if (m !== 0) return m;
    return a.name.localeCompare(b.name);
  });

  // Write output
  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(settlements));
  const size = fs.statSync(OUT_FILE).size;
  console.log(`Written ${OUT_FILE} (${(size / 1024).toFixed(1)} KB raw)`);

  // Spot checks
  const spotChecks = [
    { name: 'Сатка', expectedMun: 'Саткинский' },
    { name: 'Бердяуш', expectedMun: 'Саткинский' },
    { name: 'Тайнак', expectedMun: 'Златоуст' },
  ];
  console.log('\nSpot checks:');
  for (const check of spotChecks) {
    const found = settlements.find(s => normalizeName(s.name) === normalizeName(check.name));
    if (found) {
      console.log(`  ${check.name} -> municipality: ${found.municipality} (type: ${found.type})`);
    } else {
      console.log(`  ${check.name} NOT FOUND`);
    }
  }

  // Check for duplicates across municipalities
  const nameMap = new Map();
  for (const s of settlements) {
    const key = normalizeName(s.name).toLowerCase();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push(s.municipality);
  }
  const duplicates = [...nameMap.entries()].filter(([, muns]) => new Set(muns).size > 1);
  console.log(`\nDuplicate names across municipalities: ${duplicates.length}`);

  // Records without definitive municipality (excluding nearest fallback)
  const noMun = settlements.filter(s => !s.municipality || s.municipality.endsWith('(nearest)')).length;
  console.log(`Records without definitive municipality: ${noMun}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});