import { describe, expect, it } from 'vitest';

import {
  addMonths,
  computeTargetDates,
  depthCutoff,
  exclusionReason,
  filterRecords,
  isA4,
} from '../src/modules/scheduler.js';

const SETTINGS = { targetYear: 2026, toDepthYears: 3 };

function record(overrides = {}) {
  return {
    owner: 'ООО «Заря»',
    ownerGroup: 'Юридические лица',
    inn: '7701000001',
    address: 'г. Москва',
    category: 'B',
    plate: 'А001ММ77',
    brand: 'МТЗ',
    name: 'Трактор',
    serial: 'Z1',
    lastTo: new Date(2025, 2, 10),
    nextTo: null,
    removalDate: null,
    flags: { ugon: false, bezTo: false, sdanGrz: false, vyvezena: false },
    ...overrides,
  };
}

describe('depthCutoff', () => {
  it('is January 1 of target year minus depth', () => {
    expect(depthCutoff(SETTINGS).getFullYear()).toBe(2023);
    expect(depthCutoff(SETTINGS).getMonth()).toBe(0);
    expect(depthCutoff(SETTINGS).getDate()).toBe(1);
  });
});

describe('exclusionReason', () => {
  it('excludes removed, flagged and stale records with reasons', () => {
    expect(exclusionReason(record({ removalDate: new Date(2025, 4, 10) }), SETTINGS)).toMatch(
      /Снято/,
    );
    expect(exclusionReason(record({ flags: { ugon: true } }), SETTINGS)).toBe('Угон');
    expect(exclusionReason(record({ flags: { sdanGrz: true } }), SETTINGS)).toBe('Сдан ГРЗ');
    expect(exclusionReason(record({ flags: { vyvezena: true } }), SETTINGS)).toBe(
      'Вывезена за рубеж',
    );
    expect(exclusionReason(record({ lastTo: null }), SETTINGS)).toMatch(/Дата ТО/);
  });

  it('applies the depth boundary at exactly January 1', () => {
    expect(exclusionReason(record({ lastTo: new Date(2022, 11, 31) }), SETTINGS)).toBe(
      'Дата ТО больше выбранной давности ТО',
    );
    expect(exclusionReason(record({ lastTo: new Date(2023, 0, 1) }), SETTINGS)).toBeNull();
  });

  it('keeps a valid record', () => {
    expect(exclusionReason(record(), SETTINGS)).toBeNull();
  });

  it('treats «Без ТО» = «*» as scheduled, not excluded (D12)', () => {
    expect(exclusionReason(record({ flags: { bezTo: true } }), SETTINGS)).toBeNull();
  });

  it('keeps the stronger exclusions above «Без ТО» (D12)', () => {
    expect(
      exclusionReason(record({ flags: { bezTo: true, ugon: true } }), SETTINGS),
    ).toBe('Угон');
    expect(
      exclusionReason(record({ flags: { bezTo: true, sdanGrz: true } }), SETTINGS),
    ).toBe('Сдан ГРЗ');
    expect(
      exclusionReason(
        record({ flags: { bezTo: true }, removalDate: new Date(2025, 0, 1) }),
        SETTINGS,
      ),
    ).toMatch(/Снято/);
  });

  it('«*» without a date is excluded until depth reaches 5 (D13)', () => {
    const noDate = record({ flags: { bezTo: true }, lastTo: null });
    expect(exclusionReason(noDate, { ...SETTINGS, toDepthYears: 3 })).toMatch(/глубина менее 5/);
    expect(exclusionReason(noDate, { ...SETTINGS, toDepthYears: 4 })).toMatch(/глубина менее 5/);
    expect(exclusionReason(noDate, { ...SETTINGS, toDepthYears: 5 })).toBeNull();
    expect(exclusionReason(noDate, { ...SETTINGS, toDepthYears: 6 })).toBeNull();
  });

  it('«*» with a valid date still honours the depth (D12)', () => {
    const stale = record({ flags: { bezTo: true }, lastTo: new Date(2022, 5, 1) });
    expect(exclusionReason(stale, SETTINGS)).toBe('Дата ТО больше выбранной давности ТО');
  });
});

describe('filterRecords', () => {
  it('splits active and excluded with reasons', () => {
    const records = [
      record(),
      record({ flags: { ugon: true } }),
      record({ removalDate: new Date(2025, 0, 1) }),
    ];
    const { active, excluded } = filterRecords(records, SETTINGS);
    expect(active).toHaveLength(1);
    expect(excluded).toHaveLength(2);
    expect(excluded[0].reason).toBe('Угон');
  });
});

describe('isA4', () => {
  it('recognizes Cyrillic А4 and Latin A4', () => {
    expect(isA4(record({ category: 'А4' }))).toBe(true);
    expect(isA4(record({ category: 'A4' }))).toBe(true);
    expect(isA4(record({ category: 'B' }))).toBe(false);
  });
});

