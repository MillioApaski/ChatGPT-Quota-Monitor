// ==UserScript==
// @name         ChatGPT Quota Monitor (Work / Codex)
// @namespace    https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @version      1.3.0
// @author       ChatGPT (GPT-6)
// @license      MIT
// @homepageURL  https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @supportURL   https://github.com/MillioApaski/ChatGPT-Quota-Monitor/issues
// @updateURL    https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @description  桌面版风格双进度弧额度按钮，点击弹出用量面板；Work 保留右上角监控。
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
  // 同一额度实例按页面布局在 Work 右侧面板或普通聊天左侧栏之间移动。
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

    /* Only the compact launch button is visible in the normal sidebar.
       The popup is rendered in a separate body portal to escape overflow clipping. */
    :host([data-placement="work"]) .sidebar-trigger { display:none; }
    :host([data-placement="sidebar"]) .card { display:none; }
    /* Match the profile avatar's icon center in the expanded web sidebar. */
    :host([data-placement="sidebar"]) { padding:0 8px 7px 19px; }
    .sidebar-trigger { width:34px; height:34px; padding:3px; display:grid; place-items:center;
      border-radius:10px; color:var(--muted); background:transparent;
      cursor:pointer; transition:background .15s ease, color .15s ease; }
    .sidebar-trigger:hover, .sidebar-trigger[aria-expanded="true"] {
      color:var(--fg); background:var(--track);
    }
    .sidebar-trigger svg { width:30px; height:30px; max-width:100%; max-height:100%; overflow:visible; }
    .quota-ring-track { fill:none; stroke:var(--muted); opacity:.32;
      stroke-width:2.8; stroke-linecap:round; }
    .quota-ring-progress { fill:none; stroke:var(--fg); stroke-width:2.8;
      stroke-linecap:round; stroke-dasharray:0 100;
      transition:stroke-dasharray .25s ease; }
    .quota-ring-diamond { fill:var(--fg); opacity:.65; }
    .quota-ring-single { display:none; }
    .quota-icon.single .quota-ring-dual { display:none; }
    .quota-icon.single .quota-ring-single { display:block; }
    @media (prefers-reduced-motion:reduce) {
      .quota-ring-progress { transition:none; }
    }
    :host { --sidebar-bg:#f0f1f3; --sidebar-outline:rgba(35,35,40,.08); }
    :host([data-theme="dark"]) { --sidebar-bg:#2c2c2f; --sidebar-outline:rgba(255,255,255,.06); }
    .sidebar-card { width:100%; padding:12px 11px 8px; border-radius:13px;
      color:var(--fg); background:var(--sidebar-bg); border:1px solid var(--sidebar-outline);
      overflow:hidden; font-size:11px; line-height:1.45; }
    .sidebar-source { display:flex; align-items:center; justify-content:space-between;
      gap:6px; color:var(--muted); min-width:0; }
    .sidebar-source-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sidebar-reload { font-size:15px; min-width:21px; height:21px; line-height:1; flex:none; }
    .sidebar-divider { border-top:1px solid var(--line); margin:7px 0 8px; }
    .sidebar-row { display:flex; align-items:center; justify-content:space-between;
      gap:8px; min-width:0; margin:8px 0; }
    .sidebar-row span { min-width:0; }
    .sidebar-row strong { white-space:nowrap; font-size:11px; font-weight:650;
      font-variant-numeric:tabular-nums; }
    .sidebar-row strong.missing { color:var(--muted); font-weight:500; }
    .sidebar-manage { display:block; color:var(--fg); text-decoration:none; border-radius:5px;
      font-size:11px; padding:2px 0 1px; }
    .sidebar-manage:hover { text-decoration:underline; }
    .sidebar-manage:focus-visible { outline:2px solid var(--ok); outline-offset:2px; }
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

  const sidebarCard = document.createElement('section');
  sidebarCard.className = 'sidebar-card';
  sidebarCard.setAttribute('aria-label', 'ChatGPT 用量余额');
  sidebarCard.innerHTML = `
    <div class="sidebar-source">
      <span class="sidebar-source-label" id="sidebar-plan">额度来源：读取中…</span>
      <button class="sidebar-reload" id="sidebar-refresh" type="button"
        aria-label="刷新额度" title="刷新额度">↻</button>
    </div>
    <div class="sidebar-divider"></div>
    <div class="sidebar-row"><span>5 小时用量上限</span><strong id="sidebar-five">读取中…</strong></div>
    <div class="sidebar-row"><span>每周限额</span><strong id="sidebar-week">读取中…</strong></div>
    <div class="sidebar-row"><span>额度</span><strong id="sidebar-credits">读取中…</strong></div>
    <div class="sidebar-divider"></div>
    <a class="sidebar-manage" href="/settings/usage" title="在 ChatGPT 中管理用量">管理用量</a>
  `;
  // Popover and its styling live outside ChatGPT sidebar's overflow containers.
  const popupRoot = document.createElement('div');
  popupRoot.id = 'cg-quota-popup';
  popupRoot.style.cssText = [
    'position:fixed', 'z-index:2147483646', 'width:260px',
    'max-width:calc(100vw - 24px)', 'box-sizing:border-box',
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-size:12px', 'line-height:1.45',
  ].join(';');
  const popupShadow = popupRoot.attachShadow({ mode: 'closed' });
  popupShadow.append(css.cloneNode(true), sidebarCard);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'sidebar-trigger';
  trigger.id = 'sidebar-trigger';
  trigger.title = '查看套餐额度';
  trigger.setAttribute('aria-label', '查看套餐额度');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  // 与桌面客户端一致：短上弧=5小时，长下弧=每周。
  // 无五小时额度时不留空白短弧，改成周额度的完整圆环。
  trigger.innerHTML = `<svg class="quota-icon" viewBox="0 0 36 36" aria-hidden="true">
    <g class="quota-ring-dual">
      <path class="quota-ring-track" d="M8.5 9.6 C13.2 4.9 22.8 4.9 27.5 9.6" pathLength="100"/>
      <path class="quota-ring-progress" id="quota-ring-five" d="M8.5 9.6 C13.2 4.9 22.8 4.9 27.5 9.6" pathLength="100"/>
      <path class="quota-ring-track" d="M29.2 14 V19.2 C29.2 25.9 24.5 30 18 30 C11.5 30 6.8 25.9 6.8 19.2 V14" pathLength="100"/>
      <path class="quota-ring-progress" id="quota-ring-week" d="M29.2 14 V19.2 C29.2 25.9 24.5 30 18 30 C11.5 30 6.8 25.9 6.8 19.2 V14" pathLength="100"/>
    </g>
    <g class="quota-ring-single">
      <circle class="quota-ring-track" cx="18" cy="18" r="12.2"/>
      <circle class="quota-ring-progress" id="quota-ring-week-single" cx="18" cy="18" r="12.2"
        pathLength="100" transform="rotate(-90 18 18)"/>
    </g>
    <path class="quota-ring-diamond" d="M18 13.4 22.6 18 18 22.6 13.4 18Z"/>
  </svg>`;
  shadow.append(trigger);

  const $ = (id) => shadow.getElementById(id);
  const nodes = {
    dot: $('dot'), brand: $('brand-text'), refresh: $('refresh'),
    collapse: $('collapse'),
    fiveValue: $('five-value'), fiveBar: $('five-bar'), fiveReset: $('five-reset'),
    weekValue: $('week-value'), weekBar: $('week-bar'), weekReset: $('week-reset'),
    status: $('status'), updated: $('updated'),
    sidebarPlan: $('sidebar-plan'), sidebarFive: $('sidebar-five'),
    sidebarWeek: $('sidebar-week'), sidebarCredits: $('sidebar-credits'),
    sidebarRefresh: popupShadow.getElementById('sidebar-refresh'),
    ringIcon: shadow.querySelector('.quota-icon'),
    fiveRing: shadow.getElementById('quota-ring-five'),
    weekRing: shadow.getElementById('quota-ring-week'),
    weekFullRing: shadow.getElementById('quota-ring-week-single'),
    trigger,
  };

  function syncTheme() {
    const doc = document.documentElement;
    const dark = doc.classList.contains('dark') ||
      doc.dataset.theme === 'dark' ||
      (!doc.classList.contains('light') && !doc.dataset.theme &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    popupRoot.dataset.theme = root.dataset.theme;
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
    credits: null,
    mode: null,
    timer: null,
    active: false,
    panel: null,
    controller: null,
    generation: 0,
    scanTimer: null,
    popupOpen: false,
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
    // credits 是可选的：无字段不代表账户余额为 0。
    const rawCredits = json?.credits;
    let credits = null;
    if (rawCredits && typeof rawCredits === 'object') {
      if (rawCredits.unlimited === true) credits = { unlimited: true };
      else if (rawCredits.balance !== null && rawCredits.balance !== undefined &&
        String(rawCredits.balance).trim() !== '' && Number.isFinite(Number(rawCredits.balance)) &&
        Number(rawCredits.balance) >= 0) {
        credits = { unlimited: false, balance: Number(rawCredits.balance) };
      } else if (rawCredits.has_credits === false) {
        credits = { unlimited: false, balance: 0 };
      }
    }
    // 部分套餐不返回五小时窗口或任何窗口，不将缺失误判为用尽。
    return { five, week, plan: String(json.plan_type || ''), credits };
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
  function planLabel(plan) {
    const known = { plus: 'Plus', pro: 'Pro', free: 'Free', go: 'Go',
      business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };
    return known[String(plan).toLowerCase()] || (plan ? String(plan) : '当前');
  }
  function renderSidebarWindow(w, node) {
    node.textContent = w ? `剩余 ${Math.round(w.remaining)}%`
      : state.lastSuccess ? '未提供' : (state.error ? '读取失败' : '读取中…');
    node.classList.toggle('missing', !w);
    node.title = w?.resetAt ? `重置倒计时：${clockText(w.resetAt)}`
      : '额度窗口数据不可用';
  }
  // BEGIN QUOTA_ICON_MODEL (pure logic: no guessed percentages)
  function quotaIconModel(five, week) {
    const valid = (item) => item && Number.isFinite(item.remaining)
      ? Math.max(0, Math.min(100, item.remaining)) : null;
    const fivePercent = valid(five);
    const weekPercent = valid(week);
    return {
      layout: fivePercent === null ? 'single' : 'dual',
      fivePercent, weekPercent,
    };
  }
  // END QUOTA_ICON_MODEL

  function renderQuotaIcon() {
    const { layout, fivePercent, weekPercent } =
      quotaIconModel(state.windows.five, state.windows.week);
    nodes.ringIcon.classList.toggle('single', layout === 'single');
    const setProgress = (node, percent) => {
      // SVG pathLength=100 normalizes the two differently sized arcs.
      node.style.strokeDasharray = percent === null ? '0 100' : `${percent} 100`;
    };
    setProgress(nodes.fiveRing, fivePercent);
    setProgress(nodes.weekRing, weekPercent);
    setProgress(nodes.weekFullRing, weekPercent);
    const describe = (percent) => percent === null ? '未提供' : `${Math.round(percent)}%`;
    const label = fivePercent === null
      ? `查看套餐额度：周额度剩余 ${describe(weekPercent)}`
      : `查看套餐额度：5 小时剩余 ${describe(fivePercent)}，周额度剩余 ${describe(weekPercent)}`;
    nodes.trigger.setAttribute('aria-label', label);
    nodes.trigger.title = label;
  }

  function renderSidebar() {
    renderQuotaIcon();
    nodes.sidebarPlan.textContent = state.lastSuccess
      ? `额度来源：你的 ${planLabel(state.plan)} 套餐`
      : '额度来源：' + (state.error ? '获取失败' : '读取中…');
    renderSidebarWindow(state.windows.five, nodes.sidebarFive);
    renderSidebarWindow(state.windows.week, nodes.sidebarWeek);
    const credits = state.credits;
    const creditText = credits?.unlimited ? '不限'
      : credits && Number.isFinite(credits.balance)
        ? `额度：${credits.balance.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
        : state.lastSuccess ? '额度：未提供' : state.error ? '读取失败' : '读取中…';
    nodes.sidebarCredits.textContent = creditText;
    nodes.sidebarCredits.classList.toggle('missing', !credits);
    nodes.sidebarRefresh.disabled = state.loading;
    sidebarCard.title = state.error
      ? `额度更新失败：${state.error}${state.lastSuccess ? '，正在显示上次成功的数据' : ''}`
      : state.lastSuccess ? `上次更新：${new Date(state.lastSuccess).toLocaleTimeString('zh-CN')}`
        : '正在读取账户额度';
  }
  function render() {
    renderSidebar();
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
      state.credits = parsed.credits;
      state.lastSuccess = Date.now();
      state.error = '';
    } catch (error) {
      if (generation !== state.generation || !state.active) return;
      state.error = error?.name === 'AbortError' ? '请求超时' :
        error instanceof Error ? error.message : '未知错误';
      if (/HTTP 401|HTTP 403|访问令牌|重新登录/.test(state.error)) {
        state.windows = { five: null, week: null };
        state.credits = null;
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

  // BEGIN POPOVER_POSITION (pure helper covered by tests)
  function calculatePopoverPosition(anchor, popupWidth, popupHeight,
    viewportWidth, viewportHeight, sidebarEdge = anchor.right) {
    const gap = 10;
    const margin = 12;
    // Desktop-style: popup opens beside the nav, not on top of the trigger.
    const right = Math.max(anchor.right, sidebarEdge) + gap;
    const left = right + popupWidth <= viewportWidth - margin
      ? right : Math.max(margin, anchor.left - popupWidth - gap);
    // Align the popup's lower edge with the trigger, clamped to the viewport.
    const top = Math.max(margin, Math.min(
      anchor.bottom - popupHeight, viewportHeight - popupHeight - margin));
    return { left, top };
  }
  // END POPOVER_POSITION

  function sidebarRightEdge(anchor) {
    // Expanded sidebar: prefer the right edge of the whole navigation panel.
    // This avoids covering the account menu and chat list.
    let edge = anchor.right;
    let element = root.parentElement;
    for (let i = 0; element && i < 12; element = element.parentElement, i++) {
      const rect = element.getBoundingClientRect();
      if (rect.width >= 180 && rect.width <= 480 && rect.left >= -8 &&
          rect.left < 100 && rect.right < innerWidth * .48) {
        edge = Math.max(edge, rect.right);
      }
    }
    return edge;
  }
  function positionPopup() {
    if (!state.popupOpen || !popupRoot.isConnected) return;
    const anchor = nodes.trigger.getBoundingClientRect();
    const rect = popupRoot.getBoundingClientRect();
    const { left, top } = calculatePopoverPosition(anchor, rect.width, rect.height,
      innerWidth, innerHeight, sidebarRightEdge(anchor));
    popupRoot.style.left = `${left}px`;
    popupRoot.style.top = `${top}px`;
  }

  function closePopup() {
    if (!state.popupOpen) return;
    state.popupOpen = false;
    nodes.trigger.setAttribute('aria-expanded', 'false');
    popupRoot.remove();
  }
  function togglePopup() {
    if (!state.active || state.mode !== 'sidebar') return;
    if (state.popupOpen) { closePopup(); return; }
    state.popupOpen = true;
    nodes.trigger.setAttribute('aria-expanded', 'true');
    document.body.appendChild(popupRoot);
    positionPopup();
  }
  nodes.trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePopup();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!state.popupOpen) return;
    const path = event.composedPath();
    if (!path.includes(popupRoot) && !path.includes(root)) closePopup();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.popupOpen) {
      closePopup();
      nodes.trigger.focus();
    }
  });
  window.addEventListener('resize', positionPopup);
  window.addEventListener('scroll', positionPopup, true);

  // BEGIN SIDEBAR_PREDICATES (pure helpers covered by tests)
  function isExpandedSidebarProfile(rect, viewportWidth, viewportHeight) {
    return viewportWidth >= 760 && rect.width >= 130 && rect.width <= 390 &&
      rect.height >= 25 && rect.left >= 0 && rect.right <= Math.min(450, viewportWidth * .46) &&
      rect.top > viewportHeight * .55 && rect.bottom <= viewportHeight + 16;
  }
  // END SIDEBAR_PREDICATES

  // 2026 年网页的展开侧栏账户入口；不可用时退回侧栏滚动区旁的 footer。
  // 不挂载到窄图标 rail 或被 inert 隐藏的重复导航树上。
  function locateSidebarInsertion() {
    const profileButtons = document.querySelectorAll('[data-testid="accounts-profile-button"]');
    for (const button of profileButtons) {
      if (button.closest('[inert], [aria-hidden="true"]')) continue;
      if (!isExpandedSidebarProfile(button.getBoundingClientRect(),
        innerWidth, innerHeight)) continue;
      const parent = button.parentElement;
      const anchor = parent && parent.children.length === 1 ? parent : button;
      if (anchor.parentElement && anchor.parentElement !== document.body) {
        return { parent: anchor.parentElement, anchor };
      }
    }
    for (const scroll of document.querySelectorAll('[data-app-action-sidebar-scroll]')) {
      if (scroll.closest('[inert], [aria-hidden="true"]')) continue;
      const footer = [scroll.nextElementSibling, scroll.parentElement?.nextElementSibling]
        .find((el) => el?.querySelector('button[aria-haspopup="menu"]'));
      const button = footer?.querySelector('button[aria-haspopup="menu"]');
      if (!button || !isExpandedSidebarProfile(button.getBoundingClientRect(),
        innerWidth, innerHeight)) continue;
      return { parent: footer, anchor: footer.firstChild === root ? root.nextSibling : footer.firstChild };
    }
    return null;
  }

  function deactivate() {
    closePopup();
    if (!state.active && !root.isConnected) return;
    state.active = false;
    state.mode = null;
    state.panel = null;
    state.generation++;
    clearTimeout(state.timer);
    state.controller?.abort();
    state.controller = null;
    state.loading = false;
    root.remove();
  }
  function reconcileMount() {
    const workPanel = locateWorkPanel();
    const sidebar = workPanel ? null : locateSidebarInsertion();
    if (!workPanel && !sidebar) { deactivate(); return; }
    const placement = workPanel ? 'work' : 'sidebar';
    const newlyActive = !state.active;
    // Switching between Work and regular chat always dismisses the popover.
    if (state.mode && state.mode !== placement) closePopup();
    root.dataset.placement = placement;
    // 复用同一份数据和轮询定时器，避免 Work 与普通聊天重复请求。
    if (workPanel) {
      if (root.parentElement !== workPanel) workPanel.appendChild(root);
    } else if (root.parentElement !== sidebar.parent ||
               root.nextSibling !== sidebar.anchor) {
      sidebar.parent.insertBefore(root, sidebar.anchor);
    }
    state.active = true;
    state.mode = placement;
    state.panel = workPanel;
    syncTheme();
    render();
    if (state.popupOpen) positionPopup();
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
  function manualRefresh() {
    if (state.active && !state.loading) {
      clearTimeout(state.timer);
      state.timer = null;
      void refresh();
    }
  }
  nodes.refresh.addEventListener('click', manualRefresh);
  nodes.sidebarRefresh.addEventListener('click', manualRefresh);
  sidebarCard.setAttribute('role', 'dialog');
  sidebarCard.setAttribute('aria-label', 'ChatGPT 套餐用量');
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