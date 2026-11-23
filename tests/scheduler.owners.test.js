import { describe, expect, it } from 'vitest';

import {
  applyPhysicalRule,
  clusterTargets,
  isPhysicalOwner,
  normalizeName,
  ownerKey,
} from '../src/modules/scheduler.js';

function record(overrides = {}) {
  return {
    owner: 'ООО «Заря»',
    ownerGroup: 'Юридические лица',
    inn: '7701000001',
    address: 'г. Москва, ул. Ленина, 1',
    category: 'B',
    ...overrides,
  };
}

describe('normalizeName', () => {
  it('lowercases, collapses spaces and folds ё', () => {
    expect(normalizeName('  ООО\u00a0 «Заря»  ')).toBe('ооо «заря»');
    expect(normalizeName('Пётр')).toBe('петр');
  });
});

describe('ownerKey', () => {
  it('uses INN digits when present', () => {
    expect(ownerKey(record({ inn: '77 01-000001' }))).toBe('inn:7701000001');
  });

  it('falls back to the normalized owner name', () => {
    expect(ownerKey(record({ inn: '', owner: ' Пётр  Иванов ' }))).toBe('name:петр иванов');
  });

  it('does not treat a short placeholder ИНН as a real key (GRAFIK-10)', () => {
    expect(ownerKey(record({ inn: '0', owner: 'Петров Пётр' }))).toBe('name:петров петр');
    expect(ownerKey(record({ inn: '—', owner: 'Петров Пётр' }))).toBe('name:петров петр');
    expect(ownerKey(record({ inn: '500100000123', owner: 'Петров Пётр' }))).toBe(
      'inn:500100000123',
    );
  });
});

describe('isPhysicalOwner', () => {
  it('detects physical owners case-insensitively', () => {
    expect(isPhysicalOwner(record({ ownerGroup: 'Физические лица' }))).toBe(true);
    expect(isPhysicalOwner(record({ ownerGroup: 'физлицо' }))).toBe(true);
    expect(isPhysicalOwner(record({ ownerGroup: 'ФЛ' }))).toBe(true);
    expect(isPhysicalOwner(record({ ownerGroup: 'Юридические лица' }))).toBe(false);
  });
});

