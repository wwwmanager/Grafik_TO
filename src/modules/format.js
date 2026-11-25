// Shared date/time formatting for preview tables and the exported workbook.
export function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

export function formatTimeLabel(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `с ${hour}-${String(minute).padStart(2, '0')}`;
}

export function formatTimeRange(startMin, endMin) {
  const label = (minutes) => {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${hour}-${String(minute).padStart(2, '0')}`;
  };
  return `с ${label(startMin)} до ${label(endMin)}`;
}

// GRAFIK-29: two statuses compared by full day (exportDate).
// date < exportDate -> 'Просрочен (ДД.ММ.ГГГГ)'
// otherwise -> 'По графику (ДД.ММ.ГГГГ)'
// '*' unit with no/invalid date -> 'Просрочен (дата неизвестна)'
export function targetDateStatus(date, options = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const label = formatDate(date);
  const exportDate = options.exportDate instanceof Date && !Number.isNaN(options.exportDate.getTime())
    ? options.exportDate
    : new Date();
  exportDate.setHours(0, 0, 0, 0);
  const compareDate = new Date(date);
  compareDate.setHours(0, 0, 0, 0);
  const status = compareDate < exportDate ? 'Просрочен' : 'По графику';
  return `${status} (${label})`;
}

// GRAFIK-17/26/27/29: one numbered line per unit, e.g.
// "1. A123AA (Lada) — Просрочен (15.03.2026)" or "По графику (01.01.2027)".
// '*' (bezTo) unit with no date -> "Просрочен (дата неизвестна)".
export function formatUnitTargets(unitsDetail, options = {}) {
  return (unitsDetail || [])
    .map((unit, index) => {
      const plate = String(unit?.plate ?? '').trim();
      const brand = String(unit?.brand ?? '').trim();
      const head =
        plate && brand ? `${plate} (${brand})` : plate || (brand ? `(${brand})` : 'ед.');
      const dates = (unit?.dates || [])
        .map((entry) => {
          const date = entry?.date;
          if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return 'Просрочен (дата неизвестна)';
          }
          return targetDateStatus(date, options) || formatDate(date);
        })
        .filter(Boolean);
      let dateLabel = '';
      if (dates.length === 1) dateLabel = ` — ${dates[0]}`;
      else if (dates.length > 1) dateLabel = ` — ${dates.join('; ')}`;
      return `${index + 1}. ${head}${dateLabel}`;
    })
    .join('\n');
}

// GRAFIK-17: one numbered line per unit, e.g. "1. A123AA — Lada".
export function formatVehicleList(records) {
  return (records || [])
    .map((record, index) => {
      const plate = String(record?.plate ?? '').trim();
      const brand = String(record?.brand ?? '').trim();
      const label = plate && brand ? `${plate} — ${brand}` : plate || brand || 'ед.';
      return `${index + 1}. ${label}`;
    })
    .join('\n');
}

export function formatMaybeDate(value) {
  if (!value) return '—';
  if (value instanceof Date) return formatDate(value);
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  return String(value);
}
