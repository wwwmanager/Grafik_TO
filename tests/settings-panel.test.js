import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REGION_NO_DATA_HINT,
  compareRegionsByCode,
  formatRegionGeoHint,
  formatRegionLabel,
  migrateBlockState,
  neighboringRegionLabel,
  regionOptionLabel,
} from '../src/modules/ui.js';
import { getAvailableRegions } from '../src/modules/physical.js';

const CSS_PATH = fileURLToPath(new URL('../src/styles/main.css', import.meta.url));
const HTML_PATH = fileURLToPath(new URL('../index.html', import.meta.url));

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

describe('settings-panel: region labels «NN — Название» (GRAFIK-48)', () => {
  it('formats an option as a 2-digit code, an en dash and the name', () => {
    expect(
      regionOptionLabel({ name: 'Челябинская область', regionCode: 74, hasData: true, count: 1267 }),
    ).toBe('74 — Челябинская область');
    expect(regionOptionLabel({ name: 'Республика Адыгея', regionCode: 1, hasData: false })).toBe(
      '01 — Республика Адыгея',
    );
  });

  it('drops the geo-reference and settlement-count suffixes from the option text', () => {
    const label = regionOptionLabel({ name: 'Тестовая область', regionCode: 74, hasData: false });
    expect(label).toBe('74 — Тестовая область');
    expect(label).not.toMatch(/гео-справочник|нет данных|НП:/);
    expect(neighboringRegionLabel({ name: 'Тестовая область', regionCode: 74, hasData: false })).toBe(
      '74 — Тестовая область',
    );
  });

  it('keeps the bare name for new territories without an official regionCode', () => {
    expect(
      regionOptionLabel({ name: 'Донецкая Народная Республика', regionCode: null, hasData: true }),
    ).toBe('Донецкая Народная Республика');
    expect(
      neighboringRegionLabel({ name: 'Донецкая Народная Республика', regionCode: null, hasData: true }),
    ).toBe('Донецкая Народная Республика');
  });

  it('sorts ascending by the numeric code, territories without a code last', () => {
    const ordered = [
      { name: 'Челябинская область', regionCode: 74 },
      { name: 'Донецкая Народная Республика', regionCode: null },
      { name: 'Республика Адыгея', regionCode: 1 },
      { name: 'Кабардино-Балкарская Республика', regionCode: 7 },
    ]
      .sort(compareRegionsByCode)
      .map(formatRegionLabel);
    expect(ordered).toEqual([
      '01 — Республика Адыгея',
      '07 — Кабардино-Балкарская Республика',
      '74 — Челябинская область',
      'Донецкая Народная Республика',
    ]);
  });

  it('renders a non-empty label for every region', async () => {
    const regions = await getAvailableRegions();
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(regionOptionLabel(region).length).toBeGreaterThan(0);
      expect(neighboringRegionLabel(region).length).toBeGreaterThan(0);
    }
  });
});

describe('settings-panel: geo-reference status line (GRAFIK-48)', () => {
  it('confirms a loaded reference with the settlement count', () => {
    expect(formatRegionGeoHint({ count: 1267 })).toBe(
      'Гео-справочник региона загружен — населённых пунктов: 1267',
    );
    expect(formatRegionGeoHint({ count: 0 })).toBe('Гео-справочник региона загружен');
  });

  it('reuses the GRAFIK-43 warning wording when the reference is missing', () => {
    expect(formatRegionGeoHint({ missing: true })).toBe(REGION_NO_DATA_HINT);
  });

  it('renders exactly one hint element directly under the region select', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    const matches = html.match(/id="region-no-data-hint"/g) || [];
    expect(matches).toHaveLength(1);
    expect(html).toMatch(
      /<select id="inspectionRegion">[\s\S]*?<\/select>\s*<\/label>\s*<p[^>]*id="region-no-data-hint"/,
    );
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

describe('settings-panel: layout CSS guards (GRAFIK-48)', () => {
  const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\s+/g, ' ').trim(),
    body: match[2],
  }));
  const bodyFor = (selector) => {
    const rule = rules.find((entry) => entry.selector === selector);
    return rule ? rule.body : '';
  };

  it('makes the panel and the form a full-height flex column', () => {
    for (const selector of ['.settings-panel', '.settings-form']) {
      const body = bodyFor(selector);
      expect(body).toMatch(/display:\s*flex/);
      expect(body).toMatch(/flex-direction:\s*column/);
      expect(body).toMatch(/height:\s*100%/);
      expect(body).toMatch(/min-height:\s*0/);
      expect(body).toMatch(/overflow:\s*hidden/);
    }
  });

  it('keeps .settings-scroll as the only growing scroll container', () => {
    const body = bodyFor('.settings-scroll');
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/gap:\s*var\(--space-3\)/);
    expect(body).toMatch(/padding:\s*0 4px 0 0/);
  });

  it('pins every scroll child to its natural height (no flex shrink)', () => {
    expect(bodyFor('.settings-scroll > *')).toMatch(/flex:\s*0 0 auto/);
  });

  it('keeps .settings-actions as a fixed opaque footer outside the scroller', () => {
    const body = bodyFor('.settings-actions');
    expect(body).toMatch(/flex:\s*0 0 auto/);
    expect(body).toMatch(/border-top:/);
    expect(body).toMatch(/background:\s*var\(--color-surface\)/);
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).toMatch(
      /<\/details>\s*<\/div>\s*<div class="settings-actions">/,
    );
  });

  it('never pins a height/max-height on details or .settings-block', () => {
    const bad = rules
      .filter(({ selector, body }) => {
        if (selector.includes('::')) return false;
        const isDetails =
          /(^|[\s,>])details($|[\s,.:>[])/.test(selector) ||
          /(^|[\s,>])\.settings-block($|[\s,.:>[])/.test(selector);
        return isDetails && /(?:^|;)\s*(?:min-|max-)?height\s*:/.test(body);
      })
      .map((entry) => entry.selector);
    expect(bad).toEqual([]);
  });
});