describe('applyPhysicalRule', () => {
  const smallPhysical = [
    record({ owner: 'Петров Пётр', ownerGroup: 'Физические лица', inn: '5001000001' }),
    record({ owner: 'Петров Пётр', ownerGroup: 'Физические лица', inn: '5001000001' }),
  ];
  const legal = record();

  it('mode A excludes individuals with <= 3 units', () => {
    const result = applyPhysicalRule([...smallPhysical, legal], { smallPhysicalMode: 'A' });
    expect(result.kept).toEqual([legal]);
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded[0].reason).toMatch(/вариант А/);
    expect(result.notes).toEqual([]);
  });

  it('mode B excludes and adds the reception note', () => {
    const result = applyPhysicalRule([...smallPhysical, legal], {
      smallPhysicalMode: 'B',
      acceptingDays: [1, 3],
      inspectionAddress: 'г. Москва, ул. Инспекции, 1',
    });
    expect(result.kept).toEqual([legal]);
    expect(result.excluded).toHaveLength(2);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('г. Москва, ул. Инспекции, 1');
    expect(result.notes[0]).toContain('Пн, Ср');
  });

  it('keeps individuals with more than 3 units', () => {
    const big = Array.from({ length: 5 }, () =>
      record({ owner: 'Иванов', ownerGroup: 'Физические лица', inn: '' }),
    );
    const result = applyPhysicalRule(big, { smallPhysicalMode: 'A' });
    expect(result.kept).toHaveLength(5);
    expect(result.excluded).toHaveLength(0);
    expect(result.notes).toEqual([]);
  });

  it('defaults to mode A', () => {
    const result = applyPhysicalRule(smallPhysical, {});
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded[0].reason).toMatch(/вариант А/);
  });

  function physical(units, overrides = {}) {
    return Array.from({ length: units }, (_, index) =>
      record({
        owner: 'Петров Пётр',
        ownerGroup: 'Физические лица',
        inn: '',
        plate: `А10${index}ММ77`,
        ...overrides,
      }),
    );
  }

  it('excludes 2 and 3 units but keeps 4 at the default threshold of 3 (D11)', () => {
    for (const units of [2, 3]) {
      const result = applyPhysicalRule(physical(units), { smallPhysicalMode: 'A' });
      expect(result.kept).toHaveLength(0);
      expect(result.excluded).toHaveLength(units);
    }
    const four = applyPhysicalRule(physical(4), { smallPhysicalMode: 'A' });
    expect(four.kept).toHaveLength(4);
    expect(four.excluded).toHaveLength(0);
  });

  it('honours a configurable threshold (D11)', () => {
    const two = applyPhysicalRule(physical(2), { physicalThreshold: 2 });
    expect(two.excluded).toHaveLength(2);
    const threeAtTwo = applyPhysicalRule(physical(3), { physicalThreshold: 2 });
    expect(threeAtTwo.kept).toHaveLength(3);
    const fourAtFive = applyPhysicalRule(physical(4), { physicalThreshold: 5 });
    expect(fourAtFive.excluded).toHaveLength(4);
  });

  it('uses the threshold inside the mode B note (D5/D11)', () => {
    const result = applyPhysicalRule(physical(2), {
      smallPhysicalMode: 'B',
      physicalThreshold: 2,
      acceptingDays: [1],
      inspectionAddress: 'г. Москва, ул. Инспекции, 1',
    });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('не более 2 ед.');
  });

  it('detects an individual even when only some of its rows are marked (D11)', () => {
    const mixed = [
      record({ owner: 'Смешанный', ownerGroup: 'Юридические лица', inn: '' }),
      record({ owner: 'Смешанный', ownerGroup: 'Физические лица', inn: '' }),
      record({ owner: 'Смешанный', ownerGroup: 'Физические лица', inn: '' }),
    ];
    const result = applyPhysicalRule(mixed, { smallPhysicalMode: 'A' });
    expect(result.kept).toHaveLength(0);
    expect(result.excluded).toHaveLength(3);
  });

  it('does not merge distinct individuals that share a placeholder ИНН (GRAFIK-10)', () => {
    const collision = [
      ...physical(3, { owner: 'Иванов Иван', inn: '0' }),
      ...physical(3, { owner: 'Сидоров Иван', inn: '0' }),
    ];
    const result = applyPhysicalRule(collision, { smallPhysicalMode: 'A' });
    expect(result.kept).toHaveLength(0);
    expect(result.excluded).toHaveLength(6);
  });
});

describe('clusterTargets', () => {
  const key = 'inn:7701000001';
  const recA = record();
  const recB = record({ plate: 'А002ММ77' });
  const recC = record({ plate: 'А003ММ77' });

  it('groups same-owner items inside the window and splits beyond it', () => {
    const items = [
      { record: recA, ownerKey: key, date: new Date(2026, 0, 1) },
      { record: recB, ownerKey: key, date: new Date(2026, 0, 10) },
      { record: recC, ownerKey: key, date: new Date(2026, 1, 10) },
    ];
    const clusters = clusterTargets(items, { groupWindowDays: 30 });
    expect(clusters).toHaveLength(2);
    expect(clusters[0].units).toBe(2);
    expect(clusters[0].date.getDate()).toBe(1);
    expect(clusters[1].units).toBe(1);
    expect(clusters[1].date.getMonth()).toBe(1);
  });

  it('does not merge different owners', () => {
    const items = [
      { record: recA, ownerKey: 'inn:1', date: new Date(2026, 0, 1) },
      { record: recB, ownerKey: 'inn:2', date: new Date(2026, 0, 1) },
    ];
    expect(clusterTargets(items, { groupWindowDays: 30 })).toHaveLength(2);
  });

  it('keeps A4 dates six months apart in separate clusters', () => {
    const a4 = record({ category: 'А4' });
    const items = [
      { record: a4, ownerKey: key, date: new Date(2026, 2, 1) },
      { record: a4, ownerKey: key, date: new Date(2026, 8, 1) },
    ];
    const clusters = clusterTargets(items, { groupWindowDays: 30 });
    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.units === 1)).toBe(true);
  });
});
