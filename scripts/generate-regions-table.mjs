// Generate src/modules/regions-table.js from scripts/build-settlements.mjs
// Run: node scripts/generate-regions-table.mjs

import fs from 'fs';
import path from 'path';

const BUILD_SCRIPT = path.resolve('scripts/build-settlements.mjs');
const OUTPUT_FILE = path.resolve('src/modules/regions-table.js');

function extractRegionsTable() {
  const content = fs.readFileSync(BUILD_SCRIPT, 'utf8');
  
  // Find the REGIONS array
  const match = content.match(/const REGIONS = \[([\s\S]*?)\n\];/);
  if (!match) {
    throw new Error('Could not find REGIONS array in build-settlements.mjs');
  }
  
  const arrayContent = match[1];
  
  // Parse each region entry. fnsCode/gibddCode may be null (new territories without an
  // official ФНС code - see D25; plate codes are documented in D32).
  const regions = [];
  const entryRegex = /\{\s*dataId:\s*(\d+),\s*fnsCode:\s*(null|\d+),\s*gibddCode:\s*(null|\d+),\s*iso:\s*'([^']+)',\s*name:\s*'([^']+)',\s*osm_name:\s*'([^']+)',\s*bbox:\s*\[([\d.\-\s,]+)\]\s*\}/g;
  
  let entryMatch;
  while ((entryMatch = entryRegex.exec(arrayContent)) !== null) {
    regions.push({
      dataId: parseInt(entryMatch[1]),
      fnsCode: entryMatch[2] === 'null' ? null : parseInt(entryMatch[2]),
      gibddCode: entryMatch[3] === 'null' ? null : parseInt(entryMatch[3]),
      iso: entryMatch[4],
      name: entryMatch[5],
      osm_name: entryMatch[6],
      bbox: entryMatch[7].split(',').map(s => parseFloat(s.trim()))
    });
  }
  
  if (regions.length === 0) {
    throw new Error('No regions parsed from REGIONS array');
  }
  
  // Sort by name for consistent output
  regions.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  
  return regions;
}

function generateRegionsTable(regions) {
  const lines = [
    '// Regions table - single source of truth for region dataId, ФНС code and ГИБДД plate code',
    '// GENERATED from scripts/build-settlements.mjs - DO NOT EDIT MANUALLY',
    '// Run: node scripts/generate-regions-table.mjs',
    '// gibddCode is DISPLAYED in the UI (GRAFIK-49); fnsCode is kept for tax/address work.',
    '',
    'export const REGIONS_TABLE = ['
  ];
  
  for (const r of regions) {
    const fns = r.fnsCode === null ? 'null' : r.fnsCode;
    const gibdd = r.gibddCode === null ? 'null' : r.gibddCode;
    lines.push(`  { dataId: ${r.dataId}, fnsCode: ${fns}, gibddCode: ${gibdd}, name: '${r.name}', iso: '${r.iso}' },`);
  }
  
  lines.push('];');
  lines.push('');
  
  return lines.join('\n');
}

function main() {
  try {
    const regions = extractRegionsTable();
    console.log(`Extracted ${regions.length} regions from build-settlements.mjs`);
    
// Validate uniqueness
  const dataIdSet = new Set(regions.map(r => r.dataId));
  
  if (dataIdSet.size !== regions.length) {
    throw new Error('Duplicate dataId values found');
  }
  
  // Null codes are allowed (new territories / no ФНС code) and excluded from uniqueness.
  for (const field of ['fnsCode', 'gibddCode']) {
    const counts = {};
    for (const r of regions) {
      if (r[field] === null) continue;
      counts[r[field]] = (counts[r[field]] || 0) + 1;
    }
    for (const [code, count] of Object.entries(counts)) {
      if (count > 1) {
        throw new Error(`Duplicate ${field} ${code} (${count} entries)`);
      }
    }
  }
    
    const output = generateRegionsTable(regions);
    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`Generated ${OUTPUT_FILE}`);
    
    // Print summary
    console.log('\nRegion summary:');
    for (const r of regions) {
      console.log(`  dataId=${r.dataId}, fnsCode=${r.fnsCode}, gibddCode=${r.gibddCode}, name=${r.name}`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();