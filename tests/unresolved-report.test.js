import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildUnresolvedReport,
  formatUnresolvedClipboard,
} from '../src/modules/address.js';
import { renderUnresolvedReport } from '../src/modules/ui.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SETTLEMENTS = [
  { name: 'Тайнак', municipality: 'Златоуст', lat: 55.14104, lon: 59.34924 },
  { name: 'Златоуст', municipality: 'Златоуст', lat: 55.16742, lon: 59.67926 },
];

const TAINAK = 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П';
const ZLATOUST = 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ';
const NOWHERE = 'ЧЕЛЯБИНСКАЯ ОБЛ, , , НЕСУЩЕСТВУЮЩИЙ Р-Н, НЕТ Г, , , НЕТ П';

function records(list) {
  return list.map((address) => ({ address }));
}

function createFakeDocument() {
  const createNode = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      className: '',
      textContent: '',
      hidden: false,
      type: '',
      listeners: {},
      attributes: {},
      append(...kids) {
        for (const kid of kids) node.appendChild(kid);
      },
      appendChild(kid) {
        node.children.push(kid);
        return kid;
      },
      replaceChildren(...kids) {
        node.children = [...kids];
      },
      setAttribute(name, value) {
        node.attributes[name] = String(value);
      },
      addEventListener(type, fn) {
        (node.listeners[type] ||= []).push(fn);
      },
    };
    return node;
  };
  return { createElement: createNode };
}

function flatten(node) {
  const parts = [node.textContent];
  for (const child of node.children || []) {
    if (child && child.children) parts.push(flatten(child));
  }
  return parts.filter(Boolean).join(' | ');
}

function findAll(node, predicate, acc = []) {
  if (predicate(node)) acc.push(node);
  for (const child of node.children || []) {
    if (child && child.children) findAll(child, predicate, acc);
  }
  return acc;
}

describe('buildUnresolvedReport (GRAFIK-45)', () => {
  it('counts an export where every address resolves', () => {
    const report = buildUnresolvedReport(
      records([TAINAK, ZLATOUST, TAINAK]),
      SETTLEMENTS,
      74,
    );
    expect(report.total).toBe(3);
    expect(report.resolvedCount).toBe(3);
    expect(report.unresolvedCount).toBe(0);
    expect(report.unresolved).toEqual([]);
    expect(report.clipboardText).toBe('');
  });

  it('keeps import-order indices for partially resolved exports', () => {
    const report = buildUnresolvedReport(
      records([TAINAK, NOWHERE, '', ZLATOUST, NOWHERE]),
      SETTLEMENTS,
      74,
    );
    expect(report.total).toBe(4); // empty address is not counted
    expect(report.resolvedCount).toBe(2);
    expect(report.unresolvedCount).toBe(2);
    expect(report.unresolved.map((row) => row.index)).toEqual([2, 5]);
    expect(report.unresolved.map((row) => row.address)).toEqual([NOWHERE, NOWHERE]);
    expect(report.resolved.map((row) => row.rowIndex)).toEqual([1, 4]);
  });

  it('reports zero resolved when the region reference does not match', () => {
    const report = buildUnresolvedReport(records([NOWHERE, NOWHERE]), SETTLEMENTS, 95);
    expect(report.total).toBe(2);
    expect(report.resolvedCount).toBe(0);
    expect(report.unresolvedCount).toBe(2);
  });

  it('copy payload contains only unresolved rows', () => {
    const report = buildUnresolvedReport(
      records([TAINAK, NOWHERE, ZLATOUST]),
      SETTLEMENTS,
      74,
    );
    expect(report.clipboardText).toBe(`2: ${NOWHERE}`);
    expect(report.clipboardText).not.toContain(TAINAK);
    expect(formatUnresolvedClipboard([{ index: 3, address: 'X' }])).toBe('3: X');
  });

  it('does not mutate the imported records', () => {
    const input = records([TAINAK, NOWHERE]);
    const snapshot = JSON.stringify(input);
    buildUnresolvedReport(input, SETTLEMENTS, 74);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('renderUnresolvedReport (GRAFIK-45)', () => {
  const originalLocalStorage = globalThis.localStorage;

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
  });

  it('shows the compact summary and the expandable list', () => {
    const doc = createFakeDocument();
    const container = doc.createElement('div');
    const report = buildUnresolvedReport(
      records([TAINAK, NOWHERE, ZLATOUST, NOWHERE]),
      SETTLEMENTS,
      74,
    );
    renderUnresolvedReport(container, report, doc);
    expect(container.hidden).toBe(false);
    expect(flatten(container)).toContain('Распознано 2 из 4 адресов · не разобрано 2');
    expect(flatten(container)).toContain('Неразобранные адреса (2)');
    const rows = findAll(container, (node) => node.className === 'unresolved-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe(`2: ${NOWHERE}`);
    expect(findAll(container, (node) => node.attributes.role === 'alert')).toHaveLength(0);
  });

  it('warns when nothing resolved (M > 0, N = 0)', () => {
    const doc = createFakeDocument();
    const container = doc.createElement('div');
    const report = buildUnresolvedReport(records([NOWHERE, NOWHERE]), SETTLEMENTS, 74);
    renderUnresolvedReport(container, report, doc);
    expect(flatten(container)).toContain('Распознано 0 из 2 адресов');
    const warnings = findAll(container, (node) => node.attributes.role === 'alert');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].textContent).toContain('Проверьте регион инспекции');
  });

  it('hides the block when there were no addresses at all', () => {
    const doc = createFakeDocument();
    const container = doc.createElement('div');
    container.hidden = false;
    renderUnresolvedReport(container, buildUnresolvedReport([], SETTLEMENTS, 74), doc);
    expect(container.hidden).toBe(true);
    expect(container.children).toHaveLength(0);
  });

  it('copies all unresolved lines through the clipboard button', async () => {
    const doc = createFakeDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    doc.defaultView = { navigator: { clipboard: { writeText } } };
    const container = doc.createElement('div');
    const report = buildUnresolvedReport(
      records([TAINAK, NOWHERE, NOWHERE]),
      SETTLEMENTS,
      74,
    );
    renderUnresolvedReport(container, report, doc);
    const copy = findAll(container, (node) => node.className.includes('unresolved-copy'))[0];
    expect(copy.textContent).toBe('Скопировать неразобранные');
    for (const listener of copy.listeners.click || []) await listener();
    expect(writeText).toHaveBeenCalledWith(`2: ${NOWHERE}\n3: ${NOWHERE}`);
    expect(copy.textContent).toBe('Скопировано');
  });

  it('never writes to localStorage while rendering', () => {
    const setItem = vi.fn();
    globalThis.localStorage = { getItem: () => null, setItem, removeItem: () => {} };
    const doc = createFakeDocument();
    const container = doc.createElement('div');
    renderUnresolvedReport(
      container,
      buildUnresolvedReport(records([TAINAK, NOWHERE]), SETTLEMENTS, 74),
      doc,
    );
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('unresolved report stays out of the export and the markup is wired (GRAFIK-45)', () => {
  const read = (relative) => readFileSync(`${ROOT}${relative}`, 'utf8');

  it('exporter.js has no access to the report', () => {
    const source = read('src/modules/exporter.js');
    expect(source).not.toMatch(/unresolved|clipboard/i);
  });

  it('the physical block contains the report container and ui wires it', () => {
    expect(read('index.html')).toContain('id="unresolved-report"');
    const ui = read('src/modules/ui.js');
    expect(ui).toContain('renderUnresolvedReport');
    expect(ui).toContain('buildUnresolvedReport');
    expect(ui).toContain('clipboardText');
  });
});
