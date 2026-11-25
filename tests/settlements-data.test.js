import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const REGIONS_FILE = path.resolve('public/data/regions.json');
const SETTLEMENTS_DIR = path.resolve('public/data/settlements');

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

describe('settlements data (GRAFIK-36)', () => {
  const index = loadRegionsIndex();

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
      if (!data || data.length === 0) continue; // e.g., region 92 Sevastopol may have 0
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

  it('region 74 spot checks', () => {
    const data = loadRegionData(74);
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
      expect(found, `${check.name} not found in region 74`).toBeDefined();
      expect(found.municipality, `${check.name} municipality mismatch`).toBe(check.expectedMun);
    }
  });

  it('major cities present in their regions (where data exists)', () => {
    const cityChecks = [
      { region: 77, name: 'Ярославль' },
      { region: 63, name: 'Екатеринбург' },
      { region: 45, name: 'Новосибирск' },
      { region: 64, name: 'Казань' },
      { region: 64, name: 'Набережные Челны' },
    ];
    for (const check of cityChecks) {
      const data = loadRegionData(check.region);
      expect(data, `Region ${check.region} data missing`).not.toBeNull();
      const found = data.find(r => r.name === check.name);
      expect(found, `${check.name} not found in region ${check.region}`).toBeDefined();
      expect(found.municipality, `${check.name} has no municipality`).toBeTruthy();
    }
  });
});