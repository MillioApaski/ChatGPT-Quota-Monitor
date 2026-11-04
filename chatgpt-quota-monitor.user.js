// ==UserScript==
// @name         ChatGPT Quota Monitor (Work / Codex)
// @namespace    https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @version      1.4.0
// @author       ChatGPT (GPT-6)
// @license      MIT
// @homepageURL  https://github.com/MillioApaski/ChatGPT-Quota-Monitor
// @supportURL   https://github.com/MillioApaski/ChatGPT-Quota-Monitor/issues
// @updateURL    https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js
// @description  5小时与周额度独立悬停提示、高亮圆弧、点击查看详细用量；支持Work。
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @sandbox      DOM
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

  // A low-noise diagnostic on <html> distinguishes "not injected" from
  // "injected but no matching sidebar". Never expose tokens or account data.
  const setDiagnostic = (status, reason = '') => {
    const html = document.documentElement;
    if (!html) return;
    html.dataset.cgQuotaMonitor = '1.4.0';
    html.dataset.cgQuotaState = status;
    if (reason) html.dataset.cgQuotaReason = String(reason).slice(0, 80);
    else delete html.dataset.cgQuotaReason;
  };
  setDiagnostic('started');
  console.info('[ChatGPT Quota Monitor] v1.4.0 started (DOM sandbox)');

  if (document.getElementById('cg-work-quota-root')) {
    setDiagnostic('duplicate-instance');
    return;
  }

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
    /* The two positions are measured independently from the account row.
       Absolute coordinates prevent flex gap/padding/browser zoom drift. */
    :host([data-placement="sidebar"]) { padding:0; }
    .sidebar-trigger { position:relative; width:100%; height:44px; padding:0;
      display:block; border-radius:9px; color:var(--fg); background:transparent;
      cursor:pointer; text-align:left; transition:background .15s ease; }
    .sidebar-trigger:hover, .sidebar-trigger[aria-expanded="true"] {
      background:var(--track);
    }
    .sidebar-trigger .quota-icon { position:absolute;
      left:var(--cg-ring-left, 16px); top:50%; transform:translateY(-50%);
      width:28px; height:28px; overflow:visible; }
    .sidebar-trigger-label { position:absolute; top:50%; transform:translateY(-50%);
      left:var(--cg-label-left, 64px); color:var(--fg); font-size:14px;
      line-height:20px; font-weight:400; white-space:nowrap; }
    :host { --cg-ring-used:#b66c15; }
    :host([data-theme="dark"]) { --cg-ring-used:#ffb64d; }
    .quota-ring-track { fill:none; stroke:var(--muted); opacity:.34;
      stroke-width:3; stroke-linecap:round; }
    .quota-ring-progress { fill:none; stroke:var(--fg); stroke-width:3;
      stroke-linecap:round; stroke-dasharray:0 100;
      transition:stroke-dasharray .25s ease; }
    .quota-ring-used { fill:none; stroke:var(--cg-ring-used); stroke-width:3;
      stroke-linecap:round; stroke-dasharray:0 100;
      transition:stroke-dasharray .25s ease, stroke-dashoffset .25s ease; }
    .quota-ring-diamond { fill:var(--fg); opacity:.65; pointer-events:none; }
    /* SVG hit paths are wider than the visible strokes, and remain
       independent for the upper 5-hour and lower weekly arcs. */
    .quota-ring-hit { fill:none; stroke:transparent; stroke-width:8;
      pointer-events:stroke; cursor:help; }
    .quota-icon[data-hover="five"] .quota-ring-week-group,
    .quota-icon[data-hover="week"] .quota-ring-five-group { opacity:.32; }
    .quota-icon[data-hover="five"] .quota-ring-five-group .quota-ring-progress,
    .quota-icon[data-hover="five"] .quota-ring-five-group .quota-ring-used,
    .quota-icon[data-hover="week"] .quota-ring-week-group .quota-ring-progress,
    .quota-icon[data-hover="week"] .quota-ring-week-group .quota-ring-used {
      stroke-width:4.2; filter:drop-shadow(0 0 2px currentColor);
    }
    .quota-icon[data-hover="five"] .quota-ring-five-group .quota-ring-track,
    .quota-icon[data-hover="week"] .quota-ring-week-group .quota-ring-track {
      opacity:.62; stroke-width:3.6;
    }
    .quota-ring-five-group,.quota-ring-week-group { transition:opacity .16s ease; }
    .quota-tip { display:inline-flex; align-items:center; padding:7px 12px;
      min-height:28px; background:#303035; color:#fff; border-radius:11px;
      box-shadow:0 5px 16px rgba(0,0,0,.28); border:1px solid rgba(255,255,255,.09);
      font-size:12px; font-weight:600; line-height:1.25; white-space:nowrap;
      font-variant-numeric:tabular-nums; }
    @media (prefers-reduced-motion:reduce) {
      .quota-ring-five-group,.quota-ring-week-group { transition:none; }
    }
    .quota-ring-single { display:none; }
    .quota-icon.single .quota-ring-dual { display:none; }
    .quota-icon.single .quota-ring-single { display:block; }
    @media (prefers-reduced-motion:reduce) {
      .quota-ring-progress, .quota-ring-used { transition:none; }
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
  // Both strokes are arcs of the SAME exact circle (center 18,18, radius 14.2).
  // Short upper arc: 234° → 306° (5h).
  // Long lower arc: 324° → 216° clockwise through the bottom (weekly).
  // Using SVG elliptical A commands prevents the flat sides/visible kinks from v1.3.1.
  trigger.innerHTML = `<svg class="quota-icon" viewBox="0 0 36 36" aria-hidden="true">
    <g class="quota-ring-dual">
      <g class="quota-ring-five-group">
      <path class="quota-ring-track" d="M9.65 6.51 A14.2 14.2 0 0 1 26.35 6.51" pathLength="100"/>
      <path class="quota-ring-progress" id="quota-ring-five" d="M9.65 6.51 A14.2 14.2 0 0 1 26.35 6.51" pathLength="100"/>
      <path class="quota-ring-used" id="quota-ring-five-used" d="M9.65 6.51 A14.2 14.2 0 0 1 26.35 6.51" pathLength="100"/>
      <path class="quota-ring-hit" id="quota-hit-five" d="M9.65 6.51 A14.2 14.2 0 0 1 26.35 6.51"/>
      </g>
      <g class="quota-ring-week-group">
      <path class="quota-ring-track" d="M6.51 9.65 A14.2 14.2 0 1 0 29.49 9.65" pathLength="100"/>
      <path class="quota-ring-progress" id="quota-ring-week" d="M6.51 9.65 A14.2 14.2 0 1 0 29.49 9.65" pathLength="100"/>
      <path class="quota-ring-used" id="quota-ring-week-used" d="M6.51 9.65 A14.2 14.2 0 1 0 29.49 9.65" pathLength="100"/>
      <path class="quota-ring-hit" id="quota-hit-week" d="M6.51 9.65 A14.2 14.2 0 1 0 29.49 9.65"/>
      </g>
    </g>
    <g class="quota-ring-single">
      <circle class="quota-ring-track" cx="18" cy="18" r="14.2"/>
      <circle class="quota-ring-progress" id="quota-ring-week-single" cx="18" cy="18" r="14.2"
        pathLength="100" transform="rotate(-90 18 18)"/>
      <circle class="quota-ring-used" id="quota-ring-week-single-used" cx="18" cy="18" r="14.2"
        pathLength="100" transform="rotate(-90 18 18)"/>
      <circle class="quota-ring-hit" id="quota-hit-week-single" cx="18" cy="18" r="14.2"/>
    </g>
    <path class="quota-ring-diamond" d="M18 13.4 22.6 18 18 22.6 13.4 18Z"/>
  </svg><span class="sidebar-trigger-label">额度</span>`;
  shadow.append(trigger);

  // Tooltip is portaled outside the sidebar to avoid overflow clipping.
  // It is never attached until an arc is hovered.
  const hoverRoot = document.createElement('div');
  hoverRoot.id = 'cg-quota-hover-tip';
  hoverRoot.style.cssText = [
    'position:fixed', 'z-index:2147483647',
    'pointer-events:none', 'width:max-content', 'max-width:calc(100vw - 16px)',
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  ].join(';');
  const hoverShadow = hoverRoot.attachShadow({ mode: 'closed' });
  const hoverStyle = document.createElement('style');
  hoverStyle.textContent = `
    * { box-sizing:border-box; }
    .quota-tip { display:inline-flex; align-items:center; padding:7px 12px;
      min-height:28px; background:#303035; color:#fff; border-radius:11px;
      box-shadow:0 5px 16px rgba(0,0,0,.28); border:1px solid rgba(255,255,255,.09);
      font-size:12px; font-weight:600; line-height:1.25; white-space:nowrap;
      font-variant-numeric:tabular-nums; }
  `;
  const hoverText = document.createElement('span');
  hoverText.className = 'quota-tip';
  hoverShadow.append(hoverStyle, hoverText);

  const $ = (id) => shadow.getElementById(id);
  const nodes = {
    dot: $('dot'), brand: $('brand-text'), refresh: $('refresh'),
    collapse: $('collapse'),
    fiveValue: $('five-value'), fiveBar: $('five-bar'), fiveReset: $('five-reset'),
    weekValue: $('week-value'), weekBar: $('week-bar'), weekReset: $('week-reset'),
    status: $('status'), updated: $('updated'),
    // Sidebar card is moved into popupShadow. Look up *all* its nodes there.
    // Otherwise the initial render throws before refresh() can even start.
    sidebarPlan: popupShadow.getElementById('sidebar-plan'),
    sidebarFive: popupShadow.getElementById('sidebar-five'),
    sidebarWeek: popupShadow.getElementById('sidebar-week'),
    sidebarCredits: popupShadow.getElementById('sidebar-credits'),
    sidebarRefresh: popupShadow.getElementById('sidebar-refresh'),
    ringIcon: shadow.querySelector('.quota-icon'),
    sidebarLabel: shadow.querySelector('.sidebar-trigger-label'),
    fiveRing: shadow.getElementById('quota-ring-five'),
    weekRing: shadow.getElementById('quota-ring-week'),
    weekFullRing: shadow.getElementById('quota-ring-week-single'),
    fiveUsedRing: shadow.getElementById('quota-ring-five-used'),
    weekUsedRing: shadow.getElementById('quota-ring-week-used'),
    weekFullUsedRing: shadow.getElementById('quota-ring-week-single-used'),
    fiveHit: shadow.getElementById('quota-hit-five'),
    weekHit: shadow.getElementById('quota-hit-week'),
    weekSingleHit: shadow.getElementById('quota-hit-week-single'),
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
  let hoveredQuota = null;

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
    // Distinguish "used" from "remaining". At 92% and 99% remaining,
    // the 8% and 1% consumed pieces used to blend into the dark track.
    // A contrast-color segment remains proportional; a 1% segment
    // becomes a small visible dot thanks to rounded stroke caps.
    const setUsed = (node, remaining) => {
      if (remaining === null) {
        node.style.strokeDasharray = '0 100';
        node.style.opacity = '0';
        return;
      }
      const used = 100 - remaining;
      node.style.strokeDasharray = `${used} 100`;
      node.style.strokeDashoffset = `${-remaining}`;
      node.style.opacity = used > 0 ? '1' : '0';
    };
    setUsed(nodes.fiveUsedRing, fivePercent);
    setUsed(nodes.weekUsedRing, weekPercent);
    setUsed(nodes.weekFullUsedRing, weekPercent);
    const describe = (percent) => percent === null ? '未提供' : `${Math.round(percent)}%`;
    const label = fivePercent === null
      ? `查看套餐额度：周额度剩余 ${describe(weekPercent)}`
      : `查看套餐额度：5 小时剩余 ${describe(fivePercent)}，周额度剩余 ${describe(weekPercent)}`;
    nodes.trigger.setAttribute('aria-label', label);
    // Native title bubbles conflict with the per-arc tooltip.
    nodes.trigger.removeAttribute('title');
    if (hoveredQuota === 'five' && layout === 'single') hideQuotaHover();
    else if (hoveredQuota) updateQuotaHover();
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

  // BEGIN QUOTA_HOVER_MODEL (pure helpers covered by tests)
  function quotaHoverLabel(kind, five, week) {
    const value = kind === 'five' ? five : week;
    const name = kind === 'five' ? '5 小时' : '每周';
    const remaining = Number.isFinite(value) ?
      '剩余 ' + Math.round(Math.max(0, Math.min(100, value))) + '%' : '未提供';
    return name + ' · ' + remaining;
  }
  function quotaTipPosition(anchor, tipWidth, tipHeight, vw, vh, kind) {
    const gap = 10, edge = 8;
    // Align the tip with upper vs lower arc to imitate the desktop app.
    const centerY = anchor.top + anchor.height * (kind === 'five' ? .24 : .76);
    const left = anchor.right + gap + tipWidth <= vw - edge
      ? anchor.right + gap : Math.max(edge, anchor.left - tipWidth - gap);
    const top = Math.max(edge, Math.min(vh - tipHeight - edge, centerY - tipHeight/2));
    return { left, top };
  }
  // END QUOTA_HOVER_MODEL

  function updateQuotaHover() {
    if (!hoveredQuota || !state.active || state.mode !== 'sidebar' ||
        document.hidden || state.popupOpen) { hideQuotaHover(); return; }
    const { fivePercent, weekPercent } = quotaIconModel(
      state.windows.five, state.windows.week
    );
    hoverText.textContent = quotaHoverLabel(hoveredQuota, fivePercent, weekPercent);
    if (!hoverRoot.isConnected) document.body.appendChild(hoverRoot);
    const anchor = nodes.ringIcon.getBoundingClientRect();
    const tip = hoverRoot.getBoundingClientRect();
    const pos = quotaTipPosition(anchor, tip.width, tip.height,
      innerWidth, innerHeight, hoveredQuota);
    hoverRoot.style.left = pos.left + 'px';
    hoverRoot.style.top = pos.top + 'px';
  }
  function showQuotaHover(kind) {
    if (!state.active || state.mode !== 'sidebar' || state.popupOpen) return;
    const { layout } = quotaIconModel(state.windows.five, state.windows.week);
    if (kind === 'five' && layout === 'single') return;
    hoveredQuota = kind;
    nodes.ringIcon.dataset.hover = kind;
    updateQuotaHover();
  }
  function hideQuotaHover() {
    hoveredQuota = null;
    delete nodes.ringIcon.dataset.hover;
    hoverRoot.remove();
  }

  nodes.fiveHit.addEventListener('pointerenter', () => showQuotaHover('five'));
  nodes.weekHit.addEventListener('pointerenter', () => showQuotaHover('week'));
  nodes.weekSingleHit.addEventListener('pointerenter', () => showQuotaHover('week'));
  for (const hit of [nodes.fiveHit, nodes.weekHit, nodes.weekSingleHit]) {
    hit.addEventListener('pointerleave', (event) => {
      // When crossing directly between the two arcs, let the new hit enter.
      hideQuotaHover();
    });
  }
  nodes.trigger.addEventListener('pointerleave', hideQuotaHover);

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
    hideQuotaHover();
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
  window.addEventListener('resize', () => { positionPopup(); updateQuotaHover(); });
  window.addEventListener('scroll', () => { positionPopup(); updateQuotaHover(); }, true);

  // BEGIN SIDEBAR_PREDICATES (pure helpers covered by tests)
  function isExpandedSidebarProfile(rect, viewportWidth, viewportHeight) {
    return viewportWidth >= 760 && rect.width >= 130 && rect.width <= 390 &&
      rect.height >= 25 && rect.left >= 0 && rect.right <= Math.min(450, viewportWidth * .46) &&
      rect.top > viewportHeight * .55 && rect.bottom <= viewportHeight + 16;
  }
  // END SIDEBAR_PREDICATES

  // The account avatar may be a plain circle with initials, or an image.
  // Prefer the visible, saturated-colored inner circle rather than a padded
  // outer wrapper; the latter caused the icon to sit ~5px left in screenshots.
  function profileColorChroma(color) {
    const parts = /^rgba?\(([^)]+)\)/.exec(color);
    if (!parts) return 0;
    const rgb = parts[1].split(/[ ,/]+/).slice(0, 3).map(Number);
    if (rgb.length !== 3 || !rgb.every(Number.isFinite)) return 0;
    return (Math.max(...rgb) - Math.min(...rgb)) / 255;
  }
  function locateProfileAvatar(profileButton) {
    const profile = profileButton.getBoundingClientRect();
    let best = null;
    let bestScore = -Infinity;
    for (const element of profileButton.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.width > 52 || rect.height < 24 ||
          Math.abs(rect.width - rect.height) > 5 ||
          rect.left < profile.left - 6 || rect.left > profile.left + 92) continue;
      const style = window.getComputedStyle(element);
      const radius = parseFloat(style.borderTopLeftRadius) || 0;
      const round = style.borderTopLeftRadius.includes('%') ||
        radius >= Math.min(rect.width, rect.height) * 0.35;
      const bg = style.backgroundColor || '';
      const hasBg = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
      const isImage = element.tagName === 'IMG';
      if (!round && !isImage) continue;
      const initialText = element.textContent?.trim() || '';
      const hasInitials = initialText.length > 0 && initialText.length <= 3 &&
        /^[\p{L}\p{N}]+$/u.test(initialText);
      const chroma = profileColorChroma(bg);
      // Saturated circular avatars win over neutral wrapper divs.
      const score = (isImage ? 25 : 0) + (chroma > .22 ? 18 * chroma : 0) +
        (round ? 3 : 0) + (hasBg ? 1 : 0) + (hasInitials ? 3 : 0) -
        Math.abs(rect.width - 36) * .08 - (rect.left - profile.left) * .008;
      if (score > bestScore) {
        bestScore = score;
        best = { rect, reliable: isImage || (round && chroma > .30) };
      }
    }
    return best;
  }
  function locateProfileNameLeft(profileButton, avatarRight) {
    const walker = document.createTreeWalker(profileButton, NodeFilter.SHOW_TEXT);
    let node;
    let target = null;
    while ((node = walker.nextNode())) {
      const label = node.textContent?.trim();
      if (!label || label.length > 80) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest('[aria-hidden="true"],[hidden]')) continue;
      const css = window.getComputedStyle(parent);
      if (css.display === 'none' || css.visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width < 6 || rect.height < 8 || rect.left < avatarRight + 3) continue;
      if (!target || rect.top < target.top - 1 ||
          (Math.abs(rect.top - target.top) <= 1 && rect.left < target.left)) {
        target = rect;
      }
    }
    return target?.left ?? null;
  }

  // BEGIN SIDEBAR_ALIGNMENT
  function reconcileProfileAnchors(avatarCenter, nameLeft, avatarWidth, reliableAvatar = false) {
    // ChatGPT profile has a ~12px avatar-to-text gap. If the DOM scanner
    // chose a neutral wrapper/text inset instead, preserve their midpoint
    // while correcting the spacing. A 36px avatar implies 18+12 = 30px
    // between its center and the username's first pixel.
    if (!Number.isFinite(nameLeft)) return { avatarCenter, nameLeft };
    const targetDistance = avatarWidth / 2 + 12;
    const mismatch = nameLeft - avatarCenter - targetDistance;
    if (Math.abs(mismatch) < 5 || Math.abs(mismatch) > 30) {
      return { avatarCenter, nameLeft };
    }
    if (reliableAvatar) {
      // Real colored/photo avatar position is stronger evidence than a text
      // wrapper's inset. Keep its center, align label to the account gap.
      return { avatarCenter, nameLeft: avatarCenter + targetDistance };
    }
    const correction = mismatch / 2;
    return {
      avatarCenter: avatarCenter + correction,
      nameLeft: nameLeft - correction,
    };
  }
  function sidebarAlignment(avatarCenter, nameLeft, hostLeft, ringSize) {
    // Both offsets are relative to the SAME host, not separate flex boxes.
    const ringLeft = Math.max(0, avatarCenter - ringSize / 2 - hostLeft);
    const labelLeft = Math.max(ringLeft + ringSize + 4,
      (nameLeft ?? (avatarCenter + 30)) - hostLeft);
    return { ringLeft: Math.round(ringLeft), labelLeft: Math.round(labelLeft) };
  }
  // END SIDEBAR_ALIGNMENT

  function alignSidebarTrigger(profileButton) {
    if (!profileButton?.isConnected) return;
    const host = root.getBoundingClientRect();
    const profile = profileButton.getBoundingClientRect();
    if (!host.width || !profile.width) return;
    const avatar = locateProfileAvatar(profileButton);
    const avatarRect = avatar?.rect;
    const measuredName = locateProfileNameLeft(profileButton,
      avatarRect?.right ?? (profile.left + 24));
    const measuredCenter = avatarRect ? avatarRect.left + avatarRect.width / 2
      : measuredName !== null ? measuredName - 30 : profile.left + 18;
    const anchors = reconcileProfileAnchors(measuredCenter, measuredName,
      avatarRect?.width ?? 36, avatar?.reliable ?? false);
    const aligned = sidebarAlignment(anchors.avatarCenter,
      anchors.nameLeft, host.left, 28);
    const ringLeft = `${aligned.ringLeft}px`;
    const labelLeft = `${aligned.labelLeft}px`;
    if (root.style.getPropertyValue('--cg-ring-left') !== ringLeft) {
      root.style.setProperty('--cg-ring-left', ringLeft);
    }
    if (root.style.getPropertyValue('--cg-label-left') !== labelLeft) {
      root.style.setProperty('--cg-label-left', labelLeft);
    }
  }

  // BEGIN SIDEBAR_PROFILE_DETECTION
  function looksLikeProfileLocation(rect, viewportWidth, viewportHeight) {
    return rect.width >= 30 && rect.height >= 24 && rect.left >= -6 &&
      rect.right <= Math.min(500, viewportWidth * .45) &&
      rect.top >= viewportHeight * .55 &&
      rect.bottom <= viewportHeight + 24;
  }
  // END SIDEBAR_PROFILE_DETECTION

  function isInExpandedNavigation(element) {
    for (let parent = element?.parentElement; parent && parent !== document.body;
         parent = parent.parentElement) {
      const rect = parent.getBoundingClientRect();
      if (rect.width >= 185 && rect.width <= 455 && rect.height >= 180 &&
          rect.left >= -12 && rect.left <= 110 &&
          rect.bottom >= window.innerHeight - 45) return true;
    }
    return false;
  }

  // Query both explicit account controls and non-button profile areas.
  // ChatGPT changes role, tag name and data-testid between releases.
  const PLAN_LABEL = /^(?:Plus|Pro|Free|Go|Business|Enterprise|Edu|Team)$/i;
  let lastProfile = null;
  let profileScanStats = { targets: 0, geometry: 0, nav: 0, eligible: 0, text: 0 };
  function visibleProfileElement(element) {
    if (!element?.isConnected ||
        element.closest('[inert],[aria-hidden="true"],[hidden]')) return false;
    const css = getComputedStyle(element);
    return css.visibility !== 'hidden' && css.display !== 'none';
  }

  // BEGIN PROFILE_FALLBACK (pure functions, exercised in tests)
  function accountRegionShape(rect, viewportWidth, viewportHeight) {
    return rect.width >= 120 && rect.width <= 460 &&
      rect.height >= 30 && rect.height <= 130 &&
      rect.left >= -8 && rect.left <= 135 &&
      rect.right <= Math.min(520, viewportWidth * .48) &&
      rect.top >= viewportHeight * .48 &&
      rect.top <= viewportHeight + 75 &&
      rect.bottom >= viewportHeight * .60;
  }
  function scoreAccountRegion(rect, viewportHeight, avatarFound, textFound) {
    return (avatarFound ? 30 : 0) + (textFound ? 20 : 0) +
      Math.min(20, Math.max(0, rect.bottom / viewportHeight * 20)) -
      Math.abs(rect.height - 60) * .03;
  }
  // END PROFILE_FALLBACK

  function locateProfileByPlanText() {
    // Use the plan label only as an anchor; never capture the actual username.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, best = null, bestScore = -Infinity;
    while ((node = walker.nextNode())) {
      if (!PLAN_LABEL.test(node.nodeValue?.trim() || '')) continue;
      if (root.contains(node.parentElement) || popupRoot.contains(node.parentElement)) continue;
      const span = node.parentElement;
      if (!span || !visibleProfileElement(span)) continue;
      const labelRect = span.getBoundingClientRect();
      if (labelRect.left < -8 || labelRect.left > 240 ||
          labelRect.top < innerHeight * .55 || labelRect.top > innerHeight + 20 ||
          !labelRect.width || !labelRect.height) continue;
      profileScanStats.text++;
      for (let el = span.parentElement, depth = 0;
           el && el !== document.body && depth < 8;
           el = el.parentElement, depth++) {
        const rect = el.getBoundingClientRect();
        if (!accountRegionShape(rect, innerWidth, innerHeight)) continue;
        if (!visibleProfileElement(el)) continue;
        // Prefer the account row over the overall side navigation/footer.
        const candidates = el.querySelectorAll('img,svg,[class*="avatar"],[data-testid*="avatar"]');
        const hasVisual = Array.from(candidates).some(candidate => {
          const r = candidate.getBoundingClientRect();
          return r.width >= 18 && r.width <= 65 &&
            r.left >= rect.left && r.left <= labelRect.left;
        }) || el.querySelectorAll('*').length >= 2;
        const score = scoreAccountRegion(rect, innerHeight, hasVisual, true) -
          depth * .15;
        if (score > bestScore) { bestScore = score; best = el; }
      }
    }
    return best;
  }

  function profileCandidate() {
    const stats = profileScanStats = { targets: 0, geometry: 0, nav: 0, eligible: 0, text: 0 };
    // Keep a successfully mounted profile if ChatGPT reflows it while the
    // injected row occupies space; do not unmount the row on the next scan.
    if (lastProfile?.isConnected && root.isConnected &&
        visibleProfileElement(lastProfile)) return lastProfile;
    const targets = document.querySelectorAll(
      '[data-testid*="profile"],[data-testid*="account"],' +
      'button[aria-haspopup="menu"],[role="button"][aria-haspopup="menu"],' +
      'button,[role="button"]'
    );
    let best = null, bestScore = -Infinity;
    stats.targets = targets.length;
    for (const candidate of targets) {
      if (!visibleProfileElement(candidate)) continue;
      const rect = candidate.getBoundingClientRect();
      if (!looksLikeProfileLocation(rect, innerWidth, innerHeight)) continue;
      stats.geometry++;
      const nav = isInExpandedNavigation(candidate);
      if (nav) stats.nav++;
      const preferred = candidate.matches('[data-testid="accounts-profile-button"]');
      const label = candidate.textContent?.trim() || '';
      const plan = /\b(Plus|Pro|Free|Go|Business|Enterprise|Edu|Team)\b/.test(label);
      const circle = candidate.querySelector('img,[class*="avatar"],[data-testid*="avatar"]');
      // The nav-ancestor check was too strict on the real ChatGPT sidebar.
      // Prefer it but never make it a mandatory condition.
      if (preferred || plan || (circle && label.length > 1)) {
        stats.eligible++;
        const score = (preferred ? 100 : 0) + (plan ? 30 : 0) +
          (circle ? 8 : 0) + (nav ? 12 : 0) + rect.width * .001;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
    if (!best) best = locateProfileByPlanText();
    if (best) lastProfile = best;
    return best;
  }

  function locateSidebarInsertion() {
    const button = profileCandidate();
    if (!button) return null;
    const parent = button.parentElement;
    if (!parent) return null;
    const anchor = parent.children.length === 1 ? parent : button;
    if (!anchor.parentElement || anchor.parentElement === document.body) return null;
    return { parent: anchor.parentElement, anchor, profileButton: button };
  }

  function deactivate() {
    hideQuotaHover();
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
    if (!workPanel && !sidebar) {
      setDiagnostic('profile-not-found',
        'targets=' + profileScanStats.targets + ',geometry=' + profileScanStats.geometry +
        ',nav=' + profileScanStats.nav + ',eligible=' + profileScanStats.eligible +
        ',planText=' + profileScanStats.text);
      deactivate();
      return;
    }
    const placement = workPanel ? 'work' : 'sidebar';
    const newlyActive = !state.active;
    // Switching between Work and regular chat always dismisses the popover.
    if (state.mode && state.mode !== placement) {
      hideQuotaHover();
      closePopup();
    }
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
    setDiagnostic(placement === 'work' ? 'work-mounted' : 'sidebar-mounted');
    if (sidebar) {
      try {
        alignSidebarTrigger(sidebar.profileButton);
      } catch (error) {
        // A profile DOM/layout change must never make the quota control vanish.
        // Default CSS still yields an operable button and live quota data.
        console.warn('[ChatGPT Quota Monitor] 账号对齐失败，使用默认布局', error);
      }
    }
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
  let lastMountError = '';
  function runMountSafely() {
    try {
      reconcileMount();
      lastMountError = '';
    } catch (error) {
      const message = String(error?.message || error);
      setDiagnostic('mount-error', error?.name || 'Error');
      if (lastMountError !== message) {
        console.error('[ChatGPT Quota Monitor] 侧栏挂载异常:', error);
        lastMountError = message;
      }
      // A scan exception is not fatal; the periodic check retries.
    }
  }
  function scheduleScan() {
    if (state.scanTimer != null) return;
    state.scanTimer = setTimeout(() => {
      state.scanTimer = null;
      runMountSafely();
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
    if (document.hidden) hideQuotaHover();
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
  runMountSafely();
})();