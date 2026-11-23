// Builds the yearly inspection schedule from parsed records and settings.
// This module grows by slice: filtering + target dates (GRAFIK-04),
// owners/clusters (GRAFIK-05), placement (GRAFIK-06).
import { isWorkingDay } from './calendarService.js';

function defaultTargetYear() {
  return new Date().getFullYear() + 1;
}

export function isA4(record) {
  const category = String(record?.category ?? '').trim();
  return /^[аa]4$/i.test(category);
}

export function addMonths(date, months) {
  const anchor = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  anchor.setDate(Math.min(date.getDate(), lastDay));
  return anchor;
}

export function depthCutoff(settings = {}) {
  const targetYear = Number(settings.targetYear) || defaultTargetYear();
  const depth = Number(settings.toDepthYears) || 3;
  return new Date(targetYear - depth, 0, 1);
}

// Returns the exclusion reason (Russian) for a record, or null when it stays active.
// Steps follow TZ §6 Step 1 with decision D1 depth (relative to the target year).
export function exclusionReason(record, settings = {}) {
  if (record?.removalDate) return 'Снято с учёта (заполнена «Дата снятия»)';
  if (record?.flags?.ugon) return 'Угон';
  if (record?.flags?.bezTo) return 'Без ТО';
  if (record?.flags?.sdanGrz) return 'Сдан ГРЗ';
  if (record?.flags?.vyvezena) return 'Вывезена за рубеж';
  if (!(record?.lastTo instanceof Date) || Number.isNaN(record.lastTo.getTime())) {
    return 'Отсутствует или некорректна «Дата ТО»';
  }
  if (record.lastTo.getTime() < depthCutoff(settings).getTime()) {
    return 'Дата ТО старше глубины';
  }
  return null;
}

export function filterRecords(records, settings = {}) {
  const active = [];
  const excluded = [];
  for (const record of records || []) {
    const reason = exclusionReason(record, settings);
    if (reason) excluded.push({ record, reason });
    else active.push(record);
  }
  return { active, excluded };
}

// Computes target inspection dates. Returns { isA4, dates: [{ date, source, overdue }], overdue }.
// D7: a valid «Дата след. ТО» from the export wins over the computed date.
// D2: A4 steps +6 months from the last TO; dates inside the target year are used,
// an overdue date is flagged for redistribution and its +6-month successor is kept
// when it still falls inside the target year.
export function computeTargetDates(record, settings = {}) {
  const targetYear = Number(settings.targetYear) || defaultTargetYear();
  const targetStart = new Date(targetYear, 0, 1);
  const targetEnd = new Date(targetYear, 11, 31);
  const a4 = isA4(record);

  if (record?.nextTo instanceof Date && !Number.isNaN(record.nextTo.getTime())) {
    const dates = [
      { date: record.nextTo, source: '«Дата след. ТО» (выгрузка)', overdue: false },
    ];
    if (a4) {
      const second = addMonths(record.nextTo, 6);
      if (second.getFullYear() === targetYear) {
        dates.push({ date: second, source: 'А4 (+6 мес.)', overdue: false });
      }
    }
    return { isA4: a4, dates, overdue: false };
  }

  const lastTo = record?.lastTo;
  if (!(lastTo instanceof Date) || Number.isNaN(lastTo.getTime())) {
    return { isA4: a4, dates: [], overdue: false };
  }

  if (a4) {
    const steps = [];
    let cursor = addMonths(lastTo, 6);
    for (let guard = 0; cursor.getTime() <= targetEnd.getTime() && guard < 48; guard += 1) {
      steps.push(cursor);
      cursor = addMonths(cursor, 6);
    }
    const before = steps.filter((date) => date.getTime() < targetStart.getTime());
    if (before.length > 0) {
      const anchor = before[before.length - 1];
      const dates = [{ date: anchor, source: 'Просроченная А4', overdue: true }];
      const next = addMonths(anchor, 6);
      if (next.getFullYear() === targetYear) {
        dates.push({ date: next, source: 'А4 (+6 мес.)', overdue: false });
      }
      return { isA4: true, dates, overdue: true };
    }
    const dates = steps
      .filter((date) => date.getFullYear() === targetYear)
      .slice(0, 2)
      .map((date) => ({ date, source: 'А4 (шаг 6 мес.)', overdue: false }));
    return { isA4: true, dates, overdue: false };
  }

  const planned = addMonths(lastTo, 12);
  if (planned.getFullYear() === targetYear) {
    return {
      isA4: false,
      dates: [{ date: planned, source: 'Расчёт («Дата ТО» + 1 год)', overdue: false }],
      overdue: false,
    };
  }
  if (planned.getTime() < targetStart.getTime()) {
    return {
      isA4: false,
      dates: [{ date: planned, source: 'Просроченная («Дата ТО» + 1 год)', overdue: true }],
      overdue: true,
    };
  }
  return { isA4: false, dates: [], overdue: false };
}

