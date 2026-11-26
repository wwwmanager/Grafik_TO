import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  migrateBlockState,
  neighboringRegionLabel,
  regionOptionLabel,
} from '../src/modules/ui.js';
import { getAvailableRegions } from '../src/modules/physical.js';

const CSS_PATH = fileURLToPath(new URL('../src/styles/main.css', import.meta.url));

describe('settings-panel: block-key migration (GRAFIK-42)', () => {
  it('merges the old physical accordion key into the merged section key', () => {
    expect(
      migrateBlockState({ 'open-physical': true, 'open-physical-schedule': false }),
    ).toEqual({ 'open-physical': true });
  });

  it('keeps the merged section open when only the old routing block was open', () => {
    expect(migrateBlockState({ 'open-physical-schedule': true })).toEqual({
      'open-physical': true,
    });
    expect(
      migrateBlockState({ 'open-physical': false, 'open-physical-schedule': true }),
    ).toEqual({ 'open-physical': true });
  });

  it('drops a closed legacy key without opening the merged section', () => {
    const migrated = migrateBlockState({ 'open-physical-schedule': false });
    expect(migrated).not.toHaveProperty('open-physical-schedule');
    expect(migrated).not.toHaveProperty('open-physical');
  });

  it('preserves unrelated block state', () => {
    expect(
      migrateBlockState({
        'open-filter': true,
        'open-region': false,
        'open-physical-schedule': true,
      }),
    ).toEqual({ 'open-filter': true, 'open-region': false, 'open-physical': true });
  });

  it('tolerates missing or malformed state', () => {
    expect(migrateBlockState(undefined)).toEqual({});
    expect(migrateBlockState(null)).toEqual({});
    expect(migrateBlockState([])).toEqual({});
  });
});

describe('settings-panel: no-data region labels still render (GRAFIK-42)', () => {
  it('marks a region without a geo reference in the option label', () => {
    const label = regionOptionLabel({ name: 'Тестовая область', regionCode: 74, hasData: false });
    expect(label).toContain('Тестовая область (74)');
    expect(label).toContain('гео-справочник не загружен');
  });

  it('keeps the option label clean when data exists', () => {
    expect(regionOptionLabel({ name: 'Тестовая область', regionCode: 74, hasData: true })).toBe(
      'Тестовая область (74)',
    );
  });

  it('shows the settlement count when data exists (GRAFIK-41)', () => {
    expect(
      regionOptionLabel({ name: 'Челябинская область', regionCode: 74, hasData: true, count: 1267 }),
    ).toBe('Челябинская область (74) · НП: 1267');
  });

  it('explains the textual fallback in the neighboring-region label', () => {
    const label = neighboringRegionLabel({ name: 'Тестовая область', regionCode: 74, hasData: false });
    expect(label).toContain('гео-справочник не загружен');
    expect(label).toContain('текстовая группировка');
    expect(neighboringRegionLabel({ name: 'Тестовая область', regionCode: 74, hasData: true })).toBe(
      'Тестовая область (74)',
    );
  });

  it('omits the code for new territories without an official regionCode (GRAFIK-41)', () => {
    const label = regionOptionLabel({ name: 'Донецкая Народная Республика', regionCode: null, hasData: false });
    expect(label).toContain('Донецкая Народная Республика —');
    expect(label).not.toContain('null');
    expect(neighboringRegionLabel({ name: 'Донецкая Народная Республика', regionCode: null, hasData: true })).toBe(
      'Донецкая Народная Республика',
    );
  });

  it('renders a non-empty label for every region in the no-data path', async () => {
    const regions = await getAvailableRegions();
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(regionOptionLabel(region).length).toBeGreaterThan(0);
      expect(neighboringRegionLabel(region).length).toBeGreaterThan(0);
    }
  });
});

describe('settings-panel: static CSS guards (GRAFIK-42)', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('has no fixed width greater than 320px in the settings CSS', () => {
    const offenders = [];
    const widthRe = /(?:^|[;{\s])width\s*:\s*(\d+)px/gi;
    let match;
    while ((match = widthRe.exec(css)) !== null) {
      const value = Number(match[1]);
      if (value > 320) offenders.push(match[0].trim());
    }
    expect(offenders).toEqual([]);
  });

  it('defines the shared .grid-2 utility and the scroll/footer split', () => {
    expect(css).toContain('.grid-2');
    expect(css).toContain('.settings-scroll');
    expect(css).toContain('.settings-actions');
    expect(css).toMatch(/\.settings-block-hint\s*\{[^}]*white-space:\s*normal/);
  });
});
