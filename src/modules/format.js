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

// GRAFIK-17: one numbered line per unit, e.g.
// "1. A123AA (Lada) — целевая дата 15.03.2027". Fits a single Excel cell (wrap on).
export function formatUnitTargets(unitsDetail) {
  return (unitsDetail || [])
    .map((unit, index) => {
      const plate = String(unit?.plate ?? '').trim();
      const brand = String(unit?.brand ?? '').trim();
      const head =
        plate && brand ? `${plate} (${brand})` : plate || (brand ? `(${brand})` : 'ед.');
      const dates = (unit?.dates || [])
        .map((entry) => formatDate(entry?.date))
        .filter(Boolean);
      let dateLabel = '';
      if (dates.length === 1) dateLabel = ` — целевая дата ${dates[0]}`;
      else if (dates.length > 1) dateLabel = ` — целевые даты ${dates.join(', ')}`;
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
