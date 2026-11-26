// GRAFIK-46: runtime guards for a stale HTML shell or a missing hashed chunk.
// GitHub Pages can serve an old index.html after a deploy; the old entry then
// requests hashed chunks that no longer exist. Every failure path below ends in
// either one cache-busting reload per tab session or a visible message — never
// in a permanent loading state.

export const PRELOAD_RELOAD_KEY = 'grafik:preload-reloaded';
export const STALE_BANNER_ID = 'stale-version-banner';
export const STALE_VERSION_TEXT =
  'Загружена устаревшая версия приложения — обновите страницу (Ctrl+F5)';
export const IMPORT_ERROR_TEXT = 'Не удалось загрузить часть приложения.';
export const RETRY_LABEL = 'Повторить';

// One automatic reload per tab session. Returns true only for the caller that
// is allowed to reload; a second failure in the same session gets the banner.
// Storage problems (private mode) count as "not allowed": reloading without a
// working guard could loop forever.
export function consumeReloadAllowance(storage, key = PRELOAD_RELOAD_KEY) {
  if (
    !storage ||
    typeof storage.getItem !== 'function' ||
    typeof storage.setItem !== 'function'
  ) {
    return false;
  }
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function buildCacheBustUrl(href, stamp = Date.now()) {
  try {
    const url = new URL(String(href), 'https://placeholder.invalid/');
    url.searchParams.set('v', String(stamp));
    return url.toString();
  } catch {
    return String(href || '');
  }
}

export function reloadWithCacheBust(win = globalThis, stamp = Date.now()) {
  const location = win?.location;
  if (!location) return false;
  const target = buildCacheBustUrl(location.href, stamp);
  try {
    if (typeof location.replace === 'function') location.replace(target);
    else location.href = target;
    return true;
  } catch {
    return false;
  }
}

export function showStaleBanner(doc = globalThis.document, text = STALE_VERSION_TEXT) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  if (typeof doc.getElementById === 'function' && doc.getElementById(STALE_BANNER_ID)) {
    return doc.getElementById(STALE_BANNER_ID);
  }
  const banner = doc.createElement('div');
  banner.id = STALE_BANNER_ID;
  banner.className = 'message message-error app-banner';
  banner.setAttribute('role', 'alert');
  banner.textContent = text;
  const host =
    (typeof doc.getElementById === 'function' && doc.getElementById('messages')) || doc.body;
  if (!host) return null;
  if (typeof host.prepend === 'function') host.prepend(banner);
  else if (typeof host.insertBefore === 'function') host.insertBefore(banner, host.firstChild || null);
  else if (typeof host.append === 'function') host.append(banner);
  else return null;
  return banner;
}

export function renderImportError(
  container,
  { doc = globalThis.document, message = IMPORT_ERROR_TEXT, retryLabel = RETRY_LABEL, onRetry } = {},
) {
  if (!container || !doc || typeof doc.createElement !== 'function') return null;
  const box = doc.createElement('div');
  box.className = 'import-error message message-error';
  box.setAttribute('role', 'alert');

  const text = doc.createElement('p');
  text.className = 'import-error-text';
  text.textContent = message;
  box.append(text);

  if (typeof onRetry === 'function') {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'button button-small import-error-retry';
    button.textContent = retryLabel;
    button.addEventListener('click', () => {
      // A failed retry re-renders itself; swallow here only to avoid an
      // unhandled rejection in the click handler.
      Promise.resolve().then(onRetry).catch(() => {});
    });
    box.append(button);
  }

  if (typeof container.replaceChildren === 'function') container.replaceChildren(box);
  else {
    container.textContent = '';
    container.append(box);
  }
  return box;
}

export function clearImportError(container) {
  if (!container || typeof container.querySelector !== 'function') return;
  const box = container.querySelector('.import-error');
  if (!box) return;
  if (typeof box.remove === 'function' && typeof container.replaceChildren !== 'function') {
    box.remove();
    return;
  }
  if (typeof container.replaceChildren === 'function' && container.children) {
    const remaining = [...container.children].filter((child) => child !== box);
    container.replaceChildren(...remaining);
  }
}

// Wraps a dynamic import: on rejection the caller-visible container gets an
// inline error with «Повторить», and the error is marked so the caller does not
// overwrite that UI with a generic message.
export async function loadModule(
  loader,
  { container, doc = globalThis.document, message = IMPORT_ERROR_TEXT, retryLabel = RETRY_LABEL, onRetry } = {},
) {
  try {
    return await loader();
  } catch (error) {
    renderImportError(container, { doc, message, retryLabel, onRetry });
    if (error && typeof error === 'object') error.guarded = true;
    throw error;
  }
}

export function installPreloadGuard({
  win = globalThis,
  doc = globalThis.document,
  storage,
} = {}) {
  if (!win || typeof win.addEventListener !== 'function') return () => {};
  let store = storage;
  if (store === undefined) {
    try {
      store = win.sessionStorage || null;
    } catch {
      store = null;
    }
  }
  const handler = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (consumeReloadAllowance(store)) {
      reloadWithCacheBust(win);
      return;
    }
    showStaleBanner(doc);
  };
  win.addEventListener('vite:preloadError', handler);
  return () => {
    if (typeof win.removeEventListener === 'function') {
      win.removeEventListener('vite:preloadError', handler);
    }
  };
}
