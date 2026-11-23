import { describe, expect, it } from 'vitest';

import { buildSchedule } from '../src/modules/scheduler.js';

const CALENDAR = { days: new Array(366).fill(0), source: 'test', warning: false };

const BASE = {
  targetYear: 2026,
  toDepthYears: 3,
  workStart: '09:00',
  workEnd: '18:00',
  lunch: { enabled: true, start: '12:00', end: '13:00' },
  perHour: 12,
  travelMinutes: 60,
  acceptingDays: [],
  groupWindowDays: 30,
  smallPhysicalMode: 'A',
  physicalThreshold: 3,
  winterMonths: [0, 1, 11],
  winterLoadPercent: 30,
};

function rec(overrides = {}) {
  return {
    owner: 'ООО «Малый»',
    ownerGroup: 'Юридические лица',
    inn: '7700000001',
    address: 'г. Москва, ул. Ленина, 1',
    category: 'B',
    plate: 'А001ММ77',
    brand: 'МТЗ',
    name: 'Трактор',
    serial: 'Z1',
    lastTo: new Date(2025, 0, 1),
    nextTo: new Date(2026, 5, 10),
    removalDate: null,
    flags: { ugon: false, bezTo: false, sdanGrz: false, vyvezena: false },
    ...overrides,
  };
}

function spaced(owner, units, extra = {}) {
  return Array.from({ length: units }, (_, index) =>
    rec({
      owner,
      inn: extra.inn ?? '7700000001',
      plate: `${owner}-${index}`,
      nextTo: new Date(2026, index * 2, 10),
      ...extra,
    }),
  );
}

describe('group small owners by latest target date (GRAFIK-14)', () => {
  it('ON merges 3 units into one visit on the latest target date', () => {
    const units = spaced('ООО «Малый»', 3);
    const result = buildSchedule(units, BASE, CALENDAR);
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0].units).toBe(3);
    expect(result.visits[0].date.getMonth()).toBe(4);
    expect(result.visits[0].date.getDate()).toBe(10);

    const months = result.visits[0].unitsDetail
      .flatMap((unit) => unit.dates.map((entry) => entry.date.getMonth()))
      .sort((a, b) => a - b);
    expect(months).toEqual([0, 2, 4]);
  });

  it('OFF keeps each unit on its own target date', () => {
    const units = spaced('ООО «Малый»', 3);
    const result = buildSchedule(units, { ...BASE, groupSmallOwners: false }, CALENDAR);
    expect(result.visits).toHaveLength(3);
  });

  it('groups 1, 2 and 3 units but not 4 at the default threshold of 3', () => {
    for (const units of [1, 2, 3]) {
      const result = buildSchedule(
        spaced(`ООО «Мал${units}»`, units, { inn: `77010000${units}0` }),
        BASE,
        CALENDAR,
      );
      expect(result.visits).toHaveLength(1);
      expect(result.visits[0].units).toBe(units);
    }
    const four = buildSchedule(spaced('ООО «Мал4»', 4), BASE, CALENDAR);
    expect(four.visits).toHaveLength(4);
  });

  it('uses the D11 threshold as N', () => {
    const three = spaced('ООО «Малый»', 3);
    expect(buildSchedule(three, { ...BASE, physicalThreshold: 2 }, CALENDAR).visits).toHaveLength(
      3,
    );
    expect(buildSchedule(three, { ...BASE, physicalThreshold: 5 }, CALENDAR).visits).toHaveLength(
      1,
    );
  });

  it('groups a small legal owner, excludes a small physical owner and keeps an individual over the limit', () => {
    const records = [
      ...spaced('ООО «Малый»', 2, { inn: '7700000001' }),
      ...spaced('Петров', 2, { inn: '5001000001', ownerGroup: 'Физические лица' }),
      ...spaced('Фермеров', 4, { inn: '5002000006', ownerGroup: 'Физические лица' }),
    ];
    const result = buildSchedule(records, BASE, CALENDAR);

    const legal = result.visits.filter((visit) => visit.owner === 'ООО «Малый»');
    expect(legal).toHaveLength(1);
    expect(legal[0].units).toBe(2);

    expect(result.excluded.some((entry) => entry.record.owner === 'Петров')).toBe(true);

    const large = result.visits.filter((visit) => visit.owner === 'Фермеров');
    expect(large).toHaveLength(4);
  });

  it('uses the normal latest date when overdue and normal targets are mixed', () => {
    const mixed = [
      rec({ plate: 'S1', lastTo: new Date(2023, 5, 1), nextTo: null }),
      rec({ plate: 'S2', nextTo: new Date(2026, 8, 10) }),
    ];
    const result = buildSchedule(mixed, BASE, CALENDAR);
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0].units).toBe(2);
    expect(result.visits[0].overdue).toBe(false);
    expect(result.visits[0].date.getMonth()).toBe(8);
  });

  it('places an all-overdue group with winter weighting (avoid winter at 0%)', () => {
    const overdue = [
      rec({ plate: 'O1', lastTo: new Date(2023, 5, 1), nextTo: null }),
      rec({ plate: 'O2', lastTo: new Date(2023, 7, 1), nextTo: null }),
    ];
    const avoid = buildSchedule(
      overdue,
      { ...BASE, winterMonths: [0, 1, 11], winterLoadPercent: 0 },
      CALENDAR,
    );
    expect(avoid.visits).toHaveLength(1);
    expect(avoid.visits[0].overdue).toBe(true);
    expect([0, 1, 11]).not.toContain(avoid.visits[0].date.getMonth());

    const allow = buildSchedule(
      overdue,
      { ...BASE, winterMonths: [0, 1, 11], winterLoadPercent: 100 },
      CALENDAR,
    );
    expect(allow.visits).toHaveLength(1);
    expect([0, 1, 11]).toContain(allow.visits[0].date.getMonth());
  });

  it('OFF keeps overdue and normal units as separate visits', () => {
    const mixed = [
      rec({ plate: 'S1', lastTo: new Date(2023, 5, 1), nextTo: null }),
      rec({ plate: 'S2', nextTo: new Date(2026, 8, 10) }),
    ];
    const result = buildSchedule(mixed, { ...BASE, groupSmallOwners: false }, CALENDAR);
    expect(result.visits).toHaveLength(2);
    expect(result.visits.filter((visit) => visit.overdue)).toHaveLength(1);
  });

  it('OFF still clusters units that fall inside the grouping window', () => {
    const close = [
      rec({ plate: 'W1', nextTo: new Date(2026, 1, 10) }),
      rec({ plate: 'W2', nextTo: new Date(2026, 1, 20) }),
    ];
    const off = buildSchedule(close, { ...BASE, groupSmallOwners: false }, CALENDAR);
    expect(off.visits).toHaveLength(1);
    expect(off.visits[0].units).toBe(2);

    const on = buildSchedule(close, BASE, CALENDAR);
    expect(on.visits).toHaveLength(1);
    expect(on.visits[0].date.getDate()).toBe(20);
  });
});
