import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.resolve('public/data/settlements-74.json');

function loadData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

describe('settlements-74.json (GRAFIK-39)', () => {
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

  it('has reasonable type distribution (no locality)', () => {
    const types = data.reduce((acc, rec) => {
      acc[rec.type] = (acc[rec.type] || 0) + 1;
      return acc;
    }, {});
    // Should have cities, towns, villages, hamlets (no locality)
    expect(types.city).toBeGreaterThan(0);
    expect(types.town).toBeGreaterThan(0);
    expect(types.village).toBeGreaterThan(0);
    expect(types.hamlet).toBeGreaterThan(0);
    expect(types.locality).toBeUndefined();
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

  it('spot check: Тундуш in Златоуст urban okrug', () => {
    const tundush = data.find(r => r.name === 'Тундуш');
    expect(tundush).toBeDefined();
    expect(tundush.municipality).toBe('Златоуст');
  });

  it('spot check: Тюбук in Каслинский district', () => {
    const tyubuk = data.find(r => r.name === 'Тюбук');
    expect(tyubuk).toBeDefined();
    expect(tyubuk.municipality).toBe('Каслинский');
  });

  it('spot check: Магнитка in Кусинский district', () => {
    const magnitka = data.find(r => r.name === 'Магнитка');
    expect(magnitka).toBeDefined();
    expect(magnitka.municipality).toBe('Кусинский');
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

  it('no duplicate (name, municipality, 3-decimal coords) pairs', () => {
    const seen = new Set();
    for (const rec of data) {
      const key = rec.name + '|' + rec.municipality + '|' + rec.lat.toFixed(3) + '|' + rec.lon.toFixed(3);
      expect(seen.has(key), `Duplicate (name,muni,3dec coords): ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('no junk names: starting with digit, "ур."/"урочище", containing "нежил"', () => {
    for (const rec of data) {
      expect(rec.name).not.toMatch(/^\d/);
      expect(rec.name).not.toMatch(/^ур\.|урочище/i);
      expect(rec.name).not.toMatch(/нежил/i);
    }
  });

  it('file size under 700 KB raw', () => {
    const stats = fs.statSync(DATA_FILE);
    expect(stats.size).toBeLessThan(700 * 1024);
  });

  it('additional spot checks: major cities present', () => {
    const checks = [
      { name: 'Челябинск', expectedMun: 'Челябинск' },
      { name: 'Магнитогорск', expectedMun: 'Магнитогорск' },
      { name: 'Златоуст', expectedMun: 'Златоуст' },
      { name: 'Миасс', expectedMun: 'Миасс' },
    ];
    for (const check of checks) {
      const found = data.find(r => r.name === check.name);
      expect(found, `${check.name} not found`).toBeDefined();
      expect(found.municipality, `${check.name} municipality mismatch`).toBe(check.expectedMun);
    }
  });
});