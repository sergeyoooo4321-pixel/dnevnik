(() => {
  'use strict';

  // ---------- Capacitor plugins ----------
  const Cap = window.Capacitor;
  const LocalNotifications = Cap?.Plugins?.LocalNotifications || null;
  const SpeechRecognition = Cap?.Plugins?.SpeechRecognition || null;

  // ---------- Tags ----------
  const TAGS = [
    { id: 'thought',   label: 'Мысль',     color: 'var(--tag-think)' },
    { id: 'important', label: 'Важно',     color: 'var(--tag-important)' },
    { id: 'idea',      label: 'Идея',      color: 'var(--tag-idea)' },
    { id: 'task',      label: 'Задача',    color: 'var(--tag-task)' },
    { id: 'question',  label: 'Вопрос',    color: 'var(--tag-question)' },
  ];
  const tagById = (id) => TAGS.find((t) => t.id === id) || TAGS[0];

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  // Local-date string YYYY-MM-DD (no UTC drift).
  const dateKey = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // Format YYYY-MM-DD as "4 мая 2026" (treats as local date).
  const formatDate = (key) => {
    const [y, m, day] = key.split('-').map(Number);
    const d = new Date(y, m - 1, day);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatDateTime = (ms) =>
    new Date(ms).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  // Days between two YYYY-MM-DD strings (local).
  const daysBetween = (fromKey, toKey) => {
    const [fy, fm, fd] = fromKey.split('-').map(Number);
    const [ty, tm, td] = toKey.split('-').map(Number);
    const a = new Date(fy, fm - 1, fd).getTime();
    const b = new Date(ty, tm - 1, td).getTime();
    return Math.round((b - a) / 86400000);
  };

  // Add N days to YYYY-MM-DD, return YYYY-MM-DD.
  const addDays = (key, n) => {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return dateKey(dt);
  };

  const escape = (s) => {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  };

  let toastTimer;
  const toast = (text) => {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  };

  const newId = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  function hashId(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // ---------- Tabs / Kebab menu ----------
  const SCREEN_TITLES = {
    today: 'День',
    notes: 'Заметки',
    history: 'История',
    reminders: 'Напоминания',
    plan: 'График',
    data: 'Данные',
  };

  const switchTab = (name) => {
    document.querySelectorAll('.menu-item').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === name)
    );
    document.querySelectorAll('.screen').forEach((s) =>
      s.classList.toggle('active', s.id === name)
    );
    const titleEl = $('screenTitle');
    if (titleEl && SCREEN_TITLES[name]) titleEl.textContent = SCREEN_TITLES[name];
    if (name === 'history') renderHistory();
    if (name === 'notes') renderNotes();
    if (name === 'reminders') renderReminders();
    if (name === 'today') loadToday();
    if (name === 'plan') renderSchedule();
  };

  const menuEl = $('menu');
  const backdropEl = $('menuBackdrop');
  const kebabBtn = $('kebabBtn');

  const openMenu = () => {
    menuEl.hidden = false;
    backdropEl.hidden = false;
    kebabBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => menuEl.classList.add('open'));
  };
  const closeMenu = () => {
    menuEl.classList.remove('open');
    menuEl.hidden = true;
    backdropEl.hidden = true;
    kebabBtn.setAttribute('aria-expanded', 'false');
  };
  const toggleMenu = () => (menuEl.hidden ? openMenu() : closeMenu());

  kebabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  backdropEl.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menuEl.hidden) closeMenu();
  });

  document.querySelectorAll('.menu-item').forEach((item) =>
    item.addEventListener('click', () => {
      switchTab(item.dataset.tab);
      closeMenu();
    })
  );

  // ---------- Voice input ----------
  let activeMicBtn = null;

  async function voiceInput(targetId, btn) {
    const target = $(targetId);
    if (!target) return;

    if (!SpeechRecognition) {
      toast('Голос: используй значок микрофона в клавиатуре Samsung');
      target.focus();
      return;
    }

    if (activeMicBtn === btn) {
      try { await SpeechRecognition.stop(); } catch (_) {}
      btn.classList.remove('listening');
      activeMicBtn = null;
      return;
    }

    try {
      const avail = await SpeechRecognition.available();
      if (!avail.available) {
        toast('Распознавание речи недоступно');
        return;
      }
      const perm = await SpeechRecognition.checkPermissions();
      if (perm.speechRecognition !== 'granted') {
        const r = await SpeechRecognition.requestPermissions();
        if (r.speechRecognition !== 'granted') {
          toast('Разреши доступ к микрофону');
          return;
        }
      }
      btn.classList.add('listening');
      activeMicBtn = btn;
      const result = await SpeechRecognition.start({
        language: 'ru-RU',
        maxResults: 1,
        partialResults: false,
        popup: false,
      });
      btn.classList.remove('listening');
      activeMicBtn = null;
      const phrase = (result?.matches && result.matches[0]) || '';
      if (phrase) {
        target.value = target.value ? `${target.value} ${phrase}` : phrase;
        target.dispatchEvent(new Event('input'));
      }
    } catch (e) {
      console.error('voice', e);
      btn.classList.remove('listening');
      activeMicBtn = null;
      toast('Ошибка голоса. Попробуй ещё раз.');
    }
  }

  // Wire all .mic buttons (delegate so dynamic ones work too).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mic');
    if (!btn) return;
    e.preventDefault();
    voiceInput(btn.dataset.target, btn);
  });

  // ---------- Notification permission ----------
  async function ensureNotifPerm() {
    if (!LocalNotifications) return false;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  }

  // ===================================================================
  //  ДЕНЬ
  // ===================================================================
  let currentRating = 0;

  const renderStars = (rating) => {
    const c = $('stars');
    c.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const star = document.createElement('div');
      star.className = 'star' + (i <= rating ? ' active' : '');
      star.textContent = '★';
      star.addEventListener('click', () => {
        currentRating = currentRating === i ? 0 : i;
        renderStars(currentRating);
        $('ratingValue').textContent = currentRating ? `${currentRating} / 10` : '—';
      });
      c.appendChild(star);
    }
  };

  const loadToday = () => {
    const key = dateKey();
    $('todayDate').textContent = formatDate(key);
    const raw = localStorage.getItem('entry-' + key);
    const entry = raw ? JSON.parse(raw) : null;
    currentRating = entry?.rating || 0;
    $('done').value = entry?.done || '';
    $('improve').value = entry?.improve || '';
    $('ratingValue').textContent = currentRating ? `${currentRating} / 10` : '—';
    renderStars(currentRating);
  };

  $('save').addEventListener('click', () => {
    const key = dateKey();
    const entry = {
      date: key,
      rating: currentRating,
      done: $('done').value.trim(),
      improve: $('improve').value.trim(),
      updatedAt: Date.now(),
    };
    localStorage.setItem('entry-' + key, JSON.stringify(entry));
    toast('День сохранён');
  });

  // ===================================================================
  //  ИСТОРИЯ
  // ===================================================================
  const renderHistory = () => {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('entry-')) {
        try {
          entries.push(JSON.parse(localStorage.getItem(key)));
        } catch (_) {}
      }
    }
    entries.sort((a, b) => b.date.localeCompare(a.date));

    const c = $('entries');
    if (!entries.length) {
      c.innerHTML = '<div class="empty">Пока нет записей</div>';
      return;
    }

    const block = (label, value) =>
      value
        ? `<div class="entry-text"><span class="label">${label}</span>${escape(value)}</div>`
        : '';

    c.innerHTML = entries
      .map((e) => `
        <div class="entry">
          <div class="entry-header">
            <span class="entry-date">${formatDate(e.date)}</span>
            <span class="entry-rating">${e.rating ? '★'.repeat(e.rating) + '☆'.repeat(10 - e.rating) : '—'}</span>
          </div>
          ${block('Сделал', e.done)}
          ${block('Улучшить', e.improve)}
        </div>`).join('');
  };

  // ===================================================================
  //  ЗАМЕТКИ
  // ===================================================================
  let currentTag = 'thought';
  let filterTag = 'all';

  const getNotes = () => {
    try {
      return JSON.parse(localStorage.getItem('notes') || '[]');
    } catch (_) { return []; }
  };
  const saveNotes = (list) => localStorage.setItem('notes', JSON.stringify(list));

  const renderTagPicker = (containerId, selectedId, onSelect, includeAll = false) => {
    const c = $(containerId);
    c.innerHTML = '';
    const opts = includeAll
      ? [{ id: 'all', label: 'Все', color: 'var(--muted)' }, ...TAGS]
      : TAGS;
    opts.forEach((t) => {
      const chip = document.createElement('button');
      chip.className = 'tag-chip' + (t.id === selectedId ? ' active' : '');
      chip.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}`;
      chip.addEventListener('click', () => {
        onSelect(t.id);
        renderTagPicker(containerId, t.id, onSelect, includeAll);
      });
      c.appendChild(chip);
    });
  };

  $('addNote').addEventListener('click', () => {
    const text = $('noteText').value.trim();
    if (!text) {
      toast('Напиши что-нибудь');
      return;
    }
    const note = {
      id: Date.now(),
      text,
      tag: currentTag,
      createdAt: Date.now(),
    };
    const list = getNotes();
    list.push(note);
    saveNotes(list);
    $('noteText').value = '';
    renderNotes();
    toast('Заметка добавлена');
  });

  const renderNotes = () => {
    let list = getNotes();
    if (filterTag !== 'all') list = list.filter((n) => n.tag === filterTag);
    list.sort((a, b) => b.createdAt - a.createdAt);

    const c = $('notesList');
    if (!list.length) {
      c.innerHTML = '<div class="empty">Заметок нет</div>';
      return;
    }

    c.innerHTML = list.map((n) => {
      const t = tagById(n.tag);
      return `
        <div class="note">
          <div class="note-bar" style="background:${t.color}"></div>
          <div class="note-body">
            <div class="note-text">${escape(n.text)}</div>
            <div class="note-meta">
              <span class="note-tag" style="color:${t.color}">${t.label}</span>
              <span>·</span>
              <span>${formatDateTime(n.createdAt)}</span>
            </div>
          </div>
          <button class="delete" data-id="${n.id}" aria-label="Удалить">×</button>
        </div>`;
    }).join('');

    c.querySelectorAll('.delete').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        saveNotes(getNotes().filter((n) => n.id !== id));
        renderNotes();
      })
    );
  };

  // ===================================================================
  //  НАПОМИНАНИЯ
  // ===================================================================
  let reminderMode = 'once';

  document.querySelectorAll('.seg-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      reminderMode = btn.dataset.mode;
      document.querySelectorAll('.seg-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      $('dateField').style.display = reminderMode === 'daily' ? 'none' : '';
    })
  );

  const getReminders = () => {
    try { return JSON.parse(localStorage.getItem('reminders') || '[]'); }
    catch (_) { return []; }
  };
  const saveReminders = (list) => localStorage.setItem('reminders', JSON.stringify(list));

  const renderReminders = () => {
    const all = getReminders();

    // Drop expired one-off reminders.
    const live = all.filter((r) => r.kind === 'daily' || new Date(r.at).getTime() > Date.now());
    if (live.length !== all.length) saveReminders(live);

    live.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'daily' ? -1 : 1;
      if (a.kind === 'daily') return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute);
      return new Date(a.at) - new Date(b.at);
    });

    const c = $('remindersList');
    if (!live.length) {
      c.innerHTML = '<div class="empty">Активных напоминаний нет</div>';
      return;
    }

    c.innerHTML = live.map((r) => {
      if (r.kind === 'daily') {
        return `
          <div class="reminder">
            <div class="reminder-info">
              <div class="reminder-text">${escape(r.text)}</div>
              <div class="reminder-time">Каждый день в ${pad(r.hour)}:${pad(r.minute)}<span class="reminder-badge">ежедн.</span></div>
            </div>
            <button class="delete" data-id="${r.id}" aria-label="Удалить">×</button>
          </div>`;
      }
      return `
        <div class="reminder">
          <div class="reminder-info">
            <div class="reminder-text">${escape(r.text)}</div>
            <div class="reminder-time">${formatDateTime(new Date(r.at).getTime())}</div>
          </div>
          <button class="delete" data-id="${r.id}" aria-label="Удалить">×</button>
        </div>`;
    }).join('');

    c.querySelectorAll('.delete').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        saveReminders(getReminders().filter((r) => r.id !== id));
        if (LocalNotifications) {
          try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch (_) {}
        }
        renderReminders();
      })
    );
  };

  $('addReminder').addEventListener('click', async () => {
    const text = $('reminderText').value.trim();
    const time = $('reminderTime').value;
    if (!text || !time) {
      toast('Заполни сообщение и время');
      return;
    }
    const [hh, mm] = time.split(':').map(Number);
    if (isNaN(hh) || isNaN(mm)) {
      toast('Кривое время');
      return;
    }

    const id = Math.floor(Math.random() * 2_000_000_000);
    const granted = await ensureNotifPerm();
    if (!granted && LocalNotifications) {
      toast('Разреши уведомления в настройках');
      return;
    }

    if (reminderMode === 'daily') {
      if (LocalNotifications) {
        try {
          await LocalNotifications.schedule({
            notifications: [{
              id,
              title: 'Дневник',
              body: text,
              schedule: { on: { hour: hh, minute: mm }, allowWhileIdle: true },
              smallIcon: 'ic_stat_icon_config_sample',
            }],
          });
        } catch (e) {
          console.error('daily schedule', e);
          toast('Не удалось поставить ежедневное');
          return;
        }
      }
      const list = getReminders();
      list.push({ id, kind: 'daily', text, hour: hh, minute: mm });
      saveReminders(list);
    } else {
      const dateVal = $('reminderDate').value || dateKey();
      const [y, m, d] = dateVal.split('-').map(Number);
      const when = new Date(y, m - 1, d, hh, mm, 0, 0);
      if (when.getTime() <= Date.now()) {
        toast('Время должно быть в будущем');
        return;
      }
      if (LocalNotifications) {
        try {
          await LocalNotifications.schedule({
            notifications: [{
              id,
              title: 'Дневник',
              body: text,
              schedule: { at: when, allowWhileIdle: true },
              smallIcon: 'ic_stat_icon_config_sample',
            }],
          });
        } catch (e) {
          console.error('once schedule', e);
          toast('Не удалось поставить напоминание');
          return;
        }
      }
      const list = getReminders();
      list.push({ id, kind: 'once', text, at: when.toISOString() });
      saveReminders(list);
    }

    $('reminderText').value = '';
    setReminderDefaults();
    renderReminders();
    toast(reminderMode === 'daily' ? 'Ежедневное поставлено' : 'Напоминание поставлено');
  });

  const setReminderDefaults = () => {
    const next = new Date();
    next.setMinutes(next.getMinutes() + 60, 0, 0);
    $('reminderDate').value = dateKey(next);
    $('reminderDate').min = dateKey();
    $('reminderTime').value = timeStr(next);
  };

  // ===================================================================
  //  ГРАФИК — события по дням + календарь
  // ===================================================================
  const getEvents = () => {
    try { return JSON.parse(localStorage.getItem('schedule-events') || '[]'); }
    catch (_) { return []; }
  };
  const saveEventsList = (list) =>
    localStorage.setItem('schedule-events', JSON.stringify(list));

  let scheduleSelectedDate = dateKey();
  let scheduleViewMonth = (() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() }; // m: 0..11
  })();

  function eventsByDate() {
    const map = {};
    for (const e of getEvents()) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }

  function renderSchedule() {
    renderScheduleEvents();
    renderCalendar();
  }

  function renderScheduleEvents() {
    const titleEl = $('scheduleDayTitle');
    const listEl = $('scheduleEventList');

    titleEl.textContent = formatDate(scheduleSelectedDate);

    const events = getEvents()
      .filter((e) => e.date === scheduleSelectedDate)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    if (!events.length) {
      listEl.innerHTML = '<div class="empty">Событий нет</div>';
      return;
    }

    listEl.innerHTML = events.map((e) => `
      <div class="schedule-item" data-id="${escape(e.id)}">
        <span class="schedule-dash">—</span>
        <div class="schedule-body">
          <div class="schedule-line">
            <span class="schedule-time">${escape(e.time || '')}</span>
            <span class="schedule-title">${escape(e.title || '')}</span>
          </div>
          ${e.note ? `<div class="schedule-note">${escape(e.note)}</div>` : ''}
        </div>
        <button class="delete" data-id="${escape(e.id)}" aria-label="Удалить">×</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.delete').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!confirm('Удалить событие?')) return;
        const id = btn.dataset.id;
        saveEventsList(getEvents().filter((e) => e.id !== id));
        renderSchedule();
      });
    });
  }

  function renderCalendar() {
    const grid = $('calGrid');
    const monthEl = $('calMonth');
    const { y, m } = scheduleViewMonth;

    monthEl.textContent = new Date(y, m, 1).toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    // Понедельник = 0 .. Воскресенье = 6 (вместо JS-овского 0=Вс).
    let leadEmpty = new Date(y, m, 1).getDay() - 1;
    if (leadEmpty < 0) leadEmpty = 6;

    const evMap = eventsByDate();
    const todayK = dateKey();

    let html = '';
    for (let i = 0; i < leadEmpty; i++) html += '<span class="cal-cell empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const k = `${y}-${pad(m + 1)}-${pad(d)}`;
      const cls = ['cal-cell'];
      if (evMap[k] && evMap[k].length) cls.push('has-events');
      if (k === todayK) cls.push('today');
      if (k === scheduleSelectedDate) cls.push('selected');
      html += `<button class="${cls.join(' ')}" data-date="${k}">${d}</button>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.cal-cell:not(.empty)').forEach((b) => {
      b.addEventListener('click', () => {
        scheduleSelectedDate = b.dataset.date;
        renderSchedule();
      });
    });
  }

  // ---- FAB + модалка добавления события ----
  function openEventModal() {
    $('eventTime').value = timeStr(new Date());
    $('eventTitle').value = '';
    $('eventNote').value = '';
    $('eventOverlay').hidden = false;
    setTimeout(() => $('eventTitle').focus(), 50);
  }
  function closeEventModal() {
    $('eventOverlay').hidden = true;
  }

  $('addEventBtn').addEventListener('click', openEventModal);
  $('eventCloseBtn').addEventListener('click', closeEventModal);
  $('eventCancelBtn').addEventListener('click', closeEventModal);
  $('eventOverlay').addEventListener('click', (e) => {
    if (e.target === $('eventOverlay')) closeEventModal();
  });

  $('eventSaveBtn').addEventListener('click', () => {
    const time = $('eventTime').value;
    const title = $('eventTitle').value.trim();
    const note = $('eventNote').value.trim();
    if (!title) { toast('Укажи событие'); return; }
    if (!time) { toast('Укажи время'); return; }

    const list = getEvents();
    list.push({
      id: newId(),
      date: scheduleSelectedDate,
      time,
      title,
      note,
    });
    saveEventsList(list);
    closeEventModal();
    renderSchedule();
    toast('Добавлено');
  });

  // ---- Навигация календаря ----
  $('calPrev').addEventListener('click', () => {
    if (--scheduleViewMonth.m < 0) {
      scheduleViewMonth.m = 11;
      scheduleViewMonth.y--;
    }
    renderCalendar();
  });
  $('calNext').addEventListener('click', () => {
    if (++scheduleViewMonth.m > 11) {
      scheduleViewMonth.m = 0;
      scheduleViewMonth.y++;
    }
    renderCalendar();
  });

  // ===================================================================
  //  ЭКСПОРТ / ИМПОРТ ДАННЫХ
  //  Бэкап нужен перед сменой подписи APK (release-keystore) — Android
  //  заставит удалить старую установку, и localStorage сотрётся.
  //  Также защищает от потери данных при смене телефона.
  // ===================================================================
  function buildExportJson() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Не экспортируем служебные ключи Capgo и OTA-кэш — они привязаны
      // к устройству и при импорте на другое устройство только запутают.
      if (k && k.startsWith('CapacitorStorage.')) continue;
      if (k === 'ota-code' || k === 'ota-version') continue;
      data[k] = localStorage.getItem(k);
    }
    return JSON.stringify({
      _meta: { app: 'dnevnik', exportedAt: new Date().toISOString() },
      data,
    }, null, 2);
  }

  function applyImportJson(json) {
    let parsed;
    try { parsed = JSON.parse(json); }
    catch (_) { throw new Error('Не похоже на JSON'); }
    if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
      throw new Error('Структура файла не от дневника');
    }
    const keys = Object.keys(parsed.data);
    for (const k of keys) {
      const v = parsed.data[k];
      if (typeof v === 'string') localStorage.setItem(k, v);
    }
    return keys.length;
  }

  $('exportBuildBtn').addEventListener('click', () => {
    $('exportText').value = buildExportJson();
    toast('Готово, можно копировать');
  });

  $('exportCopyBtn').addEventListener('click', async () => {
    const text = $('exportText').value || buildExportJson();
    $('exportText').value = text;
    try {
      await navigator.clipboard.writeText(text);
      toast('Скопировано в буфер');
    } catch (_) {
      // На некоторых WebView clipboard API не работает — показываем,
      // чтобы юзер скопировал руками через выделение.
      $('exportText').focus();
      $('exportText').select();
      toast('Выдели текст и скопируй вручную');
    }
  });

  $('importDoBtn2').addEventListener('click', () => {
    const text = $('importText').value.trim();
    if (!text) { toast('Сначала вставь JSON'); return; }
    if (!confirm('Импортировать? Текущие данные будут перезаписаны.')) return;
    try {
      const n = applyImportJson(text);
      toast('Импортировано ключей: ' + n);
      $('importText').value = '';
      // Перерендерим открытую вкладку, чтобы новые данные подтянулись.
      loadToday();
    } catch (e) {
      toast('Ошибка импорта: ' + (e.message || 'неизвестно'));
    }
  });

  // ===================================================================
  //  OTA menu row (powered by @capgo/capacitor-updater via updater.js)
  // ===================================================================
  function escapeText(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function ensureMenuVersionEl() {
    const menu = $('menu');
    if (!menu) return null;
    let wrap = $('menuVersion');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'menuVersion';
      wrap.className = 'menu-version';
      menu.appendChild(wrap);
    }
    return wrap;
  }

  // Одна кнопка с тремя состояниями: idle → checking → (update | uptodate | offline) → applying.
  // По тапу: idle → проверка; если есть обновление — рендер «Обновить до vX»; ещё тап — скачивание.
  let otaState = 'idle';

  function renderOtaIdle(wrap, currentVersion) {
    wrap.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'menu-version-static';
    div.innerHTML =
      '<span class="menu-version-title">Версия v' + escapeText(currentVersion) + '</span>';
    wrap.appendChild(div);

    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = 'Проверить обновления';
    btn.addEventListener('click', () => doCheck(wrap));
    wrap.appendChild(btn);
  }

  async function doCheck(wrap) {
    if (otaState !== 'idle') return;
    otaState = 'checking';
    wrap.innerHTML =
      '<div class="menu-version-static">' +
        '<span class="menu-version-title">Проверяю…</span>' +
      '</div>';

    let info;
    try { info = await window.OTA.checkUpdate(); }
    catch (_) { info = { available: false, offline: true, currentVersion: 'unknown' }; }

    otaState = 'idle';
    renderOtaResult(wrap, info);
  }

  function renderOtaResult(wrap, info) {
    wrap.innerHTML = '';
    const cur = info.currentVersion || 'unknown';

    if (info.available) {
      const btn = document.createElement('button');
      btn.className = 'menu-item menu-update';
      btn.innerHTML =
        '<span class="dot"></span>' +
        '<span>' +
          '<span class="menu-update-title">Обновить до v' + escapeText(info.latestVersion) + '</span>' +
          '<span class="menu-version-sub">сейчас v' + escapeText(cur) + '</span>' +
        '</span>';
      btn.addEventListener('click', () => doApply(wrap, info));
      wrap.appendChild(btn);
      return;
    }

    const div = document.createElement('div');
    div.className = 'menu-version-static';
    if (info.offline) {
      div.innerHTML =
        '<span class="menu-version-title">Нет интернета</span>' +
        '<span class="menu-version-sub">v' + escapeText(cur) + '</span>';
    } else {
      div.innerHTML =
        '<span class="menu-version-title">Уже последняя версия</span>' +
        '<span class="menu-version-sub">v' + escapeText(cur) + '</span>';
    }
    wrap.appendChild(div);

    const again = document.createElement('button');
    again.className = 'menu-item';
    again.style.opacity = '0.7';
    again.style.fontSize = '13px';
    again.textContent = 'Проверить ещё раз';
    again.addEventListener('click', () => doCheck(wrap));
    wrap.appendChild(again);
  }

  async function doApply(wrap, info) {
    if (otaState !== 'idle') return;
    otaState = 'applying';

    const status = document.createElement('div');
    status.className = 'menu-version-static';
    status.innerHTML =
      '<span class="menu-version-title">Скачиваю…</span>' +
      '<span class="menu-version-sub" id="otaProgress">0%</span>';
    wrap.innerHTML = '';
    wrap.appendChild(status);

    try {
      await window.OTA.applyUpdate(info.url, info.latestVersion, info.checksum, (percent) => {
        const el = $('otaProgress');
        if (el) el.textContent = Math.round(percent) + '%';
      });
      // Capgo set() сам перезагружает WebView — сюда обычно не доходим.
    } catch (e) {
      otaState = 'idle';
      wrap.innerHTML =
        '<div class="menu-version-static">' +
          '<span class="menu-version-title">Ошибка обновления</span>' +
          '<span class="menu-version-sub">' + escapeText(e && e.message ? e.message : 'неизвестная') + '</span>' +
        '</div>';
      const retry = document.createElement('button');
      retry.className = 'menu-item';
      retry.textContent = 'Попробовать снова';
      retry.addEventListener('click', () => doCheck(wrap));
      wrap.appendChild(retry);
    }
  }

  async function renderOtaMenuRow() {
    if (!window.OTA) return;
    const wrap = ensureMenuVersionEl();
    if (!wrap) return;

    let cur;
    try { cur = await window.OTA.getCurrent(); }
    catch (_) { cur = { bundle: { version: 'unknown' } }; }
    const curVersion = (cur && cur.bundle && cur.bundle.version) || 'unknown';

    renderOtaIdle(wrap, curVersion);
  }

  window.addEventListener('ota:ready', () => { renderOtaMenuRow(); });
  if (window.OTA) setTimeout(renderOtaMenuRow, 0);

  // ===================================================================
  //  INIT
  // ===================================================================
  loadToday();
  renderTagPicker('tagPicker', currentTag, (id) => { currentTag = id; });
  renderTagPicker('filterPicker', filterTag, (id) => { filterTag = id; renderNotes(); }, true);
  setReminderDefaults();
})();
