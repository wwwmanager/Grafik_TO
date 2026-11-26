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
  
  // Parse each region entry
  const regions = [];
  const entryRegex = /\{\s*dataId:\s*(\d+),\s*regionCode:\s*(\d+),\s*iso:\s*'([^']+)',\s*name:\s*'([^']+)',\s*osm_name:\s*'([^']+)',\s*bbox:\s*\[([\d.\-\s,]+)\]\s*\}/g;
  
  let entryMatch;
  while ((entryMatch = entryRegex.exec(arrayContent)) !== null) {
    regions.push({
      dataId: parseInt(entryMatch[1]),
      regionCode: parseInt(entryMatch[2]),
      iso: entryMatch[3],
      name: entryMatch[4],
      osm_name: entryMatch[5],
      bbox: entryMatch[6].split(',').map(s => parseFloat(s.trim()))
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
    '// Official regions table - single source of truth for region dataId and regionCode',
    '// GENERATED from scripts/build-settlements.mjs - DO NOT EDIT MANUALLY',
    '// Run: node scripts/generate-regions-table.mjs',
    '',
    'export const REGIONS_TABLE = ['
  ];
  
  for (const r of regions) {
    lines.push(`  { dataId: ${r.dataId}, regionCode: ${r.regionCode}, name: '${r.name}', iso: '${r.iso}' },`);
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
  
  // Check regionCode uniqueness (excluding new territories with duplicate codes)
  const regionCodeCounts = {};
  for (const r of regions) {
    regionCodeCounts[r.regionCode] = (regionCodeCounts[r.regionCode] || 0) + 1;
  }
  for (const [code, count] of Object.entries(regionCodeCounts)) {
    if (count > 1) {
      console.warn(`WARNING: Duplicate regionCode ${code} (${count} entries)`);
    }
  }
    
    const output = generateRegionsTable(regions);
    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`Generated ${OUTPUT_FILE}`);
    
    // Print summary
    console.log('\nRegion summary:');
    for (const r of regions) {
      console.log(`  dataId=${r.dataId}, regionCode=${r.regionCode}, name=${r.name}`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();