// OTA bootstrap. Pulls fresh app.js + style.css from GitHub raw on every launch,
// caches them in localStorage, and falls back to bundled files when offline.
// This way users don't need to reinstall the APK to receive UI/logic updates.
(async function bootstrap() {
  const REMOTE_BASE = 'https://raw.githubusercontent.com/sergeyoooo4321-pixel/dnevnik/main/www/';
  const FILES = ['style.css', 'app.js'];
  const TIMEOUT_MS = 4000;
  const status = document.getElementById('otaStatus');

  function show(msg, ok = true) {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle('ok', ok);
    status.classList.toggle('warn', !ok);
    status.hidden = false;
    setTimeout(() => { status.hidden = true; }, 2000);
  }

  async function tryRemote(file) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(REMOTE_BASE + file + '?t=' + Date.now(), {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) return null;
      const text = await r.text();
      if (!text || text.length < 50) return null;
      return text;
    } catch (_) {
      return null;
    }
  }

  async function tryBundled(file) {
    try {
      const r = await fetch(file, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.text();
    } catch (_) {
      return null;
    }
  }

  // 1. Try fresh remote in parallel.
  const remote = {};
  await Promise.all(
    FILES.map(async (f) => {
      remote[f] = await tryRemote(f);
    })
  );

  const allRemote = FILES.every((f) => remote[f]);

  // 2. Decide source: remote > cached > bundled.
  const payload = {};
  let source = 'bundled';
  if (allRemote) {
    FILES.forEach((f) => {
      payload[f] = remote[f];
      try { localStorage.setItem('ota-' + f, remote[f]); } catch (_) {}
    });
    source = 'remote';
  } else {
    let allCached = true;
    FILES.forEach((f) => {
      const c = localStorage.getItem('ota-' + f);
      if (c) payload[f] = c;
      else allCached = false;
    });
    if (allCached) source = 'cache';
    else {
      // Final fallback to bundled files inside the APK.
      for (const f of FILES) {
        if (!payload[f]) payload[f] = await tryBundled(f);
      }
      source = 'bundled';
    }
  }

  // 3. Inject CSS.
  const styleEl = document.createElement('style');
  styleEl.id = 'app-style';
  styleEl.textContent = payload['style.css'] || '';
  document.head.appendChild(styleEl);

  // 4. Inject + run JS.
  const scriptEl = document.createElement('script');
  scriptEl.textContent = payload['app.js'] || '';
  document.body.appendChild(scriptEl);

  // 5. Tiny status hint (only if remote update applied).
  if (source === 'remote') {
    const prev = localStorage.getItem('ota-last-source');
    localStorage.setItem('ota-last-source', source);
    if (prev !== 'remote' || localStorage.getItem('ota-show-on-update') === '1') {
      show('Обновлено', true);
    }
  } else if (source === 'cache') {
    show('Оффлайн — кэшированная версия', false);
  }
})();
