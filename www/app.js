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

  // Local date+time string YYYY-MM-DDTHH:MM (for input[type=datetime-local]).
  const localDateTimeStr = (d) =>
    `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

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

  const escape = (s) => {
    const div = document.createElement('div');
    div.textContent = s;
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

  // ---------- Tabs / Kebab menu ----------
  const SCREEN_TITLES = {
    today: 'День',
    notes: 'Заметки',
    history: 'История',
    reminders: 'Напоминания',
    plan: 'План',
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
    if (name === 'plan') renderPlan();
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

  document.querySelectorAll('.mic').forEach((btn) =>
    btn.addEventListener('click', () => voiceInput(btn.dataset.target, btn))
  );

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
    renderTodayPlan();
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
      // Recurring daily at HH:MM (system handles repeat).
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
  //  ПЛАН (Subjects, schedule, themes, Pomodoro)
  // ===================================================================
  const FOCUS_MIN = 25;
  const BREAK_MIN = 5;

  const SUBJECT_COLORS = [
    'var(--tag-think)',
    'var(--tag-important)',
    'var(--tag-idea)',
    'var(--tag-task)',
    'var(--tag-question)',
    'var(--tag-default)',
  ];

  const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // Convert internal weekday (1=Mon..7=Sun) to Capacitor (1=Sun..7=Sat).
  const toCapWeekday = (w) => (w === 7 ? 1 : w + 1);

  // JS Date.getDay(): 0=Sun..6=Sat → internal 1=Mon..7=Sun
  const internalWeekdayFromDate = (d) => {
    const j = d.getDay();
    return j === 0 ? 7 : j;
  };

  function hashId(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  const slotNotifId = (subjectId, slot) =>
    hashId(`plan|${subjectId}|${slot.weekday}|${slot.hour}|${slot.minute}`);

  const newId = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  const getSubjects = () => {
    try { return JSON.parse(localStorage.getItem('plan-subjects') || '[]'); }
    catch (_) { return []; }
  };
  const saveSubjects = (list) =>
    localStorage.setItem('plan-subjects', JSON.stringify(list));

  async function scheduleSlotNotification(subject, slot) {
    if (!LocalNotifications) return;
    const granted = await ensureNotifPerm();
    if (!granted) return;
    const id = slotNotifId(subject.id, slot);
    try {
      // Cancel previous (if any) to avoid duplicates.
      try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch (_) {}
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: `По плану: ${subject.name}`,
          body: `Время заниматься. ${slot.durationMin} мин`,
          schedule: {
            on: {
              weekday: toCapWeekday(slot.weekday),
              hour: slot.hour,
              minute: slot.minute,
            },
            allowWhileIdle: true,
          },
          smallIcon: 'ic_stat_icon_config_sample',
        }],
      });
    } catch (e) {
      console.error('slot schedule', e);
    }
  }

  async function cancelSlotNotification(subjectId, slot) {
    if (!LocalNotifications) return;
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: slotNotifId(subjectId, slot) }],
      });
    } catch (_) {}
  }

  async function cancelAllSubjectNotifications(subject) {
    if (!subject?.schedule?.length) return;
    for (const slot of subject.schedule) await cancelSlotNotification(subject.id, slot);
  }

  // ----- Render: subjects list -----
  const expandedSubjects = new Set();

  function renderPlan() {
    const subjects = getSubjects();
    const c = $('subjectsList');
    if (!subjects.length) {
      c.innerHTML = '<div class="empty">Предметов пока нет. Добавь первый.</div>';
      return;
    }

    c.innerHTML = subjects.map((s) => {
      const total = s.themes.length;
      const done = s.themes.filter((t) => t.done).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const expanded = expandedSubjects.has(s.id);
      const slotsHtml = (s.schedule || []).map((sl, idx) =>
        `<span class="slot-pill" data-subject="${s.id}" data-slot="${idx}">${WEEKDAY_LABELS[sl.weekday - 1]} ${pad(sl.hour)}:${pad(sl.minute)} · ${sl.durationMin}м<span class="slot-x" data-slot-del="${idx}" data-subject="${s.id}">×</span></span>`
      ).join('');

      const themesHtml = s.themes.map((t) => `
        <div class="theme-row">
          <input type="checkbox" class="theme-check" data-subject="${s.id}" data-theme="${t.id}" ${t.done ? 'checked' : ''}>
          <span class="theme-text${t.done ? ' done' : ''}">${escape(t.text)}</span>
          <button class="delete theme-del" data-subject="${s.id}" data-theme="${t.id}" aria-label="Удалить">×</button>
        </div>
      `).join('');

      return `
        <div class="subject-card" data-subject="${s.id}">
          <div class="subject-head" data-subject-toggle="${s.id}">
            <span class="color-dot" style="background:${s.color}"></span>
            <div class="subject-name">${escape(s.name)}</div>
            <div class="subject-progress-text">${done} / ${total}</div>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${s.color}"></div></div>
          <div class="subject-actions">
            <button class="ghost subject-pomodoro" data-subject="${s.id}">Начать сессию</button>
          </div>

          ${expanded ? `
            <div class="subject-section">
              <label class="section-label">Темы</label>
              <div class="themes-list">${themesHtml || '<div class="muted-line">Тем нет.</div>'}</div>
              <div class="theme-add-row">
                <input type="text" class="theme-input" id="themeInput-${s.id}" placeholder="Новая тема">
                <button class="mic theme-mic" data-target="themeInput-${s.id}" aria-label="Голос">🎤</button>
                <button class="ghost theme-add" data-subject="${s.id}">Добавить</button>
              </div>
              <div class="field" style="margin-top:10px;">
                <label>Темы пачкой (по одной на строку)</label>
                <textarea id="themeBulk-${s.id}" placeholder="Тема 1&#10;Тема 2&#10;…"></textarea>
                <button class="ghost theme-bulk" data-subject="${s.id}" style="margin-top:6px;">Добавить пачкой</button>
              </div>
            </div>

            <div class="subject-section">
              <label class="section-label">Расписание</label>
              <div class="slots-row">${slotsHtml || '<span class="muted-line">Слотов нет.</span>'}</div>
              <div class="slot-add">
                <div class="weekday-row" data-subject="${s.id}"></div>
                <div class="slot-add-row">
                  <input type="time" class="slot-time" id="slotTime-${s.id}" value="18:00">
                  <input type="number" class="slot-dur" id="slotDur-${s.id}" min="5" max="240" value="60">
                  <span class="muted-line">мин</span>
                  <button class="ghost slot-add-btn" data-subject="${s.id}">Добавить</button>
                </div>
              </div>
            </div>

            <div class="subject-section subject-danger">
              <button class="ghost danger subject-delete" data-subject="${s.id}">Удалить предмет</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Wire toggles
    c.querySelectorAll('[data-subject-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.subjectToggle;
        if (expandedSubjects.has(id)) expandedSubjects.delete(id);
        else expandedSubjects.add(id);
        renderPlan();
      });
    });

    // Pomodoro start
    c.querySelectorAll('.subject-pomodoro').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        startPomodoro(b.dataset.subject);
      });
    });

    // Theme checkbox
    c.querySelectorAll('.theme-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const list = getSubjects();
        const subj = list.find((x) => x.id === cb.dataset.subject);
        if (!subj) return;
        const th = subj.themes.find((x) => x.id === cb.dataset.theme);
        if (!th) return;
        th.done = cb.checked;
        saveSubjects(list);
        renderPlan();
      });
    });

    // Theme delete
    c.querySelectorAll('.theme-del').forEach((b) => {
      b.addEventListener('click', () => {
        const list = getSubjects();
        const subj = list.find((x) => x.id === b.dataset.subject);
        if (!subj) return;
        subj.themes = subj.themes.filter((x) => x.id !== b.dataset.theme);
        saveSubjects(list);
        renderPlan();
      });
    });

    // Theme add (single)
    c.querySelectorAll('.theme-add').forEach((b) => {
      b.addEventListener('click', () => {
        const sid = b.dataset.subject;
        const input = $('themeInput-' + sid);
        const txt = (input?.value || '').trim();
        if (!txt) { toast('Введи тему'); return; }
        const list = getSubjects();
        const subj = list.find((x) => x.id === sid);
        if (!subj) return;
        if (!subj.themes.some((t) => t.text.toLowerCase() === txt.toLowerCase())) {
          subj.themes.push({ id: newId(), text: txt, done: false });
        }
        saveSubjects(list);
        renderPlan();
      });
    });

    // Theme bulk add
    c.querySelectorAll('.theme-bulk').forEach((b) => {
      b.addEventListener('click', () => {
        const sid = b.dataset.subject;
        const ta = $('themeBulk-' + sid);
        const lines = (ta?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
        if (!lines.length) { toast('Список пуст'); return; }
        const list = getSubjects();
        const subj = list.find((x) => x.id === sid);
        if (!subj) return;
        const seen = new Set(subj.themes.map((t) => t.text.toLowerCase()));
        let added = 0;
        for (const ln of lines) {
          const k = ln.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          subj.themes.push({ id: newId(), text: ln, done: false });
          added++;
        }
        saveSubjects(list);
        toast(`Добавлено: ${added}`);
        renderPlan();
      });
    });

    // Theme mic
    c.querySelectorAll('.theme-mic').forEach((btn) =>
      btn.addEventListener('click', () => voiceInput(btn.dataset.target, btn))
    );

    // Slot delete
    c.querySelectorAll('[data-slot-del]').forEach((x) => {
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sid = x.dataset.subject;
        const idx = parseInt(x.dataset.slotDel, 10);
        const list = getSubjects();
        const subj = list.find((s) => s.id === sid);
        if (!subj) return;
        const slot = subj.schedule[idx];
        if (!slot) return;
        await cancelSlotNotification(sid, slot);
        subj.schedule.splice(idx, 1);
        saveSubjects(list);
        renderPlan();
      });
    });

    // Weekday chips for each open subject
    c.querySelectorAll('.weekday-row').forEach((row) => {
      const sid = row.dataset.subject;
      WEEKDAY_LABELS.forEach((lbl, i) => {
        const chip = document.createElement('button');
        chip.className = 'tag-chip weekday-chip';
        chip.dataset.subject = sid;
        chip.dataset.weekday = String(i + 1);
        chip.textContent = lbl;
        chip.addEventListener('click', () => chip.classList.toggle('active'));
        row.appendChild(chip);
      });
    });

    // Slot add
    c.querySelectorAll('.slot-add-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        const sid = b.dataset.subject;
        const card = b.closest('.subject-card');
        const days = Array.from(card.querySelectorAll('.weekday-chip.active'))
          .map((ch) => parseInt(ch.dataset.weekday, 10));
        const time = $('slotTime-' + sid)?.value;
        const dur = parseInt($('slotDur-' + sid)?.value || '60', 10);
        if (!days.length) { toast('Выбери хотя бы один день'); return; }
        if (!time) { toast('Укажи время'); return; }
        if (!Number.isFinite(dur) || dur <= 0) { toast('Кривая длительность'); return; }
        const [hh, mm] = time.split(':').map(Number);
        const list = getSubjects();
        const subj = list.find((s) => s.id === sid);
        if (!subj) return;
        for (const w of days) {
          const exists = subj.schedule.some(
            (sl) => sl.weekday === w && sl.hour === hh && sl.minute === mm
          );
          if (exists) continue;
          const slot = { weekday: w, hour: hh, minute: mm, durationMin: dur };
          subj.schedule.push(slot);
          await scheduleSlotNotification(subj, slot);
        }
        saveSubjects(list);
        toast('Слот(ы) добавлены');
        renderPlan();
      });
    });

    // Subject delete
    c.querySelectorAll('.subject-delete').forEach((b) => {
      b.addEventListener('click', async () => {
        const sid = b.dataset.subject;
        const list = getSubjects();
        const subj = list.find((s) => s.id === sid);
        if (!subj) return;
        if (!confirm(`Удалить предмет «${subj.name}» и всё его расписание?`)) return;
        await cancelAllSubjectNotifications(subj);
        saveSubjects(list.filter((s) => s.id !== sid));
        expandedSubjects.delete(sid);
        renderPlan();
      });
    });
  }

  // ----- New subject form -----
  let newSubjectColor = SUBJECT_COLORS[0];

  function renderNewSubjectColors() {
    const c = $('newSubjectColor');
    c.innerHTML = '';
    SUBJECT_COLORS.forEach((col) => {
      const dot = document.createElement('button');
      dot.className = 'color-dot color-pick' + (col === newSubjectColor ? ' active' : '');
      dot.style.background = col;
      dot.addEventListener('click', () => {
        newSubjectColor = col;
        renderNewSubjectColors();
      });
      c.appendChild(dot);
    });
  }

  $('newSubjectBtn').addEventListener('click', () => {
    const f = $('newSubjectForm');
    f.hidden = !f.hidden;
    if (!f.hidden) {
      $('newSubjectName').value = '';
      newSubjectColor = SUBJECT_COLORS[0];
      renderNewSubjectColors();
      setTimeout(() => $('newSubjectName').focus(), 0);
    }
  });
  $('newSubjectCancel').addEventListener('click', () => { $('newSubjectForm').hidden = true; });
  $('newSubjectSave').addEventListener('click', () => {
    const name = $('newSubjectName').value.trim();
    if (!name) { toast('Имя предмета обязательно'); return; }
    const list = getSubjects();
    list.push({
      id: newId(),
      name,
      color: newSubjectColor,
      themes: [],
      schedule: [],
    });
    saveSubjects(list);
    $('newSubjectForm').hidden = true;
    toast('Предмет создан');
    renderPlan();
  });

  // ===================================================================
  //  Pomodoro
  // ===================================================================
  let pomoState = {
    active: false,
    subjectId: null,
    phase: 'focus', // 'focus' | 'break'
    remaining: FOCUS_MIN * 60,
    paused: false,
    cycles: 0, // completed focus phases
    timer: null,
  };

  function pomoFmt(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${pad(m)}:${pad(s)}`;
  }

  function pomoUpdateUI() {
    $('pomodoroTime').textContent = pomoFmt(pomoState.remaining);
    $('pomodoroPhase').textContent = pomoState.phase === 'focus' ? 'Учим' : 'Отдых';
    $('pomodoroCycles').textContent = `Циклов: ${pomoState.cycles}`;
    $('pomodoroPause').textContent = pomoState.paused ? 'Продолжить' : 'Пауза';
  }

  function pomoTick() {
    if (!pomoState.active || pomoState.paused) return;
    pomoState.remaining -= 1;
    if (pomoState.remaining <= 0) {
      pomoNextPhase(true);
    } else {
      $('pomodoroTime').textContent = pomoFmt(pomoState.remaining);
    }
  }

  async function pomoNotify(title, body) {
    try { navigator.vibrate?.([200, 100, 200]); } catch (_) {}
    if (!LocalNotifications) return;
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: hashId('pomo|' + Date.now() + Math.random()),
          title,
          body,
          schedule: { at: new Date(Date.now() + 50), allowWhileIdle: true },
          smallIcon: 'ic_stat_icon_config_sample',
        }],
      });
    } catch (_) {}
  }

  function pomoNextPhase(natural) {
    if (pomoState.phase === 'focus') {
      if (natural) {
        pomoState.cycles += 1;
        // Increment today's counter for this subject.
        if (pomoState.subjectId) {
          const k = `pomodoro-${pomoState.subjectId}-${dateKey()}`;
          const cur = parseInt(localStorage.getItem(k) || '0', 10) || 0;
          localStorage.setItem(k, String(cur + 1));
        }
        pomoNotify('Pomodoro', `Перерыв ${BREAK_MIN} мин`);
      }
      pomoState.phase = 'break';
      pomoState.remaining = BREAK_MIN * 60;
    } else {
      if (natural) pomoNotify('Pomodoro', `Снова в бой! ${FOCUS_MIN} мин`);
      pomoState.phase = 'focus';
      pomoState.remaining = FOCUS_MIN * 60;
    }
    pomoUpdateUI();
  }

  function startPomodoro(subjectId) {
    const subj = getSubjects().find((s) => s.id === subjectId);
    if (!subj) return;
    // If already active for another subject, ask first.
    if (pomoState.active && pomoState.subjectId !== subjectId) {
      if (!confirm('Идёт другая сессия. Прервать и начать новую?')) return;
      stopPomodoro(false);
    }
    pomoState.active = true;
    pomoState.subjectId = subjectId;
    pomoState.phase = 'focus';
    pomoState.remaining = FOCUS_MIN * 60;
    pomoState.paused = false;
    pomoState.cycles = 0;
    if (pomoState.timer) clearInterval(pomoState.timer);
    pomoState.timer = setInterval(pomoTick, 1000);
    $('pomodoroSubject').textContent = subj.name;
    pomoUpdateUI();
    $('pomodoroOverlay').hidden = false;
  }

  function stopPomodoro(closeUi) {
    if (pomoState.timer) clearInterval(pomoState.timer);
    pomoState.timer = null;
    pomoState.active = false;
    pomoState.paused = false;
    if (closeUi !== false) $('pomodoroOverlay').hidden = true;
  }

  $('pomodoroPause').addEventListener('click', () => {
    if (!pomoState.active) return;
    pomoState.paused = !pomoState.paused;
    pomoUpdateUI();
  });
  $('pomodoroSkip').addEventListener('click', () => {
    if (!pomoState.active) return;
    pomoNextPhase(false);
  });
  $('pomodoroStop').addEventListener('click', () => {
    stopPomodoro(true);
    toast('Сессия завершена');
    renderTodayPlan();
  });

  // ===================================================================
  //  Today plan widget on День
  // ===================================================================
  function renderTodayPlan() {
    const c = $('todayPlan');
    if (!c) return;
    const subjects = getSubjects();
    const today = internalWeekdayFromDate(new Date());
    const items = [];
    for (const s of subjects) {
      const slots = (s.schedule || []).filter((sl) => sl.weekday === today);
      for (const sl of slots) items.push({ subject: s, slot: sl });
    }
    items.sort((a, b) =>
      (a.slot.hour * 60 + a.slot.minute) - (b.slot.hour * 60 + b.slot.minute)
    );

    if (!subjects.length) {
      c.innerHTML = '';
      return;
    }

    if (!items.length) {
      c.innerHTML = `
        <div class="today-plan">
          <div class="today-plan-head">По плану сегодня</div>
          <div class="muted-line">Сегодня свободный день.</div>
        </div>`;
      return;
    }

    c.innerHTML = `
      <div class="today-plan">
        <div class="today-plan-head">По плану сегодня</div>
        ${items.map(({ subject, slot }) => {
          const next = subject.themes.find((t) => !t.done);
          return `
            <div class="today-plan-row">
              <span class="color-dot" style="background:${subject.color}"></span>
              <div class="today-plan-info">
                <div class="today-plan-name">${escape(subject.name)}</div>
                <div class="today-plan-meta">${pad(slot.hour)}:${pad(slot.minute)} · ${slot.durationMin}м${next ? ' · ' + escape(next.text) : ''}</div>
              </div>
              <button class="ghost today-plan-go" data-subject="${subject.id}">Начать</button>
            </div>`;
        }).join('')}
      </div>`;

    c.querySelectorAll('.today-plan-go').forEach((b) =>
      b.addEventListener('click', () => startPomodoro(b.dataset.subject))
    );
  }

  // ===================================================================
  //  INIT
  // ===================================================================
  loadToday();
  renderTagPicker('tagPicker', currentTag, (id) => { currentTag = id; });
  renderTagPicker('filterPicker', filterTag, (id) => { filterTag = id; renderNotes(); }, true);
  setReminderDefaults();
})();
