/*
 * GRAFIK-46: stable bootstrap guard for GitHub Pages.
 *
 * This file lives in public/ on purpose: Vite copies it to dist/ unchanged, so
 * the URL never has a content hash. An old cached index.html that points at a
 * removed hashed entry/CSS still resolves this script, and the script then
 * reloads once with a cache-buster. Without it, a 404 on the entry chunk runs
 * no application code at all and the page is silently dead.
 */
(function () {
  'use strict';

  var RELOAD_KEY = 'grafik:preload-reloaded';
  var BANNER_ID = 'stale-version-banner';
  var TEXT = 'Загружена устаревшая версия приложения — обновите страницу (Ctrl+F5)';

  function allowReload() {
    try {
      if (!window.sessionStorage) return false;
      if (window.sessionStorage.getItem(RELOAD_KEY)) return false;
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      return true;
    } catch {
      return false;
    }
  }

  function showBanner() {
    if (!document.body || document.getElementById(BANNER_ID)) return;
    var banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'message message-error app-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = TEXT;
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;' +
      'font:14px/1.4 sans-serif;color:#991b1b;background:#fef2f2;border-bottom:2px solid #dc2626;';
    var host = document.getElementById('messages') || document.body;
    host.insertBefore(banner, host.firstChild || null);
  }

  function reloadOnce() {
    if (!allowReload()) {
      showBanner();
      return;
    }
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('v', String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }

  function isChunkLike(message) {
    return /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch dynamically/i.test(
      String(message || ''),
    );
  }

  window.addEventListener(
    'error',
    function (event) {
      var target = event && event.target;
      if (!target || target === window) return;
      var tag = String(target.tagName || '').toUpperCase();
      if (tag === 'SCRIPT' && String(target.type || '') === 'module') reloadOnce();
      else if (tag === 'LINK' && /stylesheet/i.test(String(target.rel || ''))) reloadOnce();
    },
    true,
  );

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? reason.message : reason;
    if (isChunkLike(message)) reloadOnce();
  });
})();
