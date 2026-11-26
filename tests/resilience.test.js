import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  IMPORT_ERROR_TEXT,
  PRELOAD_RELOAD_KEY,
  RETRY_LABEL,
  STALE_BANNER_ID,
  STALE_VERSION_TEXT,
  buildCacheBustUrl,
  clearImportError,
  consumeReloadAllowance,
  installPreloadGuard,
  loadModule,
  renderImportError,
  showStaleBanner,
} from '../src/modules/resilience.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

// Minimal DOM: enough for the guards, no jsdom dependency in the node test env.
function createFakeDocument() {
  const createNode = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attributes: {},
      className: '',
      textContent: '',
      listeners: {},
      append(...kids) {
        node.children.push(...kids);
      },
      replaceChildren(...kids) {
        node.children = [...kids];
      },
      prepend(...kids) {
        node.children = [...kids, ...node.children];
      },
      insertBefore(child) {
        node.children.unshift(child);
      },
      setAttribute(name, value) {
        node.attributes[name] = String(value);
      },
      addEventListener(type, fn) {
        (node.listeners[type] ||= []).push(fn);
      },
      removeEventListener(type, fn) {
        node.listeners[type] = (node.listeners[type] || []).filter((item) => item !== fn);
      },
      remove() {},
      click() {
        for (const fn of node.listeners.click || []) fn({ type: 'click' });
      },
    };
    return node;
  };
  return {
    createElement: createNode,
    getElementById: () => null,
    body: createNode('body'),
  };
}

function flatten(node) {
  const parts = [node.textContent];
  for (const child of node.children || []) {
    if (child && child.children) parts.push(flatten(child));
  }
  return parts.filter(Boolean).join(' ');
}

function findByClass(node, needle) {
  if (String(node.className || '').includes(needle)) return node;
  for (const child of node.children || []) {
    if (child && child.children) {
      const found = findByClass(child, needle);
      if (found) return found;
    }
  }
  return null;
}

