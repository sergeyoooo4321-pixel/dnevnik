(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const Cap = window.Capacitor;
  const LocalNotifications = Cap && Cap.Plugins ? Cap.Plugins.LocalNotifications : null;

  const todayKey = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const formatDate = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatDateTime = (iso) =>
    new Date(iso).toLocaleString('ru-RU', {
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
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  };

  // ---- Tabs ----
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
      tab.classList.add('active');
      $(tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'history') renderHistory();
      if (tab.dataset.tab === 'reminders') renderReminders();
    });
  });

  // ---- Today ----
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
    $('todayDate').textContent = formatDate(todayKey());
    const raw = localStorage.getItem('entry-' + todayKey());
    const entry = raw ? JSON.parse(raw) : null;
    currentRating = entry?.rating || 0;
    $('done').value = entry?.done || '';
    $('improve').value = entry?.improve || '';
    $('notes').value = entry?.notes || '';
    $('ratingValue').textContent = currentRating ? `${currentRating} / 10` : '—';
    renderStars(currentRating);
  };

  $('save').addEventListener('click', () => {
    const entry = {
      date: todayKey(),
      rating: currentRating,
      done: $('done').value.trim(),
      improve: $('improve').value.trim(),
      notes: $('notes').value.trim(),
      updatedAt: Date.now(),
    };
    localStorage.setItem('entry-' + todayKey(), JSON.stringify(entry));
    toast('Сохранено');
  });

  // ---- History ----
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
      .map(
        (e) => `
        <div class="entry">
          <div class="entry-header">
            <span class="entry-date">${formatDate(e.date)}</span>
            <span class="entry-rating">${e.rating ? '★'.repeat(e.rating) + '☆'.repeat(10 - e.rating) : '—'}</span>
          </div>
          ${block('Сделал', e.done)}
          ${block('Улучшить', e.improve)}
          ${block('Заметки', e.notes)}
        </div>`
      )
      .join('');
  };

  // ---- Reminders ----
  const getReminders = () => {
    try {
      return JSON.parse(localStorage.getItem('reminders') || '[]');
    } catch (_) {
      return [];
    }
  };

  const saveReminders = (list) =>
    localStorage.setItem('reminders', JSON.stringify(list));

  const renderReminders = () => {
    const all = getReminders();
    const future = all.filter((r) => new Date(r.time) > new Date());
    if (future.length !== all.length) saveReminders(future);

    future.sort((a, b) => a.time.localeCompare(b.time));
    const c = $('remindersList');

    if (!future.length) {
      c.innerHTML = '<div class="empty">Активных напоминаний нет</div>';
      return;
    }

    c.innerHTML = future
      .map(
        (r) => `
        <div class="reminder">
          <div class="reminder-info">
            <div class="reminder-text">${escape(r.text)}</div>
            <div class="reminder-time">${formatDateTime(r.time)}</div>
          </div>
          <button class="delete" data-id="${r.id}" aria-label="Удалить">×</button>
        </div>`
      )
      .join('');

    c.querySelectorAll('.delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        saveReminders(getReminders().filter((r) => r.id !== id));
        if (LocalNotifications) {
          try {
            await LocalNotifications.cancel({ notifications: [{ id }] });
          } catch (_) {}
        }
        renderReminders();
      });
    });
  };

  $('addReminder').addEventListener('click', async () => {
    const text = $('reminderText').value.trim();
    const time = $('reminderTime').value;
    if (!text || !time) {
      toast('Заполни сообщение и время');
      return;
    }

    const when = new Date(time);
    if (isNaN(when.getTime()) || when <= new Date()) {
      toast('Время должно быть в будущем');
      return;
    }

    const id = Math.floor(Math.random() * 2_000_000_000);

    if (LocalNotifications) {
      try {
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') {
          const req = await LocalNotifications.requestPermissions();
          if (req.display !== 'granted') {
            toast('Разреши уведомления в настройках');
            return;
          }
        }
        await LocalNotifications.schedule({
          notifications: [
            {
              id,
              title: 'Дневник',
              body: text,
              schedule: { at: when, allowWhileIdle: true },
              smallIcon: 'ic_stat_icon_config_sample',
            },
          ],
        });
      } catch (e) {
        console.error('schedule failed', e);
        toast('Не удалось поставить напоминание');
        return;
      }
    }

    const list = getReminders();
    list.push({ id, text, time: when.toISOString() });
    saveReminders(list);

    $('reminderText').value = '';
    setDefaultReminderTime();
    renderReminders();
    toast('Напоминание поставлено');
  });

  const setDefaultReminderTime = () => {
    const next = new Date();
    next.setMinutes(next.getMinutes() + 60, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
    $('reminderTime').min = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    })();
    $('reminderTime').value = local;
  };

  // ---- Init ----
  loadToday();
  setDefaultReminderTime();
})();
