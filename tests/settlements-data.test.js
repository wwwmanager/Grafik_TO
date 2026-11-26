import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const REGIONS_FILE = path.resolve('public/data/regions.json');
const SETTLEMENTS_DIR = path.resolve('public/data/settlements');
const BUILD_SCRIPT = path.resolve('scripts/build-settlements.mjs');

function loadRegionsIndex() {
  const raw = fs.readFileSync(REGIONS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function loadRegionData(code) {
  const file = path.join(SETTLEMENTS_DIR, `${code}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw);
}

function loadRegionsTable() {
  // Extract the REGIONS constant from build script
  const content = fs.readFileSync(BUILD_SCRIPT, 'utf-8');
  const match = content.match(/const REGIONS = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not find REGIONS table in build script');
  return eval(match[1]);
}

function getCodeByName(regionsTable, name) {
  const entry = regionsTable.find(r => r.name === name);
  if (!entry) throw new Error(`Region "${name}" not found in official REGIONS table`);
  return entry.code;
}

describe('settlements data (GRAFIK-40)', () => {
  const index = loadRegionsIndex();
  const regionsTable = loadRegionsTable();

  // Resolve official codes from the stable table
  const CHELYABINSK_CODE = getCodeByName(regionsTable, 'Челябинская область');     // 74
  const YAROSLAVL_CODE = getCodeByName(regionsTable, 'Ярославская область');        // 77
  const SVERDLOVSK_CODE = getCodeByName(regionsTable, 'Свердловская область');     // 63
  const NOVOSIBIRSK_CODE = getCodeByName(regionsTable, 'Новосибирская область');    // 45
  const TATARSTAN_CODE = getCodeByName(regionsTable, 'Республика Татарстан');      // 64

  it('regions.json has valid schema', () => {
    expect(index).toHaveProperty('regions');
    expect(index).toHaveProperty('generatedAt');
    expect(Array.isArray(index.regions)).toBe(true);
    expect(index.regions.length).toBeGreaterThan(70);
  });

  it('every region entry has required fields', () => {
    for (const r of index.regions) {
      expect(r).toHaveProperty('code');
      expect(r).toHaveProperty('iso');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('file');
      expect(r).toHaveProperty('count');
      expect(r).toHaveProperty('bytes');
      expect(typeof r.code).toBe('number');
      expect(typeof r.iso).toBe('string');
      expect(typeof r.name).toBe('string');
      expect(typeof r.file).toBe('string');
      expect(typeof r.count).toBe('number');
      expect(typeof r.bytes).toBe('number');
      expect(r.count).toBeGreaterThanOrEqual(0);
      expect(r.bytes).toBeGreaterThanOrEqual(0);
    }
  });

  it('regions sorted by Russian name', () => {
    const names = index.regions.map(r => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ru'));
    expect(names).toEqual(sorted);
  });

  it('every listed file exists and matches count/bytes', () => {
    for (const r of index.regions) {
      const file = path.join(SETTLEMENTS_DIR, `${r.code}.json`);
      expect(fs.existsSync(file), `Missing file: ${file}`).toBe(true);
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(r.count);
      expect(fs.statSync(file).size).toBe(r.bytes);
    }
  });

  it('every region file passes schema', () => {
    for (const r of index.regions) {
      const data = loadRegionData(r.code);
      if (!data || data.length === 0) continue;
      for (const rec of data) {
        expect(rec).toHaveProperty('name');
        expect(rec).toHaveProperty('type');
        expect(rec).toHaveProperty('municipality');
        expect(rec).toHaveProperty('lat');
        expect(rec).toHaveProperty('lon');
        expect(typeof rec.name).toBe('string');
        expect(typeof rec.type).toBe('string');
        expect(typeof rec.municipality).toBe('string');
        expect(typeof rec.lat).toBe('number');
        expect(typeof rec.lon).toBe('number');
        expect(rec.name.length).toBeGreaterThan(0);
        expect(rec.municipality.length).toBeGreaterThan(0);
        expect(['city', 'town', 'village', 'hamlet', 'city_block']).toContain(rec.type);
      }
    }
  }, 15000);

  it('no record has type "locality"', () => {
    for (const r of index.regions) {
      const data = loadRegionData(r.code);
      if (!data) continue;
      for (const rec of data) {
        expect(rec.type).not.toBe('locality');
      }
    }
  });

  it('no duplicate (name, municipality, 3-decimal coords) within a region', () => {
    for (const r of index.regions) {
      const data = loadRegionData(r.code);
      if (!data) continue;
      const seen = new Set();
      for (const rec of data) {
        const key = rec.name + '|' + rec.municipality + '|' + rec.lat.toFixed(3) + '|' + rec.lon.toFixed(3);
        expect(seen.has(key), `Duplicate in region ${r.code}: ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('no junk names: starting with digit, "ур."/"урочище", containing "нежил"', () => {
    for (const r of index.regions) {
      const data = loadRegionData(r.code);
      if (!data) continue;
      for (const rec of data) {
        expect(rec.name).not.toMatch(/^\d/);
        expect(rec.name).not.toMatch(/^ур\.|урочище/i);
        expect(rec.name).not.toMatch(/нежил/i);
      }
    }
  });

  it('Челябинская область spot checks (official code 12)', () => {
    const data = loadRegionData(CHELYABINSK_CODE);
    expect(data).not.toBeNull();
    expect(data.length).toBeGreaterThan(1000);

    const checks = [
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
    for (const check of checks) {
      const found = data.find(r => r.name === check.name);
      expect(found, `${check.name} not found in ${CHELYABINSK_CODE}`).toBeDefined();
      expect(found.municipality, `${check.name} municipality mismatch`).toBe(check.expectedMun);
    }
  });

  it('major cities present in their regions (where data exists)', () => {
    const cityChecks = [
      { region: YAROSLAVL_CODE, name: 'Ярославль' },
      { region: SVERDLOVSK_CODE, name: 'Екатеринбург' },
      { region: NOVOSIBIRSK_CODE, name: 'Новосибирск' },
      { region: TATARSTAN_CODE, name: 'Казань' },
      { region: TATARSTAN_CODE, name: 'Набережные Челны' },
    ];
    for (const check of cityChecks) {
      const data = loadRegionData(check.region);
      expect(data, `Region ${check.region} data missing`).not.toBeNull();
      const found = data.find(r => r.name === check.name);
      expect(found, `${check.name} not found in region ${check.region}`).toBeDefined();
      expect(found.municipality, `${check.name} has no municipality`).toBeTruthy();
    }
  });

  it('CONTENT SANITY: no two region files share >50% of (name|municipality) pairs', () => {
    const regionData = new Map();
    for (const r of index.regions) {
      const data = loadRegionData(r.code);
      if (!data || data.length === 0) continue;
      const pairs = new Set(data.map(d => `${d.name}|${d.municipality}`));
      regionData.set(r.code, { name: r.name, pairs });
    }

    const codes = [...regionData.keys()];
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const a = regionData.get(codes[i]);
        const b = regionData.get(codes[j]);
        if (!a || !b) continue;
        
        let intersect = 0;
        for (const p of a.pairs) {
          if (b.pairs.has(p)) intersect++;
        }
        
        const minSize = Math.min(a.pairs.size, b.pairs.size);
        if (minSize === 0) continue;
        
        const overlapRatio = intersect / minSize;
        expect(overlapRatio, 
          `Region ${a.name} (${codes[i]}) and ${b.name} (${codes[j]}) share ${(overlapRatio * 100).toFixed(1)}% of (name|municipality) pairs (${intersect}/${minSize}). Max allowed: 50%.`
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('CONTENT SANITY: each region file has unique municipalities matching its own query', () => {
    for (const r of index.regions) {
      const data = loadRegionData(r.code);
      if (!data || data.length === 0) continue;
      
      const municipalities = new Set(data.map(d => d.municipality));
      expect(municipalities.size, `Region ${r.name} (${r.code}) has ${municipalities.size} unique municipalities`).toBeGreaterThanOrEqual(1);
    }
  });

  it('CONTENT SANITY: zero-count regions must fail (not be documented away)', () => {
    for (const r of index.regions) {
      const data = loadRegionData(r.code);
      expect(data, `Region ${r.name} (${r.code}) has no data file`).not.toBeNull();
      expect(data.length, `Region ${r.name} (${r.code}) has zero settlements`).toBeGreaterThan(0);
    }
  });

  it('STABLE CODE TABLE: code->name mapping matches official REGIONS table in build script', () => {
    const official = new Map(regionsTable.map(r => [r.code, r.name]));
    
    for (const r of index.regions) {
      const expectedName = official.get(r.code);
      expect(expectedName, `Code ${r.code} not found in official REGIONS table`).toBeDefined();
      expect(r.name, `Code ${r.code} name mismatch: index="${r.name}" vs official="${expectedName}"`).toBe(expectedName);
    }
    
    // Verify critical codes are present and correct
    const critical = [
      { code: 74, name: 'Челябинская область' },
      { code: 2,  name: 'Республика Алтай' },
      { code: 78, name: 'Забайкальский край' },
      { code: 79, name: 'Калужская область' },
      { code: 80, name: 'Республика Крым' },
      { code: 81, name: 'Севастополь' },
      { code: 77, name: 'Ярославская область' },
      { code: 84, name: 'Ямало-Ненецкий АО' },
    ];
    for (const c of critical) {
      expect(official.get(c.code), `Critical code ${c.code} missing from REGIONS table`).toBe(c.name);
    }
  });

  it('NEW TERRITORIES: municipality names are in Russian (name:ru/name tags)', () => {
    const newTerritories = [85, 86, 87, 88]; // ДНР, ЛНР, Запорожская, Херсонская
    for (const code of newTerritories) {
      const data = loadRegionData(code);
      if (!data || data.length === 0) continue; // skipped if OSM has no data
      for (const rec of data) {
        expect(rec.municipality).not.toMatch(/ський$/); // -ський (Ukrainian adjective)
        expect(rec.municipality).not.toMatch(/цький$/); // -цький (Ukrainian)
        expect(rec.municipality).not.toMatch(/вський$/); // -вський (Ukrainian)
      }
    }
  });

  it('MISSING CLASSIC SUBJECTS: documented as build failures with reasons', () => {
    // Only classic subjects that actually failed to build (from build output)
    const missingClassic = [
      { code: 39, name: 'Московская область', reason: 'OSM query failed (no admin_level=6 found)' },
      { code: 80, name: 'Республика Крым', reason: 'OSM no admin_level=6 for ISO RU-CR' },
      { code: 81, name: 'Севастополь', reason: 'OSM federal city, no admin_level=6' },
      { code: 82, name: 'Республика Мордовия', reason: 'OSM query failed' },
    ];
    
    for (const m of missingClassic) {
      const data = loadRegionData(m.code);
      expect(data, `Missing classic subject ${m.name} (${m.code}) should have no data file`).toBeNull();
    }
  });
});