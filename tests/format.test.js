import { describe, expect, it } from 'vitest';

import { formatUnitTargets, targetDateStatus } from '../src/modules/format.js';

const EXPORT_DATE = new Date(2026, 10, 23); // 23.11.2026

describe('targetDateStatus (GRAFIK-29)', () => {
  it('labels a date before exportDate as overdue', () => {
    expect(targetDateStatus(new Date(2026, 2, 15), { exportDate: EXPORT_DATE })).toBe('Просрочен (15.03.2026)');
  });

  it('labels the exportDate itself as on schedule', () => {
    expect(targetDateStatus(new Date(2026, 10, 23), { exportDate: EXPORT_DATE })).toBe('По графику (23.11.2026)');
  });

  it('labels a future date as on schedule', () => {
    expect(targetDateStatus(new Date(2027, 0, 1), { exportDate: EXPORT_DATE })).toBe('По графику (01.01.2027)');
  });

  it('labels a past year date as overdue', () => {
    expect(targetDateStatus(new Date(2025, 0, 1), { exportDate: EXPORT_DATE })).toBe('Просрочен (01.01.2025)');
  });
});

describe('formatUnitTargets date status (GRAFIK-29)', () => {
  const unit = (date, extra = {}) => [
    { plate: 'А001ММ77', brand: 'Lada', dates: [{ date, ...extra }] },
  ];

  it('marks a past date as overdue', () => {
    const text = formatUnitTargets(unit(new Date(2025, 0, 1)), { exportDate: EXPORT_DATE });
    expect(text).toContain('Просрочен (01.01.2025)');
  });

  it('marks exportDate as on schedule', () => {
    const text = formatUnitTargets(unit(new Date(2026, 10, 23)), { exportDate: EXPORT_DATE });
    expect(text).toContain('По графику (23.11.2026)');
  });

  it('marks a future date as on schedule', () => {
    const text = formatUnitTargets(unit(new Date(2027, 0, 1)), { exportDate: EXPORT_DATE });
    expect(text).toContain('По графику (01.01.2027)');
  });

  it('marks a date with no valid date as overdue (unknown)', () => {
    const text = formatUnitTargets([{ plate: 'А001ММ77', brand: 'Lada', dates: [{ date: null }] }], { exportDate: EXPORT_DATE });
    expect(text).toContain('Просрочен (дата неизвестна)');
  });

  it('marks a date with invalid date as overdue (unknown)', () => {
    const text = formatUnitTargets([{ plate: 'А001ММ77', brand: 'Lada', dates: [{ date: 'invalid' }] }], { exportDate: EXPORT_DATE });
    expect(text).toContain('Просрочен (дата неизвестна)');
  });

  it('handles multiple dates per unit', () => {
    const text = formatUnitTargets([{ plate: 'А001ММ77', brand: 'Lada', dates: [
      { date: new Date(2025, 0, 1) },
      { date: new Date(2027, 0, 1) }
    ] }], { exportDate: EXPORT_DATE });
    expect(text).toContain('Просрочен (01.01.2025)');
    expect(text).toContain('По графику (01.01.2027)');
  });
});