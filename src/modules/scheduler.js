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
// D12: «Без ТО» = «*» means the inspection is overdue and the unit MUST be scheduled;
// therefore it is no longer an exclusion reason, and the other exclusions (removal,
// угон, сдан ГРЗ, вывезена) still win over it.
// D13: «*» with an empty/invalid «Дата ТО» is treated as older than 5 years — it is
// scheduled only when the depth is >= 5, otherwise excluded with an explicit reason.
export function exclusionReason(record, settings = {}) {
  if (record?.removalDate) return 'Снято с учёта (заполнена «Дата снятия»)';
  if (record?.flags?.ugon) return 'Угон';
  if (record?.flags?.sdanGrz) return 'Сдан ГРЗ';
  if (record?.flags?.vyvezena) return 'Вывезена за рубеж';

  const depth = Number(settings.toDepthYears) || 3;
  const hasLastTo =
    record?.lastTo instanceof Date && !Number.isNaN(record.lastTo.getTime());

  if (record?.flags?.bezTo) {
    if (!hasLastTo) {
      return depth >= 5 ? null : '«Без ТО» без даты ТО, глубина менее 5 лет';
    }
    if (record.lastTo.getTime() < depthCutoff(settings).getTime()) {
      return 'Дата ТО больше выбранной давности ТО';
    }
    return null;
  }

  if (!hasLastTo) return 'Отсутствует или некорректна «Дата ТО»';
  if (record.lastTo.getTime() < depthCutoff(settings).getTime()) {
    return 'Дата ТО больше выбранной давности ТО';
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
  const lastTo = record?.lastTo;
  const hasLastTo = lastTo instanceof Date && !Number.isNaN(lastTo.getTime());

  // D12: «Без ТО» = «*» is always overdue and scheduled through the least-loaded
  // month (D14). With a valid «Дата ТО» the computed anchor only seeds the preferred
  // day; without it (D13) a January anchor is used purely for clustering.
  if (record?.flags?.bezTo) {
    const period = a4 ? 6 : 12;
    const anchor = hasLastTo ? addMonths(lastTo, period) : new Date(targetYear, 0, 1);
    const dates = [
      {
        date: anchor,
        source: hasLastTo ? '«Без ТО» (просрочено)' : '«Без ТО» (нет даты ТО)',
        overdue: true,
      },
    ];
    if (a4 && hasLastTo) {
      const next = addMonths(anchor, 6);
      if (next.getFullYear() === targetYear) {
        dates.push({ date: next, source: 'А4 (+6 мес.)', overdue: false });
      }
    }
    return { isA4: a4, dates, overdue: true };
  }

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

  if (!hasLastTo) {
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

// Owner key: a real ИНН (10 or 12 digits), else the normalized owner name.
// GRAFIK-10 root cause: the old key accepted ANY digits, so placeholder values such
// as "0" collapsed many unrelated individuals into one group; the inflated count
// bypassed the physical-person limit and 3-unit individuals stayed in the schedule.
export function ownerKey(record) {
  const digits = String(record?.inn ?? '').replace(/\D/g, '');
  if (digits.length >= 10) return `inn:${digits}`;
  return `name:${normalizeName(record?.owner)}`;
}

// Recognizes an individual by «Группа владельца»: contains «физ» (физические лица,
// физ. лицо, …) or the isolated token «ФЛ».
export function isPhysicalOwner(record) {
  const text = normalizeName(record?.ownerGroup);
  return /физ/.test(text) || /(^|[^а-яa-z])фл([^а-яa-z]|$)/.test(text);
}

// D11: configurable limit for individuals, default 3.
export function physicalThreshold(settings = {}) {
  const value = Number(settings.physicalThreshold);
  if (!Number.isFinite(value) || value < 0) return 3;
  return Math.floor(value);
}

function physicalNote(settings) {
  const limit = physicalThreshold(settings);
  const names = (settings.acceptingDays || [])
    .map((day) => WEEKDAY_NAMES[day])
    .filter(Boolean)
    .join(', ');
  const days = names || 'приёмные дни';
  const address = String(settings.inspectionAddress ?? '').trim() || 'инспекции';
  return `Физические лица, имеющие не более ${limit} ед. техники, проходят ТО в приёмные дни (${days}) по адресу инспекции: ${address}.`;
}

// D11 / TZ §5.6: individuals with units <= threshold (counted only among the units
// that passed the filters) are handled by mode A (exclude) or mode B (exclude from
// the table but add the reception note). Owners above the threshold stay scheduled.
export function applyPhysicalRule(records, settings = {}) {
  const mode = settings.smallPhysicalMode === 'B' ? 'B' : 'A';
  const limit = physicalThreshold(settings);
  const groups = new Map();
  for (const record of records || []) {
    const key = ownerKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const excludedReasons = new Map();
  let noteNeeded = false;
  for (const group of groups.values()) {
    // A single mismatched row must not hide the rule: the owner is physical when
    // any of the owner's units says so.
    if (!group.some(isPhysicalOwner)) continue;
    const units = group.length;
    if (units > limit) continue;
    const reason =
      mode === 'B'
        ? `Физлицо с ≤${limit} ед. техники — приём в приёмные дни`
        : `Физлицо с ≤${limit} ед. техники (вариант А)`;
    if (mode === 'B') noteNeeded = true;
    for (const record of group) excludedReasons.set(record, reason);
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

// D8/GRAFIK-15: district and region suffixes are separate so an explicit district
// (р-н/район) still wins over a region, while a region alone gives a usable key.
const DISTRICT_MARKERS = ['р-н', 'район'];
const REGION_MARKERS = ['обл', 'область', 'край', 'ао', 'аобл', 'респ', 'республика', 'округ'];

// Markers that mean "this part is a street/house", never a settlement on its own.
const STREET_MARKERS = [
  'ул',
  'улица',
  'пр-т',
  'проспект',
  'пр',
  'проезд',
  'пер',
  'переулок',
  'ш',
  'шоссе',
  'наб',
  'набережная',
  'пл',
  'площадь',
  'бул',
  'бульвар',
  'туп',
  'тупик',
  'мкр',
  'микрорайон',
  'кв-л',
  'квартал',
  'дор',
  'дорога',
];
const HOUSE_MARKERS = [
  'д',
  'дом',
  'кв',
  'квартира',
  'корп',
  'корпус',
  'стр',
  'строение',
  'оф',
  'офис',
  'пом',
  'помещение',
];

const WORD_SPLIT = /[^а-яёa-z0-9-]+/u;

function addressTokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter(Boolean);
}

function hasAnyToken(tokens, list) {
  return list.some((token) => tokens.includes(token));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Removes whole marker words (р-н / район / обл / край / …) and punctuation,
// returning the cleaned, normalized remainder.
function stripMarkers(part, markers) {
  let result = String(part);
  for (const marker of markers) {
    result = result.replace(
      new RegExp(`(^|[^а-яёa-z0-9-])${escapeRegExp(marker)}(?=$|[^а-яёa-z0-9-])`, 'giu'),
      ' ',
    );
  }
  return normalizeName(result.replace(/[.,]/g, ' '));
}

// Splits a part like "г.Москва", "г Москва", "с. Рогачёво", "ст-ца Динская".
// A marker must be followed by a dot, whitespace or end, so "Советская" (street)
// does not match the single-letter marker "с".
function splitSettlementMarker(part) {
  const markers = [...SETTLEMENT_MARKERS].sort((a, b) => b.length - a.length);
  for (const marker of markers) {
    const match = part.match(new RegExp(`^${escapeRegExp(marker)}(?:\\.|\\s+|$)`, 'iu'));
    if (!match) continue;
    const name = part.slice(match[0].length).replace(/^[.\s]+/, '').trim();
    if (!name || /^\d/.test(name)) continue;
    return { marker, name };
  }
  return null;
}

// GRAFIK-16: real-export settlement values put the marker after the name, for
// example "КУСА Г", "МЕДВЕДЕВКА С", "ЦЕНТРАЛЬНЫЙ п". Strip the trailing marker.
function splitSettlementSuffix(part) {
  const words = String(part ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return '';
  const marker = words[words.length - 1].toLowerCase().replace(/\./g, '');
  if (!SETTLEMENT_MARKERS.includes(marker)) return '';
  const name = words.slice(0, -1).join(' ').trim();
  if (!name || /^\d/.test(name)) return '';
  return name;
}

// GRAFIK-15: a bare "Москва" without a marker is a settlement when the part has no
// region/district/street/house marker, no digits, and starts with a capital letter.
function looksLikeBareSettlement(part) {
  const trimmed = String(part ?? '').trim();
  if (!trimmed) return false;
  const tokens = addressTokens(trimmed);
  if (tokens.length === 0) return false;
  if (hasAnyToken(tokens, REGION_MARKERS)) return false;
  if (hasAnyToken(tokens, DISTRICT_MARKERS)) return false;
  if (hasAnyToken(tokens, STREET_MARKERS)) return false;
  if (hasAnyToken(tokens, HOUSE_MARKERS)) return false;
  if (/\d/.test(trimmed)) return false;
  if (!/^[А-ЯЁA-Z]/.test(trimmed)) return false;
  return trimmed.length <= 60;
}

function districtFromPart(part) {
  const tokens = addressTokens(part);
  if (!hasAnyToken(tokens, DISTRICT_MARKERS)) return '';
  return stripMarkers(part, DISTRICT_MARKERS);
}

function regionFromPart(part) {
  const tokens = addressTokens(part);
  if (!hasAnyToken(tokens, REGION_MARKERS)) return '';
  return stripMarkers(part, REGION_MARKERS);
}

// D8: recognizes district (``... р-н`` / ``район``), region fallback (обл./край/…)
// and settlement (marker + name, attached marker, or a bare city name) from a
// free-form address without any external geocoding. Key = district|settlement.
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

  // An explicit district wins; a region is only a fallback grouping key.
  let district = '';
  for (const part of parts) {
    const value = districtFromPart(part);
    if (value) {
      district = value;
      break;
    }
  }
  if (!district) {
    for (const part of parts) {
      const value = regionFromPart(part);
      if (value) {
        district = value;
        break;
      }
    }
  }

  let settlement = '';
  for (const part of parts) {
    const split = splitSettlementMarker(part);
    if (split) {
      settlement = normalizeName(split.name);
      break;
    }
    const suffix = splitSettlementSuffix(part);
    if (suffix) {
      settlement = normalizeName(suffix);
      break;
    }
    if (looksLikeBareSettlement(part)) {
      settlement = normalizeName(part);
      break;
    }
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

// D14: least-loaded month selection weights the capacity of winter months by the
// configured percentage (0 = avoid winter, 100 = treat as a regular month). Choosing
// the minimum of visits / factor keeps the comparison capacity-aware.
function winterScore(month, monthLoads, winterMonths, factor) {
  if (!winterMonths.has(month)) return monthLoads[month].visits;
  if (factor <= 0) return Number.POSITIVE_INFINITY;
  return monthLoads[month].visits / factor;
}

function placeOverdue(builder, dayStates, settings, calendar, targetYear, monthLoads) {
  const winterMonths = new Set(
    (settings.winterMonths || [11, 0, 1]).map((month) => Number(month)),
  );
  const rawPercent = Number(settings.winterLoadPercent);
  const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(0, rawPercent)) : 30;
  const factor = percent / 100;
  const order = [...Array(12).keys()].sort(
    (a, b) =>
      winterScore(a, monthLoads, winterMonths, factor) -
        winterScore(b, monthLoads, winterMonths, factor) || a - b,
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
    // Per-unit original target dates (GRAFIK-14): lets the details sheet show each
    // unit's own planned date even when the owner is merged into one visit.
    unitsDetail: builder.cluster.records.map((record) => {
      const recordItems = builder.cluster.items.filter((item) => item.record === record);
      return {
        plate: record.plate || '',
        brand: record.brand || '',
        dates: recordItems.map((item) => ({ date: item.date, source: item.source })),
      };
    }),
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
  const physical = applyPhysicalRule(active, effective);
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

  // GRAFIK-14: group every small owner (physical or legal, post-filter units <= the
  // D11 limit) into ONE visit on the latest target date of its units. Off (or an
  // owner above the limit) keeps the per-unit behaviour clustered by the window.
  const groupSmall = settings.groupSmallOwners !== false;
  const limit = physicalThreshold(effective);
  const keptByOwner = new Map();
  for (const record of physical.kept) {
    const key = ownerKey(record);
    if (!keptByOwner.has(key)) keptByOwner.set(key, []);
    keptByOwner.get(key).push(record);
  }

  const itemsByOwner = new Map();
  for (const item of items) {
    if (!itemsByOwner.has(item.ownerKey)) itemsByOwner.set(item.ownerKey, []);
    itemsByOwner.get(item.ownerKey).push(item);
  }

  const groupedBuilders = [];
  const standaloneItems = [];
  for (const [key, ownerItems] of itemsByOwner) {
    const ownerUnits = keptByOwner.get(key)?.length ?? 0;
    if (groupSmall && ownerUnits > 0 && ownerUnits <= limit) {
      const records = [...new Set(ownerItems.map((item) => item.record))];
      const latest = ownerItems.reduce(
        (best, item) => (item.date.getTime() > best.date.getTime() ? item : best),
        ownerItems[0],
      );
      groupedBuilders.push(
        makeBuilder(
          {
            ownerKey: key,
            date: latest.date,
            overdue: Boolean(latest.overdue),
            units: records.length,
            records,
            items: ownerItems,
          },
          settings,
        ),
      );
    } else {
      standaloneItems.push(...ownerItems);
    }
  }

  const byClusterDate = (a, b) => a.cluster.date - b.cluster.date;
  const regularBuilders = [
    ...groupedBuilders.filter((builder) => !builder.cluster.overdue),
    ...clusterTargets(
      standaloneItems.filter((item) => !item.overdue),
      settings,
    ).map((cluster) => makeBuilder(cluster, settings)),
  ].sort(byClusterDate);
  const overdueBuilders = [
    ...groupedBuilders.filter((builder) => builder.cluster.overdue),
    ...clusterTargets(
      standaloneItems.filter((item) => item.overdue),
      settings,
    ).map((cluster) => makeBuilder(cluster, settings)),
  ].sort(byClusterDate);

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
