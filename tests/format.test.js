import { describe, expect, it } from 'vitest';

import { formatUnitTargets, targetDateStatus } from '../src/modules/format.js';

const CONTEXT = { currentYear: 2026, targetYear: 2027 };

describe('targetDateStatus (GRAFIK-27)', () => {
  it('labels a future target-year date as the target year', () => {
    expect(targetDateStatus(new Date(2027, 0, 1), CONTEXT)).toBe('Целевой год (01.01.2027)');
  });

  it('labels a past date as overdue', () => {
    expect(targetDateStatus(new Date(2025, 0, 1), CONTEXT)).toBe('Просрочена (01.01.2025)');
  });

  it('labels a current-year date as the current year', () => {
    expect(targetDateStatus(new Date(2026, 5, 15), CONTEXT)).toBe('Текущий год (15.06.2026)');
  });
});

describe('formatUnitTargets date status (GRAFIK-27)', () => {
  const unit = (date, extra = {}) => [
    { plate: 'А001ММ77', brand: 'Lada', dates: [{ date, ...extra }] },
  ];

  it('does not mark a 2027 date overdue even when the overdue flag is set', () => {
    const text = formatUnitTargets(unit(new Date(2027, 0, 1), { overdue: true }), CONTEXT);
    expect(text).toBe('1. А001ММ77 (Lada) — Целевой год (01.01.2027)');
    expect(text).not.toContain('Просрочена');
  });

  it('marks a past date overdue and a current-year date as current', () => {
    const past = formatUnitTargets(unit(new Date(2025, 0, 1)), CONTEXT);
    expect(past).toContain('Просрочена (01.01.2025)');
    const current = formatUnitTargets(unit(new Date(2026, 5, 15)), CONTEXT);
    expect(current).toContain('Текущий год (15.06.2026)');
  });
});
