// Builds the yearly inspection schedule from parsed records and settings.
// This module grows by slice: filtering + target dates (GRAFIK-04),
// owners/clusters (GRAFIK-05), placement (GRAFIK-06).

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

// Placeholder kept for the scaffold smoke test; the full pipeline lands in GRAFIK-06.
export function buildSchedule() {
  return [];
}