describe('resilience: one reload per tab session (GRAFIK-46)', () => {
  it('allows exactly one reload per session flag', () => {
    const storage = memoryStorage();
    expect(consumeReloadAllowance(storage)).toBe(true);
    expect(consumeReloadAllowance(storage)).toBe(false);
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBeTruthy();
  });

  it('refuses to reload when storage is unavailable (no reload loop)', () => {
    expect(consumeReloadAllowance(null)).toBe(false);
    expect(
      consumeReloadAllowance({
        getItem() {
          throw new Error('blocked');
        },
        setItem() {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
  });

  it('builds a cache-busting URL and replaces a previous bust', () => {
    expect(buildCacheBustUrl('https://wwwmanager.github.io/Grafik_TO/?a=1#frag', 42)).toBe(
      'https://wwwmanager.github.io/Grafik_TO/?a=1&v=42#frag',
    );
    expect(buildCacheBustUrl('https://wwwmanager.github.io/Grafik_TO/?v=1', 7)).toBe(
      'https://wwwmanager.github.io/Grafik_TO/?v=7',
    );
  });
});

describe('resilience: preloadError handler (GRAFIK-46)', () => {
  function createFakeWindow(storage) {
    const win = {
      sessionStorage: storage,
      location: { href: 'https://wwwmanager.github.io/Grafik_TO/', replace: vi.fn() },
      listeners: {},
      addEventListener(type, fn) {
        (win.listeners[type] ||= []).push(fn);
      },
      removeEventListener() {},
    };
    return win;
  }

  it('reloads once with ?v= and then shows the stale-version banner', () => {
    const win = createFakeWindow(memoryStorage());
    const doc = createFakeDocument();
    installPreloadGuard({ win, doc });
    const handler = win.listeners['vite:preloadError'][0];

    const first = { preventDefault: vi.fn() };
    handler(first);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(win.location.replace).toHaveBeenCalledTimes(1);
    expect(win.location.replace.mock.calls[0][0]).toContain('v=');

    const second = { preventDefault: vi.fn() };
    handler(second);
    expect(second.preventDefault).toHaveBeenCalled();
    expect(win.location.replace).toHaveBeenCalledTimes(1);

    const banner = doc.body.children[0];
    expect(banner.id).toBe(STALE_BANNER_ID);
    expect(banner.attributes.role).toBe('alert');
    expect(banner.textContent).toBe(STALE_VERSION_TEXT);
  });

  it('never reloads when the session already used its reload', () => {
    const win = createFakeWindow(memoryStorage({ [PRELOAD_RELOAD_KEY]: '1' }));
    const doc = createFakeDocument();
    installPreloadGuard({ win, doc });
    win.listeners['vite:preloadError'][0]({ preventDefault: vi.fn() });
    expect(win.location.replace).not.toHaveBeenCalled();
    expect(doc.body.children[0].id).toBe(STALE_BANNER_ID);
  });

  it('keeps the required banner wording', () => {
    expect(STALE_VERSION_TEXT).toBe(
      'Загружена устаревшая версия приложения — обновите страницу (Ctrl+F5)',
    );
  });
});

describe('resilience: rejected dynamic import renders retry UI (GRAFIK-46)', () => {
  it('replaces a loading placeholder with role=alert + «Повторить» and calls the retry', async () => {
    const doc = createFakeDocument();
    const container = doc.createElement('div');
    const spinner = doc.createElement('span');
    spinner.textContent = 'Построение маршрутов физлиц… загрузка';
    container.append(spinner);
    const onRetry = vi.fn();

    let caught;
    try {
      await loadModule(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), {
        container,
        doc,
        message: 'Не удалось загрузить модуль маршрутизации.',
        onRetry,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught?.guarded).toBe(true);
    expect(flatten(container)).not.toContain('загрузка');

    const box = container.children[0];
    expect(box.attributes.role).toBe('alert');
    expect(box.className).toContain('import-error');
    expect(flatten(box)).toContain('Не удалось загрузить модуль маршрутизации.');

    const button = findByClass(box, 'import-error-retry');
    expect(button.textContent).toBe(RETRY_LABEL);
    button.click();
    await Promise.resolve();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('clears the retry UI after a successful load', async () => {
    const doc = createFakeDocument();
    const container = doc.createElement('div');
    renderImportError(container, { doc, message: IMPORT_ERROR_TEXT });
    expect(container.children).toHaveLength(1);

    const fakeContainer = { ...container, querySelector: (selector) => (selector === '.import-error' ? container.children[0] : null) };
    clearImportError(fakeContainer);
    expect(container.children).toHaveLength(0);

    await loadModule(async () => ({ ok: true }), { container: doc.createElement('div'), doc });
  });

  it('shows the stale banner in #messages when present', () => {
    const doc = createFakeDocument();
    const messages = doc.createElement('div');
    messages.id = 'messages';
    doc.getElementById = (id) => (id === 'messages' ? messages : null);
    showStaleBanner(doc);
    expect(messages.children[0].id).toBe(STALE_BANNER_ID);
  });
});

describe('resilience: static wiring (GRAFIK-46)', () => {
  const read = (relative) => readFileSync(`${ROOT}${relative}`, 'utf8');

  it('index.html loads the un-hashed cache guard before the module entry', () => {
    const html = read('index.html');
    const guardIndex = html.indexOf('./cache-guard.js');
    const entryIndex = html.indexOf('type="module"');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(entryIndex).toBeGreaterThan(guardIndex);
  });

  it('public/cache-guard.js is a stable classic script with the same reload key', () => {
    const source = read('public/cache-guard.js');
    expect(source).toContain(PRELOAD_RELOAD_KEY);
    expect(source).toContain('unhandledrejection');
    expect(source).toContain("'error'");
    expect(source).toContain(STALE_VERSION_TEXT);
    expect(source).not.toMatch(/^\s*(import|export)\s/m);
  });

  it('main.js installs the preload guard before initUi', () => {
    const source = read('src/main.js');
    expect(source.indexOf('installPreloadGuard()')).toBeGreaterThan(-1);
    expect(source.indexOf('installPreloadGuard()')).toBeLessThan(source.indexOf('initUi()'));
  });

  it('ships a deploy check script that fails on broken assets', () => {
    const source = read('scripts/check-deploy.mjs');
    expect(source).toContain('assets/');
    expect(source).toContain('process.exit(1)');
    expect(source).toContain('dist/index.html missing');
  });

  it('wraps every dynamic import in ui.js and physicalTab.js with a guard', () => {
    const ui = read('src/modules/ui.js');
    const dynamicImports = ui.match(/await import\(/g) || [];
    expect(dynamicImports.length).toBe(0);
    expect(ui).toContain("loadModule(() => import('./parser.js')");
    expect(ui).toContain("loadModule(() => import('./exporter.js')");
    expect(ui).toContain("loadModule(() => import('./physical.js')");
    expect(ui).toContain("loadModule(() => import('./address.js')");

    const physicalTab = read('src/modules/physicalTab.js');
    expect(physicalTab).toContain("import('./physical.js')");
    expect(physicalTab).toContain('importMessage');
  });
});
