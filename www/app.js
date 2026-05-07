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

  // Tiny inline markdown renderer: **bold** + line breaks + bare URLs.
  // Just enough for phase bodies — no library.
  const renderMarkdown = (s) => {
    if (!s) return '';
    let out = escape(s);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/\n/g, '<br>');
    return out;
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
    if (name === 'plan') renderPlanView();
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
    renderTodayCourses();
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
  //  ПЛАН — Course tracker
  // ===================================================================

  // ---- Storage ----
  const getCourses = () => {
    try { return JSON.parse(localStorage.getItem('plan-courses') || '[]'); }
    catch (_) { return []; }
  };
  const saveCourses = (list) =>
    localStorage.setItem('plan-courses', JSON.stringify(list));

  // ---- Markdown course parser ----
  // Exported via window.__parseCourseMarkdown for the sanity test.
  function parseCourseMarkdown(md) {
    if (!md || typeof md !== 'string') {
      return { name: '', goal: '', days: [] };
    }

    // 1) Course name from first H1.
    let name = '';
    const h1 = md.match(/^\s*#\s+(.+)$/m);
    if (h1) name = h1[1].trim();

    // 2) Course goal — line like **Цель:** ... (before any H3 День).
    let goal = '';
    const beforeFirstDay = md.split(/^\s*###\s+День\s+\d+/m)[0] || md;
    const goalMatch = beforeFirstDay.match(/\*\*\s*Цель\s*:?\s*\*\*\s*(.+)/);
    if (goalMatch) goal = goalMatch[1].trim();

    // 3) Split into day blocks. Use lookahead so we keep the heading line.
    // Day heading: ### День N [— title]   (allow extra spaces, em-dash, hyphen, colon)
    const dayBlocks = [];
    const dayRe = /^###\s+День\s+(\d+)\s*(?:[—\-:–]\s*(.*))?$/gm;
    const matches = [];
    let m;
    while ((m = dayRe.exec(md)) !== null) {
      matches.push({ index: m.index, end: dayRe.lastIndex, n: parseInt(m[1], 10), title: (m[2] || '').trim() });
    }
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const next = matches[i + 1];
      const blockEnd = next ? next.index : md.length;
      // Body of this day (excluding its heading line).
      const body = md.slice(cur.end, blockEnd);
      dayBlocks.push({ n: cur.n, title: cur.title, body });
    }

    // 4) Phase parser inside each day's body.
    // Phase heading: a line starting with "**" containing "· N мин" or "· N min".
    // Examples:
    //   **🧠 Теория · 30 мин**
    //   **📺 Видео · 20 мин**
    //   **🎯 Практика · 70 мин** — 30 заданий №4
    //   **📋 Аналитика · 30 мин** — стандарт.
    //   **🎯 КОНТРОЛЬНАЯ №1 · 30 мин**
    // Phase heading: a "**...**" line that contains "· N мин" somewhere inside.
    // We allow extra text on either side of the duration so headings like
    // "**🧠 Теория · 30 мин · Задание 6 (...)**" still match.
    const PHASE_RE = /^\*\*([^*\n]*?·\s*\d+\s*мин[^*\n]*)\*\*\s*(.*)$/gm;
    // Goal line: **✅ Цель:** ...
    const GOAL_RE = /^\*\*\s*[✅✓]?\s*Цель\s*:?\s*\*\*\s*(.+)$/m;
    // "---" terminates the block.

    const detectType = (label) => {
      if (/🧠|теори/i.test(label)) return 'theory';
      if (/📺|видео/i.test(label)) return 'video';
      if (/🎯|практик|контрольн|сочинени|проб/i.test(label)) return 'practice';
      if (/📋|аналитик|разбор|самопроверк/i.test(label)) return 'analytics';
      if (/⌚|⏱|✍️|🌙|утр/i.test(label)) return 'other';
      return 'other';
    };

    const cleanLabel = (raw) => {
      // raw = "🧠 Теория · 30 мин" → "Теория"
      const noEmoji = raw
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}️]/gu, '')
        .trim();
      const beforeDot = noEmoji.split('·')[0].trim();
      return beforeDot || 'Этап';
    };

    const days = dayBlocks.map(({ n, title, body }) => {
      // Cut at horizontal rule "---" (separator before next H2/H3).
      const hrIdx = body.search(/^\s*---\s*$/m);
      const blockBody = hrIdx >= 0 ? body.slice(0, hrIdx) : body;

      // Find phases.
      const phaseMatches = [];
      PHASE_RE.lastIndex = 0;
      let pm;
      while ((pm = PHASE_RE.exec(blockBody)) !== null) {
        phaseMatches.push({
          start: pm.index,
          headEnd: PHASE_RE.lastIndex,
          headInner: pm[1].trim(),       // e.g. "🧠 Теория · 30 мин"
          tail: (pm[2] || '').trim(),    // e.g. "— 30 заданий №4"
        });
      }

      const phases = phaseMatches.map((ph, i) => {
        const next = phaseMatches[i + 1];
        const phaseBody = blockBody.slice(ph.headEnd, next ? next.start : blockBody.length).trim();
        const minMatch = ph.headInner.match(/(\d+)\s*мин/);
        const minutes = minMatch ? parseInt(minMatch[1], 10) : 30;
        const label = cleanLabel(ph.headInner);
        const type = detectType(ph.headInner);
        // Combine tail (text after **...**) with body — tail often has "— подробности".
        const fullBody = (ph.tail ? ph.tail + '\n' : '') + phaseBody;
        return { type, label, minutes, body: fullBody.trim() };
      });

      // Day goal text.
      let goalText = '';
      const gm = blockBody.match(GOAL_RE);
      if (gm) goalText = gm[1].trim();

      return {
        n,
        title: title || `День ${n}`,
        phases,
        goalText,
        done: false,
        actualPercent: null,
        notes: '',
      };
    });

    return { name, goal, days };
  }
  // Expose for sanity test.
  if (typeof window !== 'undefined') window.__parseCourseMarkdown = parseCourseMarkdown;

  // ---- Plan view state ----
  let planView = 'courses';     // 'courses' | 'course' | 'day'
  let activeCourseId = null;
  let activeDayN = null;

  function renderPlanView() {
    $('planCourses').hidden = planView !== 'courses';
    $('planCourseDetail').hidden = planView !== 'course';
    $('planDayDetail').hidden = planView !== 'day';

    if (planView === 'courses') renderCoursesList();
    else if (planView === 'course') renderCourseDetail();
    else if (planView === 'day') renderDayDetail();
  }

  // ---- View 1: courses list ----
  function renderCoursesList() {
    const courses = getCourses();
    const c = $('coursesList');
    if (!courses.length) {
      c.innerHTML = `
        <div class="empty-course">
          <div class="empty-course-text">Курсов пока нет.<br>Скопируй markdown своего курса и вставь сюда.</div>
          <button class="primary" id="emptyImportBtn">+ Импортировать курс</button>
        </div>
      `;
      $('emptyImportBtn').addEventListener('click', openImportModal);
      return;
    }

    c.innerHTML = courses.map((cr) => {
      const total = cr.days.length;
      const done = cr.days.filter((d) => d.done).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      return `
        <div class="course-card" data-course="${cr.id}">
          <div class="course-card-head">
            <div class="course-name">${escape(cr.name)}</div>
            <button class="course-menu-btn" data-course-menu="${cr.id}" aria-label="Меню">⋯</button>
          </div>
          ${cr.goal ? `<div class="course-goal">${escape(cr.goal)}</div>` : ''}
          <div class="course-progress-row">
            <span>${done} / ${total} дней</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');

    // Click course → open
    c.querySelectorAll('.course-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.course-menu-btn')) return;
        activeCourseId = el.dataset.course;
        planView = 'course';
        renderPlanView();
      });
    });

    // Course menu (delete)
    c.querySelectorAll('.course-menu-btn').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = b.dataset.courseMenu;
        const cr = getCourses().find((x) => x.id === id);
        if (!cr) return;
        if (!confirm(`Удалить курс «${cr.name}»?`)) return;
        saveCourses(getCourses().filter((x) => x.id !== id));
        renderCoursesList();
        toast('Курс удалён');
      });
    });
  }

  // ---- View 2: course detail (day list) ----
  function renderCourseDetail() {
    const cr = getCourses().find((x) => x.id === activeCourseId);
    if (!cr) { planView = 'courses'; renderPlanView(); return; }

    const total = cr.days.length;
    const done = cr.days.filter((d) => d.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const todayKey = dateKey();
    const todayIdx = daysBetween(cr.startDate, todayKey) + 1; // 1-based n

    $('courseDetailHead').innerHTML = `
      <div class="course-detail-name">${escape(cr.name)}</div>
      ${cr.goal ? `<div class="course-detail-goal">${escape(cr.goal)}</div>` : ''}
      <div class="course-progress-row">
        <span>${done} / ${total} дней</span>
        <span>${pct}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="course-detail-start">Старт: ${formatDate(cr.startDate)}</div>
    `;

    $('daysList').innerHTML = cr.days.map((d) => {
      const status = d.done
        ? 'done'
        : (d.actualPercent != null || (d.notes && d.notes.length))
          ? 'progress'
          : 'todo';
      const icon = status === 'done' ? '✓' : (status === 'progress' ? '⌛' : '☐');
      const isToday = d.n === todayIdx;
      const pctText = d.actualPercent != null ? ` · ${d.actualPercent}%` : '';
      return `
        <div class="day-row${isToday ? ' today' : ''}" data-day="${d.n}">
          <div class="day-num">${d.n}</div>
          <div class="day-info">
            <div class="day-title">${escape(d.title)}</div>
            ${d.goalText ? `<div class="day-goal">Цель: ${escape(d.goalText)}${pctText}</div>` : (pctText ? `<div class="day-goal">${pctText.replace(/^\s·\s/, '')}</div>` : '')}
          </div>
          <div class="day-status status-${status}">${icon}</div>
        </div>
      `;
    }).join('');

    $('daysList').querySelectorAll('.day-row').forEach((row) => {
      row.addEventListener('click', () => {
        activeDayN = parseInt(row.dataset.day, 10);
        planView = 'day';
        renderPlanView();
      });
    });
  }

  // ---- View 3: day detail ----
  function renderDayDetail() {
    const cr = getCourses().find((x) => x.id === activeCourseId);
    if (!cr) { planView = 'courses'; renderPlanView(); return; }
    const day = cr.days.find((d) => d.n === activeDayN);
    if (!day) { planView = 'course'; renderPlanView(); return; }

    const plannedKey = addDays(cr.startDate, day.n - 1);

    const phaseIcon = (type) => {
      if (type === 'theory') return '🧠';
      if (type === 'video') return '📺';
      if (type === 'practice') return '🎯';
      if (type === 'analytics') return '📋';
      return '⏱';
    };

    const phasesHtml = day.phases.map((p, i) => `
      <div class="phase-card" data-phase="${i}">
        <div class="phase-head">
          <div class="phase-icon">${phaseIcon(p.type)}</div>
          <div class="phase-label">${escape(p.label)}</div>
          <div class="phase-min">${p.minutes} мин</div>
        </div>
        ${p.body ? `<div class="phase-body">${renderMarkdown(p.body)}</div>` : ''}
        <button class="ghost phase-start" data-phase-start="${i}">▶ Запустить таймер</button>
      </div>
    `).join('');

    $('dayDetailBody').innerHTML = `
      <div class="day-detail-head">
        <div class="day-detail-title">День ${day.n} · ${escape(day.title)}</div>
        <div class="day-detail-sub">Дата по плану: ${formatDate(plannedKey)}</div>
        ${day.goalText ? `<div class="day-detail-goal">Цель: ${escape(day.goalText)}</div>` : ''}
      </div>

      ${phasesHtml || '<div class="muted-line">У этого дня нет этапов.</div>'}

      <div class="divider"></div>

      <div class="field">
        <label>Фактический результат, %</label>
        <input type="number" id="dayActualPct" min="0" max="100" placeholder="0–100" value="${day.actualPercent != null ? day.actualPercent : ''}">
      </div>

      <div class="field">
        <div class="label-row">
          <label>Заметки по дню</label>
          <button class="mic" data-target="dayNotes" aria-label="Голос">🎤</button>
        </div>
        <textarea id="dayNotes" placeholder="Что получилось, какие ошибки…">${escape(day.notes || '')}</textarea>
      </div>

      <button class="primary" id="dayDoneBtn">${day.done ? 'Снять отметку' : 'Отметить пройденным'}</button>
    `;

    // Phase start buttons
    $('dayDetailBody').querySelectorAll('[data-phase-start]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.phaseStart, 10);
        const ph = day.phases[idx];
        if (!ph) return;
        startPhaseTimer(ph, day);
      });
    });

    // Auto-save on blur
    $('dayActualPct').addEventListener('blur', () => {
      const v = $('dayActualPct').value.trim();
      const num = v === '' ? null : Math.max(0, Math.min(100, parseInt(v, 10) || 0));
      mutateDay((d) => { d.actualPercent = num; });
    });
    $('dayNotes').addEventListener('blur', () => {
      const v = $('dayNotes').value;
      mutateDay((d) => { d.notes = v; });
    });

    $('dayDoneBtn').addEventListener('click', () => {
      mutateDay((d) => { d.done = !d.done; });
      toast(day.done ? 'Снято' : 'День пройден ✓');
      renderDayDetail();
    });
  }

  function mutateDay(fn) {
    const list = getCourses();
    const cr = list.find((x) => x.id === activeCourseId);
    if (!cr) return;
    const d = cr.days.find((x) => x.n === activeDayN);
    if (!d) return;
    fn(d);
    saveCourses(list);
  }

  // ---- Back buttons ----
  $('backToCoursesBtn').addEventListener('click', () => {
    planView = 'courses';
    renderPlanView();
  });
  $('backToDaysBtn').addEventListener('click', () => {
    planView = 'course';
    renderPlanView();
  });

  // ===================================================================
  //  Import modal
  // ===================================================================
  function openImportModal() {
    $('importName').value = '';
    $('importGoal').value = '';
    $('importStart').value = dateKey();
    $('importMarkdown').value = '';
    $('importOverlay').hidden = false;
    setTimeout(() => $('importMarkdown').focus(), 50);
  }
  function closeImportModal() {
    $('importOverlay').hidden = true;
  }

  $('openImportBtn').addEventListener('click', openImportModal);
  $('importCloseBtn').addEventListener('click', closeImportModal);
  $('importCancelBtn').addEventListener('click', closeImportModal);

  // Auto-fill name+goal as user types/pastes markdown.
  $('importMarkdown').addEventListener('input', () => {
    const md = $('importMarkdown').value;
    if (!md) return;
    const parsed = parseCourseMarkdown(md);
    if (parsed.name && !$('importName').value.trim()) {
      $('importName').value = parsed.name;
    }
    if (parsed.goal && !$('importGoal').value.trim()) {
      $('importGoal').value = parsed.goal;
    }
  });

  $('importDoBtn').addEventListener('click', () => {
    const md = $('importMarkdown').value;
    if (!md.trim()) { toast('Вставь markdown курса'); return; }

    const parsed = parseCourseMarkdown(md);
    if (!parsed.days.length) {
      toast('Не нашёл дней. Заголовки должны быть `### День N — Название`');
      return;
    }

    const totalPhases = parsed.days.reduce((acc, d) => acc + d.phases.length, 0);
    if (!confirm(`Найдено: ${parsed.days.length} дней, ${totalPhases} фаз. Импортировать?`)) {
      return;
    }

    const name = ($('importName').value.trim() || parsed.name || 'Мой курс');
    const goal = $('importGoal').value.trim() || parsed.goal || '';
    const startDate = $('importStart').value || dateKey();

    const course = {
      id: newId(),
      name,
      goal,
      startDate,
      days: parsed.days,
    };

    const list = getCourses();
    list.push(course);
    saveCourses(list);
    closeImportModal();
    toast(`Импортировано: ${parsed.days.length} дней`);
    planView = 'courses';
    renderPlanView();
  });

  // ===================================================================
  //  Phase timer (single-shot, replaces old Pomodoro overlay)
  // ===================================================================
  let timerState = {
    active: false,
    phaseLabel: '',
    dayN: null,
    courseName: '',
    remaining: 0,        // seconds
    paused: false,
    interval: null,
    autoCloseAt: 0,      // 0 = no auto close
  };

  const fmtMMSS = (sec) => {
    if (sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${pad(m)}:${pad(s)}`;
  };

  function timerUpdateUI() {
    $('timerTime').textContent = fmtMMSS(timerState.remaining);
    $('timerLabel').textContent = timerState.phaseLabel || '';
    const subParts = [];
    if (timerState.dayN != null) subParts.push(`День ${timerState.dayN}`);
    if (timerState.courseName) subParts.push(timerState.courseName);
    $('timerSub').textContent = subParts.join(' · ');
    $('timerPause').textContent = timerState.paused ? 'Продолжить' : 'Пауза';
  }

  function timerTick() {
    if (!timerState.active) return;
    if (timerState.autoCloseAt && Date.now() >= timerState.autoCloseAt) {
      stopPhaseTimer();
      return;
    }
    if (timerState.paused) return;
    timerState.remaining -= 1;
    if (timerState.remaining <= 0) {
      timerState.remaining = 0;
      $('timerTime').textContent = '00:00';
      $('timerLabel').textContent = (timerState.phaseLabel || 'Этап') + ' завершён';
      try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch (_) {}
      notifyPhaseDone(timerState.phaseLabel || 'Этап');
      // Schedule auto-close in 3 seconds.
      timerState.autoCloseAt = Date.now() + 3000;
      timerState.paused = true; // freeze countdown
    } else {
      $('timerTime').textContent = fmtMMSS(timerState.remaining);
    }
  }

  async function notifyPhaseDone(label) {
    if (!LocalNotifications) return;
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: hashId('timer|' + Date.now() + Math.random()),
          title: 'Дневник',
          body: `${label} завершён`,
          schedule: { at: new Date(Date.now() + 50), allowWhileIdle: true },
          smallIcon: 'ic_stat_icon_config_sample',
        }],
      });
    } catch (_) {}
  }

  function startPhaseTimer(phase, day) {
    if (timerState.active) {
      if (!confirm('Идёт другой таймер. Прервать и запустить новый?')) return;
      stopPhaseTimer(true);
    }
    const cr = getCourses().find((x) => x.id === activeCourseId);
    timerState.active = true;
    timerState.phaseLabel = phase.label;
    timerState.dayN = day.n;
    timerState.courseName = cr ? cr.name : '';
    timerState.remaining = (phase.minutes || 30) * 60;
    timerState.paused = false;
    timerState.autoCloseAt = 0;
    if (timerState.interval) clearInterval(timerState.interval);
    timerState.interval = setInterval(timerTick, 1000);
    timerUpdateUI();
    $('timerOverlay').hidden = false;
  }

  function stopPhaseTimer(silent) {
    if (timerState.interval) clearInterval(timerState.interval);
    timerState.interval = null;
    timerState.active = false;
    timerState.paused = false;
    timerState.autoCloseAt = 0;
    $('timerOverlay').hidden = true;
    if (!silent) toast('Таймер остановлен');
  }

  $('timerPause').addEventListener('click', () => {
    if (!timerState.active) return;
    timerState.paused = !timerState.paused;
    timerUpdateUI();
  });
  $('timerExtend').addEventListener('click', () => {
    if (!timerState.active) return;
    timerState.remaining += 5 * 60;
    timerState.autoCloseAt = 0;
    timerState.paused = false;
    timerUpdateUI();
  });
  $('timerStop').addEventListener('click', () => stopPhaseTimer());

  // ===================================================================
  //  Today widget — "Сегодня по курсам"
  // ===================================================================
  function renderTodayCourses() {
    const c = $('todayCourses');
    if (!c) return;
    const courses = getCourses();
    if (!courses.length) { c.innerHTML = ''; return; }

    const todayKey = dateKey();
    const rowsHtml = courses.map((cr) => {
      const idx = daysBetween(cr.startDate, todayKey) + 1;
      const total = cr.days.length;
      let body;
      if (idx < 1) {
        const left = 1 - idx;
        body = `<div class="today-course-meta">До старта осталось ${left} ${pluralDays(left)}</div>`;
      } else if (idx > total) {
        const done = cr.days.filter((d) => d.done).length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        body = `<div class="today-course-meta">Курс завершён · ${pct}%</div>`;
      } else {
        const day = cr.days[idx - 1];
        const isDone = day.done ? ' ✓' : '';
        body = `
          <div class="today-course-meta">Сегодня День ${day.n}: ${escape(day.title)}${isDone}</div>
          <button class="ghost today-course-go" data-course="${cr.id}" data-day="${day.n}">Открыть</button>
        `;
      }
      return `
        <div class="today-course-row">
          <div class="today-course-name">${escape(cr.name)}</div>
          ${body}
        </div>
      `;
    }).join('');

    c.innerHTML = `
      <div class="today-courses">
        <div class="today-courses-head">Сегодня по курсам</div>
        ${rowsHtml}
      </div>
    `;

    c.querySelectorAll('.today-course-go').forEach((b) => {
      b.addEventListener('click', () => {
        activeCourseId = b.dataset.course;
        activeDayN = parseInt(b.dataset.day, 10);
        planView = 'day';
        switchTab('plan');
      });
    });
  }

  function pluralDays(n) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m100 >= 11 && m100 <= 14) return 'дней';
    if (m10 === 1) return 'день';
    if (m10 >= 2 && m10 <= 4) return 'дня';
    return 'дней';
  }

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

  function renderForceResyncRow(wrap) {
    const link = document.createElement('button');
    link.className = 'menu-item';
    link.style.opacity = '0.7';
    link.style.fontSize = '13px';
    link.textContent = 'Перепроверить · Пересобрать';
    link.addEventListener('click', async () => {
      link.disabled = true;
      link.textContent = 'Скачиваю…';
      try {
        await window.OTA.forceResync();
        // capgo .set() reloads the WebView, so we shouldn't reach here.
      } catch (e) {
        link.textContent = 'Ошибка — нет интернета';
        setTimeout(() => renderOtaMenuRow(), 1500);
      }
    });
    wrap.appendChild(link);
  }

  async function renderOtaMenuRow() {
    if (!window.OTA) return;
    const wrap = ensureMenuVersionEl();
    if (!wrap) return;

    let cur;
    try { cur = await window.OTA.getCurrent(); }
    catch (_) { cur = { bundle: { version: 'unknown' } }; }
    const curVersion = (cur && cur.bundle && cur.bundle.version) || 'unknown';

    let info;
    try { info = await window.OTA.checkUpdate(); }
    catch (_) { info = { available: false, currentVersion: curVersion, offline: true }; }

    wrap.innerHTML = '';

    if (info.available) {
      const btn = document.createElement('button');
      btn.className = 'menu-item menu-update';
      btn.id = 'otaUpdateBtn';
      btn.innerHTML =
        '<span class="dot"></span>' +
        '<span>' +
          '<span class="menu-update-title">Доступно обновление</span>' +
          '<span class="menu-version-sub">v' + escapeText(curVersion) +
            ' → v' + escapeText(info.version) + '</span>' +
        '</span>';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.innerHTML = '<span>Скачиваю…</span>';
        try {
          await window.OTA.download_and_apply(info.url, info.version, info.code);
          // capgo .set() reloads the WebView.
        } catch (e) {
          btn.innerHTML = '<span>Ошибка — проверь интернет</span>';
          setTimeout(() => renderOtaMenuRow(), 1500);
        }
      });
      wrap.appendChild(btn);
    } else if (info.offline) {
      const div = document.createElement('div');
      div.className = 'menu-version-static';
      div.innerHTML =
        '<span class="menu-version-title">Версия v' + escapeText(curVersion) +
          ' · оффлайн</span>';
      wrap.appendChild(div);
      renderForceResyncRow(wrap);
    } else {
      const div = document.createElement('div');
      div.className = 'menu-version-static';
      div.innerHTML =
        '<span class="menu-version-title">Максимальная версия</span>' +
        '<span class="menu-version-sub">v' + escapeText(curVersion) + '</span>';
      wrap.appendChild(div);
      renderForceResyncRow(wrap);
    }
  }

  window.addEventListener('ota:ready', () => { renderOtaMenuRow(); });
  // If updater.js already fired the event before app.js attached the
  // listener (race on cold boot), schedule one render anyway.
  if (window.OTA) setTimeout(renderOtaMenuRow, 0);

  // ===================================================================
  //  INIT
  // ===================================================================
  loadToday();
  renderTagPicker('tagPicker', currentTag, (id) => { currentTag = id; });
  renderTagPicker('filterPicker', filterTag, (id) => { filterTag = id; renderNotes(); }, true);
  setReminderDefaults();
})();
