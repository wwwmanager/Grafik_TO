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

// GRAFIK-14: "PLATE BRAND — DD.MM.YYYY[, DD.MM.YYYY]; …" for one visit's units.
export function formatUnitTargets(unitsDetail) {
  return (unitsDetail || [])
    .map((unit) => {
      const label = [unit?.plate, unit?.brand].filter(Boolean).join(' ') || 'ед.';
      const dates = (unit?.dates || [])
        .map((entry) => formatDate(entry?.date))
        .filter(Boolean);
      return dates.length > 0 ? `${label} — ${dates.join(', ')}` : label;
    })
    .join('; ');
}

export function formatMaybeDate(value) {
  if (!value) return '—';
  if (value instanceof Date) return formatDate(value);
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  return String(value);
}
