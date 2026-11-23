import { describe, expect, it } from 'vitest';

import {
  buildSchedule,
  extractLocation,
  visitDurationMinutes,
} from '../src/modules/scheduler.js';

const CALENDAR = { days: new Array(365).fill(0), source: 'test', warning: false };

const SETTINGS = {
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
};

function record(overrides = {}) {
  return {
    owner: 'ООО «Альфа»',
    ownerGroup: 'Юридические лица',
    inn: '7701000001',
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

describe('extractLocation', () => {
  it('extracts district and settlement (D8)', () => {
    const location = extractLocation(
      'Московская обл., Одинцовский р-н, г. Одинцово, ул. Мира, 5',
    );
    expect(location.district).toBe('одинцовский');
    expect(location.settlement).toBe('одинцово');
    expect(location.key).toBe('одинцовский|одинцово');
  });

  it('handles a city without a district and a village marker', () => {
    expect(extractLocation('г. Москва, ул. Ленина, д. 1').key).toBe('—|москва');
    expect(
      extractLocation('Московская обл., Клинский р-н, д. Бородино, ул. Полевая, 2').settlement,
    ).toBe('бородино');
  });

  it('does not treat a house number as a settlement', () => {
    expect(extractLocation('Московская обл., Клинский р-н, ул. Полевая, д. 1').settlement).toBe('');
  });

  it('falls back for an empty address', () => {
    expect(extractLocation('').key).toBe('—|—');
  });

  it('handles a settlement marker attached without a space (GRAFIK-15)', () => {
    expect(extractLocation('г.Москва, ул. Тверская, д. 1').settlement).toBe('москва');
    expect(extractLocation('г.Москва').settlement).toBe('москва');
  });

  it('recognizes a bare city name without a marker (GRAFIK-15)', () => {
    expect(extractLocation('Москва, ул. Ленина, д. 1').settlement).toBe('москва');
    expect(extractLocation('Нижний Новгород, ул. Большая, д. 1').settlement).toBe(
      'нижний новгород',
    );
  });

  it('does not treat a street-only address as a settlement (GRAFIK-15)', () => {
    expect(extractLocation('ул. Ленина, д. 5').settlement).toBe('');
  });

  it('uses region markers as the district fallback (GRAFIK-15)', () => {
    expect(extractLocation('Московская область, г. Одинцово').district).toBe('московская');
    expect(extractLocation('Краснодарский край, г. Краснодар').district).toBe('краснодарский');
    expect(extractLocation('Республика Крым, г. Симферополь').district).toBe('крым');
    expect(extractLocation('Чукотский АО, г. Анадырь').district).toBe('чукотский');
    expect(extractLocation('Еврейская аобл, г. Биробиджан').district).toBe('еврейская');
  });

  it('prefers an explicit district over a region (GRAFIK-15)', () => {
    const location = extractLocation('Московская обл., Одинцовский р-н, г. Одинцово');
    expect(location.district).toBe('одинцовский');
    expect(location.settlement).toBe('одинцово');
    expect(location.key).toBe('одинцовский|одинцово');
  });

  it('recognizes suffix settlement markers from split-column values (GRAFIK-16)', () => {
    const location = extractLocation('ЧЕЛЯБИНСКАЯ ОБЛ, КУСИНСКИЙ Р-Н, КУСА Г');
    expect(location.district).toBe('кусинский');
    expect(location.settlement).toBe('куса');
    expect(location.key).toBe('кусинский|куса');
    expect(extractLocation('ЧЕЛЯБИНСКАЯ ОБЛ, КУСИНСКИЙ Р-Н, МЕДВЕДЕВКА С').settlement).toBe(
      'медведевка',
    );
    expect(extractLocation('ЧЕЛЯБИНСКАЯ ОБЛ, КУСИНСКИЙ Р-Н, ЦЕНТРАЛЬНЫЙ п').settlement).toBe(
      'центральный',
    );
  });

  it('never returns the empty key for real addresses (GRAFIK-15)', () => {
    for (const address of [
      'г.Москва',
      'Москва',
      'г.Москва, ул. Тверская, д. 1',
      'Московская область, г. Одинцово',
      'Краснодарский край, г. Краснодар',
    ]) {
      expect(extractLocation(address).key).not.toBe('—|—');
    }
  });
});

describe('visitDurationMinutes', () => {
  it('rounds up to whole hours and 30-minute steps', () => {
    expect(visitDurationMinutes(12, 12)).toBe(60);
    expect(visitDurationMinutes(13, 12)).toBe(120);
    expect(visitDurationMinutes(1, 12)).toBe(60);
  });
});

describe('buildSchedule placement', () => {
  it('places same-location visits back-to-back without travel', () => {
    const result = buildSchedule(
      [
        record(),
        record({ owner: 'ООО «Бета»', inn: '2', address: 'г. Москва, ул. Мира, 2' }),
      ],
      SETTINGS,
      CALENDAR,
    );
    expect(result.visits).toHaveLength(2);
    expect(result.visits[0].date.getDate()).toBe(10);
    expect(result.visits[0].startMin).toBe(9 * 60);
    expect(result.visits[0].endMin).toBe(10 * 60);
    expect(result.visits[1].startMin).toBe(10 * 60);
  });

  it('adds travel time between visits from different settlements (D4)', () => {
    const result = buildSchedule(
      [
        record(),
        record({
          owner: 'ООО «Бета»',
          inn: '2',
          address: 'Московская обл., Одинцовский р-н, г. Одинцово, ул. Мира, 5',
        }),
      ],
      SETTINGS,
      CALENDAR,
    );
    expect(result.visits[1].locationKey).toBe('одинцовский|одинцово');
    expect(result.visits[1].startMin).toBe(10 * 60 + 60);
  });

  it('skips accepting weekdays and shifts to an earlier day', () => {
    const weekday = new Date(2026, 5, 10).getDay();
    const result = buildSchedule([record()], { ...SETTINGS, acceptingDays: [weekday] }, CALENDAR);
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0].date.getDay()).not.toBe(weekday);
    expect(result.visits[0].date.getMonth()).toBe(5);
  });

  it('places an overdue visit into the least-loaded month', () => {
    const regulars = Array.from({ length: 4 }, (_, index) =>
      record({ owner: `ООО «Рег${index}»`, inn: `10${index}` }),
    );
    const overdue = record({
      owner: 'ООО «Старое»',
      inn: '99',
      lastTo: new Date(2023, 5, 1),
      nextTo: null,
    });
    const result = buildSchedule([...regulars, overdue], SETTINGS, CALENDAR);
    const overdueVisit = result.visits.find((visit) => visit.overdue);
    expect(overdueVisit).toBeTruthy();
    expect(overdueVisit.date.getMonth()).toBe(0);
    expect(result.visits.filter((visit) => visit.date.getMonth() === 5)).toHaveLength(4);
  });

  it('flags an over-capacity visit as an overload occupying the whole day (D3)', () => {
    const many = Array.from({ length: 120 }, () => record());
    const result = buildSchedule(many, SETTINGS, CALENDAR);
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0].units).toBe(120);
    expect(result.visits[0].overload).toBe(true);
    expect(result.visits[0].startMin).toBe(9 * 60);
    expect(result.visits[0].endMin).toBe(18 * 60);
    expect(result.summary.overloaded).toBe(1);
  });

  it('builds a 12-month summary consistent with the visits', () => {
    const result = buildSchedule([record()], SETTINGS, CALENDAR);
    expect(result.summary.months).toHaveLength(12);
    expect(result.summary.visits).toBe(1);
    expect(result.summary.months[5].visits).toBe(1);
    expect(result.summary.months[5].machines).toBe(1);
  });

  it('places a «Без ТО» unit as an overdue visit (D12)', () => {
    const bez = record({
      owner: 'ООО «БезТО»',
      inn: '96',
      nextTo: null,
      flags: { bezTo: true },
    });
    const result = buildSchedule([bez], SETTINGS, CALENDAR);
    const visit = result.visits.find((entry) => entry.owner === 'ООО «БезТО»');
    expect(visit).toBeTruthy();
    expect(visit.overdue).toBe(true);
  });
});

