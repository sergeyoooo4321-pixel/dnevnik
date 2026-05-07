// OTA loader.
// On launch: runs the currently installed code (cached → bundled).
// Then in the background checks remote version.json. If newer, adds an
// "Update available" item to the menu. The user clicks it to actually
// download + apply (no auto-apply). Versioning is driven by code (int)
// in version.json — bump it whenever app.js / style.css changes.
(async function bootstrap() {
  const REMOTE_BASE = 'https://raw.githubusercontent.com/sergeyoooo4321-pixel/dnevnik/main/www/';
  const FILES = ['style.css', 'app.js'];
  const TIMEOUT_MS = 4000;

  function fetchRemote(file, asJSON = false) {
    return new Promise(async (resolve) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const r = await fetch(REMOTE_BASE + file + '?t=' + Date.now(), {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!r.ok) return resolve(null);
        resolve(asJSON ? await r.json() : await r.text());
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function fetchBundled(file) {
    try {
      const r = await fetch(file, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.text();
    } catch (_) {
      return null;
    }
  }

  // ---- 1. Determine current installed version ----
  let installedCode = parseInt(localStorage.getItem('ota-installed-code') || '0', 10);
  let installedVersion = localStorage.getItem('ota-installed-version') || '0.0';

  let bundled = { code: 0, version: '0.0' };
  try {
    const text = await fetchBundled('version.json');
    if (text) bundled = JSON.parse(text);
  } catch (_) {}

  // First launch (or APK reinstall with newer bundled): seed from bundled.
  if (bundled.code > installedCode) {
    installedCode = bundled.code;
    installedVersion = bundled.version;
    localStorage.setItem('ota-installed-code', String(installedCode));
    localStorage.setItem('ota-installed-version', installedVersion);
    // Drop stale OTA cache, since we just upgraded the APK past it.
    FILES.forEach((f) => localStorage.removeItem('ota-' + f));
  }

  // ---- 2. Pick code to run: cache (if matches installedCode) > bundled ----
  const useCache = parseInt(localStorage.getItem('ota-cache-code') || '0', 10) === installedCode;
  const payload = {};
  for (const f of FILES) {
    if (useCache) {
      const c = localStorage.getItem('ota-' + f);
      if (c) {
        payload[f] = c;
        continue;
      }
    }
    payload[f] = await fetchBundled(f);
  }

  // ---- 3. Inject CSS + JS to start the app ----
  const styleEl = document.createElement('style');
  styleEl.id = 'app-style';
  styleEl.textContent = payload['style.css'] || '';
  document.head.appendChild(styleEl);

  const scriptEl = document.createElement('script');
  scriptEl.textContent = payload['app.js'] || '';
  document.body.appendChild(scriptEl);

  // ---- 4. Background update check (no auto-apply) ----
  setTimeout(async () => {
    const remote = await fetchRemote('version.json', true);
    const hasUpdate = remote && typeof remote.code === 'number' && remote.code > installedCode;
    addMenuVersionEntry({
      installedVersion,
      hasUpdate,
      remoteVersion: hasUpdate ? remote.version : null,
      remoteCode: hasUpdate ? remote.code : null,
    });
  }, 600);

  // ---- 5. UI: add a row at the bottom of the kebab menu ----
  function addMenuVersionEntry({ installedVersion, hasUpdate, remoteVersion, remoteCode }) {
    const menu = document.getElementById('menu');
    if (!menu) return;
    const old = document.getElementById('menuVersion');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = 'menuVersion';
    wrap.className = 'menu-version';

    if (hasUpdate) {
      wrap.innerHTML = `
        <button class="menu-item menu-update" id="otaUpdateBtn">
          <span class="dot"></span>
          <span>
            <span class="menu-update-title">Доступно обновление</span>
            <span class="menu-version-sub">v${installedVersion} → v${remoteVersion}</span>
          </span>
        </button>
      `;
      menu.appendChild(wrap);
      document.getElementById('otaUpdateBtn').addEventListener('click', async () => {
        const btn = document.getElementById('otaUpdateBtn');
        btn.disabled = true;
        btn.innerHTML = '<span>Скачиваю…</span>';
        const css = await fetchRemote('style.css');
        const js = await fetchRemote('app.js');
        if (!css || !js) {
          btn.innerHTML = '<span>Ошибка — проверь интернет</span>';
          setTimeout(() => { addMenuVersionEntry({ installedVersion, hasUpdate, remoteVersion, remoteCode }); }, 1500);
          return;
        }
        try {
          localStorage.setItem('ota-style.css', css);
          localStorage.setItem('ota-app.js', js);
          localStorage.setItem('ota-installed-code', String(remoteCode));
          localStorage.setItem('ota-installed-version', remoteVersion);
          localStorage.setItem('ota-cache-code', String(remoteCode));
        } catch (_) {}
        btn.innerHTML = '<span>Обновлено · перезапуск</span>';
        setTimeout(() => location.reload(), 600);
      });
    } else {
      wrap.innerHTML = `
        <div class="menu-version-static">
          <span class="menu-version-title">Максимальная версия</span>
          <span class="menu-version-sub">v${installedVersion}</span>
        </div>
      `;
      menu.appendChild(wrap);
    }
  }
})();
