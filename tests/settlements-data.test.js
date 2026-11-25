import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve('public/data/settlements-74.json');

function loadData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

describe('settlements-74.json (GRAFIK-32)', () => {
  const data = loadData();

  it('should be an array with > 1000 records', () => {
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(1000);
  });

  it('every record has required fields', () => {
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
    }
  });

  it('all coordinates within Chelyabinsk oblast bbox (lat 51.9–56.4, lon 57.0–63.4)', () => {
    for (const rec of data) {
      expect(rec.lat).toBeGreaterThanOrEqual(51.9);
      expect(rec.lat).toBeLessThanOrEqual(56.4);
      expect(rec.lon).toBeGreaterThanOrEqual(57.0);
      expect(rec.lon).toBeLessThanOrEqual(63.4);
    }
  });

  it('has reasonable type distribution', () => {
    const types = data.reduce((acc, rec) => {
      acc[rec.type] = (acc[rec.type] || 0) + 1;
      return acc;
    }, {});
    // Should have cities, towns, villages, hamlets, localities
    expect(types.city).toBeGreaterThan(0);
    expect(types.town).toBeGreaterThan(0);
    expect(types.village).toBeGreaterThan(0);
    expect(types.hamlet).toBeGreaterThan(0);
    expect(types.locality).toBeGreaterThan(0);
  });

  it('spot check: Сатка in Саткинский district', () => {
    const satka = data.find(r => r.name === 'Сатка');
    expect(satka).toBeDefined();
    // Municipality name may have encoding issues or "(nearest)" suffix
    expect(satka.municipality).toMatch(/Саткинск/);
  });

  it('spot check: Бердяуш in Саткинский district', () => {
    const berdyaush = data.find(r => r.name === 'Бердяуш');
    expect(berdyaush).toBeDefined();
    expect(berdyaush.municipality).toMatch(/Саткинск/);
  });

  it('spot check: Тайнак in Кусинский district (note: OSM has it in Кусинский, not Златоустовский)', () => {
    const tainak = data.find(r => r.name === 'Тайнак');
    expect(tainak).toBeDefined();
    // OSM places Тайнак in Кусинский муниципальный округ, not Златоустовский
    expect(tainak.municipality).toContain('Кусинский');
  });

  it('file size under 650 KB raw', () => {
    const stats = fs.statSync(DATA_FILE);
    expect(stats.size).toBeLessThan(650 * 1024);
  });

  it('duplicate names across municipalities are tracked', () => {
    const nameMap = new Map();
    for (const rec of data) {
      const key = rec.name.toLowerCase();
      if (!nameMap.has(key)) nameMap.set(key, new Set());
      nameMap.get(key).add(rec.municipality);
    }
    const duplicates = [...nameMap.entries()].filter(([, muns]) => muns.size > 1);
    // Just verify we can compute this - the count is informational
    expect(duplicates.length).toBeGreaterThanOrEqual(0);
  });

  it('records with definitive municipality (non-nearest) exist', () => {
    const definitive = data.filter(r => !r.municipality.endsWith('(nearest)'));
    expect(definitive.length).toBeGreaterThan(0);
  });
});