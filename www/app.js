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
      if (item.dataset.tab) switchTab(item.dataset.tab);
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
  //  ОБНОВЛЕНИЕ ПРИЛОЖЕНИЯ — сравнить SHA коммита и открыть APK в браузере
  // ===================================================================
  const REPO = 'sergeyoooo4321-pixel/dnevnik';
  const APK_URL = `https://github.com/${REPO}/releases/download/latest/dnevnik.apk`;

  async function checkForUpdate() {
    const btn = document.getElementById('update-btn');
    if (!btn) return;
    btn.textContent = 'Проверяю';
    btn.disabled = true;
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const remoteSha = (data.body || '').trim().split(/\s+/)[0];
      if (remoteSha && remoteSha === window.BUILD_SHA) {
        btn.textContent = 'Актуальная версия';
        await new Promise((r) => setTimeout(r, 2000));
        return;
      }
      if (confirm('Доступна новая версия. Скачать APK?')) {
        window.open(APK_URL, '_system');
      }
    } catch (e) {
      alert('Не удалось проверить обновление: ' + (e && e.message ? e.message : e));
    } finally {
      btn.textContent = 'Обновить';
      btn.disabled = false;
    }
  }

  const updateBtn = document.getElementById('update-btn');
  if (updateBtn) updateBtn.addEventListener('click', checkForUpdate);

  // ===================================================================
  //  INIT
  // ===================================================================
  loadToday();
  renderTagPicker('tagPicker', currentTag, (id) => { currentTag = id; });
  renderTagPicker('filterPicker', filterTag, (id) => { filterTag = id; renderNotes(); }, true);
  setReminderDefaults();
})();