describe('winter weighting (D14)', () => {
  const OVERDUE = record({
    owner: 'ООО «Старое»',
    inn: '99',
    lastTo: new Date(2023, 5, 1),
    nextTo: null,
  });

  it('avoids winter months when the winter load is 0%', () => {
    const regulars = Array.from({ length: 4 }, (_, index) =>
      record({ owner: `ООО «Рег${index}»`, inn: `20${index}` }),
    );
    const result = buildSchedule(
      [...regulars, OVERDUE],
      { ...SETTINGS, winterMonths: [0, 1, 11], winterLoadPercent: 0 },
      CALENDAR,
    );
    const visit = result.visits.find((entry) => entry.overdue);
    expect(visit).toBeTruthy();
    expect([0, 1, 11]).not.toContain(visit.date.getMonth());
  });

  it('uses winter months when the winter load is 100%', () => {
    const result = buildSchedule(
      [OVERDUE],
      { ...SETTINGS, winterMonths: [0, 1, 11], winterLoadPercent: 100 },
      CALENDAR,
    );
    const visit = result.visits.find((entry) => entry.overdue);
    expect(visit).toBeTruthy();
    expect([0, 1, 11]).toContain(visit.date.getMonth());
  });

  it('honours a custom winter month list', () => {
    const result = buildSchedule(
      [OVERDUE],
      { ...SETTINGS, winterMonths: [6, 7], winterLoadPercent: 0 },
      CALENDAR,
    );
    const visit = result.visits.find((entry) => entry.overdue);
    expect(visit).toBeTruthy();
    expect([6, 7]).not.toContain(visit.date.getMonth());
  });
});
