// Physical schedule module for GRAFIK-34
// Schedules physical persons as efficient day routes over nearby settlements

import { REGIONS_TABLE } from './regions-table.js';
import {
  loadSettlements,
  detectRegion,
  pickBaseSettlement,
  resolveAddressesForBase,
} from './address.js';
import { isWorkingDay } from './calendarService.js';

// Haversine distance in km
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Travel minutes between points
export function travelMinutes(lat1, lon1, lat2, lon2, avgSpeedKmh) {
  const km = haversineKm(lat1, lon1, lat2, lon2);
  const minutes = Math.ceil((km * 1.3 / avgSpeedKmh) * 60 / 5) * 5; // rounded up to 5 min
  return Math.max(5, minutes);
}

// GRAFIK-47: hard ceiling for route building. Never let the UI spin forever.
export const PHYSICAL_BUILD_DEADLINE_MS = 15000;

export class PhysicalBuildTimeoutError extends Error {
  constructor(deadlineMs = PHYSICAL_BUILD_DEADLINE_MS) {
    super(
      `Построение маршрутов физлиц превысило ${Math.round(deadlineMs / 1000)} с. ` +
        'Уменьшите радиус маршрута или число адресов и нажмите «Повторить».',
    );
    this.name = 'PhysicalBuildTimeoutError';
    this.code = 'PHYSICAL_BUILD_TIMEOUT';
  }
}

