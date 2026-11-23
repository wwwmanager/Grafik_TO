import { describe, expect, it } from 'vitest';

import { defaultSettings, summarizeMessages } from '../src/modules/ui.js';

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
