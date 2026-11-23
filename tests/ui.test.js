import { describe, expect, it } from 'vitest';

import {
  defaultSettings,
  detailPreviewRows,
  schedulePreviewRows,
  summarizeMessages,
} from '../src/modules/ui.js';

describe('defaultSettings', () => {
  it('uses the next year and TZ defaults', () => {
    const settings = defaultSettings(new Date(2026, 10, 23));
    expect(settings.targetYear).toBe(2027);
    expect(settings.toDepthYears).toBe(3);
    expect(settings.groupWindowDays).toBe(30);
    expect(settings.perHour).toBe(12);
    expect(settings.travelMinutes).toBe(60);
    expect(settings.workStart).toBe('09:00');
    expect(settings.workEnd).toBe('18:00');
    expect(settings.lunch).toEqual({ enabled: true, start: '12:00', end: '13:00' });
    expect(settings.smallPhysicalMode).toBe('A');
    expect(settings.acceptingDays).toEqual([]);
    expect(settings.vacations).toEqual([]);
    expect(settings.physicalThreshold).toBe(3);
    expect(settings.groupSmallOwners).toBe(true);
    expect(settings.winterMonths).toEqual([11, 0, 1]);
    expect(settings.winterLoadPercent).toBe(30);
  });
});

describe('preview rows', () => {
  const visit = {
    owner: 'ООО «Старое»',
    overdue: true,
    date: new Date(2026, 5, 10),
    startMin: 9 * 60,
    endMin: 10 * 60,
    inn: '7701000001',
    locationLabel: '— / москва',
    units: 1,
    durationMin: 60,
    records: [{ plate: 'А001ММ77', brand: 'МТЗ' }],
    unitsDetail: [
      { plate: 'А001ММ77', brand: 'МТЗ', dates: [{ date: new Date(2026, 5, 10) }] },
    ],
  };

  it('schedule preview shows only the owner name (no overdue suffix)', () => {
    const rows = schedulePreviewRows({ visits: [visit] });
    expect(rows[0][0]).toBe(1);
    expect(rows[0][1]).toBe('ООО «Старое»');
    expect(String(rows[0][1])).not.toContain('просроченная');
  });

  it('details preview uses «с ЧЧ-ММ до ЧЧ-ММ»', () => {
    const rows = detailPreviewRows({ visits: [visit] });
    expect(rows[0][2]).toBe('с 9-00 до 10-00');
  });

  it('details preview carries the same visit number as the schedule tab (GRAFIK-22)', () => {
    const schedule = schedulePreviewRows({ visits: [visit, { ...visit, owner: 'Второй' }] });
    const details = detailPreviewRows({ visits: [visit, { ...visit, owner: 'Второй' }] });
    expect(schedule.map((row) => row[0])).toEqual([1, 2]);
    expect(details.map((row) => row[0])).toEqual([1, 2]);
    expect(details[0][0]).toBe(schedule[0][0]);
    expect(details[1][0]).toBe(schedule[1][0]);
  });

  it('details preview lists each unit with its original target date', () => {
    const rows = detailPreviewRows({ visits: [visit] });
    expect(rows[0][9]).toContain('А001ММ77');
    expect(rows[0][9]).toContain('10.06.2026');
    expect(rows[0][9]).toContain('1.');
    expect(rows[0][8]).toBe('1. А001ММ77 — МТЗ');
  });
});

describe('summarizeMessages', () => {
  it('maps warnings, notes and the excluded count into banners', () => {
    const messages = summarizeMessages({
      warnings: ['календарь недоступен'],
      notes: ['примечание про физлиц'],
      excluded: [{}, {}],
    });
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ type: 'warning', text: 'календарь недоступен' });
    expect(messages[1]).toEqual({ type: 'note', text: 'примечание про физлиц' });
    expect(messages[2].type).toBe('info');
    expect(messages[2].text).toContain('2');
  });

  it('returns no banners for a clean result', () => {
    expect(summarizeMessages({ warnings: [], notes: [], excluded: [] })).toEqual([]);
  });
});