export function createBuildRuntime({
  deadlineMs = PHYSICAL_BUILD_DEADLINE_MS,
  now = () => Date.now(),
  onProgress = null,
  yieldToUi = true,
} = {}) {
  const startedAt = now();
  let lastProgressAt = -Infinity;
  let lastYieldAt = startedAt;
  return {
    deadlineMs,
    elapsed() {
      return now() - startedAt;
    },
    check(phase, processed, total) {
      const current = now();
      if (current - startedAt > deadlineMs) {
        throw new PhysicalBuildTimeoutError(deadlineMs);
      }
      // Throttle progress so a 1267-settlement export does not spam the DOM.
      if (onProgress && (current - lastProgressAt >= 200 || processed >= total)) {
        lastProgressAt = current;
        onProgress({ phase, processed, total, elapsedMs: current - startedAt });
      }
      return current;
    },
    async maybeYield(current = now()) {
      if (!yieldToUi || current - lastYieldAt < 50) return;
      lastYieldAt = current;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

async function withDeadline(promise, deadlineMs, runtime) {
  const remaining = Math.max(0, deadlineMs - runtime.elapsed());
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new PhysicalBuildTimeoutError(deadlineMs)), remaining);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// GRAFIK-47: only the regions the export actually needs are loaded. Loading all
// 89 region files (~14.7 MB) on every analyze was the browser-side freeze.
export function selectRegionDataIds(settings = {}, records = [], regionsData = []) {
  const ids = new Set();
  const add = (value) => {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  };
  add(settings.inspectionRegion);
  for (const id of settings.neighboringRegions || []) add(id);
  if (ids.size === 0) {
    const detected = detectRegionFromExport(records);
    if (detected) add(detected);
  }
  const known = new Set((regionsData || []).map((region) => Number(region?.dataId)));
  return [...ids].filter((id) => known.size === 0 || known.has(id));
}

// Uniform lat/lon grid used to replace full scans in radius queries. The box
// returned for a query is always a superset of the radius circle; every
// candidate is still filtered by exact haversine, so results are unchanged.
function createRadiusGrid(stops, referenceLat, cellKm = 10) {
  const latStep = cellKm / 111.32;
  const lonStep = cellKm / (111.32 * Math.max(Math.cos((referenceLat * Math.PI) / 180), 0.05));
  const cells = new Map();
  stops.forEach((stop, index) => {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
    const cell = `${Math.floor(stop.lat / latStep)}:${Math.floor(stop.lon / lonStep)}`;
    const bucket = cells.get(cell);
    if (bucket) bucket.push({ stop, index });
    else cells.set(cell, [{ stop, index }]);
  });
  return { cells, latStep, lonStep };
}

function queryRadiusGrid(grid, lat, lon, radiusKm) {
  const latMargin = (radiusKm / 111.32) * 1.1 + grid.latStep;
  const cosMin = Math.min(
    Math.cos(((lat - 3) * Math.PI) / 180),
    Math.cos(((lat + 3) * Math.PI) / 180),
    0.05,
  );
  const lonMargin = (radiusKm / (111.32 * cosMin)) * 1.15 + grid.lonStep;
  const latFrom = Math.floor((lat - latMargin) / grid.latStep);
  const latTo = Math.floor((lat + latMargin) / grid.latStep);
  const lonFrom = Math.floor((lon - lonMargin) / grid.lonStep);
  const lonTo = Math.floor((lon + lonMargin) / grid.lonStep);
  const found = [];
  for (let latCell = latFrom; latCell <= latTo; latCell++) {
    for (let lonCell = lonFrom; lonCell <= lonTo; lonCell++) {
      const bucket = grid.cells.get(`${latCell}:${lonCell}`);
      if (bucket) found.push(...bucket);
    }
  }
  // Same candidate order as the original full scan => identical tie-breaking.
  found.sort((a, b) => a.index - b.index);
  return found;
}

// Default settings for physical scheduling
export function defaultPhysicalSettings() {
  return {
    includePhysical: false,
    physicalScope: 'threshold', // 'threshold' | 'all'
    minUnitsForVisit: 5,
    baseSettlement: null, // { code, name, lat, lon, municipality }
    maxRadiusKm: 40,
    avgSpeedKmh: 50,
    onsiteDays: [], // weekday numbers 0-6
    onsiteAsAcceptingDays: true,
    onsiteLocation: 'inspection', // 'inspection' | 'own'
    onsiteAddress: '',
  };
}

// Persist physical settings
const PHYSICAL_STORAGE_KEY = 'grafik-to-physical-v1';

export function persistPhysicalSettings(settings) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(PHYSICAL_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

export function loadPersistedPhysicalSettings() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return {};
    const raw = storage.getItem(PHYSICAL_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

// Cache for regions index (fetched once from regions.json)
let _regionsIndexCache = null;
let _regionsIndexPromise = null;

// Get available regions for UI - fetches regions.json ONCE, cached, called lazily only when needed
export async function getAvailableRegions() {
  if (_regionsIndexCache) return _regionsIndexCache;
  if (_regionsIndexPromise) return _regionsIndexPromise;

  _regionsIndexPromise = (async () => {
    try {
      const url = `${import.meta.env.BASE_URL}data/regions.json`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const index = await resp.json();
      // index is array of { dataId, regionCode (legacy = fnsCode), fnsCode, gibddCode, name, iso, count }
      // Only dataId/count are read here; codes come from REGIONS_TABLE.
      const hasDataSet = new Set(index.map(r => r.dataId));
      const countMap = new Map(index.map(r => [r.dataId, Number(r.count) || 0]));
      const available = REGIONS_TABLE.map(r => ({
        dataId: r.dataId,
        fnsCode: r.fnsCode,
        gibddCode: r.gibddCode,
        name: r.name,
        iso: r.iso,
        hasData: hasDataSet.has(r.dataId),
        count: countMap.get(r.dataId) ?? 0,
      }));
      _regionsIndexCache = available;
      return available;
    } catch (e) {
      console.warn('Failed to load regions index:', e);
      // Fallback: all regions marked as no data
      const available = REGIONS_TABLE.map(r => ({
        dataId: r.dataId,
        fnsCode: r.fnsCode,
        gibddCode: r.gibddCode,
        name: r.name,
        iso: r.iso,
        hasData: false,
        count: 0,
      }));
      _regionsIndexCache = available;
      return available;
    }
  })();

  return _regionsIndexPromise;
}

// Clear cache (for testing or when export changes)
export function clearRegionsIndexCache() {
  _regionsIndexCache = null;
  _regionsIndexPromise = null;
}

// Detect region from export records — returns dataId for internal use
export function detectRegionFromExport(records) {
  const dataId = detectRegion(records, REGIONS_TABLE);
  if (!dataId) return null;
  return REGIONS_TABLE.some(r => r.dataId === dataId) ? dataId : null;
}

// Build physical stops from eligible records
export async function buildPhysicalStops(
  records,
  settings,
  regionsData,
  runtime = createBuildRuntime(),
) {
  const { includePhysical, physicalScope, minUnitsForVisit } = settings;
  
  if (!includePhysical) return { stops: [], routes: [], onsiteVisits: [] };
  
  // Filter physical owner records
  const physicalRecords = records.filter(r => {
    const ownerGroup = String(r.ownerGroup || '').toLowerCase();
    return ownerGroup.includes('физ') || /(^|[^а-яa-z])фл([^а-яa-z]|$)/.test(ownerGroup);
  });
  
  if (!physicalRecords.length) return { stops: [], routes: [], onsiteVisits: [] };
  
  // Apply scope filter
  let eligibleRecords = physicalRecords;
  if (physicalScope === 'threshold') {
    // Group by owner and count units
    const ownerUnits = new Map();
    for (const record of physicalRecords) {
      const key = String(record.inn || record.owner).trim();
      if (!ownerUnits.has(key)) ownerUnits.set(key, []);
      ownerUnits.get(key).push(record);
    }
    eligibleRecords = [];
    for (const [, units] of ownerUnits) {
      if (units.length <= (minUnitsForVisit || 5)) {
        eligibleRecords.push(...units);
      }
    }
  }
  
  if (!eligibleRecords.length) return { stops: [], routes: [], onsiteVisits: [] };
  
  // GRAFIK-47: load only the regions this export needs (never all 89), and
  // race the load against the overall deadline so a slow fetch cannot hang.
  const regionDataIds = selectRegionDataIds(settings, records, regionsData);
  if (regionDataIds.length > 0) {
    await withDeadline(loadSettlements(regionDataIds), runtime.deadlineMs, runtime);
  }

  // Group by settlement and month
  const stopMap = new Map(); // key: settlementKey|month -> { settlement, month, records, units, overdue }
  const totalRecords = eligibleRecords.length;

  for (let recordIndex = 0; recordIndex < eligibleRecords.length; recordIndex++) {
    const record = eligibleRecords[recordIndex];
    const current = runtime.check('settlements', recordIndex + 1, totalRecords);
    await runtime.maybeYield(current);
    // For now, use the existing extractLocation logic from scheduler
    // In real implementation, we'd use resolveSettlement
    const locationKey = record.address || 'unknown';
    
    // Determine month for this record (simplified - use target date logic)
    const month = 0; // placeholder - would use actual target date month
    
    const key = `${locationKey}|${month}`;
    if (!stopMap.has(key)) {
      stopMap.set(key, { settlement: locationKey, month, records: [], units: 0, overdue: false });
    }
    const stop = stopMap.get(key);
    stop.records.push(record);
    stop.units += 1;
    if (record.flags?.bezTo) stop.overdue = true;
  }
  
  // Resolve settlements to coordinates
  const stops = [];
  for (const stop of stopMap.values()) {
    // Try to resolve to actual settlement
    // For now, create basic stop structure
    stops.push({
      key: stop.settlement,
      name: stop.settlement,
      month: stop.month,
      units: stop.units,
      records: stop.records,
      overdue: stop.overdue,
      resolved: false,
      lat: null,
      lon: null,
      municipality: '',
    });
  }
  
  return { stops, routes: [], onsiteVisits: [] };
}

// Build day routes for a month
function buildDayRoutesForMonth(
  stops,
  baseSettlement,
  settings,
  calendar,
  targetYear,
  month,
  runtime = createBuildRuntime(),
) {
  const { maxRadiusKm, avgSpeedKmh, minUnitsForVisit, workStart, workEnd, lunch, perHour } = settings;
  
  if (!baseSettlement || !baseSettlement.lat || !baseSettlement.lon) {
    // No base settlement - each stop gets its own route
    return stops.map(stop => ({
      stops: [stop],
      totalUnits: stop.units,
      travelMinutes: 60,
      isOutbound: stop.units >= minUnitsForVisit,
    }));
  }
  
  // Filter stops for this month
  const monthStops = stops.filter(s => s.month === month);
  
  // Separate resolved and unresolved
  const resolved = monthStops.filter(s => s.resolved && s.lat && s.lon);
  const unresolved = monthStops.filter(s => !s.resolved || !s.lat || !s.lon);
  
  const routes = [];
  
  // Build routes for resolved stops using greedy nearest-neighbor.
  // GRAFIK-47: base distances are computed once, and neighbour lookups use a
  // bucketed grid instead of a full scan. Both are supersets filtered by the
  // same haversine comparison, so the chosen routes are identical.
  const used = new Set();
  const baseDistances = resolved.map((s) =>
    haversineKm(baseSettlement.lat, baseSettlement.lon, s.lat, s.lon),
  );
  const grid = createRadiusGrid(resolved, baseSettlement.lat);

  for (let seedIndex = 0; seedIndex < resolved.length; seedIndex++) {
    const stop = resolved[seedIndex];
    if (used.has(stop.key)) continue;
    runtime.check('routes', seedIndex + 1, resolved.length);

    // Find seed: farthest from base (ties keep the earliest stop, as before)
    let seed = null;
    let maxDist = -1;
    for (let index = 0; index < resolved.length; index++) {
      if (used.has(resolved[index].key)) continue;
      const dist = baseDistances[index];
      if (dist > maxDist && dist <= maxRadiusKm) {
        maxDist = dist;
        seed = resolved[index];
      }
    }
    if (!seed) continue;
    
    // Build route from seed
    const routeStops = [seed];
    used.add(seed.key);
    let current = seed;
    
    while (true) {
      // Find nearest unused stop within radius
      runtime.check('routes', seedIndex + 1, resolved.length);
      let nearest = null;
      let minDist = Infinity;
      for (const candidate of queryRadiusGrid(grid, current.lat, current.lon, maxRadiusKm)) {
        const s = candidate.stop;
        if (used.has(s.key)) continue;
        const dist = haversineKm(current.lat, current.lon, s.lat, s.lon);
        if (dist < minDist && dist <= maxRadiusKm) {
          minDist = dist;
          nearest = s;
        }
      }
      if (!nearest) break;
      
      // Check if adding this stop fits in a day
      const testStops = [...routeStops, nearest];
      const travel = calculateRouteTravel(testStops, baseSettlement, avgSpeedKmh);
      const inspection = calculateInspectionTime(testStops, perHour);
      const totalMinutes = travel + inspection;
      
      const workStartMin = parseTime(workStart);
      const workEndMin = parseTime(workEnd);
      const lunchOn = lunch.enabled !== false;
      const lunchStart = parseTime(lunch.start);
      const lunchEnd = parseTime(lunch.end);
      const available = workEndMin - workStartMin - (lunchOn ? lunchEnd - lunchStart : 0);
      
      if (totalMinutes <= available) {
        routeStops.push(nearest);
        used.add(nearest.key);
        current = nearest;
      } else {
        break;
      }
    }
    
    const totalUnits = routeStops.reduce((sum, s) => sum + s.units, 0);
    const travel = calculateRouteTravel(routeStops, baseSettlement, avgSpeedKmh);
    
    routes.push({
      stops: routeStops,
      totalUnits,
      travelMinutes: travel,
      isOutbound: totalUnits >= minUnitsForVisit,
    });
  }
  
  // Unresolved stops get individual routes
  for (const stop of unresolved) {
    routes.push({
      stops: [stop],
      totalUnits: stop.units,
      travelMinutes: 60,
      isOutbound: stop.units >= minUnitsForVisit,
    });
  }
  
  return routes;
}

// Test seam for the greedy route builder (GRAFIK-47 equivalence tests).
export function buildDayRoutes(
  stops,
  baseSettlement,
  settings,
  calendar,
  targetYear,
  month = 0,
  options = {},
) {
  return buildDayRoutesForMonth(
    stops,
    baseSettlement,
    { ...defaultPhysicalSettings(), ...settings },
    calendar,
    targetYear,
    month,
    options.runtime || createBuildRuntime(options),
  );
}

function calculateRouteTravel(stops, base, avgSpeedKmh) {
  if (!stops.length) return 0;
  if (!base || !base.lat || !base.lon) return stops.length * 60;
  
  let total = 0;
  let current = base;
  
  for (const stop of stops) {
    if (stop.lat && stop.lon) {
      total += travelMinutes(current.lat, current.lon, stop.lat, stop.lon, avgSpeedKmh);
      current = stop;
    } else {
      total += 60; // fixed for unresolved
    }
  }
  
  // Return to base
  if (current.lat && current.lon && base.lat && base.lon) {
    total += travelMinutes(current.lat, current.lon, base.lat, base.lon, avgSpeedKmh);
  }
  
  return total;
}

function calculateInspectionTime(stops, perHour) {
  const totalUnits = stops.reduce((sum, s) => sum + s.units, 0);
  const speed = perHour > 0 ? perHour : 12;
  const minutes = Math.ceil((totalUnits / speed) * 60);
  return Math.max(30, Math.ceil(minutes / 30) * 30);
}

function parseTime(str) {
  const match = String(str || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Place routes on calendar days
function placeRoutesOnCalendar(routes, settings, calendar, targetYear, month) {
  const { onsiteDays, onsiteAsAcceptingDays, onsiteLocation, onsiteAddress, workStart, workEnd, lunch, perHour } = settings;
  
  const workStartMin = parseTime(workStart || '09:00');
  const workEndMin = parseTime(workEnd || '18:00');
  const lunchObj = lunch || { enabled: true, start: '12:00', end: '13:00' };
  const lunchOn = lunchObj.enabled !== false;
  const lunchStart = parseTime(lunchObj.start || '12:00');
  const lunchEnd = parseTime(lunchObj.end || '13:00');
  const availablePerDay = workEndMin - workStartMin - (lunchOn ? lunchEnd - lunchStart : 0);
  
  const daysInMonth = new Date(targetYear, month + 1, 0).getDate();
  const dayStates = new Map(); // dateKey -> { usedMinutes, visits }
  
  const outboundVisits = [];
  const onsiteVisits = [];
  const onsiteWeekdays = onsiteDays.length > 0 ? onsiteDays : [1, 2, 3, 4, 5]; // default Mon-Fri
  
  for (const route of routes) {
    const { stops, totalUnits, travelMinutes: routeTravelMinutes, isOutbound } = route;
    const inspectionMin = calculateInspectionTime(stops, perHour);
    const totalDuration = routeTravelMinutes + inspectionMin;
    
    if (isOutbound) {
      // Find a workday that is NOT an accepting/onsite day
      let placed = false;
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(targetYear, month, day);
        const weekday = date.getDay();
        const isAcceptingDay = onsiteAsAcceptingDays && onsiteWeekdays.includes(weekday);
        const isWorking = isWorkingDay(date, {}, calendar);
        
        if (!isWorking || isAcceptingDay) continue;
        
        const key = `${targetYear}-${month + 1}-${day}`;
        const used = dayStates.get(key)?.usedMinutes || 0;
        
        if (used + totalDuration <= availablePerDay) {
          const startMin = workStartMin + used;
          outboundVisits.push({
            date,
            startMin,
            endMin: startMin + totalDuration,
            stops,
            totalUnits,
            travelMinutes: routeTravelMinutes,
            inspectionMin,
            isOutbound: true,
            routeName: buildRouteName(stops),
          });
          dayStates.set(key, { usedMinutes: used + totalDuration, visits: (dayStates.get(key)?.visits || 0) + 1 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Fallback: place on any workday
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(targetYear, month, day);
          if (!isWorkingDay(date, {}, calendar)) continue;
          
          const key = `${targetYear}-${month + 1}-${day}`;
          const used = dayStates.get(key)?.usedMinutes || 0;
          
          if (used + totalDuration <= availablePerDay) {
            const startMin = workStartMin + used;
            outboundVisits.push({
              date,
              startMin,
              endMin: startMin + totalDuration,
              stops,
              totalUnits,
              travelMinutes: routeTravelMinutes,
              inspectionMin,
              isOutbound: true,
              routeName: buildRouteName(stops),
            });
            dayStates.set(key, { usedMinutes: used + totalDuration, visits: (dayStates.get(key)?.visits || 0) + 1 });
            // eslint-disable-next-line no-useless-assignment
            placed = true;
            break;
          }
        }
      }
    } else {
      // Onsite visits - place on onsite days
      // Split by capacity if needed
      const maxUnitsPerDay = Math.floor(availablePerDay / (inspectionMin / totalUnits)) || totalUnits;
      let remainingUnits = totalUnits;
      let remainingStops = [...stops];
      
      while (remainingUnits > 0 && remainingStops.length > 0) {
        const dayUnits = Math.min(remainingUnits, maxUnitsPerDay);
        const dayStops = remainingStops.splice(0, Math.ceil(remainingStops.length * dayUnits / remainingUnits));
        const dayTravel = dayStops.length > 0 ? routeTravelMinutes : 0;
        const dayInspection = calculateInspectionTime(dayStops, perHour);
        const dayDuration = dayTravel + dayInspection;
        
        let placed = false;
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(targetYear, month, day);
          const weekday = date.getDay();
          
          if (!onsiteWeekdays.includes(weekday)) continue;
          if (!isWorkingDay(date, {}, calendar)) continue;
          
          const key = `${targetYear}-${month + 1}-${day}`;
          const used = dayStates.get(key)?.usedMinutes || 0;
          
          if (used + dayDuration <= availablePerDay) {
            const startMin = workStartMin + used;
            onsiteVisits.push({
              date,
              startMin,
              endMin: startMin + dayDuration,
              stops: dayStops,
              totalUnits: dayUnits,
              travelMinutes: dayTravel,
              inspectionMin: dayInspection,
              isOutbound: false,
              location: onsiteLocation === 'inspection' ? 'inspection' : 'own',
              address: onsiteLocation === 'inspection' ? '' : onsiteAddress,
            });
            dayStates.set(key, { usedMinutes: used + dayDuration, visits: (dayStates.get(key)?.visits || 0) + 1 });
            placed = true;
            break;
          }
        }
        if (!placed) {
          // Fallback to any workday
          for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(targetYear, month, day);
            if (!isWorkingDay(date, {}, calendar)) continue;
            
            const key = `${targetYear}-${month + 1}-${day}`;
            const used = dayStates.get(key)?.usedMinutes || 0;
            
            if (used + dayDuration <= availablePerDay) {
              const startMin = workStartMin + used;
              onsiteVisits.push({
                date,
                startMin,
                endMin: startMin + dayDuration,
                stops: dayStops,
                totalUnits: dayUnits,
                travelMinutes: dayTravel,
                inspectionMin: dayInspection,
                isOutbound: false,
                location: onsiteLocation === 'inspection' ? 'inspection' : 'own',
                address: onsiteLocation === 'inspection' ? '' : onsiteAddress,
              });
              dayStates.set(key, { usedMinutes: used + dayDuration, visits: (dayStates.get(key)?.visits || 0) + 1 });
              // eslint-disable-next-line no-useless-assignment
              placed = true;
              break;
            }
          }
        }
        remainingUnits -= dayUnits;
      }
    }
  }
  
  return { outboundVisits, onsiteVisits };
}

function buildRouteName(stops) {
  if (!stops.length) return '';
  if (stops.length === 1) return stops[0].name;
  return `${stops[0].name} → ${stops[stops.length - 1].name} (${stops[0].municipality || ''})`;
}

// Main entry point
export async function buildPhysicalSchedule(
  records,
  settings,
  calendar,
  targetYear,
  options = {},
) {
  const physicalSettings = { ...defaultPhysicalSettings(), ...settings };
  const runtime = options.runtime || createBuildRuntime(options);

  if (!physicalSettings.includePhysical) {
    return { outboundVisits: [], onsiteVisits: [], notes: [] };
  }
  
  // Get available regions
  const regions = await withDeadline(
    getAvailableRegions(),
    runtime.deadlineMs,
    runtime,
  );
  // const _regionsWithData = regions.filter(r => r.hasData).map(r => r.dataId); // unused
  
  // GRAFIK-44: derive the base settlement from the export (mode of resolved
  // addresses); a manual value from settings still wins. Falls back to the
  // previous "first settlement of the region" rule when nothing resolves.
  let baseSettlement = physicalSettings.baseSettlement;
  if (typeof baseSettlement === 'string') {
    try {
      baseSettlement = JSON.parse(baseSettlement);
    } catch {
      baseSettlement = null;
    }
  }
  if (!baseSettlement || !Number.isFinite(baseSettlement.lat) || !Number.isFinite(baseSettlement.lon)) {
    const detectedDataId = selectRegionDataIds(physicalSettings, records, regions)[0] ||
      detectRegionFromExport(records);
    if (detectedDataId) {
      const region = regions.find(r => r.dataId === detectedDataId);
      if (region && region.hasData) {
        const settlements = await withDeadline(
          loadSettlements([detectedDataId]),
          runtime.deadlineMs,
          runtime,
        );
        if (settlements.length > 0) {
          const { resolved, total } = resolveAddressesForBase(records, settlements, detectedDataId);
          const picked = pickBaseSettlement(resolved, detectedDataId, {
            regionSettlements: settlements,
            total,
          });
          baseSettlement = picked.settlement || settlements[0];
        }
      }
    }
  }
  
  // Build stops
  const { stops } = await buildPhysicalStops(records, physicalSettings, regions, runtime);
  
  // For each month, build routes and place on calendar
  const allOutbound = [];
  const allOnsite = [];
  
  for (let month = 0; month < 12; month++) {
    const current = runtime.check('months', month + 1, 12);
    const routes = buildDayRoutesForMonth(
      stops,
      baseSettlement,
      physicalSettings,
      calendar,
      targetYear,
      month,
      runtime,
    );
    const { outboundVisits, onsiteVisits } = placeRoutesOnCalendar(routes, physicalSettings, calendar, targetYear, month);
    allOutbound.push(...outboundVisits);
    allOnsite.push(...onsiteVisits);
    await runtime.maybeYield(current);
  }
  
  // Generate notes
  const notes = [];
  if (allOnsite.length > 0) {
    const location = physicalSettings.onsiteLocation === 'inspection' ? 'инспекции' : `своей площадке (${physicalSettings.onsiteAddress})`;
    const days = physicalSettings.onsiteDays.map(d => ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d]).join(', ');
    notes.push(`ТО физлиц на ${location} в приёмные дни (${days}).`);
  }
  
  return { outboundVisits: allOutbound, onsiteVisits: allOnsite, notes };
}

export function formatPhysicalScheduleRows(outboundVisits, onsiteVisits) {
  const rows = [];
  
  for (const visit of outboundVisits) {
    const owners = [...new Set(visit.stops.flatMap(s => s.records.map(r => r.owner)))];
    const units = visit.totalUnits;
    const people = owners.length;
    rows.push(`ТО физлиц: ${visit.routeName} — ${people} чел., ${units} ед., маршрут ${Math.round(visit.travelMinutes / 60 * 50)} км`);
  }
  
  for (const visit of onsiteVisits) {
    const owners = [...new Set(visit.stops.flatMap(s => s.records.map(r => r.owner)))];
    const units = visit.totalUnits;
    const people = owners.length;
    const location = visit.location === 'inspection' ? 'инспекции' : visit.address;
    rows.push(`ТО физлиц на площадке: ${location} — ${people} чел., ${units} ед.`);
  }
  
  return rows;
}

export function formatPhysicalDetailRows(outboundVisits, onsiteVisits) {
  const rows = [];
  let index = 1;
  
  for (const visit of outboundVisits) {
    for (const stop of visit.stops) {
      for (const record of stop.records) {
        rows.push([
          index++,
          record.owner,
          record.inn || '',
          stop.name,
          stop.municipality || '',
          record.plate || '',
          record.brand || '',
          visit.travelMinutes,
        ]);
      }
    }
  }
  
  for (const visit of onsiteVisits) {
    for (const stop of visit.stops) {
      for (const record of stop.records) {
        rows.push([
          index++,
          record.owner,
          record.inn || '',
          visit.address || 'инспекция',
          '',
          record.plate || '',
          record.brand || '',
          visit.travelMinutes,
        ]);
      }
    }
  }
  
  return rows;
}