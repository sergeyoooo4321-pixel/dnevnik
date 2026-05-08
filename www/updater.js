// OTA via @capgo/capacitor-updater (self-hosted on GitHub Releases).
//
// Источник правды — manifest.json в GitHub Release (тег `latest`).
// Хост release-assets отдаёт всегда свежий файл (в отличие от raw.githubusercontent.com,
// который кэшируется CDN до 5+ минут).
//
// Почему такая сложная клиентская логика, а не простой `await download() / await set()`:
//   В версиях плагина серий 6.x и 7.x был известный баг (issues #599 и #609 в репо
//   плагина): promise от download() иногда резолвится ДО события downloadComplete,
//   и последующий set() падает с "Bundle does not exist". Также set() может молча
//   не активировать новый бандл, если в storage есть устаревший pending-бандл.
//   Поэтому:
//     1) делаем reset() в builtin состояние перед download (чистим pending),
//     2) подписываемся на события downloadComplete / downloadFailed / updateFailed
//        и принимаем решение по событию, а не по promise,
//     3) ставим watchdog-таймаут — если ничего не приходит, fail с понятной ошибкой.
//
// Все ключевые шаги пишутся в localStorage['ota-log'] чтобы их можно было показать
// в UI («Данные → Лог OTA»). В release-сборке нет console — это единственный способ
// видеть, на каком шаге упало.
(function () {
  'use strict';

  var MANIFEST_URL =
    'https://github.com/sergeyoooo4321-pixel/dnevnik/releases/download/latest/manifest.json';

  var DOWNLOAD_TIMEOUT_MS = 90000; // 90 сек на полный цикл скачивания
  var SET_TIMEOUT_MS = 15000;      // 15 сек на set() (после этого WebView должен перезагрузиться)
  var LOG_KEY = 'ota-log';
  var LOG_MAX = 100;

  function plugins() {
    return (window.Capacitor && window.Capacitor.Plugins) || {};
  }
  function updater() { return plugins().CapacitorUpdater || null; }
  function http() { return plugins().CapacitorHttp || null; }

  // ---------- In-app log ----------
  function otaLog(msg, data) {
    try {
      var arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      arr.push({ t: Date.now(), msg: String(msg), data: data == null ? null : data });
      if (arr.length > LOG_MAX) arr.splice(0, arr.length - LOG_MAX);
      localStorage.setItem(LOG_KEY, JSON.stringify(arr));
    } catch (_) {}
    if (typeof console !== 'undefined' && console.log) {
      try { console.log('[OTA]', msg, data || ''); } catch (_) {}
    }
  }
  function otaLogError(label, err) {
    otaLog(label, {
      message: err && err.message ? err.message : String(err),
      code: err && err.code,
      stack: err && err.stack ? String(err.stack).slice(0, 500) : undefined,
    });
  }

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
      if (!res || (res.status && res.status >= 400)) {
        otaLog('manifest http status not ok', { status: res && res.status });
        return null;
      }
      var data = res.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) {
          otaLogError('manifest JSON parse failed', e);
          return null;
        }
      }
      if (!data || typeof data.version !== 'string' || typeof data.url !== 'string') {
        otaLog('manifest invalid shape', data);
        return null;
      }
      return data;
    }).catch(function (e) {
      otaLogError('manifest fetch failed', e);
      return null;
    });
  }

  function getCurrent() {
    var U = updater();
    if (!U) {
      return Promise.resolve({
        bundle: { version: 'browser', id: 'browser' },
        native: 'browser',
      });
    }
    return U.current().catch(function (e) {
      otaLogError('current() failed', e);
      return { bundle: { version: 'unknown', id: 'unknown' }, native: 'unknown' };
    });
  }

  function checkUpdate() {
    return Promise.all([fetchManifest(), getCurrent()]).then(function (r) {
      var manifest = r[0];
      var cur = r[1];
      var currentVersion = (cur && cur.bundle && cur.bundle.version) || 'builtin';
      if (!manifest) {
        return { available: false, currentVersion: currentVersion, offline: true };
      }
      var available = manifest.version !== currentVersion;
      otaLog('checkUpdate', {
        current: currentVersion,
        latest: manifest.version,
        available: available,
      });
      return {
        available: available,
        currentVersion: currentVersion,
        latestVersion: manifest.version,
        url: manifest.url,
      };
    });
  }

  // ---------- applyUpdate: основной flow с event-listeners ----------
  function applyUpdate(url, version, onProgress) {
    var U = updater();
    if (!U) return Promise.reject(new Error('CapacitorUpdater недоступен'));

    return new Promise(function (resolve, reject) {
      var listeners = [];
      var done = false;
      var watchdog = null;

      function cleanup() {
        listeners.forEach(function (l) {
          try {
            if (l && typeof l.then === 'function') {
              l.then(function (h) { if (h && h.remove) h.remove(); });
            } else if (l && l.remove) {
              l.remove();
            }
          } catch (_) {}
        });
        listeners = [];
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      }
      function finish(err) {
        if (done) return;
        done = true;
        cleanup();
        if (err) {
          otaLogError('applyUpdate failed', err);
          reject(err);
        } else {
          otaLog('applyUpdate success — WebView reloads');
          resolve();
        }
      }

      // ---- listeners ----
      listeners.push(U.addListener('download', function (e) {
        if (e && typeof e.percent === 'number' && typeof onProgress === 'function') {
          onProgress(e.percent);
        }
      }));
      listeners.push(U.addListener('downloadComplete', function (e) {
        var bundleId = e && e.bundle && e.bundle.id;
        otaLog('event: downloadComplete', { bundleId: bundleId, version: e && e.bundle && e.bundle.version });
        if (!bundleId) {
          finish(new Error('downloadComplete без bundle.id'));
          return;
        }
        // Перезапускаем watchdog на set()
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(function () {
          finish(new Error('set() не перезагрузил приложение за ' + (SET_TIMEOUT_MS / 1000) + 'с'));
        }, SET_TIMEOUT_MS);
        otaLog('calling set()', { bundleId: bundleId });
        U.set({ id: bundleId }).then(function () {
          // set() обычно перезагружает WebView сам — сюда не должны добраться.
          otaLog('set() returned without reload');
        }).catch(function (err) {
          finish(new Error('set() упал: ' + (err && err.message ? err.message : err)));
        });
      }));
      listeners.push(U.addListener('downloadFailed', function (e) {
        otaLog('event: downloadFailed', e);
        finish(new Error('Скачивание не удалось: ' + (e && e.version ? 'v' + e.version : '')));
      }));
      listeners.push(U.addListener('updateFailed', function (e) {
        otaLog('event: updateFailed', e);
        finish(new Error('Установка не удалась: ' + (e && e.bundle && e.bundle.version ? 'v' + e.bundle.version : '')));
      }));

      watchdog = setTimeout(function () {
        finish(new Error('Превышено время ожидания (' + (DOWNLOAD_TIMEOUT_MS / 1000) + 'с)'));
      }, DOWNLOAD_TIMEOUT_MS);

      // ---- pre-step: reset(toLastSuccessful: false) — чистим pending bundle ----
      // Это workaround для бага #609 — set() не активировал новый бандл, если
      // в storage оставался старый pending. После reset Capgo откатывается на
      // builtin (скомпилированный в APK), а download затем создаёт новый pending.
      otaLog('reset to builtin (pre-clean)');
      Promise.resolve()
        .then(function () { return U.reset({ toLastSuccessful: false }); })
        .catch(function (err) {
          otaLog('reset failed (continuing anyway)', { message: err && err.message });
        })
        .then(function () {
          otaLog('starting download', { url: url, version: version });
          return U.download({ version: version, url: url });
        })
        .catch(function (err) {
          // Promise download ненадёжен (issue #599) — но если он явно reject'нул
          // с ошибкой ДО того как пришёл downloadComplete, считаем фейлом.
          if (!done) {
            finish(new Error('download() reject: ' + (err && err.message ? err.message : err)));
          }
        });
    });
  }

  // Очистить лог OTA (для UI-кнопки)
  function clearLog() {
    try { localStorage.removeItem(LOG_KEY); } catch (_) {}
  }
  function getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
    catch (_) { return []; }
  }

  window.OTA = {
    MANIFEST_URL: MANIFEST_URL,
    checkUpdate: checkUpdate,
    getCurrent: getCurrent,
    applyUpdate: applyUpdate,
    log: otaLog,
    getLog: getLog,
    clearLog: clearLog,
  };

  function boot() {
    otaLog('boot');
    var U = updater();
    if (!U) {
      otaLog('CapacitorUpdater plugin missing — running in browser');
      fireReady();
      return;
    }
    Promise.resolve()
      .then(function () { return U.notifyAppReady(); })
      .then(function () { otaLog('notifyAppReady ok'); })
      .catch(function (e) { otaLogError('notifyAppReady failed', e); })
      .then(fireReady);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
