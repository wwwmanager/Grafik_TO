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

// Placeholder kept for the scaffold smoke test; the full pipeline lands in GRAFIK-06.
export function buildSchedule() {
  return [];
}
