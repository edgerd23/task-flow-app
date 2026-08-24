/* TaskFlow — vanilla JS app.
   Layers: Store (localStorage) -> TaskService -> Analytics -> UI controller. */
(() => {
  'use strict';

  // ---------- Constants ----------
  const KEY = 'taskflow.v1';
  const ACCENTS = ['#6d5efc', '#0ea5e9', '#12b886', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#334155'];
  const PRIORITIES = ['high', 'medium', 'low'];
  const PRIO_RANK = { high: 0, medium: 1, low: 2 };
  const DEFAULT_CATEGORIES = ['General', 'Work', 'Personal', 'Study', 'Health'];
  const VIEWS = [
    { id: 'dashboard', label: 'Dashboard', sub: 'Your day at a glance', icon: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z' },
    { id: 'tasks', label: 'Tasks', sub: 'Everything on your plate', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
    { id: 'completed', label: 'Completed', sub: 'Work you have finished', icon: 'M20 6L9 17l-5-5' },
    { id: 'analytics', label: 'Analytics', sub: 'How your productivity trends', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
    { id: 'settings', label: 'Settings', sub: 'Theme, data and preferences', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003.5 15a2 2 0 11 0-4h.2a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010.6 4h.1a2 2 0 014 0v.2a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9h.1a2 2 0 010 4h-.2a1.7 1.7 0 00-1.6 1z' }
  ];

  // ---------- Utilities ----------
  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => 't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d.split('|').map(p => `<path d="${p}"/>`).join('')}</svg>`;
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const dayKey = (ts) => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function dueLabel(due) {
    if (!due) return null;
    const t = todayISO();
    if (due === t) return { text: 'Today', cls: 'today' };
    if (due < t) {
      const days = Math.round((new Date(t) - new Date(due)) / 864e5);
      return { text: days === 1 ? 'Overdue by 1 day' : `Overdue by ${days} days`, cls: 'overdue' };
    }
    const days = Math.round((new Date(due) - new Date(t)) / 864e5);
    if (days === 1) return { text: 'Tomorrow', cls: '' };
    if (days <= 7) return { text: `In ${days} days`, cls: '' };
    return { text: new Date(due + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: '' };
  }

  // ---------- Data layer ----------
  const blank = () => ({
    tasks: [],
    settings: { theme: 'system', accent: ACCENTS[0], categories: [...DEFAULT_CATEGORIES] }
  });

  function normalizeTask(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !raw.title.trim()) return null;
    const now = Date.now();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      title: raw.title.trim().slice(0, 140),
      description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '',
      category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim().slice(0, 24) : 'General',
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'medium',
      due: /^\d{4}-\d{2}-\d{2}$/.test(raw.due || '') ? raw.due : '',
      completed: !!raw.completed,
      pinned: !!raw.pinned,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
      completedAt: raw.completed ? (Number.isFinite(raw.completedAt) ? raw.completedAt : now) : null
    };
  }

  const Store = {
    load() {
      try {
        const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (!parsed) return blank();
        const s = blank();
        s.tasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask).filter(Boolean) : [];
        const ps = parsed.settings || {};
        if (['light', 'dark', 'system'].includes(ps.theme)) s.settings.theme = ps.theme;
        if (typeof ps.accent === 'string' && /^#[0-9a-f]{6}$/i.test(ps.accent)) s.settings.accent = ps.accent;
        if (Array.isArray(ps.categories) && ps.categories.length) {
          s.settings.categories = [...new Set(ps.categories.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim().slice(0, 24)))];
        }
        return s;
      } catch { return blank(); }
    },
    save(state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
      catch { toast('Could not save — browser storage is full or blocked.', 'bad'); return false; }
    },
    clear() { try { localStorage.removeItem(KEY); } catch {} }
  };

  let state = Store.load();
  const persist = () => Store.save(state);

  // ---------- Task service ----------
  const Tasks = {
    all: () => state.tasks,
    get: (id) => state.tasks.find(t => t.id === id),
    add(data) {
      const t = normalizeTask({ ...data, createdAt: Date.now(), updatedAt: Date.now() });
      if (!t) return null;
      state.tasks.unshift(t); persist(); return t;
    },
    update(id, patch) {
      const t = Tasks.get(id); if (!t) return null;
      Object.assign(t, patch, { updatedAt: Date.now() });
      if (t.completed && !t.completedAt) t.completedAt = Date.now();
      if (!t.completed) t.completedAt = null;
      persist(); return t;
    },
    remove(id) { state.tasks = state.tasks.filter(t => t.id !== id); persist(); },
    toggle(id) {
      const t = Tasks.get(id); if (!t) return;
      Tasks.update(id, { completed: !t.completed, completedAt: !t.completed ? Date.now() : null });
    },
    query({ search = '', status = 'all', category = 'all', priority = 'all', due = 'all', sort = 'newest' } = {}) {
      const q = search.trim().toLowerCase();
      const today = todayISO();
      let list = state.tasks.filter(t => {
        if (q && !(t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))) return false;
        if (status === 'active' && t.completed) return false;
        if (status === 'completed' && !t.completed) return false;
        if (status === 'pinned' && !t.pinned) return false;
        if (category !== 'all' && t.category !== category) return false;
        if (priority !== 'all' && t.priority !== priority) return false;
        if (due !== 'all') {
          if (due === 'none' && t.due) return false;
          if (due === 'today' && t.due !== today) return false;
          if (due === 'overdue' && !(t.due && t.due < today && !t.completed)) return false;
          if (due === 'week') {
            if (!t.due) return false;
            const diff = (new Date(t.due) - new Date(today)) / 864e5;
            if (diff < 0 || diff > 7) return false;
          }
        }
        return true;
      });
      const cmp = {
        newest: (a, b) => b.createdAt - a.createdAt,
        oldest: (a, b) => a.createdAt - b.createdAt,
        priority: (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || b.createdAt - a.createdAt,
        due: (a, b) => (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31') || b.createdAt - a.createdAt,
        alpha: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      }[sort] || ((a, b) => b.createdAt - a.createdAt);
      return list.sort((a, b) => (b.pinned - a.pinned) || cmp(a, b));
    }
  };

  // ---------- Analytics ----------
  const Analytics = {
    summary() {
      const t = state.tasks;
      const today = todayISO();
      const completed = t.filter(x => x.completed);
      const pending = t.filter(x => !x.completed);
      return {
        total: t.length,
        completed: completed.length,
        pending: pending.length,
        pinned: t.filter(x => x.pinned && !x.completed).length,
        overdue: pending.filter(x => x.due && x.due < today).length,
        dueToday: pending.filter(x => x.due === today).length,
        highPriority: pending.filter(x => x.priority === 'high').length,
        completedToday: completed.filter(x => x.completedAt && dayKey(x.completedAt) === today).length,
        rate: t.length ? Math.round((completed.length / t.length) * 100) : 0
      };
    },
    groupBy(field) {
      const map = new Map();
      for (const t of state.tasks) {
        const k = t[field] || 'Uncategorized';
        const e = map.get(k) || { key: k, total: 0, done: 0 };
        e.total++; if (t.completed) e.done++;
        map.set(k, e);
      }
      return [...map.values()].sort((a, b) => b.total - a.total);
    },
    last7Days() {
      const out = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = dayKey(d.getTime());
        out.push({
          key,
          label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
          count: state.tasks.filter(t => t.completedAt && dayKey(t.completedAt) === key).length
        });
      }
      return out;
    },
    streak() {
      let n = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = dayKey(d.getTime());
        const hit = state.tasks.some(t => t.completedAt && dayKey(t.completedAt) === key);
        if (hit) n++; else if (i > 0) break;
      }
      return n;
    }
  };

  // ---------- UI state ----------
  const ui = {
    view: 'dashboard',
    filters: { search: '', status: 'active', category: 'all', priority: 'all', due: 'all', sort: 'newest' },
    doneSort: 'newest',
    editing: null
  };

  // ---------- Theme ----------
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const { theme, accent } = state.settings;
    const dark = theme === 'dark' || (theme === 'system' && mql.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--accent', accent);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = accent;
    document.querySelectorAll('[data-theme-pick]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.themePick === theme)));
    document.querySelectorAll('.sw[data-accent]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.accent.toLowerCase() === accent.toLowerCase())));
  }
  mql.addEventListener('change', () => { if (state.settings.theme === 'system') applyTheme(); });

  // ---------- Toasts ----------
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, 2600);
  }

  // ---------- Confirm dialog ----------
  function confirmAsk(title, body, confirmLabel = 'Confirm') {
    return new Promise(resolve => {
      const dlg = $('#confirmDialog');
      $('#cfmTitle').textContent = title;
      $('#cfmBody').textContent = body;
      $('#cfmYes').textContent = confirmLabel;
      const done = (val) => { dlg.close(); $('#cfmYes').onclick = null; $('#cfmNo').onclick = null; resolve(val); };
      $('#cfmYes').onclick = () => done(true);
      $('#cfmNo').onclick = () => done(false);
      dlg.addEventListener('close', () => resolve(false), { once: true });
      dlg.showModal();
    });
  }

  // ---------- Rendering: nav ----------
  function renderNav() {
    const s = Analytics.summary();
    const counts = { dashboard: null, tasks: s.pending, completed: s.completed, analytics: null, settings: null };
    $('#nav').innerHTML = VIEWS.map(v => `
      <button class="nav-btn" data-view="${v.id}" ${ui.view === v.id ? 'aria-current="page"' : ''}>
        ${svg(v.icon)}<span>${v.label}</span>
        ${counts[v.id] ? `<span class="nav-count">${counts[v.id]}</span>` : ''}
      </button>`).join('');
  }

  // ---------- Rendering: task item ----------
  function taskItem(t) {
    const d = dueLabel(t.due);
    const overdue = d && d.cls === 'overdue' && !t.completed;
    return `<li class="task ${t.completed ? 'done' : ''}" data-priority="${t.priority}" data-id="${t.id}">
      <button class="check" data-act="toggle" aria-label="${t.completed ? 'Mark as pending' : 'Mark as complete'}" aria-pressed="${t.completed}">
        ${svg('M20 6L9 17l-5-5')}
      </button>
      <div class="task-main">
        <div class="task-title">
          ${t.pinned ? `<span class="pinned-flag" title="Pinned">${svg('M15 3l6 6-3 1-4 4-1 6-3-3-5 5 5-5-3-3 6-1 4-4z')}</span>` : ''}
          <span>${esc(t.title)}</span>
        </div>
        ${t.description ? `<div class="task-desc">${esc(t.description)}</div>` : ''}
        <div class="meta">
          <span class="tag ${t.priority}">${cap(t.priority)}</span>
          <span class="tag">${esc(t.category)}</span>
          ${d ? `<span class="tag ${t.completed ? '' : d.cls}">${overdue ? '' : ''}${esc(d.text)}</span>` : ''}
          ${t.completed && t.completedAt ? `<span class="tag">Done ${new Date(t.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-btn ${t.pinned ? 'on' : ''}" data-act="pin" aria-label="${t.pinned ? 'Unpin task' : 'Pin task'}">${svg('M15 3l6 6-3 1-4 4-1 6-3-3-5 5 5-5-3-3 6-1 4-4z')}</button>
        <button class="icon-btn" data-act="edit" aria-label="Edit task">${svg('M4 20h4L20 8l-4-4L4 16z')}</button>
        <button class="icon-btn del" data-act="delete" aria-label="Delete task">${svg('M4 7h16|M10 11v6M14 11v6|M6 7l1 13h10l1-13|M9 7V4h6v3')}</button>
      </div>
    </li>`;
  }

  function emptyState(title, body) {
    return `<div class="empty">${svg('M9 11l3 3 6-6|M21 12a9 9 0 11-9-9', 'icon')}
      <h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
  }

  // ---------- Rendering: dashboard ----------
  function statCard(icoCls, icon, label, value, note) {
    return `<div class="card stat">
      <div class="stat-top"><span class="stat-ico ${icoCls}">${svg(icon)}</span>${esc(label)}</div>
      <div class="stat-val">${value}</div>
      <div class="stat-note">${esc(note)}</div>
    </div>`;
  }

  function renderDashboard() {
    const s = Analytics.summary();
    $('#dashStats').innerHTML = [
      statCard('', 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', 'Total tasks', s.total, s.total ? `${s.pinned} pinned` : 'Add your first task'),
      statCard('o', 'M12 7v5l3 2|M21 12a9 9 0 11-9-9', 'Pending', s.pending, `${s.dueToday} due today`),
      statCard('g', 'M20 6L9 17l-5-5', 'Completed', s.completed, `${s.completedToday} finished today`),
      statCard('r', 'M12 9v4M12 17h.01|M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z', 'Needs attention', s.overdue + s.highPriority, `${s.overdue} overdue · ${s.highPriority} high priority`)
    ].join('');

    const today = todayISO();
    const focus = Tasks.query({ status: 'active', sort: 'due' })
      .filter(t => t.due && t.due <= today).slice(0, 8);
    const fallback = focus.length ? focus : Tasks.query({ status: 'active', sort: 'priority' }).slice(0, 5);
    $('#todayList').innerHTML = fallback.length
      ? fallback.map(taskItem).join('')
      : emptyState('Nothing scheduled', 'You are all clear. Add a task to get moving.');

    $('#dashProgress').innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
        <b>${s.rate}% complete</b><span style="color:var(--faint)">${s.completed}/${s.total} tasks</span>
      </div>
      <div class="progress"><i style="width:${s.rate}%"></i></div>
      <div class="mini" style="margin-top:14px">
        <div><b>${s.completedToday}</b><span>Done today</span></div>
        <div><b>${Analytics.streak()}</b><span>Day streak</span></div>
        <div><b>${s.overdue}</b><span>Overdue</span></div>
      </div>`;
  }

  // ---------- Rendering: tasks ----------
  function selectField(label, key, options, value) {
    return `<div class="field"><label for="f-${key}">${label}</label>
      <select id="f-${key}" data-filter="${key}">
        ${options.map(o => `<option value="${esc(o.v)}" ${o.v === value ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}
      </select></div>`;
  }

  function renderTasks() {
    const cats = state.settings.categories;
    const f = ui.filters;
    $('#taskFilters').innerHTML = [
      selectField('Status', 'status', [
        { v: 'all', l: 'All' }, { v: 'active', l: 'Pending' }, { v: 'completed', l: 'Completed' }, { v: 'pinned', l: 'Pinned' }], f.status),
      selectField('Category', 'category', [{ v: 'all', l: 'All' }, ...cats.map(c => ({ v: c, l: c }))], f.category),
      selectField('Priority', 'priority', [{ v: 'all', l: 'All' }, ...PRIORITIES.map(p => ({ v: p, l: cap(p) }))], f.priority),
      selectField('Due', 'due', [
        { v: 'all', l: 'Any' }, { v: 'today', l: 'Today' }, { v: 'week', l: 'Next 7 days' },
        { v: 'overdue', l: 'Overdue' }, { v: 'none', l: 'No date' }], f.due),
      selectField('Sort', 'sort', [
        { v: 'newest', l: 'Newest' }, { v: 'oldest', l: 'Oldest' }, { v: 'priority', l: 'Priority' },
        { v: 'due', l: 'Due date' }, { v: 'alpha', l: 'A–Z' }], f.sort),
      `<button class="btn btn-sm" id="clearFilters" style="margin-left:auto">Reset filters</button>`
    ].join('');

    const list = Tasks.query(f);
    $('#taskList').innerHTML = list.length
      ? list.map(taskItem).join('')
      : emptyState(f.search ? 'No matches' : 'No tasks here',
          f.search ? `Nothing matches “${f.search}”.` : 'Try changing the filters, or create a new task.');
    $('#pageSub').textContent = `${list.length} task${list.length === 1 ? '' : 's'} shown`;
  }

  function renderCompleted() {
    $('#doneToolbar').innerHTML = selectField('Sort', 'doneSort', [
      { v: 'newest', l: 'Newest' }, { v: 'oldest', l: 'Oldest' },
      { v: 'priority', l: 'Priority' }, { v: 'alpha', l: 'A–Z' }], ui.doneSort)
      + `<button class="btn btn-sm btn-danger" id="clearDone" style="margin-left:auto">Clear completed</button>`;
    const list = Tasks.query({ status: 'completed', search: ui.filters.search, sort: ui.doneSort });
    $('#doneList').innerHTML = list.length
      ? list.map(taskItem).join('')
      : emptyState('Nothing completed yet', 'Finished tasks land here so you can see your progress.');
    $('#pageSub').textContent = `${list.length} completed task${list.length === 1 ? '' : 's'}`;
  }

  // ---------- Rendering: analytics ----------
  function barRows(rows, colorFor) {
    const max = Math.max(1, ...rows.map(r => r.total));
    if (!rows.length) return emptyState('No data yet', 'Create a few tasks to see the breakdown.');
    return rows.map(r => `<div class="bar-row">
      <b title="${esc(r.key)}">${esc(r.key)}</b>
      <div class="bar"><i style="width:${(r.total / max) * 100}%;--c:${colorFor(r.key)}"></i></div>
      <span>${r.done}/${r.total}</span>
    </div>`).join('');
  }

  function renderAnalytics() {
    const s = Analytics.summary();
    const week = Analytics.last7Days();
    const weekTotal = week.reduce((a, b) => a + b.count, 0);
    $('#anStats').innerHTML = [
      statCard('', 'M4 20V10M10 20V4M16 20v-7M22 20H2', 'Completion rate', s.rate + '%', `${s.completed} of ${s.total} tasks`),
      statCard('g', 'M13 2L3 14h8l-1 8 10-12h-8z', 'Done this week', weekTotal, `${(weekTotal / 7).toFixed(1)} per day average`),
      statCard('o', 'M12 7v5l3 2|M21 12a9 9 0 11-9-9', 'Open tasks', s.pending, `${s.highPriority} high priority`),
      statCard('r', 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6', 'Current streak', Analytics.streak(), 'consecutive active days')
    ].join('');

    const maxDay = Math.max(1, ...week.map(d => d.count));
    $('#anWeek').innerHTML = week.map(d =>
      `<div title="${d.count} completed on ${d.key}">
         <i style="height:${(d.count / maxDay) * 100}%;opacity:${d.count ? .9 : .25}"></i>
         <small>${esc(d.label)}</small>
       </div>`).join('');

    const ring = $('#anRing');
    ring.style.setProperty('--p', s.rate);
    ring.innerHTML = `<b>${s.rate}%</b>`;
    $('#anMini').innerHTML = `
      <div><b>${s.total}</b><span>Total tasks</span></div>
      <div><b>${s.completed}</b><span>Completed</span></div>
      <div><b>${s.pending}</b><span>Pending</span></div>
      <div><b>${s.overdue}</b><span>Overdue</span></div>`;

    const palette = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--danger)', '#0ea5e9', '#ec4899', '#8b5cf6'];
    const cats = Analytics.groupBy('category');
    $('#anCategory').innerHTML = barRows(cats, (k) => palette[cats.findIndex(c => c.key === k) % palette.length]);
    const prio = PRIORITIES.map(p => Analytics.groupBy('priority').find(r => r.key === p) || { key: p, total: 0, done: 0 })
      .map(r => ({ ...r, key: cap(r.key) }));
    const prioColor = { High: 'var(--danger)', Medium: 'var(--warn)', Low: 'var(--ok)' };
    $('#anPriority').innerHTML = barRows(prio, k => prioColor[k]);
  }

  // ---------- Rendering: settings ----------
  function renderSettings() {
    $('#swatches').innerHTML = ACCENTS.map(c =>
      `<button class="sw" data-accent="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join('');
    $('#catList').innerHTML = state.settings.categories.map(c => {
      const count = state.tasks.filter(t => t.category === c).length;
      return `<span class="tag">${esc(c)} · ${count}
        <button class="icon-btn" data-del-cat="${esc(c)}" aria-label="Remove ${esc(c)}" style="padding:0;margin-left:2px">
          ${svg('M6 6l12 12M18 6L6 18')}</button></span>`;
    }).join('') || '<span style="color:var(--faint);font-size:13px">No categories.</span>';
    let bytes = 0;
    try { bytes = new Blob([localStorage.getItem(KEY) || '']).size; } catch {}
    $('#storageNote').textContent = `Download all tasks and settings as JSON (${(bytes / 1024).toFixed(1)} KB stored).`;
    applyTheme();
  }

  // ---------- Router ----------
  function render() {
    renderNav();
    const v = VIEWS.find(x => x.id === ui.view) || VIEWS[0];
    $('#pageTitle').textContent = v.label;
    $('#pageSub').textContent = v.sub;
    VIEWS.forEach(x => { $('#view-' + x.id).hidden = x.id !== ui.view; });
    ({ dashboard: renderDashboard, tasks: renderTasks, completed: renderCompleted, analytics: renderAnalytics, settings: renderSettings })[ui.view]();
  }

  function go(view) {
    if (!VIEWS.some(v => v.id === view)) view = 'dashboard';
    ui.view = view;
    if (location.hash.slice(1) !== view) location.hash = view;
    document.body.classList.remove('nav-open');
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------- Task dialog ----------
  function fillCategorySelect(selected) {
    $('#fCategory').innerHTML = state.settings.categories
      .map(c => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }

  function openTaskDialog(id) {
    const t = id ? Tasks.get(id) : null;
    ui.editing = t ? t.id : null;
    $('#dlgTitle').textContent = t ? 'Edit task' : 'New task';
    $('#dlgSave').textContent = t ? 'Save changes' : 'Create task';
    $('#formErr').textContent = '';
    fillCategorySelect(t ? t.category : state.settings.categories[0]);
    $('#fTitle').value = t ? t.title : '';
    $('#fDesc').value = t ? t.description : '';
    $('#fPriority').value = t ? t.priority : 'medium';
    $('#fDue').value = t ? t.due : '';
    $('#fPinned').value = t && t.pinned ? 'yes' : 'no';
    $('#taskDialog').showModal();
    setTimeout(() => $('#fTitle').focus(), 30);
  }

  $('#taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#fTitle').value.trim();
    if (!title) { $('#formErr').textContent = 'A title is required.'; return; }
    const data = {
      title,
      description: $('#fDesc').value.trim(),
      category: $('#fCategory').value || 'General',
      priority: $('#fPriority').value,
      due: $('#fDue').value,
      pinned: $('#fPinned').value === 'yes'
    };
    if (ui.editing) { Tasks.update(ui.editing, data); toast('Task updated', 'ok'); }
    else { Tasks.add(data); toast('Task created', 'ok'); }
    $('#taskDialog').close();
    render();
  });
  $('#dlgClose').onclick = $('#dlgCancel').onclick = () => $('#taskDialog').close();

  // ---------- Global events ----------
  document.addEventListener('click', async (e) => {
    const navBtn = e.target.closest('[data-view]');
    if (navBtn) return go(navBtn.dataset.view);
    const goto = e.target.closest('[data-goto]');
    if (goto) return go(goto.dataset.goto);

    const act = e.target.closest('[data-act]');
    if (act) {
      const id = act.closest('.task').dataset.id;
      const t = Tasks.get(id);
      if (!t) return;
      if (act.dataset.act === 'toggle') { Tasks.toggle(id); toast(t.completed ? 'Moved back to pending' : 'Task completed', 'ok'); render(); }
      if (act.dataset.act === 'pin') { Tasks.update(id, { pinned: !t.pinned }); render(); }
      if (act.dataset.act === 'edit') openTaskDialog(id);
      if (act.dataset.act === 'delete') {
        if (await confirmAsk('Delete task?', `“${t.title}” will be permanently removed.`, 'Delete')) {
          Tasks.remove(id); toast('Task deleted'); render();
        }
      }
      return;
    }

    const themePick = e.target.closest('[data-theme-pick]');
    if (themePick) { state.settings.theme = themePick.dataset.themePick; persist(); applyTheme(); return; }
    const accent = e.target.closest('[data-accent]');
    if (accent) { state.settings.accent = accent.dataset.accent; persist(); applyTheme(); return; }

    const delCat = e.target.closest('[data-del-cat]');
    if (delCat) {
      const name = delCat.dataset.delCat;
      if (state.settings.categories.length <= 1) return toast('Keep at least one category.', 'bad');
      const used = state.tasks.filter(t => t.category === name).length;
      if (await confirmAsk('Remove category?', used
        ? `${used} task(s) in “${name}” will move to “General”.`
        : `“${name}” will be removed.`, 'Remove')) {
        state.settings.categories = state.settings.categories.filter(c => c !== name);
        if (!state.settings.categories.includes('General')) state.settings.categories.unshift('General');
        state.tasks.forEach(t => { if (t.category === name) t.category = 'General'; });
        persist(); render();
      }
      return;
    }

    if (e.target.closest('#clearFilters')) {
      ui.filters = { ...ui.filters, status: 'active', category: 'all', priority: 'all', due: 'all', sort: 'newest' };
      render(); return;
    }
    if (e.target.closest('#clearDone')) {
      const n = state.tasks.filter(t => t.completed).length;
      if (!n) return toast('Nothing to clear.');
      if (await confirmAsk('Clear completed?', `${n} completed task(s) will be deleted.`, 'Clear')) {
        state.tasks = state.tasks.filter(t => !t.completed); persist(); toast('Completed tasks cleared'); render();
      }
      return;
    }
    if (e.target.closest('#menuBtn')) document.body.classList.toggle('nav-open');
    if (e.target.closest('#scrim')) document.body.classList.remove('nav-open');
    if (e.target.closest('#newBtn')) openTaskDialog(null);
  });

  document.addEventListener('change', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    if (f.dataset.filter === 'doneSort') ui.doneSort = f.value;
    else ui.filters[f.dataset.filter] = f.value;
    render();
  });

  $('#search').addEventListener('input', (e) => {
    ui.filters.search = e.target.value;
    if (ui.view === 'tasks' || ui.view === 'completed') render();
    else if (e.target.value.trim()) go('tasks');
  });

  $('#quickForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#quickTitle').value.trim();
    if (!title) return;
    Tasks.add({ title, priority: $('#quickPriority').value, due: $('#quickDue').value, category: state.settings.categories[0] });
    e.target.reset(); $('#quickPriority').value = 'medium';
    toast('Task added', 'ok'); render(); $('#quickTitle').focus();
  });

  $('#catForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#catInput').value.trim().slice(0, 24);
    if (!name) return;
    if (state.settings.categories.some(c => c.toLowerCase() === name.toLowerCase())) return toast('That category already exists.', 'bad');
    state.settings.categories.push(name); persist(); $('#catInput').value = '';
    toast('Category added', 'ok'); render();
  });

  // ---------- Data management ----------
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'TaskFlow', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `taskflow-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Export downloaded', 'ok');
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter(Boolean);
      if (!incoming.length) return toast('No valid tasks found in that file.', 'bad');
      const ids = new Set(state.tasks.map(t => t.id));
      let added = 0;
      for (const t of incoming) { if (!ids.has(t.id)) { state.tasks.push(t); ids.add(t.id); added++; } }
      const cats = new Set([...state.settings.categories, ...incoming.map(t => t.category)]);
      state.settings.categories = [...cats];
      persist(); render();
      toast(`Imported ${added} task${added === 1 ? '' : 's'}`, 'ok');
    } catch { toast('That file could not be read as TaskFlow JSON.', 'bad'); }
  });
  $('#resetBtn').onclick = async () => {
    if (await confirmAsk('Reset all data?', 'Every task and setting stored in this browser will be deleted. This cannot be undone.', 'Reset everything')) {
      Store.clear(); state = blank(); persist(); applyTheme(); go('dashboard'); toast('All data reset');
    }
  };
  $('#sampleBtn').onclick = () => {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return dayKey(x.getTime()); };
    const samples = [
      { title: 'Write the weekly status update', category: 'Work', priority: 'high', due: d(0), pinned: true, description: 'Cover shipped work, blockers and next week’s focus.' },
      { title: 'Review pull requests', category: 'Work', priority: 'medium', due: d(1) },
      { title: '30 minute run', category: 'Health', priority: 'medium', due: d(0) },
      { title: 'Finish chapter 4 of the algorithms course', category: 'Study', priority: 'low', due: d(4) },
      { title: 'Book dentist appointment', category: 'Personal', priority: 'high', due: d(-2) },
      { title: 'Plan next sprint backlog', category: 'Work', priority: 'medium', due: d(6) },
      { title: 'Clean up desktop files', category: 'Personal', priority: 'low', completed: true, completedAt: Date.now() - 864e5 },
      { title: 'Set up the project repository', category: 'Work', priority: 'high', completed: true, completedAt: Date.now() - 2 * 864e5 }
    ];
    samples.forEach(s => { const t = normalizeTask(s); if (t) state.tasks.unshift(t); });
    persist(); toast('Sample tasks loaded', 'ok'); go('dashboard');
  };

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); openTaskDialog(null); }
    if (e.key === 'Escape') document.body.classList.remove('nav-open');
  });

  window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'dashboard'));
  window.addEventListener('storage', (e) => { if (e.key === KEY) { state = Store.load(); applyTheme(); render(); } });

  // ---------- Boot ----------
  applyTheme();
  go(location.hash.slice(1) || 'dashboard');
})();
