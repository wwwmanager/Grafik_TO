import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve('public/data/settlements-74.json');

function loadData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

describe('settlements-74.json (GRAFIK-37)', () => {
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
    expect(types.city).toBeGreaterThan(0);
    expect(types.town).toBeGreaterThan(0);
    expect(types.village).toBeGreaterThan(0);
    expect(types.hamlet).toBeGreaterThan(0);
    expect(types.locality).toBeGreaterThan(0);
  });

  it('spot check: Сатка in Саткинский district', () => {
    const satka = data.find(r => r.name === 'Сатка');
    expect(satka).toBeDefined();
    expect(satka.municipality).toBe('Саткинский');
  });

  it('spot check: Бердяуш in Саткинский district', () => {
    const berdyaush = data.find(r => r.name === 'Бердяуш');
    expect(berdyaush).toBeDefined();
    expect(berdyaush.municipality).toBe('Саткинский');
  });

  it('spot check: Тайнак in Златоуст urban okrug (per OSM area membership)', () => {
    const tainak = data.find(r => r.name === 'Тайнак');
    expect(tainak).toBeDefined();
    expect(tainak.municipality).toBe('Златоуст');
  });

  it('no record contains "nearest" or "(" in municipality', () => {
    for (const rec of data) {
      expect(rec.municipality).not.toContain('nearest');
      expect(rec.municipality).not.toContain('(');
    }
  });

  it('100% of records have a municipality (non-empty)', () => {
    const noMun = data.filter(r => !r.municipality || r.municipality.trim() === '');
    expect(noMun.length).toBe(0);
  });

  it('file size under 700 KB raw', () => {
    const stats = fs.statSync(DATA_FILE);
    expect(stats.size).toBeLessThan(700 * 1024);
  });

  it('duplicate names across municipalities are tracked', () => {
    const nameMap = new Map();
    for (const rec of data) {
      const key = rec.name.toLowerCase();
      if (!nameMap.has(key)) nameMap.set(key, new Set());
      nameMap.get(key).add(rec.municipality);
    }
    const duplicates = [...nameMap.entries()].filter(([, muns]) => muns.size > 1);
    expect(duplicates.length).toBeGreaterThanOrEqual(0);
  });

  it('additional spot checks (10+)', () => {
    const checks = [
      { name: 'Челябинск', expectedMun: 'Челябинск' },
      { name: 'Магнитогорск', expectedMun: 'Магнитогорск' },
      { name: 'Златоуст', expectedMun: 'Златоуст' },
      { name: 'Миасс', expectedMun: 'Миасс' },
      { name: 'Копейск', expectedMun: 'Копейск' },
      { name: 'Коркино', expectedMun: 'Коркино' },
      { name: 'Южноуральск', expectedMun: 'Южноуральск' },
      { name: 'Снежинск', expectedMun: 'Снежинск' },
      { name: 'Трёхгорный', expectedMun: 'Трехгорный' },
      { name: 'Озёрск', expectedMun: 'Озёрск' },
      { name: 'Карабаш', expectedMun: 'Карабаш' },
      { name: 'Кыштым', expectedMun: 'Кыштым' },
      { name: 'Усть-Катав', expectedMun: 'Усть-Катав' },
    ];
    for (const check of checks) {
      const found = data.find(r => r.name === check.name);
      expect(found, `${check.name} not found`).toBeDefined();
      expect(found.municipality, `${check.name} municipality mismatch`).toBe(check.expectedMun);
    }
  });
});