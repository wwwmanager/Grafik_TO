import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  loadSettlements,
  parseAddress,
  resolveSettlement,
} from '../src/modules/address.js';
import {
  buildDayRoutes,
  buildPhysicalSchedule,
  buildPhysicalStops,
  clearRegionsIndexCache,
  defaultPhysicalSettings,
  haversineKm,
  selectRegionDataIds,
  travelMinutes,
} from '../src/modules/physical.js';

const DATA_PATH = fileURLToPath(new URL('../public/data/settlements/74.json', import.meta.url));
const CALENDAR = { days: new Array(365).fill(0), source: 'test', warning: false };

export function readChelyabinskSettlements() {
  return JSON.parse(readFileSync(DATA_PATH, 'utf8'));
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

// Deterministic synthetic export: settlement names are public geo data, no
// owner names / INNs / plates from a real export are used anywhere.
export function createSyntheticAddresses(settlements, count = 150) {
  const usable = settlements.filter((s) => s.lat && s.lon);
  let seed = 20261126;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const picked = [];
  const seen = new Set();
  while (picked.length < count) {
    const settlement = usable[Math.floor(next() * usable.length)];
    const dedupeKey = `${settlement.name}|${settlement.municipality}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    picked.push(settlement);
  }
  return picked.map((settlement, index) => ({
    settlement,
    address: `ЧЕЛЯБИНСКАЯ ОБЛ, , , ${settlement.municipality.toUpperCase()} Р-Н, ${settlement.name.toUpperCase()} Г, , , ТАЙНАК П`,
    record: {
      owner: `Физлицо ${index + 1}`,
      ownerGroup: 'Физические лица',
      inn: String(100000000000 + index),
      address: `ЧЕЛЯБИНСКАЯ ОБЛ, , , ${settlement.municipality.toUpperCase()} Р-Н, ${settlement.name.toUpperCase()} Г, , , ТАЙНАК П`,
      category: 'B',
      lastTo: new Date(2025, 5, 1),
      nextTo: new Date(2026, 5, 1),
      flags: {},
    },
  }));
}

describe('74.json integrity (GRAFIK-47)', () => {
  it('contains the real Челябинская reference: 1267 unique settlements, expected shape', () => {
    expect(existsSync(DATA_PATH)).toBe(true);
    const settlements = readChelyabinskSettlements();
    expect(settlements).toHaveLength(1267);

    const keys = new Set();
    const nameMuni = new Map();
    for (const settlement of settlements) {
      expect(typeof settlement.name).toBe('string');
      expect(settlement.name.length).toBeGreaterThan(0);
      expect(typeof settlement.municipality).toBe('string');
      expect(['city', 'town', 'village', 'hamlet']).toContain(settlement.type);
      expect(Number.isFinite(settlement.lat)).toBe(true);
      expect(Number.isFinite(settlement.lon)).toBe(true);
      keys.add(`${settlement.name}|${settlement.municipality}|${settlement.type}|${settlement.lat}|${settlement.lon}`);
      const pair = `${settlement.name}|${settlement.municipality}`;
      if (!nameMuni.has(pair)) nameMuni.set(pair, []);
      nameMuni.get(pair).push(settlement);
    }
    // Full identity is unique. 17 name+municipality pairs repeat (village vs
    // hamlet / different coordinates) — that is real OSM data, not corruption.
    expect(keys.size).toBe(settlements.length);
    const repeatedPairs = [...nameMuni.values()].filter((list) => list.length > 1);
    expect(repeatedPairs.length).toBe(17);
    for (const list of repeatedPairs) {
      const coordinates = new Set(list.map((s) => `${s.lat}|${s.lon}`));
      expect(coordinates.size).toBe(list.length);
    }
  });
});

describe('resolver end-to-end on a synthetic Челябинская address (GRAFIK-47)', () => {
  it('resolves КУСИНСКИЙ Р-Н / ЗЛАТОУСТ Г / ТАЙНАК П to Тайнак (Златоуст)', () => {
    const settlements = readChelyabinskSettlements();
    const parsed = parseAddress(
      'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П',
    );
    const resolved = resolveSettlement(parsed, settlements);
    expect(resolved.match).toBe('exact');
    expect(resolved.name).toBe('Тайнак');
    expect(resolved.municipality).toBe('Златоуст');
    expect(Number.isFinite(resolved.lat)).toBe(true);
    expect(Number.isFinite(resolved.lon)).toBe(true);
  });
});

describe('route build performance on the real 1267-settlement reference (GRAFIK-47)', () => {
  const originalFetch = globalThis.fetch;
  const settlements = readChelyabinskSettlements();
  const items = createSyntheticAddresses(settlements, 150);

  beforeAll(() => {
    clearRegionsIndexCache();
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.includes('data/settlements/74.json')) return jsonResponse(settlements);
      if (target.includes('data/regions.json')) {
        return jsonResponse([
          { dataId: 74, fnsCode: 74, gibddCode: 74, name: 'Челябинская область', iso: 'RU-CHE', count: 1267 },
        ]);
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolve -> group -> buildPhysicalStops -> buildPhysicalSchedule stays under 1500 ms', async () => {
    await loadSettlements([74]);

    const timings = {};

    let started = performance.now();
    const resolved = items.map((item) => resolveSettlement(parseAddress(item.address), settlements));
    timings.resolveMs = performance.now() - started;

    started = performance.now();
    const groups = new Map();
    items.forEach((item, index) => {
      const match = resolved[index];
      const key = `${match.key}|0`;
      if (!groups.has(key)) groups.set(key, { key, units: 0, records: [] });
      const group = groups.get(key);
      group.units += 1;
      group.records.push(item.record);
    });
    timings.groupMs = performance.now() - started;

    const records = items.map((item) => item.record);
    const settings = {
      ...defaultPhysicalSettings(),
      includePhysical: true,
      physicalScope: 'all',
      minUnitsForVisit: 5,
      workStart: '09:00',
      workEnd: '18:00',
      perHour: 12,
      onsiteDays: [1, 2, 3],
      baseSettlement: settlements.find((s) => s.name === 'Златоуст'),
    };

    started = performance.now();
    const stopsResult = await buildPhysicalStops(records, settings, [{ dataId: 74 }]);
    timings.stopsMs = performance.now() - started;
    expect(stopsResult.stops.length).toBeGreaterThan(0);

    started = performance.now();
    const schedule = await buildPhysicalSchedule(records, settings, CALENDAR, 2026);
    timings.scheduleMs = performance.now() - started;
    expect(Array.isArray(schedule.outboundVisits)).toBe(true);
    expect(Array.isArray(schedule.onsiteVisits)).toBe(true);

    const totalMs =
      timings.resolveMs + timings.groupMs + timings.stopsMs + timings.scheduleMs;
    console.log(
      `[GRAFIK-47] 1267 settlements / 150 addresses: resolve=${timings.resolveMs.toFixed(
        1,
      )} ms, group=${timings.groupMs.toFixed(1)} ms, stops=${timings.stopsMs.toFixed(
        1,
      )} ms, schedule=${timings.scheduleMs.toFixed(1)} ms, total=${totalMs.toFixed(1)} ms`,
    );

    expect(totalMs).toBeLessThan(1500);
  });

  it('loads only the export region, never all 89 settlement files', () => {
    const regions = [
      { dataId: 74, hasData: true },
      { dataId: 1, hasData: true },
    ];
    const records = [
      { address: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П' },
    ];
    expect(selectRegionDataIds({}, records, regions)).toEqual([74]);
    expect(
      selectRegionDataIds({ inspectionRegion: 74, neighboringRegions: [74, 95] }, [], regions),
    ).toEqual([74]);
    expect(
      selectRegionDataIds({ inspectionRegion: 95, neighboringRegions: [1] }, [], regions),
    ).toEqual([1]);
    expect(
      selectRegionDataIds({ inspectionRegion: 74, neighboringRegions: [1, 74] }, [], regions),
    ).toEqual([74, 1]);
  });

  it('reports processed/total progress during a build', async () => {
    const events = [];
    const records = items.map((item) => item.record);
    const settings = basePhysicalSettings(settlements);
    await buildPhysicalSchedule(records, settings, CALENDAR, 2026, {
      yieldToUi: false,
      onProgress: (progress) => events.push(progress),
    });
    expect(events.length).toBeGreaterThan(0);
    const settlementEvent = events.find((event) => event.phase === 'settlements');
    expect(settlementEvent.total).toBe(records.length);
    expect(settlementEvent.processed).toBeLessThanOrEqual(records.length);
    expect(events.some((event) => event.phase === 'months' && event.total === 12)).toBe(true);
  });

  it('fails with an actionable timeout instead of an infinite loop', async () => {
    let clock = 0;
    const records = createSyntheticAddresses(settlements, 60).map((item) => item.record);
    const error = await buildPhysicalSchedule(
      records,
      basePhysicalSettings(settlements),
      CALENDAR,
      2026,
      {
        deadlineMs: 15000,
        now: () => (clock += 1000),
        yieldToUi: false,
      },
    ).catch((caught) => caught);
    expect(error?.code).toBe('PHYSICAL_BUILD_TIMEOUT');
    expect(error?.message).toContain('15 с');
    expect(error?.message).toContain('Повторить');
  });

  it('abandons a stalled settlement fetch through the same deadline', async () => {
    const healthyFetch = globalThis.fetch;
    try {
      clearRegionsIndexCache();
      globalThis.fetch = () => new Promise(() => {});
      const records = [items[0].record];
      const error = await buildPhysicalSchedule(
        records,
        basePhysicalSettings(settlements),
        CALENDAR,
        2026,
        { deadlineMs: 60, yieldToUi: false },
      ).catch((caught) => caught);
      expect(error?.code).toBe('PHYSICAL_BUILD_TIMEOUT');
    } finally {
      globalThis.fetch = healthyFetch;
      clearRegionsIndexCache();
    }
  });
});

function basePhysicalSettings(settlements) {
  return {
    ...defaultPhysicalSettings(),
    includePhysical: true,
    physicalScope: 'all',
    minUnitsForVisit: 5,
    workStart: '09:00',
    workEnd: '18:00',
    perHour: 12,
    onsiteDays: [1, 2, 3],
    baseSettlement: settlements.find((s) => s.name === 'Златоуст'),
  };
}

// Pre-GRAFIK-47 algorithm, kept in the test as the reference for the grid
// optimization: full scan for the seed and for the nearest neighbour.
function referenceRouteStopKeys(stops, base, settings) {
  const { maxRadiusKm, avgSpeedKmh, minUnitsForVisit, workStart, workEnd, lunch, perHour } = settings;
  const routeTravel = (list) => {
    if (!list.length) return 0;
    let total = 0;
    let current = base;
    for (const stop of list) {
      total += travelMinutes(current.lat, current.lon, stop.lat, stop.lon, avgSpeedKmh);
      current = stop;
    }
    return total + travelMinutes(current.lat, current.lon, base.lat, base.lon, avgSpeedKmh);
  };
  const inspection = (list) => {
    const units = list.reduce((sum, stop) => sum + stop.units, 0);
    const minutes = Math.ceil((units / (perHour > 0 ? perHour : 12)) * 60);
    return Math.max(30, Math.ceil(minutes / 30) * 30);
  };
  const toMinutes = (value) => {
    const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  };
  const available =
    toMinutes(workEnd) -
    toMinutes(workStart) -
    (lunch.enabled !== false ? toMinutes(lunch.end) - toMinutes(lunch.start) : 0);

  const resolved = stops.filter((s) => s.resolved && s.lat && s.lon);
  const used = new Set();
  const keys = [];
  for (const stop of resolved) {
    if (used.has(stop.key)) continue;
    let seed = null;
    let maxDist = -1;
    for (const candidate of resolved) {
      if (used.has(candidate.key)) continue;
      const dist = haversineKm(base.lat, base.lon, candidate.lat, candidate.lon);
      if (dist > maxDist && dist <= maxRadiusKm) {
        maxDist = dist;
        seed = candidate;
      }
    }
    if (!seed) continue;
    const route = [seed];
    used.add(seed.key);
    let current = seed;
    while (true) {
      let nearest = null;
      let minDist = Infinity;
      for (const candidate of resolved) {
        if (used.has(candidate.key)) continue;
        const dist = haversineKm(current.lat, current.lon, candidate.lat, candidate.lon);
        if (dist < minDist && dist <= maxRadiusKm) {
          minDist = dist;
          nearest = candidate;
        }
      }
      if (!nearest) break;
      const test = [...route, nearest];
      if (routeTravel(test) + inspection(test) <= available) {
        route.push(nearest);
        used.add(nearest.key);
        current = nearest;
      } else {
        break;
      }
    }
    keys.push(route.map((entry) => entry.key));
    if (route.reduce((sum, entry) => sum + entry.units, 0) < minUnitsForVisit) continue;
  }
  return keys;
}

describe('grid-based route builder equals the reference full scan (GRAFIK-47)', () => {
  const referenceBase = { name: 'Златоуст', lat: 55.16742, lon: 59.67926 };
  const settings = {
    maxRadiusKm: 40,
    avgSpeedKmh: 50,
    minUnitsForVisit: 5,
    workStart: '09:00',
    workEnd: '18:00',
    lunch: { enabled: true, start: '12:00', end: '13:00' },
    perHour: 12,
    onsiteDays: [1, 2, 3],
  };
  const stops = [];
  for (let index = 0; index < 60; index++) {
    stops.push({
      key: `s${index}`,
      name: `НП ${index}`,
      lat: 55.0 + (index % 10) * 0.05,
      lon: 59.3 + Math.floor(index / 10) * 0.05,
      units: 1 + (index % 3),
      resolved: true,
      month: 0,
    });
  }

  it('picks the same routes and stop order', () => {
    const expected = referenceRouteStopKeys(stops, referenceBase, settings);
    const actual = buildDayRoutes(stops, referenceBase, settings, CALENDAR, 2026, 0).map((route) =>
      route.stops.map((stop) => stop.key),
    );
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(1);
  });

  it('matches the reference on unresolved-only input (single-stop routes)', () => {
    const unresolved = stops.map((stop) => ({ ...stop, resolved: false }));
    const routes = buildDayRoutes(unresolved, referenceBase, settings, CALENDAR, 2026, 0);
    expect(routes.map((route) => route.stops.map((stop) => stop.key))).toEqual(
      unresolved.map((stop) => [stop.key]),
    );
  });
});
