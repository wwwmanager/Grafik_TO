// Physical schedule module for GRAFIK-34
// Schedules physical persons as efficient day routes over nearby settlements

import { REGIONS_TABLE } from './regions-table.js';
import { loadSettlements, detectRegion } from './address.js';
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
      // index is array of { dataId, regionCode, name, iso, count } - regions that HAVE settlement files
      const hasDataSet = new Set(index.map(r => r.dataId));
      const countMap = new Map(index.map(r => [r.dataId, Number(r.count) || 0]));
      const available = REGIONS_TABLE.map(r => ({
        dataId: r.dataId,
        regionCode: r.regionCode,
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
        regionCode: r.regionCode,
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

// Detect region from export records - returns dataId for internal use
export function detectRegionFromExport(records) {
  const regionCode = detectRegion(records, REGIONS_TABLE);
  if (!regionCode) return null;
  const region = REGIONS_TABLE.find(r => r.regionCode === regionCode);
  return region ? region.dataId : null;
}

// Build physical stops from eligible records
export async function buildPhysicalStops(records, settings, regionsData) {
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
  
  // Load settlements for relevant regions (use dataId for internal)
  const regionDataIds = [...new Set(regionsData.map(r => r.dataId))];
  await loadSettlements(regionDataIds);
  
  // Group by settlement and month
  const stopMap = new Map(); // key: settlementKey|month -> { settlement, month, records, units, overdue }
  
  for (const record of eligibleRecords) {
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
function buildDayRoutesForMonth(stops, baseSettlement, settings, calendar, targetYear, month) {
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
  
  // Build routes for resolved stops using greedy nearest-neighbor
  const used = new Set();
  
  for (const stop of resolved) {
    if (used.has(stop.key)) continue;
    
    // Find seed: farthest from base
    let seed = null;
    let maxDist = -1;
    for (const s of resolved) {
      if (used.has(s.key)) continue;
      const dist = haversineKm(baseSettlement.lat, baseSettlement.lon, s.lat, s.lon);
      if (dist > maxDist && dist <= maxRadiusKm) {
        maxDist = dist;
        seed = s;
      }
    }
    if (!seed) continue;
    
    // Build route from seed
    const routeStops = [seed];
    used.add(seed.key);
    let current = seed;
    
    while (true) {
      // Find nearest unused stop within radius
      let nearest = null;
      let minDist = Infinity;
      for (const s of resolved) {
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
export async function buildPhysicalSchedule(records, settings, calendar, targetYear) {
  const physicalSettings = { ...defaultPhysicalSettings(), ...settings };
  
  if (!physicalSettings.includePhysical) {
    return { outboundVisits: [], onsiteVisits: [], notes: [] };
  }
  
  // Get available regions
  const regions = await getAvailableRegions();
  // const _regionsWithData = regions.filter(r => r.hasData).map(r => r.dataId); // unused
  
  // Detect region from export if no base settlement
  let baseSettlement = physicalSettings.baseSettlement;
  if (!baseSettlement) {
    const detectedDataId = detectRegionFromExport(records);
    if (detectedDataId) {
      const region = regions.find(r => r.dataId === detectedDataId);
      if (region && region.hasData) {
        // Load first settlement as base
        const settlements = await loadSettlements([detectedDataId]);
        if (settlements.length > 0) {
          baseSettlement = settlements[0];
        }
      }
    }
  }
  
  // Build stops
  const { stops } = await buildPhysicalStops(records, physicalSettings, regions);
  
  // For each month, build routes and place on calendar
  const allOutbound = [];
  const allOnsite = [];
  
  for (let month = 0; month < 12; month++) {
    const routes = buildDayRoutesForMonth(stops, baseSettlement, physicalSettings, calendar, targetYear, month);
    const { outboundVisits, onsiteVisits } = placeRoutesOnCalendar(routes, physicalSettings, calendar, targetYear, month);
    allOutbound.push(...outboundVisits);
    allOnsite.push(...onsiteVisits);
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