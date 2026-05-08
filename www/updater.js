// OTA via @capgo/capacitor-updater (self-hosted on GitHub Releases).
//
// Источник правды — manifest.json в GitHub Release (тег `latest`).
// Хост release-assets отдаёт всегда свежий файл (в отличие от raw.githubusercontent.com,
// который кэшируется CDN до 5 минут и из-за этого юзер не видел новые версии).
//
// Текущая установленная OTA-версия = current().bundle.version. Никаких параллельных
// localStorage-счётчиков — Capgo сам ведёт учёт.
(function () {
  'use strict';

  var MANIFEST_URL =
    'https://github.com/sergeyoooo4321-pixel/dnevnik/releases/download/latest/manifest.json';

  function plugins() {
    return (window.Capacitor && window.Capacitor.Plugins) || {};
  }
  function updater() { return plugins().CapacitorUpdater || null; }
  function http() { return plugins().CapacitorHttp || null; }

  function fireReady() {
    try {
      window.dispatchEvent(new CustomEvent('ota:ready'));
    } catch (_) {
      var ev = document.createEvent('Event');
      ev.initEvent('ota:ready', false, false);
      window.dispatchEvent(ev);
    }
  }

  function fetchManifest() {
    var H = http();
    if (!H) return Promise.resolve(null);
    return H.get({
      url: MANIFEST_URL + '?t=' + Date.now(),
      headers: { 'Cache-Control': 'no-cache' },
      readTimeout: 10000,
      connectTimeout: 10000,
    }).then(function (res) {
      if (!res || (res.status && res.status >= 400)) return null;
      var data = res.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) { return null; }
      }
      if (!data || typeof data.version !== 'string' || typeof data.url !== 'string') {
        return null;
      }
      return data;
    }).catch(function () { return null; });
  }

  function getCurrent() {
    var U = updater();
    if (!U) {
      return Promise.resolve({
        bundle: { version: 'browser', id: 'browser' },
        native: 'browser',
      });
    }
    return U.current().catch(function () {
      return { bundle: { version: 'unknown', id: 'unknown' }, native: 'unknown' };
    });
  }

  // { available: bool, currentVersion, latestVersion?, url?, offline? }
  function checkUpdate() {
    return Promise.all([fetchManifest(), getCurrent()]).then(function (r) {
      var manifest = r[0];
      var cur = r[1];
      var currentVersion = (cur && cur.bundle && cur.bundle.version) || 'builtin';
      if (!manifest) {
        return { available: false, currentVersion: currentVersion, offline: true };
      }
      var available = manifest.version !== currentVersion;
      return {
        available: available,
        currentVersion: currentVersion,
        latestVersion: manifest.version,
        url: manifest.url,
      };
    });
  }

  // Скачать бандл по url и переключиться на него (Capgo сам перезагрузит WebView).
  // onProgress(percent) — опциональный колбэк прогресса.
  function applyUpdate(url, version, onProgress) {
    var U = updater();
    if (!U) return Promise.reject(new Error('CapacitorUpdater недоступен'));

    var progressListener = null;
    if (typeof onProgress === 'function') {
      progressListener = U.addListener('download', function (e) {
        if (e && typeof e.percent === 'number') onProgress(e.percent);
      });
    }
    var cleanup = function () {
      if (progressListener && progressListener.remove) {
        try { progressListener.remove(); } catch (_) {}
      }
    };

    return U.download({ version: version, url: url })
      .then(function (bundle) {
        return U.set({ id: bundle.id });
      })
      .then(function () {
        cleanup();
      })
      .catch(function (err) {
        cleanup();
        throw err;
      });
  }

  window.OTA = {
    MANIFEST_URL: MANIFEST_URL,
    checkUpdate: checkUpdate,
    getCurrent: getCurrent,
    applyUpdate: applyUpdate,
  };

  function boot() {
    var U = updater();
    if (!U) {
      // Запущены в браузере (не в Capacitor) — плагин отсутствует.
      fireReady();
      return;
    }
    // Обязателен на каждом запуске: иначе Capgo через appReadyTimeout (10s)
    // откатит на builtin, считая текущий бандл сломанным.
    Promise.resolve()
      .then(function () { return U.notifyAppReady(); })
      .catch(function () {})
      .then(fireReady);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