describe('computeTargetDates', () => {
  it('uses the computed +1 year date for a regular record', () => {
    const result = computeTargetDates(record(), SETTINGS);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].date.getFullYear()).toBe(2026);
    expect(result.dates[0].date.getMonth()).toBe(2);
    expect(result.dates[0].source).toMatch(/1 год/);
    expect(result.overdue).toBe(false);
  });

  it('prefers a valid «Дата след. ТО» from the export', () => {
    const result = computeTargetDates(record({ nextTo: new Date(2026, 4, 1) }), SETTINGS);
    expect(result.dates[0].date.getMonth()).toBe(4);
    expect(result.dates[0].source).toMatch(/след\. ТО/);
  });

  it('flags a regular record as overdue when its date precedes the target year', () => {
    const result = computeTargetDates(
      record({ lastTo: new Date(2023, 5, 1) }),
      SETTINGS,
    );
    expect(result.overdue).toBe(true);
    expect(result.dates[0].date.getFullYear()).toBe(2024);
  });

  it('produces two +6-month dates inside the target year for A4', () => {
    const result = computeTargetDates(
      record({ category: 'А4', lastTo: new Date(2025, 8, 1) }),
      SETTINGS,
    );
    expect(result.isA4).toBe(true);
    expect(result.dates).toHaveLength(2);
    expect(result.dates.map((item) => item.date.getMonth())).toEqual([2, 8]);
  });

  it('adds the +6-month successor for A4 from the export next date', () => {
    const result = computeTargetDates(
      record({ category: 'A4', nextTo: new Date(2026, 1, 1) }),
      SETTINGS,
    );
    expect(result.dates).toHaveLength(2);
    expect(result.dates[1].date.getMonth()).toBe(7);
  });

  it('keeps an overdue A4 anchor and its in-year successor', () => {
    const result = computeTargetDates(
      record({ category: 'А4', lastTo: new Date(2024, 0, 1) }),
      SETTINGS,
    );
    expect(result.overdue).toBe(true);
    const anchor = result.dates[0];
    expect(anchor.overdue).toBe(true);
    expect(anchor.date.getTime()).toBe(addMonths(new Date(2024, 0, 1), 18).getTime());
    expect(result.dates[1].date.getFullYear()).toBe(2026);
  });

  it('rolls an on-time current-year next TO into the target year (GRAFIK-18)', () => {
    const result = computeTargetDates(
      record({ nextTo: new Date(2026, 10, 26) }),
      { targetYear: 2027, toDepthYears: 3, exportDate: new Date(2026, 10, 23) },
    );
    expect(result.overdue).toBe(false);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].overdue).toBe(false);
    expect([
      result.dates[0].date.getFullYear(),
      result.dates[0].date.getMonth(),
      result.dates[0].date.getDate(),
    ]).toEqual([2027, 10, 26]);
  });

  it('rolls an on-time computed next TO (+1 year) instead of overdue (GRAFIK-18)', () => {
    const result = computeTargetDates(
      record({ lastTo: new Date(2025, 10, 26) }),
      { targetYear: 2027, toDepthYears: 3, exportDate: new Date(2026, 10, 23) },
    );
    expect(result.overdue).toBe(false);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].overdue).toBe(false);
    expect([
      result.dates[0].date.getFullYear(),
      result.dates[0].date.getMonth(),
      result.dates[0].date.getDate(),
    ]).toEqual([2027, 10, 26]);
  });

  it('steps an on-time A4 date by 6 months inside the target year (GRAFIK-18)', () => {
    const result = computeTargetDates(
      record({ category: 'А4', nextTo: new Date(2026, 10, 26) }),
      { targetYear: 2027, toDepthYears: 3, exportDate: new Date(2026, 10, 23) },
    );
    expect(result.overdue).toBe(false);
    expect(result.dates).toHaveLength(2);
    expect(result.dates.map((item) => [item.date.getFullYear(), item.date.getMonth(), item.date.getDate()])).toEqual([
      [2027, 4, 26],
      [2027, 10, 26],
    ]);
  });

  it('marks «Без ТО» as overdue even when the computed date is in the target year (D12)', () => {
    const result = computeTargetDates(
      record({ flags: { bezTo: true }, lastTo: new Date(2026, 0, 10) }),
      SETTINGS,
    );
    expect(result.overdue).toBe(true);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].overdue).toBe(true);
    expect(result.dates[0].source).toMatch(/Без ТО/);
  });

  it('schedules «*» without a date via a placeholder overdue date (D13)', () => {
    const result = computeTargetDates(
      record({ flags: { bezTo: true }, lastTo: null }),
      SETTINGS,
    );
    expect(result.overdue).toBe(true);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].date.getFullYear()).toBe(2026);
    expect(result.dates[0].source).toMatch(/нет даты ТО/);
  });
});