const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function normalizeName(name) {
  return String(name ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Owner key: digits of ИНН, else the normalized owner name (TZ §6 Step 2).
export function ownerKey(record) {
  const digits = String(record?.inn ?? '').replace(/\D/g, '');
  if (digits) return `inn:${digits}`;
  return `name:${normalizeName(record?.owner)}`;
}

export function isPhysicalOwner(record) {
  return /физ/i.test(String(record?.ownerGroup ?? ''));
}

function physicalNote(settings) {
  const names = (settings.acceptingDays || [])
    .map((day) => WEEKDAY_NAMES[day])
    .filter(Boolean)
    .join(', ');
  const days = names || 'приёмные дни';
  const address = String(settings.inspectionAddress ?? '').trim() || 'инспекции';
  return `Физические лица, имеющие не более 3 ед. техники, проходят ТО в приёмные дни (${days}) по адресу инспекции: ${address}.`;
}

// D5 / TZ §5.6: individuals with <= 3 active units are handled by mode A (exclude)
// or mode B (exclude from the table but add the reception note). Owners with more
// than 3 units always stay in the schedule.
export function applyPhysicalRule(records, settings = {}) {
  const mode = settings.smallPhysicalMode === 'B' ? 'B' : 'A';
  const groups = new Map();
  for (const record of records || []) {
    const key = ownerKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const excludedReasons = new Map();
  let noteNeeded = false;
  for (const group of groups.values()) {
    if (!isPhysicalOwner(group[0]) || group.length > 3) continue;
    if (mode === 'B') {
      noteNeeded = true;
      for (const record of group) {
        excludedReasons.set(record, 'Физлицо с ≤3 ед. техники — приём в приёмные дни');
      }
    } else {
      for (const record of group) {
        excludedReasons.set(record, 'Физлицо с ≤3 ед. техники (вариант А)');
      }
    }
  }

  const kept = (records || []).filter((record) => !excludedReasons.has(record));
  const excluded = (records || [])
    .filter((record) => excludedReasons.has(record))
    .map((record) => ({ record, reason: excludedReasons.get(record) }));
  return { kept, excluded, notes: noteNeeded ? [physicalNote(settings)] : [] };
}

// Groups target items of one owner whose dates fall inside the grouping window.
// Cluster date = the earliest date in the cluster (TZ §6 Step 4). A4 items six
// months apart therefore land in separate clusters.
export function clusterTargets(items, settings = {}) {
  const windowMs = (Number(settings.groupWindowDays) || 30) * 86400000;
  const byOwner = new Map();
  for (const item of items || []) {
    const key = item.ownerKey || ownerKey(item.record);
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push({ ...item, ownerKey: key });
  }

  const clusters = [];
  for (const list of byOwner.values()) {
    const sorted = [...list].sort((a, b) => a.date - b.date);
    let current = null;
    for (const item of sorted) {
      if (!current || item.date.getTime() - current.startTime > windowMs) {
        current = {
          ownerKey: item.ownerKey,
          startTime: item.date.getTime(),
          date: item.date,
          items: [],
          overdue: false,
        };
        clusters.push(current);
      }
      current.items.push(item);
      current.overdue = current.overdue || Boolean(item.overdue);
    }
  }

  clusters.sort((a, b) => a.date - b.date);
  return clusters.map((cluster) => {
    const records = [...new Set(cluster.items.map((item) => item.record))];
    return {
      ownerKey: cluster.ownerKey,
      date: cluster.date,
      overdue: cluster.overdue,
      units: records.length,
      records,
      items: cluster.items,
    };
  });
}

const SETTLEMENT_MARKERS = [
  'г',
  'город',
  'с',
  'село',
  'п',
  'пос',
  'посёлок',
  'поселок',
  'пгт',
  'д',
  'деревня',
  'х',
  'хутор',
  'ст-ца',
  'станица',
  'аул',
  'рп',
];

// D8: recognizes district (``... р-н`` / ``район``) and settlement (marker + name)
// from a free-form address without any external geocoding. Location key = district|settlement.
export function extractLocation(address) {
  const text = String(address ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { district: '', settlement: '', key: '—|—', label: 'не распознано' };

  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let district = '';
  for (const part of parts) {
    if (/р-н|район/i.test(part)) {
      district = normalizeName(part.replace(/р-н|район/gi, ''));
      break;
    }
  }

  let settlement = '';
  for (const part of parts) {
    const match = part.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const marker = match[1].toLowerCase().replace(/\.$/, '');
    if (!SETTLEMENT_MARKERS.includes(marker)) continue;
    const name = match[2].trim();
    if (/^\d/.test(name)) continue;
    settlement = normalizeName(name);
    break;
  }

  return {
    district,
    settlement,
    key: `${district || '—'}|${settlement || '—'}`,
    label: `${district || '—'} / ${settlement || '—'}`,
  };
}

// TZ §6 Step 6 / D3: visit duration = ceil(units / perHour) hours, rounded to 30
// minutes, minimum 30.
export function visitDurationMinutes(units, perHour) {
  const speed = Number(perHour) > 0 ? Number(perHour) : 12;
  const hours = Math.max(1, Math.ceil((Number(units) || 1) / speed));
  return Math.max(30, Math.round((hours * 60) / 30) * 30);
}

function parseTimeToMinutes(value, fallback) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function addDays(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function clampDate(date, min, max) {
  const time = date.getTime();
  if (time < min.getTime()) return new Date(min.getFullYear(), min.getMonth(), min.getDate());
  if (time > max.getTime()) return new Date(max.getFullYear(), max.getMonth(), max.getDate());
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function pickDominant(records) {
  const counts = new Map();
  for (const record of records) {
    const key = record.address || '';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = records[0];
  let bestCount = -1;
  for (const record of records) {
    const count = counts.get(record.address || '') || 0;
    if (count > bestCount) {
      bestCount = count;
      best = record;
    }
  }
  return best;
}

function fitDay(date, builder, dayStates, settings, calendar) {
  if (!isWorkingDay(date, settings, calendar)) return null;
  const key = dateKey(date);
  const state = dayStates.get(key) || { lastEnd: null, lastLocation: null, visits: [] };
  const workStart = parseTimeToMinutes(settings.workStart, 9 * 60);
  const workEnd = parseTimeToMinutes(settings.workEnd, 18 * 60);
  const lunch = settings.lunch || {};
  const lunchOn = lunch.enabled !== false;
  const lunchStart = parseTimeToMinutes(lunch.start, 12 * 60);
  const lunchEnd = parseTimeToMinutes(lunch.end, 13 * 60);
  const travel = Number(settings.travelMinutes) || 60;

  const available = workEnd - workStart - (lunchOn ? lunchEnd - lunchStart : 0);
  if (builder.duration > available) {
    if (state.visits.length > 0) return null;
    return { startMin: workStart, endMin: workEnd, overload: true };
  }

  let start =
    state.lastEnd === null
      ? workStart
      : state.lastEnd + (state.lastLocation !== builder.location.key ? travel : 0);
  if (lunchOn && start < lunchEnd && start + builder.duration > lunchStart) {
    start = lunchEnd;
  }
  const end = start + builder.duration;
  if (end > workEnd) return null;
  return { startMin: start, endMin: end, overload: false };
}

function placeOnDay(date, builder, dayStates, settings, calendar) {
  const slot = fitDay(date, builder, dayStates, settings, calendar);
  if (!slot) return null;
  const key = dateKey(date);
  const state = dayStates.get(key) || { lastEnd: null, lastLocation: null, visits: [] };
  state.visits.push({ startMin: slot.startMin, endMin: slot.endMin, location: builder.location.key });
  state.lastEnd = slot.endMin;
  state.lastLocation = builder.location.key;
  dayStates.set(key, state);
  return { date, ...slot };
}

function placeRegular(builder, dayStates, settings, calendar, targetStart, targetEnd) {
  const target = clampDate(builder.cluster.date, targetStart, targetEnd);
  let cursor = target;
  while (cursor.getTime() >= targetStart.getTime()) {
    const visit = placeOnDay(cursor, builder, dayStates, settings, calendar);
    if (visit) return visit;
    cursor = addDays(cursor, -1);
  }
  cursor = addDays(target, 1);
  while (cursor.getTime() <= targetEnd.getTime()) {
    const visit = placeOnDay(cursor, builder, dayStates, settings, calendar);
    if (visit) return visit;
    cursor = addDays(cursor, 1);
  }
  return null;
}

function placeOverdue(builder, dayStates, settings, calendar, targetYear, monthLoads) {
  const order = [...Array(12).keys()].sort(
    (a, b) => monthLoads[a].visits - monthLoads[b].visits || a - b,
  );
  const anchorDay = builder.cluster.date.getDate();
  for (const month of order) {
    const total = daysInMonth(targetYear, month);
    const days = [...Array(total).keys()]
      .map((index) => index + 1)
      .sort((a, b) => Math.abs(a - anchorDay) - Math.abs(b - anchorDay) || a - b);
    for (const day of days) {
      const date = new Date(targetYear, month, day);
      const visit = placeOnDay(date, builder, dayStates, settings, calendar);
      if (visit) return visit;
    }
  }
  return null;
}

function makeVisit(placed, builder, overdue) {
  const dominant = builder.dominant;
  return {
    date: placed.date,
    startMin: placed.startMin,
    endMin: placed.endMin,
    overload: placed.overload,
    overdue: Boolean(overdue || builder.cluster.overdue),
    owner: dominant.owner,
    ownerKey: ownerKey(dominant),
    inn: dominant.inn || '',
    address: dominant.address || '',
    locationKey: builder.location.key,
    locationLabel: builder.location.label,
    units: builder.cluster.units,
    durationMin: builder.duration,
    records: builder.cluster.records,
    sources: [...new Set(builder.cluster.items.map((item) => item.source))],
    isA4: builder.cluster.items.some((item) => item.isA4),
  };
}

function makeBuilder(cluster, settings) {
  const dominant = pickDominant(cluster.records);
  return {
    cluster,
    dominant,
    duration: visitDurationMinutes(cluster.units, settings.perHour),
    location: extractLocation(dominant.address),
  };
}

// Full pipeline: filter -> physical rule -> target dates -> clusters ->
// day/time placement. Returns { visits, excluded, notes, warnings, summary }.
export function buildSchedule(records, settings = {}, calendar = null) {
  const targetYear = Number(settings.targetYear) || defaultTargetYear();
  const targetStart = new Date(targetYear, 0, 1);
  const targetEnd = new Date(targetYear, 11, 31);
  const effective = { ...settings, targetYear };

  const { active, excluded: filterExcluded } = filterRecords(records, effective);
  const physical = applyPhysicalRule(active, settings);
  const excluded = [...filterExcluded, ...physical.excluded];
  const notes = physical.notes;

  const items = [];
  for (const record of physical.kept) {
    const targets = computeTargetDates(record, effective);
    for (const target of targets.dates) {
      items.push({
        record,
        ownerKey: ownerKey(record),
        date: target.date,
        source: target.source,
        overdue: target.overdue,
        isA4: targets.isA4,
      });
    }
  }

  const regularBuilders = clusterTargets(
    items.filter((item) => !item.overdue),
    settings,
  ).map((cluster) => makeBuilder(cluster, settings));
  const overdueBuilders = clusterTargets(
    items.filter((item) => item.overdue),
    settings,
  ).map((cluster) => makeBuilder(cluster, settings));

  const dayStates = new Map();
  const visits = [];
  const warnings = [];
  if (calendar && calendar.warning) {
    warnings.push(
      `Производственный календарь на ${targetYear} год недоступен — использованы только выходные (Сб/Вс).`,
    );
  }

  for (const builder of regularBuilders) {
    const placed = placeRegular(builder, dayStates, effective, calendar, targetStart, targetEnd);
    if (placed) visits.push(makeVisit(placed, builder, false));
    else warnings.push(`Не удалось разместить визит: ${builder.dominant.owner}.`);
  }

  const monthLoads = Array.from({ length: 12 }, () => ({ visits: 0, machines: 0 }));
  for (const visit of visits) {
    const load = monthLoads[visit.date.getMonth()];
    load.visits += 1;
    load.machines += visit.units;
  }

  for (const builder of overdueBuilders) {
    const placed = placeOverdue(
      builder,
      dayStates,
      effective,
      calendar,
      targetYear,
      monthLoads,
    );
    if (placed) {
      const visit = makeVisit(placed, builder, true);
      visits.push(visit);
      const load = monthLoads[visit.date.getMonth()];
      load.visits += 1;
      load.machines += visit.units;
    } else {
      warnings.push(`Не удалось разместить просроченный визит: ${builder.dominant.owner}.`);
    }
  }

  visits.sort((a, b) => a.date - b.date || a.startMin - b.startMin);

  const months = Array.from({ length: 12 }, (_, month) => ({
    month: month + 1,
    visits: 0,
    machines: 0,
  }));
  for (const visit of visits) {
    const entry = months[visit.date.getMonth()];
    entry.visits += 1;
    entry.machines += visit.units;
  }

  const machines = visits.reduce((sum, visit) => sum + visit.units, 0);
  const overloaded = visits.filter((visit) => visit.overload).length;
  return {
    year: targetYear,
    visits,
    excluded,
    notes,
    warnings,
    calendarSource: calendar ? calendar.source : 'none',
    summary: {
      visits: visits.length,
      machines,
      overloaded,
      months,
    },
  };
}
