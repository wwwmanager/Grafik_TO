import { describe, expect, it } from 'vitest';

import {
  buildWeekendCalendar,
  daysInYear,
  getDayOfYear,
  isWorkingDay,
  loadProductionCalendar,
  parseApiString,
} from '../src/modules/calendarService.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

function textResponse(body) {
  return { ok: true, text: async () => body };
}

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

describe('daysInYear', () => {
  it('handles leap years', () => {
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2025)).toBe(365);
  });
});

describe('parseApiString', () => {
  it('parses a full-year 0/1 string', () => {
    const days = parseApiString('0'.repeat(365), 2026);
    expect(days).toHaveLength(365);
    expect(days.every((value) => value === 0)).toBe(true);
    expect(parseApiString('1'.repeat(366), 2024)).toHaveLength(366);
  });

  it('rejects wrong length and invalid characters', () => {
    expect(parseApiString('0101', 2026)).toBeNull();
    expect(parseApiString('x'.repeat(365), 2026)).toBeNull();
  });
});

describe('buildWeekendCalendar', () => {
  it('marks Saturdays and Sundays as days off', () => {
    const days = buildWeekendCalendar(2026);
    expect(days).toHaveLength(365);
    expect(days[getDayOfYear(new Date(2026, 0, 3))]).toBe(1); // Saturday
    expect(days[getDayOfYear(new Date(2026, 0, 7))]).toBe(0); // Wednesday
  });
});

describe('isWorkingDay', () => {
  const workingCalendar = { days: new Array(daysInYear(2026)).fill(0) };

  it('rejects production-calendar days off', () => {
    const calendar = { days: workingCalendar.days.slice() };
    calendar.days[getDayOfYear(new Date(2026, 0, 1))] = 1;
    expect(isWorkingDay(new Date(2026, 0, 1), {}, calendar)).toBe(false);
  });

  it('rejects accepting weekdays', () => {
    const monday = new Date(2026, 0, 5);
    expect(isWorkingDay(monday, { acceptingDays: [monday.getDay()] }, workingCalendar)).toBe(
      false,
    );
  });

  it('rejects dates inside the vacation range', () => {
    const settings = { vacation: { enabled: true, from: '2026-01-05', to: '2026-01-09' } };
    expect(isWorkingDay(new Date(2026, 0, 7), settings, workingCalendar)).toBe(false);
    expect(isWorkingDay(new Date(2026, 0, 12), settings, workingCalendar)).toBe(true);
  });

  it('allows a regular working day', () => {
    expect(isWorkingDay(new Date(2026, 0, 7), {}, workingCalendar)).toBe(true);
  });
});

describe('loadProductionCalendar', () => {
  it('uses the API on success and writes a cache entry', async () => {
    const storage = fakeStorage();
    const fetchImpl = async (url) =>
      url.includes('isdayoff') ? textResponse('0'.repeat(365)) : jsonResponse({});
    const result = await loadProductionCalendar(2026, { fetchImpl, storage });
    expect(result.source).toBe('api');
    expect(result.warning).toBe(false);
    expect(result.days).toHaveLength(365);
    expect(storage.map.has('grafik-to:calendar:2026')).toBe(true);
  });

  it('returns the cache without network', async () => {
    const storage = fakeStorage({
      'grafik-to:calendar:2026': JSON.stringify({
        year: 2026,
        days: new Array(365).fill(1),
        source: 'api',
      }),
    });
    const fetchImpl = async () => {
      throw new Error('network must not be used');
    };
    const result = await loadProductionCalendar(2026, { fetchImpl, storage });
    expect(result.source).toBe('cache');
    expect(result.days[0]).toBe(1);
  });

  it('falls back to the bundled calendar when the API fails', async () => {
    const storage = fakeStorage();
    const fetchImpl = async (url) => {
      if (url.includes('isdayoff')) throw new Error('CORS');
      return jsonResponse({ year: 2026, days: new Array(365).fill(0) });
    };
    const result = await loadProductionCalendar(2026, { fetchImpl, storage });
    expect(result.source).toBe('bundled');
    expect(result.warning).toBe(false);
  });

  it('falls back to weekends with a warning for unknown years', async () => {
    const storage = fakeStorage();
    const fetchImpl = async () => {
      throw new Error('offline');
    };
    const result = await loadProductionCalendar(2035, { fetchImpl, storage });
    expect(result.source).toBe('weekend');
    expect(result.warning).toBe(true);
    expect(result.days).toHaveLength(daysInYear(2035));
  });
});
