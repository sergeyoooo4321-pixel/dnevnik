// OTA via @capgo/capacitor-updater (native, CORS-free, atomic bundle swap).
// Exposes window.OTA with checkUpdate / forceResync / getCurrent / download_and_apply.
// Fires window 'ota:ready' once notifyAppReady completes so app.js can render
// the menu row safely.
(function () {
  'use strict';

  var MANIFEST_URL =
    'https://raw.githubusercontent.com/sergeyoooo4321-pixel/dnevnik/main/www/manifest.json';

  function plugins() {
    return (window.Capacitor && window.Capacitor.Plugins) || {};
  }
  function updater() { return plugins().CapacitorUpdater || null; }
  function http() { return plugins().CapacitorHttp || null; }

  function fireReady() {
    try {
      window.dispatchEvent(new CustomEvent('ota:ready'));
    } catch (_) {
      // IE/older WebView fallback
      var ev = document.createEvent('Event');
      ev.initEvent('ota:ready', false, false);
      window.dispatchEvent(ev);
    }
  }

  // Fetch the manifest via CapacitorHttp (bypasses WebView CORS).
  // Returns { version, code, url, checksum? } or null on failure.
  function fetchManifest() {
    var H = http();
    if (!H) return Promise.resolve(null);
    return H.get({
      url: MANIFEST_URL + '?t=' + Date.now(),
      headers: { 'Cache-Control': 'no-cache' },
      readTimeout: 8000,
      connectTimeout: 8000,
    }).then(function (res) {
      if (!res || (res.status && res.status >= 400)) return null;
      var data = res.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) { return null; }
      }
      if (!data || typeof data.code !== 'number') return null;
      return data;
    }).catch(function () { return null; });
  }

  function getCurrent() {
    var U = updater();
    if (!U) {
      return Promise.resolve({
        bundle: { version: 'builtin', id: 'builtin' },
        native: 'builtin',
      });
    }
    return U.current().catch(function () {
      return { bundle: { version: 'unknown', id: 'unknown' }, native: 'unknown' };
    });
  }

  // Compare manifest.code against the locally tracked installed code.
  // We persist the last applied code in localStorage because capgo's
  // BundleInfo doesn't carry a numeric code (only a version string).
  function getLocalCode() {
    var v = parseInt(localStorage.getItem('ota-code') || '0', 10);
    return isNaN(v) ? 0 : v;
  }
  function setLocalCode(code, version) {
    try {
      localStorage.setItem('ota-code', String(code));
      if (version) localStorage.setItem('ota-version', String(version));
    } catch (_) {}
  }

  function checkUpdate() {
    return fetchManifest().then(function (m) {
      return getCurrent().then(function (cur) {
        var currentVersion = (cur && cur.bundle && cur.bundle.version) || 'builtin';
        if (!m) {
          return { available: false, currentVersion: currentVersion, offline: true };
        }
        var localCode = getLocalCode();
        if (m.code > localCode) {
          return {
            available: true,
            version: m.version,
            code: m.code,
            url: m.url,
            currentVersion: currentVersion,
          };
        }
        return { available: false, currentVersion: currentVersion, version: m.version };
      });
    });
  }

  function download_and_apply(url, version) {
    var U = updater();
    if (!U) return Promise.reject(new Error('CapacitorUpdater not available'));
    return U.download({ version: version, url: url, sessionKey: '' })
      .then(function (bundle) {
        return U.set({ id: bundle.id }).then(function () { return bundle; });
      });
  }

  function forceResync() {
    return fetchManifest().then(function (m) {
      if (!m) throw new Error('No manifest (offline?)');
      return download_and_apply(m.url, m.version).then(function (bundle) {
        setLocalCode(m.code, m.version);
        return bundle;
      });
    });
  }

  // Wrap download_and_apply so we also persist the code on success.
  function applyUpdate(url, version, code) {
    return download_and_apply(url, version).then(function (bundle) {
      setLocalCode(code, version);
      return bundle;
    });
  }

  window.OTA = {
    MANIFEST_URL: MANIFEST_URL,
    checkUpdate: checkUpdate,
    forceResync: forceResync,
    getCurrent: getCurrent,
    download_and_apply: applyUpdate,
  };

  function boot() {
    var U = updater();
    if (!U) {
      // Running in browser / plugin missing — still fire so app.js can render
      // the offline state.
      fireReady();
      return;
    }
    Promise.resolve()
      .then(function () { return U.notifyAppReady(); })
      .catch(function () { /* ignore — app still works */ })
      .then(fireReady);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
