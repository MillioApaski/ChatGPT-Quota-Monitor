// ==UserScript==
// @name         ChatGPT Quota Monitor (Work / Codex)
// @namespace    https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @version      1.1.1
// @author       ChatGPT (GPT-6)
// @license      MIT
// @homepageURL  https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @supportURL   https://github.com/MillioApaski/ChatGPT-Quota-Monitor/issues
// @updateURL    https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @description  仅在 ChatGPT Work 中，将 5 小时/每周剩余额度嵌入右上角「输出 / 来源」面板。
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
    refreshVisibleMs: 60_000,
    retryMs: 120_000,
    scanThrottleMs: 450,
    storageKey: 'chatgpt-work-quota-docked-v1',
  });

  if (document.getElementById('cg-work-quota-root')) return;

  const root = document.createElement('div');
  root.id = 'cg-work-quota-root';
  // 不允许在普通 ChatGPT 页面出现悬浮组件；只有定位到 Work 专属面板后才挂载。
  root.style.cssText = [
    'display:block', 'width:100%', 'min-width:0', 'max-width:100%',
    'grid-column:1 / -1', 'flex:none', 'box-sizing:border-box',
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-size:12px', 'line-height:1.45',
  ].join(';');
  const shadow = root.attachShadow({ mode: 'closed' });

  const css = document.createElement('style');
  css.textContent = `
    :host { --fg:#20242b; --muted:#707783; --line:rgba(80,80,80,.18);
      --track:#eaedf1; --ok:#16a36c; --warn:#e5a33b; --low:#e25b5b; }
    :host([data-theme="dark"]) { --fg:#f4f4f5; --muted:#a5a5ae;
      --line:rgba(255,255,255,.11); --track:#48484c;
      --ok:#3dcb97; --warn:#efbd5f; --low:#f08080; }
    * { box-sizing:border-box; }
    /* The Work panel owns the full-width section divider, while its
       headings/list items sit inside 16px horizontal gutters. Apply the
       same gutters to the quota card to avoid flush-edge text/bars. */
    .card { width:100%; margin-top:12px; padding:12px 16px 14px;
      border-top:1px solid var(--line);
      background:transparent; color:var(--fg); overflow:hidden; }
    .header { display:flex; align-items:center; justify-content:space-between;
      padding:0 0 10px; gap:8px; user-select:none; }
    .brand { display:flex; align-items:center; gap:7px; min-width:0;
      font-size:12px; font-weight:650; white-space:nowrap; }
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
    .body { padding:0; }
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
    .card.collapsed .header { padding-bottom:0; }
    .card.collapsed .brand { font-size:11px; }
  `;
  shadow.append(css);

  const card = document.createElement('section');
  card.className = 'card';
  card.setAttribute('aria-label', 'ChatGPT Work 额度监控');
  card.innerHTML = `
    <div class="header" id="quota-header">
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
    collapse: $('collapse'),
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


  // 仅保存折叠状态，不保存访问令牌或账户信息。
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}') || {}; }
  catch { /* 本地存储不可用时按默认值显示 */ }
  let collapsed = Boolean(saved.collapsed);
  function applyCollapsed() {
    card.classList.toggle('collapsed', collapsed);
    nodes.collapse.textContent = collapsed ? '+' : '−';
    nodes.collapse.title = collapsed ? '展开' : '折叠';
  }
  applyCollapsed();
  nodes.collapse.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapsed();
    try { localStorage.setItem(CONFIG.storageKey, JSON.stringify({ collapsed })); }
    catch { /* localStorage 可能被浏览器禁用 */ }
    render();
  });

  const state = {
    windows: { five: null, week: null },
    lastSuccess: 0,
    loading: false,
    error: '',
    plan: '',
    timer: null,
    active: false,
    panel: null,
    controller: null,
    generation: 0,
    scanTimer: null,
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
    // 共用一次刷新操作的 AbortController，离开 Work 时能立即中止请求。
    const controller = state.controller;
    if (!controller) throw new Error('已停止额度同步');
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
    if (state.active && !document.hidden) state.timer = setTimeout(refresh, ms);
  }
  async function refresh() {
    if (!state.active || document.hidden || state.loading) return;
    const generation = state.generation;
    state.controller = new AbortController();
    state.loading = true;
    state.error = '';
    render();
    try {
      const session = await fetchJson('/api/auth/session');
      if (!state.active || generation !== state.generation) return;
      const token = session?.accessToken || session?.access_token ||
        session?.auth?.accessToken || session?.tokens?.access_token;
      if (typeof token !== 'string' || !token) throw new Error('会话没有可用的访问令牌，请重新登录');
      const headers = { Authorization: `Bearer ${token}` };
      const accountId = session?.account_id || session?.accountId || session?.user?.account_id;
      if (typeof accountId === 'string' && accountId) headers['ChatGPT-Account-Id'] = accountId;
      const data = await fetchJson('/backend-api/wham/usage', { headers });
      if (!state.active || generation !== state.generation) return;
      const parsed = parseUsage(data);
      state.windows = { five: parsed.five, week: parsed.week };
      state.plan = parsed.plan;
      state.lastSuccess = Date.now();
      state.error = '';
    } catch (error) {
      if (generation !== state.generation || !state.active) return;
      state.error = error?.name === 'AbortError' ? '请求超时' :
        error instanceof Error ? error.message : '未知错误';
      if (/HTTP 401|HTTP 403|访问令牌|重新登录/.test(state.error)) {
        state.windows = { five: null, week: null };
        state.lastSuccess = 0;
      }
      console.warn('[ChatGPT Work Quota]', state.error);
    } finally {
      if (generation === state.generation) {
        state.controller = null;
        state.loading = false;
        if (state.active) {
          render();
          nextRefresh(state.error ? CONFIG.retryMs : CONFIG.refreshVisibleMs);
        }
      }
    }
  }

  // BEGIN WORK_PANEL_PREDICATES (pure helpers covered by tests)
  function isRightWorkPanelPair(output, sources, viewportWidth, viewportHeight) {
    if (viewportWidth < 660) return false;
    const xLimit = Math.max(viewportWidth * 0.55, viewportWidth - 560);
    const yLimit = Math.min(550, viewportHeight * 0.65);
    return output.width > 0 && sources.width > 0 &&
      output.left > xLimit && sources.left > xLimit &&
      output.top >= 0 && output.top < yLimit &&
      sources.top > output.top && sources.top - output.top < 400 &&
      Math.abs(sources.left - output.left) < 100 &&
      output.right <= viewportWidth + 12 && sources.right <= viewportWidth + 12;
  }
  // END WORK_PANEL_PREDICATES

  // 查找右上角同时含有「输出 / 来源」标题的 Work 专属卡片。
  // 不根据聊天正文里的“Work”字样判断，避免普通聊天误触发。
  function locateWorkPanel() {
    if (!document.body) return null;
    // Work 正在流式输出时 DOM 可能频繁变化；优先复用仍有效的面板，避免全页面扫描。
    if (state.panel?.isConnected) {
      const rect = state.panel.getBoundingClientRect();
      const labels = state.panel.textContent || '';
      if (rect.width >= 210 && rect.left > window.innerWidth * 0.5 &&
          rect.right >= window.innerWidth - 120 &&
          rect.top < window.innerHeight && rect.bottom > 0 &&
          /输出|Outputs?/.test(labels) && /来源|Sources?/.test(labels)) {
        return state.panel;
      }
    }
    const outputs = [], sources = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const label = node.nodeValue?.trim();
      const isOutput = label === '输出' || label === 'Output' || label === 'Outputs';
      const isSource = label === '来源' || label === 'Sources';
      if (!isOutput && !isSource) continue;
      const element = node.parentElement;
      if (!element || root.contains(element) || element.closest('[aria-hidden="true"]')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top < 0 ||
          rect.left < window.innerWidth * 0.5) continue;
      (isOutput ? outputs : sources).push({ element, rect });
    }
    for (const output of outputs) {
      for (const source of sources) {
        if (!isRightWorkPanelPair(output.rect, source.rect,
          window.innerWidth, window.innerHeight)) continue;
        let common = output.element;
        while (common && !common.contains(source.element)) common = common.parentElement;
        let fallback = null;
        for (let el = common; el && el !== document.body; el = el.parentElement) {
          const rect = el.getBoundingClientRect();
          // 长来源列表会增加卡片高度，不能按固定最大高度限制，否则会反复卸载/挂载。
          if (rect.width < 210 || rect.width > 540 || rect.height < 90 ||
              rect.right < window.innerWidth - 120) continue;
          if (!fallback) fallback = el;
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor;
          const hasSurface = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
          const hasRoundedCorners = parseFloat(style.borderTopLeftRadius) >= 8;
          if (hasSurface || hasRoundedCorners) return el;
        }
        if (fallback) return fallback;
      }
    }
    return null;
  }

  function deactivate() {
    if (!state.active && !root.isConnected) return;
    state.active = false;
    state.panel = null;
    state.generation++;
    clearTimeout(state.timer);
    state.controller?.abort();
    state.controller = null;
    state.loading = false;
    root.remove();
  }
  function reconcileMount() {
    const panel = locateWorkPanel();
    if (!panel) { deactivate(); return; }
    const newlyActive = !state.active;
    if (root.parentElement !== panel) panel.appendChild(root);
    state.active = true;
    state.panel = panel;
    syncTheme();
    render();
    if (newlyActive) {
      if (!document.hidden) void refresh();
    } else if (!state.loading && !state.timer && !document.hidden &&
               Date.now() - state.lastSuccess >= CONFIG.refreshVisibleMs) {
      void refresh();
    }
  }
  function scheduleScan() {
    if (state.scanTimer != null) return;
    state.scanTimer = setTimeout(() => {
      state.scanTimer = null;
      reconcileMount();
    }, CONFIG.scanThrottleMs);
  }
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  // 单页路由、React 替换组件以及面板晚加载都需要重新定位。
  window.addEventListener('popstate', scheduleScan);
  window.addEventListener('pageshow', scheduleScan);
  setInterval(scheduleScan, 4000);
  nodes.refresh.addEventListener('click', () => {
    if (state.active && !state.loading) {
      clearTimeout(state.timer);
      state.timer = null;
      void refresh();
    }
  });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(state.timer);
    state.timer = null;
    if (!document.hidden) {
      scheduleScan();
      if (state.active && !state.loading) {
        if (!state.lastSuccess || Date.now() - state.lastSuccess >= 30_000) void refresh();
        else nextRefresh(CONFIG.refreshVisibleMs);
      }
    }
  });
  window.addEventListener('focus', () => {
    scheduleScan();
    if (state.active && !state.loading &&
        Date.now() - state.lastSuccess >= CONFIG.refreshVisibleMs) void refresh();
  });
  // 仅在 Work 面板可见时更新倒计时，避免无关页面额外开销。
  setInterval(() => {
    if (state.active && !document.hidden) render();
  }, 1000);
  reconcileMount();
})();