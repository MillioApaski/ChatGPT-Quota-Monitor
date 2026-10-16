// ==UserScript==
// @name         ChatGPT Quota Monitor (Work / Codex)
// @namespace    https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @version      1.0.0
// @author       ChatGPT (GPT-6)
// @license      MIT
// @homepageURL  https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @supportURL   https://github.com/MillioApaski/ChatGPT-Quota-Monitor/issues
// @updateURL    https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @description  在 ChatGPT（含 Work）页面右下角显示 Work/Codex 共享的五小时及每周剩余额度、重置倒计时。
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // 仅访问 chatgpt.com 下的两个同源接口。不会发送数据到第三方。
  // 注意：/backend-api/wham/usage 是非公开接口，OpenAI 可能修改它。
  const CONFIG = Object.freeze({
    refreshVisibleMs: 60_000,   // 页面可见时每 60 秒更新额度
    refreshHiddenMs: 300_000,  // 页面隐藏时每 5 分钟更新额度
    retryMs: 120_000,
    widgetWidth: 284,
    margin: 16,
    storageKey: 'chatgpt-work-quota-widget-position-v1',
  });

  if (document.getElementById('cg-work-quota-root')) return;

  const root = document.createElement('div');
  root.id = 'cg-work-quota-root';
  root.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:16px',
    'z-index:2147483647', 'width:284px', 'max-width:calc(100vw - 32px)',
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-size:12px', 'line-height:1.45', 'box-sizing:border-box',
  ].join(';');
  document.documentElement.append(root);
  const shadow = root.attachShadow({ mode: 'closed' });

  const css = document.createElement('style');
  css.textContent = `
    :host { --bg:rgba(255,255,255,.96); --fg:#20242b; --muted:#707783;
      --line:#e6e8ec; --track:#eaedf1; --ok:#16a36c;
      --warn:#e5a33b; --low:#e25b5b; --shadow:0 8px 30px rgba(0,0,0,.15); }
    :host([data-theme="dark"]) { --bg:rgba(34,34,36,.96); --fg:#f4f4f5;
      --muted:#a5a5ae; --line:#3e3e42; --track:#48484c;
      --ok:#3dcb97; --warn:#efbd5f; --low:#f08080;
      --shadow:0 10px 32px rgba(0,0,0,.38); }
    * { box-sizing:border-box; }
    .card { width:100%; border:1px solid var(--line); border-radius:13px;
      background:var(--bg); color:var(--fg); box-shadow:var(--shadow);
      overflow:hidden; backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); }
    .header { display:flex; align-items:center; justify-content:space-between; padding:10px 11px;
      gap:8px; cursor:grab; user-select:none; touch-action:none; }
    .header:active { cursor:grabbing; }
    .brand { display:flex; align-items:center; gap:7px; font-size:12px; font-weight:650; white-space:nowrap; }
    .dot { width:7px; height:7px; border-radius:50%; background:var(--ok); flex-shrink:0; }
    .dot.busy { background:var(--warn); }
    .dot.error { background:var(--low); }
    .actions { display:flex; align-items:center; gap:3px; }
    button { border:0; color:var(--muted); background:transparent; border-radius:7px;
      min-width:24px; height:24px; font:inherit; cursor:pointer; }
    button:hover { background:var(--track); color:var(--fg); }
    button:focus-visible { outline:2px solid var(--ok); outline-offset:1px; }
    button[disabled] { cursor:wait; opacity:.5; }
    #collapse { font-size:18px; line-height:1; }
    #refresh { font-size:16px; line-height:1; }
    .body { padding:0 11px 10px; }
    .quota + .quota { margin-top:12px; }
    .line { display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .label { color:var(--fg); }
    .value { font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; }
    .value.unknown { color:var(--muted); font-weight:500; font-size:11px; }
    .track { margin-top:6px; background:var(--track); border-radius:10px; height:6px; overflow:hidden; }
    .fill { height:100%; border-radius:10px; width:0%; background:var(--ok); transition:width .25s ease; }
    .fill.warning { background:var(--warn); }
    .fill.low { background:var(--low); }
    .reset { margin-top:5px; color:var(--muted); font-size:11px; font-variant-numeric:tabular-nums; }
    .footer { border-top:1px solid var(--line); margin-top:11px; padding-top:7px;
      font-size:10px; color:var(--muted); display:flex; justify-content:space-between; gap:8px; }
    .footer .status { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .card.collapsed .body { display:none; }
    .card.collapsed .header { padding:7px 9px; }
    .card.collapsed .brand { font-size:11px; }
  `;
  shadow.append(css);

  const card = document.createElement('section');
  card.className = 'card';
  card.setAttribute('aria-label', 'ChatGPT Work 额度监控');
  card.innerHTML = `
    <div class="header" id="drag-handle" title="拖动可调整位置">
      <span class="brand"><span class="dot busy" id="dot"></span><span id="brand-text">Work 额度监控</span></span>
      <span class="actions">
        <button id="refresh" type="button" title="立即刷新额度" aria-label="立即刷新额度">↻</button>
        <button id="collapse" type="button" title="折叠/展开" aria-label="折叠/展开">−</button>
      </span>
    </div>
    <div class="body">
      <div class="quota">
        <div class="line"><span class="label">5 小时额度</span><span class="value unknown" id="five-value">查询中…</span></div>
        <div class="track"><div class="fill" id="five-bar"></div></div>
        <div class="reset" id="five-reset">重置时间：—</div>
      </div>
      <div class="quota">
        <div class="line"><span class="label">每周额度</span><span class="value unknown" id="week-value">查询中…</span></div>
        <div class="track"><div class="fill" id="week-bar"></div></div>
        <div class="reset" id="week-reset">重置时间：—</div>
      </div>
      <div class="footer"><span class="status" id="status">正在读取账户额度…</span><span id="updated">—</span></div>
    </div>`;
  shadow.append(card);

  const $ = (id) => shadow.getElementById(id);
  const nodes = {
    dot: $('dot'), brand: $('brand-text'), refresh: $('refresh'),
    collapse: $('collapse'), handle: $('drag-handle'),
    fiveValue: $('five-value'), fiveBar: $('five-bar'), fiveReset: $('five-reset'),
    weekValue: $('week-value'), weekBar: $('week-bar'), weekReset: $('week-reset'),
    status: $('status'), updated: $('updated'),
  };

  function syncTheme() {
    const doc = document.documentElement;
    const dark = doc.classList.contains('dark') ||
      doc.dataset.theme === 'dark' ||
      (!doc.classList.contains('light') && !doc.dataset.theme &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['class', 'data-theme'],
  });
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener?.('change', syncTheme);

  // 仅保存面板位置和折叠状态；不保存访问令牌或账户资料。
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}') || {}; }
  catch { /* 禁止本地存储时使用默认布局 */ }
  let collapsed = Boolean(saved.collapsed);
  function applyCollapsed() {
    card.classList.toggle('collapsed', collapsed);
    nodes.collapse.textContent = collapsed ? '+' : '−';
    nodes.collapse.title = collapsed ? '展开' : '折叠';
  }
  applyCollapsed();

  function constrainPosition() {
    if (root.style.left === '') return;
    const rect = root.getBoundingClientRect();
    const left = Math.min(Math.max(CONFIG.margin, rect.left),
      Math.max(CONFIG.margin, innerWidth - rect.width - CONFIG.margin));
    const top = Math.min(Math.max(CONFIG.margin, rect.top),
      Math.max(CONFIG.margin, innerHeight - rect.height - CONFIG.margin));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }
  if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
    root.style.right = 'auto'; root.style.bottom = 'auto';
    root.style.left = `${saved.left}px`; root.style.top = `${saved.top}px`;
    requestAnimationFrame(constrainPosition);
  }
  function saveLayout() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        left: root.style.left ? Number.parseFloat(root.style.left) : null,
        top: root.style.top ? Number.parseFloat(root.style.top) : null,
        collapsed,
      }));
    } catch { /* localStorage 可能被浏览器禁用 */ }
  }
  nodes.collapse.addEventListener('click', () => {
    collapsed = !collapsed; applyCollapsed(); constrainPosition(); saveLayout(); render();
  });
  window.addEventListener('resize', () => { constrainPosition(); saveLayout(); });

  // 拖动标题栏，按钮区不参与拖动。
  let drag = null;
  nodes.handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = root.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    root.style.right = 'auto'; root.style.bottom = 'auto';
    root.style.left = `${r.left}px`; root.style.top = `${r.top}px`;
    nodes.handle.setPointerCapture(e.pointerId);
  });
  nodes.handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    root.style.left = `${e.clientX - drag.dx}px`;
    root.style.top = `${e.clientY - drag.dy}px`;
    constrainPosition();
  });
  const finishDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    saveLayout();
  };
  nodes.handle.addEventListener('pointerup', finishDrag);
  nodes.handle.addEventListener('pointercancel', finishDrag);

  const state = {
    windows: { five: null, week: null },
    lastSuccess: 0,
    loading: false,
    error: '',
    plan: '',
    timer: null,
  };

  // BEGIN QUOTA_PARSER (kept pure for automated tests)
  function timestampMs(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return num < 1e12 ? num * 1000 : num;
  }
  function normalizeWindow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const secs = Number(raw.limit_window_seconds);
    const used = Number(raw.used_percent);
    if (!Number.isFinite(secs) || secs <= 0 || raw.used_percent == null || !Number.isFinite(used)) {
      return null;
    }
    const absolute = timestampMs(raw.reset_at);
    const after = Number(raw.reset_after_seconds);
    const resetAt = absolute || ((raw.reset_after_seconds != null && Number.isFinite(after) && after >= 0)
      ? Date.now() + after * 1000 : 0);
    return { seconds: secs, remaining: Math.max(0, Math.min(100, 100 - used)), resetAt };
  }
  function parseUsage(json) {
    const limit = json?.rate_limit ?? json?.rate_limits;
    if (!limit || typeof limit !== 'object' || Array.isArray(limit)) throw new Error('接口未返回 rate_limit');
    const candidates = [limit.primary_window, limit.secondary_window, limit.five_hour, limit.weekly]
      .map(normalizeWindow).filter(Boolean);
    // 按实际窗口长度分类，不能假定 primary=5h / secondary=每周。
    const closeTo = (seconds, target) => Math.abs(seconds - target) <= 600;
    const five = candidates.find((w) => closeTo(w.seconds, 18_000)) || null;
    const week = candidates.find((w) => closeTo(w.seconds, 604_800)) || null;
    // 部分套餐不返回五小时窗口或任何窗口，不将缺失误判为用尽。
    return { five, week, plan: String(json.plan_type || '') };
  }
  // END QUOTA_PARSER

  function clockText(timeMs) {
    if (!timeMs) return '—';
    const remaining = Math.max(0, Math.ceil((timeMs - Date.now()) / 1000));
    if (remaining <= 0) return '已到重置时间（等待接口更新）';
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    const secs = remaining % 60;
    return days > 0 ? `${days} 天 ${hours} 时 ${mins} 分` :
      hours > 0 ? `${hours} 时 ${mins} 分 ${secs} 秒` : `${mins} 分 ${secs} 秒`;
  }
  function formatPercent(value) {
    return `${Number(value.toFixed(1)).toLocaleString('zh-CN')}% 剩余`;
  }
  function renderWindow(w, value, bar, reset) {
    if (!w) {
      value.textContent = state.lastSuccess ? '接口未提供' : '查询中…';
      value.classList.add('unknown');
      bar.style.width = '0%';
      bar.className = 'fill';
      reset.textContent = state.lastSuccess ? '当前账户未返回此额度窗口' : '重置时间：—';
      reset.title = '';
      return;
    }
    value.textContent = formatPercent(w.remaining);
    value.classList.remove('unknown');
    bar.style.width = `${w.remaining}%`;
    bar.className = 'fill' + (w.remaining <= 20 ? ' low' : w.remaining <= 50 ? ' warning' : '');
    reset.textContent = w.resetAt ? `重置倒计时：${clockText(w.resetAt)}` : '重置时间：未提供';
    reset.title = w.resetAt ? `预计重置：${new Date(w.resetAt).toLocaleString('zh-CN')}` : '';
  }
  function render() {
    renderWindow(state.windows.five, nodes.fiveValue, nodes.fiveBar, nodes.fiveReset);
    renderWindow(state.windows.week, nodes.weekValue, nodes.weekBar, nodes.weekReset);
    nodes.dot.className = 'dot' + (state.error ? ' error' : state.loading ? ' busy' : '');
    nodes.refresh.disabled = state.loading;
    nodes.brand.textContent = collapsed && state.lastSuccess
      ? `Work · 5h ${state.windows.five ? Math.round(state.windows.five.remaining) + '%' : '—'} / 周 ${state.windows.week ? Math.round(state.windows.week.remaining) + '%' : '—'}`
      : 'Work 额度监控';
    if (state.error) {
      nodes.status.textContent = state.lastSuccess ? '更新失败，显示上次数据' : `读取失败：${state.error}`;
      nodes.status.title = state.error;
    } else {
      nodes.status.textContent = state.loading ? '正在同步…' :
        state.lastSuccess && !state.windows.five && !state.windows.week ? '账户未提供可识别的额度窗口' :
        state.lastSuccess ? `已同步 · ${state.plan || '账户'}` : '等待读取额度';
      nodes.status.title = 'Work 与 Codex 共用套餐额度';
    }
    nodes.updated.textContent = state.lastSuccess
      ? new Date(state.lastSuccess).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : '—';
  }

  async function fetchJson(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
    const resp = await fetch(path, {
      credentials: 'same-origin',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    if (!resp.ok) throw new Error(`${path.includes('/usage') ? '额度' : '会话'}接口 HTTP ${resp.status}`);
    return await resp.json();
    } finally { clearTimeout(timeout); }
  }
  function nextRefresh(ms) {
    clearTimeout(state.timer);
    state.timer = setTimeout(refresh, ms);
  }
  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    render();
    try {
      const session = await fetchJson('/api/auth/session');
      const token = session?.accessToken || session?.access_token ||
        session?.auth?.accessToken || session?.tokens?.access_token;
      if (typeof token !== 'string' || !token) throw new Error('会话没有可用的访问令牌，请重新登录');
      const headers = { Authorization: `Bearer ${token}` };
      // 存在明确的账户 ID 时才附加，绝不把用户 ID 当成账户 ID。
      const accountId = session?.account_id || session?.accountId || session?.user?.account_id;
      if (typeof accountId === 'string' && accountId) headers['ChatGPT-Account-Id'] = accountId;
      const data = await fetchJson('/backend-api/wham/usage', { headers });
      const parsed = parseUsage(data);
      state.windows = { five: parsed.five, week: parsed.week };
      state.plan = parsed.plan;
      state.lastSuccess = Date.now();
      state.error = '';
    } catch (error) {
      state.error = error?.name === 'AbortError' ? '请求超时' :
        error instanceof Error ? error.message : '未知错误';
      if (/HTTP 401|HTTP 403|访问令牌|重新登录/.test(state.error)) {
        state.windows = { five: null, week: null };
        state.lastSuccess = 0; // 登录状态改变时不显示旧账户数据
      }
      console.warn('[ChatGPT Work Quota]', state.error); // 不记录 Token 或完整接口响应
    } finally {
      state.loading = false;
      render();
      nextRefresh(state.error ? CONFIG.retryMs :
        document.hidden ? CONFIG.refreshHiddenMs : CONFIG.refreshVisibleMs);
    }
  }
  nodes.refresh.addEventListener('click', () => {
    if (!state.loading) { clearTimeout(state.timer); void refresh(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!state.lastSuccess || Date.now() - state.lastSuccess >= 30_000)) {
      clearTimeout(state.timer);
      void refresh();
    } else {
      nextRefresh(document.hidden ? CONFIG.refreshHiddenMs : CONFIG.refreshVisibleMs);
    }
  });
  window.addEventListener('focus', () => {
    if (!state.loading && Date.now() - state.lastSuccess >= 60_000) {
      clearTimeout(state.timer);
      void refresh();
    }
  });
  // 倒计时逐秒更新，不需要每秒访问服务器。
  setInterval(() => {
    if (!document.hidden) render();
  }, 1000);
  void refresh();
})();